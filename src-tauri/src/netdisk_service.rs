//! Bounded native HTTP transport for netdisk search. Parsing and merging live in
//! the shared frontend core so the browser and desktop use the same contracts.
use reqwest::{Client, Url};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const MAX_BODY: usize = 8 * 1024 * 1024;
static CLIENT: OnceLock<Client> = OnceLock::new();

#[derive(Default)]
struct RequestRegistry {
    pending: HashMap<String, tauri::async_runtime::JoinHandle<()>>,
    cancelled: HashMap<String, Instant>,
}

impl RequestRegistry {
    fn cancel(&mut self, id: String) {
        if let Some(task) = self.pending.remove(&id) {
            task.abort();
        }
        self.cancelled
            .retain(|_, time| time.elapsed() < Duration::from_secs(60));
        if self.cancelled.len() < 128 {
            self.cancelled.insert(id, Instant::now());
        }
    }
}

#[derive(Default)]
pub struct NetdiskRequests(Mutex<RequestRegistry>);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub request_id: String,
    pub kind: String,
    pub base_url: String,
    pub keyword: String,
    #[serde(default)]
    pub refresh: bool,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub cloud_type: String,
}

fn base_url(raw: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw.trim()).map_err(|_| "服务地址无效")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("请填写 HTTP(S) 服务地址，不含账号、查询参数或片段".into());
    }
    url.set_path(&format!("{}/", url.path().trim_end_matches('/')));
    Ok(url)
}

fn client() -> Result<&'static Client, String> {
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .user_agent("Mozilla/5.0 DocTools/1.0")
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(22))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|_| "无法初始化网络连接")?;
    let _ = CLIENT.set(client);
    CLIENT.get().ok_or_else(|| "无法初始化网络连接".into())
}

async fn read_body(request: reqwest::RequestBuilder) -> Result<String, String> {
    let mut response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            "连接超时".to_string()
        } else {
            "连接失败，请检查网络或服务地址".to_string()
        }
    })?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "服务需要认证或拒绝访问".into(),
            429 => "搜索过于频繁，请稍后重试".into(),
            code => format!("服务返回 HTTP {code}"),
        });
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取响应失败")? {
        if body.len() + chunk.len() > MAX_BODY {
            return Err("搜索响应过大".into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| "响应编码无效".into())
}

pub async fn fetch(request: SearchRequest) -> Result<Value, String> {
    let keyword = request.keyword.trim();
    if keyword.is_empty() || keyword.chars().count() > 120 {
        return Err("关键词需为 1–120 个字".into());
    }
    let base = base_url(&request.base_url)?;
    if !matches!(request.cloud_type.as_str(), "" | "baidu" | "aliyun") {
        return Err("不支持的网盘类型".into());
    }
    let client = client()?;
    let body = match request.kind.as_str() {
        "pansou" => {
            let mut req = client.get(base.join("api/search").map_err(|_| "服务地址无效")?)
                .query(&[("kw", keyword), ("res", "merge"), ("src", "all"),
                    ("refresh", if request.refresh { "true" } else { "false" })]);
            if !request.token.trim().is_empty() { req = req.bearer_auth(request.token.trim()); }
            read_body(req).await?
        }
        "melost" | "qkpanso" => {
            let body = json!({
                "page": 1, "q": keyword, "user": "", "exact": false,
                "user_distinct": false, "format": [], "share_time": "",
                "share_year": "", "size": 50, "order": "",
                "type": match request.cloud_type.as_str() { "baidu" => "BDY", "aliyun" => "ALY", _ => "" },
                "search_ticket": "", "exclude_user": [],
                "adv_params": { "wechat_pwd": "", "search_code": "", "platform": "pc", "fp_data": "", "automated": true }
            });
            read_body(client.post(base.join("v1/search/disk").map_err(|_| "服务地址无效")?)
                .header("Origin", base.origin().ascii_serialization())
                .header("Referer", base.join("search").map_err(|_| "服务地址无效")?.as_str())
                .json(&body)).await?
        }
        "qupansou" => read_body(client.post(base.join("search").map_err(|_| "服务地址无效")?)
            .header("Referer", "https://pan.funletu.com/")
            .json(&json!({"style":"get", "datasrc":"search",
                "query":{"searchtext":keyword,"courseid":1,"id":"","datetime":"","categoryid":"","filetypeid":"","filetype":"","reportid":"","validid":""},
                "page":{"pageSize":500,"pageIndex":1},"order":{"prop":"sort","order":"desc"}}))).await?,
        "pansearch" => {
            let html = read_body(client.get(base.join("search").map_err(|_| "服务地址无效")?)
                .query(&[("keyword", keyword)])).await?;
            let pattern = regex::Regex::new(r#"(?s)<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)</script>"#).unwrap();
            return pattern.captures(&html).and_then(|c| serde_json::from_str(&c[1]).ok())
                .ok_or_else(|| "搜索源页面结构已变化".into());
        }
        _ => return Err("不支持的搜索源类型".into()),
    };
    serde_json::from_str(&body).map_err(|_| "服务未返回有效的搜索数据".into())
}

#[tauri::command]
pub async fn search_netdisk_source(
    request: SearchRequest,
    state: tauri::State<'_, NetdiskRequests>,
) -> Result<Value, String> {
    let id = request.request_id.clone();
    if id.is_empty() || id.len() > 160 {
        return Err("请求标识无效".into());
    }
    // The task is polled through a oneshot-style channel without holding a lock
    // across an await; aborting the stored task drops its HTTP request immediately.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    {
        let mut registry = state.0.lock().map_err(|_| "请求状态不可用")?;
        registry
            .cancelled
            .retain(|_, time| time.elapsed() < Duration::from_secs(60));
        // Cancellation can arrive before the invoke task is scheduled.
        if registry.cancelled.contains_key(&id) {
            return Err("搜索已取消".into());
        }
        if registry.pending.len() >= 24 {
            return Err("正在搜索，请稍后再试".into());
        }
        if registry.pending.contains_key(&id) {
            return Err("请求标识重复".into());
        }
        let task = tauri::async_runtime::spawn(async move {
            let result = fetch(request).await;
            let _ = sender.send(result);
        });
        registry.pending.insert(id.clone(), task);
    }
    let result = receiver.await.unwrap_or_else(|_| Err("搜索已取消".into()));
    state
        .0
        .lock()
        .map_err(|_| "请求状态不可用")?
        .pending
        .remove(&id);
    result
}

#[tauri::command]
pub fn cancel_netdisk_search(request_ids: Vec<String>, state: tauri::State<'_, NetdiskRequests>) {
    if let Ok(mut registry) = state.0.lock() {
        for id in request_ids.into_iter().take(24) {
            if id.len() <= 160 {
                registry.cancel(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_endpoints_and_keeps_proxy_prefix() {
        assert_eq!(
            base_url("http://127.0.0.1:8888/proxy")
                .unwrap()
                .join("api/search")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:8888/proxy/api/search"
        );
        for url in [
            "file:///etc/passwd",
            "https://u:p@example.com",
            "https://example.com?token=x",
            "javascript:alert(1)",
        ] {
            assert!(base_url(url).is_err());
        }
    }

    #[test]
    fn cancellation_before_registration_is_remembered_and_bounded() {
        let mut registry = RequestRegistry::default();
        registry.cancel("early".into());
        assert!(registry.cancelled.contains_key("early"));
        for i in 0..1000 {
            registry.cancel(i.to_string());
        }
        assert_eq!(registry.cancelled.len(), 128);
    }
}
