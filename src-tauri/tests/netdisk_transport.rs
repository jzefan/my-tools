use doc_tools_lib::netdisk_service::{SearchRequest, fetch};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
};

fn request(base_url: String, kind: &str) -> SearchRequest {
    SearchRequest {
        request_id: "transport-test".into(),
        kind: kind.into(),
        base_url,
        keyword: "Linux & 资料".into(),
        refresh: true,
        token: "test-token".into(),
        cloud_type: String::new(),
    }
}

fn upstream(status: &str, body: String) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (sender, receiver) = mpsc::channel();
    let status = status.to_string();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let count = stream.read(&mut chunk).unwrap();
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..count]);
            let text = String::from_utf8_lossy(&bytes);
            if let Some(index) = text.find("\r\n\r\n") {
                let length = text[..index]
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if bytes.len() >= index + 4 + length {
                    break;
                }
            }
        }
        let _ = sender.send(String::from_utf8_lossy(&bytes).into_owned());
        let _ = write!(
            stream,
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
    });
    (base, receiver)
}

#[test]
fn native_pansou_transport_encodes_query_and_auth() {
    let (base, received) = upstream("200 OK", r#"{"results":[],"merged_by_type":{}}"#.into());
    let payload = tauri::async_runtime::block_on(fetch(request(base, "pansou"))).unwrap();
    assert!(payload["results"].is_array());
    let wire = received.recv().unwrap();
    assert!(wire.starts_with(
        "GET /api/search?kw=Linux+%26+%E8%B5%84%E6%96%99&res=merge&src=all&refresh=true HTTP/1.1"
    ));
    assert!(
        wire.to_lowercase()
            .contains("authorization: bearer test-token")
    );
}

#[test]
fn native_direct_source_posts_provider_headers_and_drive_filter() {
    let (base, received) = upstream("200 OK", r#"{"code":200,"data":{"list":[]}}"#.into());
    let mut req = request(base.clone(), "melost");
    req.cloud_type = "aliyun".into();
    tauri::async_runtime::block_on(fetch(req)).unwrap();
    let wire = received.recv().unwrap();
    assert!(wire.starts_with("POST /v1/search/disk HTTP/1.1"));
    assert!(wire.contains(&format!("origin: {base}")));
    let body: serde_json::Value =
        serde_json::from_str(wire.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(body["q"], "Linux & 资料");
    assert_eq!(body["type"], "ALY");
    assert_eq!(body["size"], 50);
    assert!(!wire.to_lowercase().contains("authorization:"));
}

#[test]
#[ignore = "requires public network"]
fn live_direct_sources() {
    for (kind, base) in [
        ("melost", "https://www.melost.cn"),
        ("qkpanso", "https://qkpanso.com"),
    ] {
        for keyword in ["史记", "红楼梦"] {
            let mut req = request(base.into(), kind);
            req.keyword = keyword.into();
            req.token.clear();
            let started = std::time::Instant::now();
            let payload = tauri::async_runtime::block_on(fetch(req)).unwrap();
            assert_eq!(payload["code"], 200);
            let rows = payload["data"]["list"].as_array().unwrap();
            assert!(!rows.is_empty());
            println!(
                "{kind} {keyword}: {} results in {:.2}s",
                rows.len(),
                started.elapsed().as_secs_f64()
            );
        }
    }
    for cloud_type in ["baidu", "aliyun"] {
        let mut req = request("https://www.melost.cn".into(), "melost");
        req.keyword = "史记".into();
        req.cloud_type = cloud_type.into();
        let payload = tauri::async_runtime::block_on(fetch(req)).unwrap();
        let rows = payload["data"]["list"].as_array().unwrap();
        assert!(!rows.is_empty());
        println!("melost 史记 {cloud_type}: {} results", rows.len());
    }
}

#[test]
fn native_pansearch_extracts_next_data() {
    let (base, _) = upstream("200 OK", r#"<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"data":{"data":[]}}}}</script></html>"#.into());
    let payload = tauri::async_runtime::block_on(fetch(request(base, "pansearch"))).unwrap();
    assert!(payload["props"]["pageProps"]["data"]["data"].is_array());
}

#[test]
fn native_transport_reports_auth_rate_limit_invalid_json_and_oversize() {
    for (status, body, expected) in [
        ("401 Unauthorized", "{}".into(), "认证"),
        ("429 Too Many Requests", "{}".into(), "频繁"),
        ("200 OK", "<html>login</html>".into(), "有效"),
        ("200 OK", " ".repeat(8 * 1024 * 1024 + 1), "过大"),
    ] {
        let (base, _) = upstream(status, body);
        assert!(
            tauri::async_runtime::block_on(fetch(request(base, "pansou")))
                .unwrap_err()
                .contains(expected)
        );
    }
}

/// Explicit live smoke: cargo test --test netdisk_transport live_pansou -- --ignored --nocapture
#[test]
#[ignore = "requires public network"]
fn live_pansou() {
    for keyword in ["Linux", "红楼梦", "Python"] {
        let mut req = request("https://so.252035.xyz".into(), "pansou");
        req.keyword = keyword.into();
        req.token.clear();
        req.refresh = false;
        let payload = tauri::async_runtime::block_on(fetch(req)).unwrap();
        let data = payload.get("data").unwrap_or(&payload);
        let total = data["total"].as_u64().unwrap_or_default();
        println!("{keyword}: {total} upstream results");
        assert!(data["results"].is_array() || data["merged_by_type"].is_object());
        assert!(total > 0);
    }
}
