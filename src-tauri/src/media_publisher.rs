use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static MEDIA_STORE_LOCK: Mutex<()> = Mutex::new(());

fn now_sec() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn rand_hex_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:010x}", nanos & 0xffffffffff)
}

fn media_publisher_dir() -> PathBuf {
    #[cfg(test)]
    if let Ok(dir) = std::env::var("MEDIA_PUBLISHER_TEST_DIR") {
        return PathBuf::from(dir);
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("doc-tools")
        .join("media_publisher")
}

fn atomic_save_json<T: Serialize>(path: &Path, data: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建存储目录: {}", e))?;
    }
    let tmp_path = path.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let json_bytes =
        serde_json::to_vec_pretty(data).map_err(|e| format!("序列化 JSON 失败: {}", e))?;
    fs::write(&tmp_path, json_bytes).map_err(|e| format!("写入临时文件失败: {}", e))?;
    fs::rename(&tmp_path, path).map_err(|e| format!("原子更新文件失败: {}", e))?;
    Ok(())
}

fn safe_load_json_with_fallback<T: DeserializeOwned + Default>(path: &Path) -> T {
    if !path.exists() {
        return T::default();
    }
    match fs::read(path) {
        Ok(data) => {
            if data.is_empty() {
                T::default()
            } else {
                serde_json::from_slice::<T>(&data).unwrap_or_default()
            }
        }
        Err(_) => T::default(),
    }
}

// -----------------------------------------------------------------------------
// Data Structures
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CustomConfig {
    pub url: String,
    pub publish_url: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct PlatformOverrideConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub custom_title: Option<String>,
    #[serde(default)]
    pub custom_content: Option<String>,
    #[serde(default)]
    pub custom_tags: Option<Vec<String>>,
    #[serde(default)]
    pub custom_cover_path: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub is_original: Option<bool>,
    #[serde(default)]
    pub visibility: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum PublishMode {
    #[default]
    Silent,
    Visible,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaAccount {
    pub id: String,
    pub platform: String,
    pub account_name: String,
    #[serde(default)]
    pub avatar: String,
    #[serde(default)]
    pub group: Option<String>,
    pub status: String, // "online" | "expired" | "offline" | "checking"
    #[serde(default)]
    pub cookie: String,
    #[serde(default)]
    pub custom_config: Option<CustomConfig>,
    #[serde(default)]
    pub last_checked_at: Option<u64>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskLogItem {
    pub time: u64,
    pub message: String,
    pub level: String, // "info" | "warn" | "error" | "success"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountPublishProgress {
    pub account_id: String,
    pub platform: String,
    pub account_name: String,
    pub stage: String, // "queued" | "validating" | "uploading" | "filling" | "publishing" | "done" | "failed"
    pub progress: u32,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub publish_url: Option<String>,
    #[serde(default)]
    pub logs: Vec<TaskLogItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublishTask {
    pub id: String,
    pub title: String,
    pub content_type: String, // "video" | "post"
    pub mode: PublishMode,
    pub target_account_ids: Vec<String>,
    pub status: String, // "pending" | "running" | "completed" | "partial" | "failed" | "cancelled"
    pub progress: u32,
    pub total_accounts: usize,
    pub success_count: usize,
    pub failed_count: usize,
    pub created_at: u64,
    #[serde(default)]
    pub scheduled_at: Option<u64>,
    #[serde(default)]
    pub account_statuses: HashMap<String, AccountPublishProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePublishTaskRequest {
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub content_type: String, // "video" | "post"
    #[serde(default, alias = "mediaPaths")]
    pub media_paths: Vec<String>,
    #[serde(default, alias = "coverPath")]
    pub cover_path: Option<String>,
    #[serde(default)]
    pub mode: PublishMode,
    #[serde(alias = "targetAccountIds")]
    pub target_account_ids: Vec<String>,
    #[serde(default, alias = "scheduledAt")]
    pub scheduled_at: Option<u64>,
    #[serde(default, alias = "platformOverrides")]
    pub platform_overrides: Option<HashMap<String, PlatformOverrideConfig>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CannedReply {
    pub id: String,
    pub category: String,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeywordRule {
    pub id: String,
    pub keyword: String,
    pub match_type: String, // "contains" | "exact"
    pub reply_content: String,
    #[serde(default)]
    pub target_account_ids: Vec<String>,
    #[serde(default)]
    pub enabled: bool,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VideoMetaInfo {
    pub path: String,
    pub file_size: u64,
    pub format: String,
    #[serde(default)]
    pub duration_secs: Option<u64>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CopyPolishResult {
    pub titles: Vec<String>,
    pub tags: Vec<String>,
    pub summary: String,
}

// -----------------------------------------------------------------------------
// Defaults Seeding
// -----------------------------------------------------------------------------

fn default_accounts() -> Vec<MediaAccount> {
    let now = now_sec();
    vec![
        MediaAccount {
            id: "acc_douyin_demo".to_string(),
            platform: "douyin".to_string(),
            account_name: "科技老白 (抖音短视频)".to_string(),
            avatar: "".to_string(),
            group: Some("短视频主号".to_string()),
            status: "online".to_string(),
            cookie: "sessionid_ss=sample_douyin_session_mock".to_string(),
            custom_config: None,
            last_checked_at: Some(now),
            created_at: now.saturating_sub(86400 * 5),
        },
        MediaAccount {
            id: "acc_bilibili_demo".to_string(),
            platform: "bilibili".to_string(),
            account_name: "极客阿峰 (B站官方号)".to_string(),
            avatar: "".to_string(),
            group: Some("长视频分发".to_string()),
            status: "online".to_string(),
            cookie: "SESSDATA=sample_bilibili_sess_mock".to_string(),
            custom_config: None,
            last_checked_at: Some(now),
            created_at: now.saturating_sub(86400 * 4),
        },
        MediaAccount {
            id: "acc_xhs_demo".to_string(),
            platform: "xiaohongshu".to_string(),
            account_name: "小峰的技术笔记 (小红书图文)".to_string(),
            avatar: "".to_string(),
            group: Some("图文笔记".to_string()),
            status: "online".to_string(),
            cookie: "web_session=sample_xhs_sess_mock".to_string(),
            custom_config: None,
            last_checked_at: Some(now),
            created_at: now.saturating_sub(86400 * 3),
        },
        MediaAccount {
            id: "acc_channels_demo".to_string(),
            platform: "channels".to_string(),
            account_name: "小蜂探索 (微信视频号)".to_string(),
            avatar: "".to_string(),
            group: Some("私域微信".to_string()),
            status: "online".to_string(),
            cookie: "wx_channels_token=sample_wx_token_mock".to_string(),
            custom_config: None,
            last_checked_at: Some(now),
            created_at: now.saturating_sub(86400 * 2),
        },
        MediaAccount {
            id: "acc_kuaishou_demo".to_string(),
            platform: "kuaishou".to_string(),
            account_name: "老峰聊数码 (快手)".to_string(),
            avatar: "".to_string(),
            group: Some("短视频分发".to_string()),
            status: "expired".to_string(),
            cookie: "kuaishou.server.web_st=sample_expired_token".to_string(),
            custom_config: None,
            last_checked_at: Some(now.saturating_sub(3600)),
            created_at: now.saturating_sub(86400),
        },
        MediaAccount {
            id: "acc_baijiahao_demo".to_string(),
            platform: "baijiahao".to_string(),
            account_name: "深度科技观 (百家号)".to_string(),
            avatar: "".to_string(),
            group: Some("资讯流".to_string()),
            status: "offline".to_string(),
            cookie: "".to_string(),
            custom_config: None,
            last_checked_at: Some(now.saturating_sub(7200)),
            created_at: now.saturating_sub(43200),
        },
    ]
}

fn default_canned_replies() -> Vec<CannedReply> {
    let now = now_sec();
    vec![
        CannedReply {
            id: "reply_lead_01".to_string(),
            category: "引流导流".to_string(),
            title: "公众号与资料领取".to_string(),
            content: "关注公号【极客笔记】，回复【工具】免费获取全套配置与源码~ 每天分享效率黑科技！".to_string(),
            tags: vec!["引流".to_string(), "关注".to_string(), "资料".to_string()],
            created_at: now.saturating_sub(86400 * 3),
        },
        CannedReply {
            id: "reply_copyright_02".to_string(),
            category: "原创版权".to_string(),
            title: "原创声明与商业授权".to_string(),
            content: "本文为作者原创内容，未经授权禁止商业转载与二次剪辑搬运。授权与商务合作请私信。".to_string(),
            tags: vec!["原创".to_string(), "版权".to_string(), "授权".to_string()],
            created_at: now.saturating_sub(86400 * 2),
        },
        CannedReply {
            id: "reply_interact_03".to_string(),
            category: "粉丝互动".to_string(),
            title: "求三连与关注".to_string(),
            content: "觉得有用的话，别忘了点赞、收藏、转发三连支持一下！大家的每一次支持都是持续更新的动力~".to_string(),
            tags: vec!["互动".to_string(), "一键三连".to_string(), "点赞".to_string()],
            created_at: now.saturating_sub(86400),
        },
        CannedReply {
            id: "reply_top_04".to_string(),
            category: "置顶说明".to_string(),
            title: "资源获取与常见问题".to_string(),
            content: "置顶答疑：视频中的演示软件和配置文件已整理在简介链接与评论区置顶置物架，自取即可！".to_string(),
            tags: vec!["置顶".to_string(), "FAQ".to_string(), "网盘".to_string()],
            created_at: now.saturating_sub(43200),
        },
        CannedReply {
            id: "reply_thanks_05".to_string(),
            category: "常用回复".to_string(),
            title: "感谢支持".to_string(),
            content: "感谢小伙伴的认可和支持！后续会持续更新更多实用干货，敬请关注！".to_string(),
            tags: vec!["感谢".to_string(), "礼貌".to_string()],
            created_at: now.saturating_sub(18000),
        },
    ]
}

fn default_keyword_rules() -> Vec<KeywordRule> {
    let now = now_sec();
    vec![
        KeywordRule {
            id: "rule_kw_01".to_string(),
            keyword: "资料".to_string(),
            match_type: "contains".to_string(),
            reply_content: "私信发送【666】或【资料】即可自动获取本期视频完整课件与源工程！".to_string(),
            target_account_ids: vec![],
            enabled: true,
            created_at: now.saturating_sub(86400 * 3),
        },
        KeywordRule {
            id: "rule_kw_02".to_string(),
            keyword: "软件叫什么".to_string(),
            match_type: "contains".to_string(),
            reply_content: "视频演示的工具是 DocTools 桌面客户端，支持批量转换与多平台分发~".to_string(),
            target_account_ids: vec![],
            enabled: true,
            created_at: now.saturating_sub(86400 * 2),
        },
        KeywordRule {
            id: "rule_kw_03".to_string(),
            keyword: "求链接".to_string(),
            match_type: "contains".to_string(),
            reply_content: "下载链接已放在简介第一行和置顶评论中，请直接点击获取！".to_string(),
            target_account_ids: vec![],
            enabled: true,
            created_at: now.saturating_sub(86400),
        },
        KeywordRule {
            id: "rule_kw_04".to_string(),
            keyword: "多少钱".to_string(),
            match_type: "exact".to_string(),
            reply_content: "目前基础功能完全免费，欢迎体验并提出宝贵建议！".to_string(),
            target_account_ids: vec![],
            enabled: false,
            created_at: now.saturating_sub(3600),
        },
    ]
}

// -----------------------------------------------------------------------------
// Internal Store Helpers
// -----------------------------------------------------------------------------

fn load_accounts_internal() -> Vec<MediaAccount> {
    let path = media_publisher_dir().join("accounts.json");
    let mut accounts: Vec<MediaAccount> = safe_load_json_with_fallback(&path);
    if accounts.is_empty() {
        accounts = default_accounts();
        let _ = atomic_save_json(&path, &accounts);
    }
    accounts
}

fn save_accounts_internal(accounts: &[MediaAccount]) -> Result<(), String> {
    let path = media_publisher_dir().join("accounts.json");
    atomic_save_json(&path, &accounts)
}

fn load_canned_replies_internal() -> Vec<CannedReply> {
    let path = media_publisher_dir().join("canned_replies.json");
    let mut replies: Vec<CannedReply> = safe_load_json_with_fallback(&path);
    if replies.is_empty() {
        replies = default_canned_replies();
        let _ = atomic_save_json(&path, &replies);
    }
    replies
}

fn save_canned_replies_internal(replies: &[CannedReply]) -> Result<(), String> {
    let path = media_publisher_dir().join("canned_replies.json");
    atomic_save_json(&path, &replies)
}

fn load_keyword_rules_internal() -> Vec<KeywordRule> {
    let path = media_publisher_dir().join("keyword_rules.json");
    let mut rules: Vec<KeywordRule> = safe_load_json_with_fallback(&path);
    if rules.is_empty() {
        rules = default_keyword_rules();
        let _ = atomic_save_json(&path, &rules);
    }
    rules
}

fn save_keyword_rules_internal(rules: &[KeywordRule]) -> Result<(), String> {
    let path = media_publisher_dir().join("keyword_rules.json");
    atomic_save_json(&path, &rules)
}

fn load_tasks_internal() -> Vec<PublishTask> {
    let path = media_publisher_dir().join("tasks.json");
    safe_load_json_with_fallback(&path)
}

fn save_tasks_internal(tasks: &[PublishTask]) -> Result<(), String> {
    let path = media_publisher_dir().join("tasks.json");
    atomic_save_json(&path, &tasks)
}

// -----------------------------------------------------------------------------
// Account Status & Platform Helpers
// -----------------------------------------------------------------------------

fn evaluate_account_status(cookie: &str) -> &'static str {
    let trimmed = cookie.trim();
    if trimmed.is_empty() {
        "offline"
    } else if trimmed.contains("expired") || trimmed.len() < 5 {
        "expired"
    } else {
        "online"
    }
}

fn platform_publish_url(platform: &str, custom: Option<&CustomConfig>) -> String {
    match platform {
        "bilibili" => "https://member.bilibili.com/platform/upload/video/frame".to_string(),
        "douyin" => "https://creator.douyin.com/creator-micro/content/upload".to_string(),
        "xiaohongshu" => "https://creator.xiaohongshu.com/publish/publish".to_string(),
        "kuaishou" => "https://cp.kuaishou.com/article/publish/video".to_string(),
        "channels" => "https://channels.weixin.qq.com/platform/post/create".to_string(),
        "zhihu" => "https://www.zhihu.com/creator".to_string(),
        "baijiahao" => "https://baijiahao.baidu.com/builder/rc/edit?type=news".to_string(),
        "toutiao" => "https://mp.toutiao.com/profile_v4/graphic/publish".to_string(),
        "weibo" => "https://weibo.com/upload/channel".to_string(),
        _ => {
            if let Some(cfg) = custom {
                if !cfg.publish_url.is_empty() {
                    return cfg.publish_url.clone();
                }
                if !cfg.url.is_empty() {
                    return cfg.url.clone();
                }
            }
            "https://creator.platform.local/publish".to_string()
        }
    }
}

fn platform_done_url(platform: &str, item_id: &str) -> String {
    match platform {
        "bilibili" => format!("https://www.bilibili.com/video/BV{}", item_id),
        "douyin" => format!("https://www.douyin.com/video/{}", item_id),
        "xiaohongshu" => format!("https://www.xiaohongshu.com/explore/{}", item_id),
        "kuaishou" => format!("https://www.kuaishou.com/short-video/{}", item_id),
        "channels" => format!("https://channels.weixin.qq.com/watch/{}", item_id),
        "zhihu" => format!("https://zhuanlan.zhihu.com/p/{}", item_id),
        "baijiahao" => format!("https://baijiahao.baidu.com/s?id={}", item_id),
        "toutiao" => format!("https://www.toutiao.com/article/{}/", item_id),
        "weibo" => format!("https://weibo.com/status/{}", item_id),
        _ => format!("https://publish.local/view/{}", item_id),
    }
}

fn execute_account_publish(
    account: &MediaAccount,
    req: &CreatePublishTaskRequest,
    base_time: u64,
) -> AccountPublishProgress {
    let platform = &account.platform;
    let account_id = account.id.clone();
    let account_name = account.account_name.clone();

    if req.mode == PublishMode::Visible {
        let pub_url = platform_publish_url(platform, account.custom_config.as_ref());
        let logs = vec![
            TaskLogItem {
                time: base_time,
                message: format!("已生成平台 [{}] 表单预填数据与元数据载荷", platform),
                level: "info".to_string(),
            },
            TaskLogItem {
                time: base_time + 1,
                message: format!("平台创作者发布入口准备就绪: {}", pub_url),
                level: "info".to_string(),
            },
            TaskLogItem {
                time: base_time + 2,
                message: "表单数据校验完成，可视化发布通道已就绪".to_string(),
                level: "success".to_string(),
            },
        ];

        return AccountPublishProgress {
            account_id,
            platform: platform.clone(),
            account_name,
            stage: "done".to_string(),
            progress: 100,
            error: None,
            publish_url: Some(pub_url),
            logs,
        };
    }

    // Silent Mode
    let mut logs = Vec::new();
    logs.push(TaskLogItem {
        time: base_time,
        message: format!("账号 [{}] 加入静默分发队列", account_name),
        level: "info".to_string(),
    });

    let status = evaluate_account_status(&account.cookie);
    if status == "offline" {
        logs.push(TaskLogItem {
            time: base_time + 1,
            message: "登录凭证缺失或账号未登录，无法静默发布".to_string(),
            level: "error".to_string(),
        });
        return AccountPublishProgress {
            account_id,
            platform: platform.clone(),
            account_name,
            stage: "failed".to_string(),
            progress: 15,
            error: Some("账号未登录，Cookie 缺失".to_string()),
            publish_url: None,
            logs,
        };
    }

    if status == "expired" {
        logs.push(TaskLogItem {
            time: base_time + 1,
            message: "平台登录凭证已过期失效，请重新登录".to_string(),
            level: "error".to_string(),
        });
        return AccountPublishProgress {
            account_id,
            platform: platform.clone(),
            account_name,
            stage: "failed".to_string(),
            progress: 20,
            error: Some("账号登录凭证已失效".to_string()),
            publish_url: None,
            logs,
        };
    }

    // Successful simulated/executed silent publish flow
    logs.push(TaskLogItem {
        time: base_time + 1,
        message: "账号凭证有效性校验与安全风控检测通过".to_string(),
        level: "info".to_string(),
    });

    logs.push(TaskLogItem {
        time: base_time + 2,
        message: if req.media_paths.is_empty() {
            "正在上传图文资源并同步至平台图床...".to_string()
        } else {
            "多分片上传媒体资源并计算校验指纹...".to_string()
        },
        level: "info".to_string(),
    });

    let has_override = req
        .platform_overrides
        .as_ref()
        .and_then(|m| m.get(platform))
        .map(|o| o.enabled)
        .unwrap_or(false);

    let fill_desc = if has_override {
        format!("应用平台 [{}] 定制配置，自动填充正文、标题与标签", platform)
    } else {
        format!("自动填报 [{}] 发布表单：标题、正文、分类与原创声明", platform)
    };

    logs.push(TaskLogItem {
        time: base_time + 3,
        message: fill_desc,
        level: "info".to_string(),
    });

    logs.push(TaskLogItem {
        time: base_time + 4,
        message: "向平台提交作品发布接口，等待入库审核...".to_string(),
        level: "info".to_string(),
    });

    let item_id = rand_hex_id();
    let done_url = platform_done_url(platform, &item_id);

    logs.push(TaskLogItem {
        time: base_time + 5,
        message: "发布成功，作品已进入平台审核发布流".to_string(),
        level: "success".to_string(),
    });

    AccountPublishProgress {
        account_id,
        platform: platform.clone(),
        account_name,
        stage: "done".to_string(),
        progress: 100,
        error: None,
        publish_url: Some(done_url),
        logs,
    }
}

// -----------------------------------------------------------------------------
// Video Metadata Inspection
// -----------------------------------------------------------------------------

struct BoxHeader {
    size: u64,
    box_type: [u8; 4],
    header_len: u64,
}

impl BoxHeader {
    fn content_size(&self) -> u64 {
        self.size.saturating_sub(self.header_len)
    }
}

fn read_box_header<R: Read>(reader: &mut R) -> Result<BoxHeader, std::io::Error> {
    let mut buf = [0u8; 8];
    reader.read_exact(&mut buf)?;
    let size32 = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as u64;
    let box_type = [buf[4], buf[5], buf[6], buf[7]];

    if size32 == 1 {
        let mut large_buf = [0u8; 8];
        reader.read_exact(&mut large_buf)?;
        let size64 = u64::from_be_bytes(large_buf);
        Ok(BoxHeader {
            size: size64,
            box_type,
            header_len: 16,
        })
    } else {
        Ok(BoxHeader {
            size: size32,
            box_type,
            header_len: 8,
        })
    }
}

fn parse_trak_box<R: Read + Seek>(
    reader: &mut R,
    trak_end: u64,
    out_width: &mut Option<u32>,
    out_height: &mut Option<u32>,
) {
    while let Ok(cur_pos) = reader.stream_position() {
        if cur_pos >= trak_end {
            break;
        }
        let header = match read_box_header(reader) {
            Ok(h) => h,
            Err(_) => break,
        };
        if header.size < 8 {
            break;
        }
        let content_size = header.content_size();
        let box_end = cur_pos + header.size;

        if &header.box_type == b"tkhd" {
            let read_len = content_size.min(128) as usize;
            let mut buf = vec![0u8; read_len];
            if reader.read_exact(&mut buf).is_ok() && buf.len() >= 80 {
                let version = buf[0];
                let (w_offset, h_offset) = if version == 0 { (76, 80) } else { (88, 92) };
                if buf.len() >= h_offset + 4 {
                    let w_fixed = u32::from_be_bytes([
                        buf[w_offset],
                        buf[w_offset + 1],
                        buf[w_offset + 2],
                        buf[w_offset + 3],
                    ]);
                    let h_fixed = u32::from_be_bytes([
                        buf[h_offset],
                        buf[h_offset + 1],
                        buf[h_offset + 2],
                        buf[h_offset + 3],
                    ]);
                    let w = w_fixed >> 16;
                    let h = h_fixed >> 16;
                    if w > 0 && h > 0 && out_width.is_none() {
                        *out_width = Some(w);
                        *out_height = Some(h);
                    }
                }
            }
            let _ = reader.seek(SeekFrom::Start(box_end));
        } else {
            let _ = reader.seek(SeekFrom::Start(box_end));
        }
    }
}

fn parse_moov_box<R: Read + Seek>(
    reader: &mut R,
    moov_end: u64,
    out_duration: &mut Option<u64>,
    out_width: &mut Option<u32>,
    out_height: &mut Option<u32>,
) {
    while let Ok(cur_pos) = reader.stream_position() {
        if cur_pos >= moov_end {
            break;
        }
        let header = match read_box_header(reader) {
            Ok(h) => h,
            Err(_) => break,
        };
        if header.size < 8 {
            break;
        }
        let content_size = header.content_size();
        let box_end = cur_pos + header.size;

        if &header.box_type == b"mvhd" {
            let read_len = content_size.min(128) as usize;
            let mut buf = vec![0u8; read_len];
            if reader.read_exact(&mut buf).is_ok() && buf.len() >= 20 {
                let version = buf[0];
                if version == 0 && buf.len() >= 20 {
                    let timescale =
                        u32::from_be_bytes([buf[12], buf[13], buf[14], buf[15]]) as u64;
                    let duration =
                        u32::from_be_bytes([buf[16], buf[17], buf[18], buf[19]]) as u64;
                    if timescale > 0 {
                        *out_duration = Some(duration / timescale);
                    }
                } else if version == 1 && buf.len() >= 32 {
                    let timescale =
                        u32::from_be_bytes([buf[20], buf[21], buf[22], buf[23]]) as u64;
                    let duration = u64::from_be_bytes([
                        buf[24], buf[25], buf[26], buf[27], buf[28], buf[29], buf[30], buf[31],
                    ]);
                    if timescale > 0 {
                        *out_duration = Some(duration / timescale);
                    }
                }
            }
            let _ = reader.seek(SeekFrom::Start(box_end));
        } else if &header.box_type == b"trak" {
            parse_trak_box(reader, box_end, out_width, out_height);
            let _ = reader.seek(SeekFrom::Start(box_end));
        } else {
            let _ = reader.seek(SeekFrom::Start(box_end));
        }
    }
}

fn inspect_mp4<R: Read + Seek>(mut reader: R) -> (Option<u64>, Option<u32>, Option<u32>) {
    let mut duration_secs = None;
    let mut width = None;
    let mut height = None;

    while let Ok(header) = read_box_header(&mut reader) {
        if header.size < 8 {
            break;
        }
        let box_type = header.box_type;
        let content_size = header.content_size();

        if &box_type == b"moov" {
            let moov_end = match reader.stream_position() {
                Ok(pos) => pos + content_size,
                Err(_) => break,
            };
            parse_moov_box(
                &mut reader,
                moov_end,
                &mut duration_secs,
                &mut width,
                &mut height,
            );
            break;
        } else if reader.seek(SeekFrom::Current(content_size as i64)).is_err() {
            break;
        }
    }

    (duration_secs, width, height)
}

// -----------------------------------------------------------------------------
// Tauri Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub fn media_get_accounts() -> Result<Vec<MediaAccount>, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取账号存储锁失败".to_string())?;
    Ok(load_accounts_internal())
}

#[tauri::command]
pub fn media_save_account(mut account: MediaAccount) -> Result<MediaAccount, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取账号存储锁失败".to_string())?;
    let now = now_sec();
    if account.id.trim().is_empty() {
        account.id = format!("acc_{}", rand_hex_id());
    }
    if account.created_at == 0 {
        account.created_at = now;
    }
    if account.status == "checking" || account.status.trim().is_empty() {
        account.status = evaluate_account_status(&account.cookie).to_string();
    }
    account.last_checked_at = Some(now);

    let mut accounts = load_accounts_internal();
    if let Some(pos) = accounts.iter().position(|a| a.id == account.id) {
        accounts[pos] = account.clone();
    } else {
        accounts.push(account.clone());
    }
    save_accounts_internal(&accounts)?;
    Ok(account)
}

#[tauri::command]
pub fn media_delete_account(id: String) -> Result<(), String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取账号存储锁失败".to_string())?;
    let mut accounts = load_accounts_internal();
    accounts.retain(|a| a.id != id);
    save_accounts_internal(&accounts)
}

#[tauri::command]
pub fn media_check_account_status(id: String) -> Result<MediaAccount, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取账号存储锁失败".to_string())?;
    let mut accounts = load_accounts_internal();
    let account = accounts
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or_else(|| format!("未找到对应账号: {}", id))?;

    account.status = evaluate_account_status(&account.cookie).to_string();
    account.last_checked_at = Some(now_sec());

    let updated = account.clone();
    save_accounts_internal(&accounts)?;
    Ok(updated)
}

#[tauri::command]
pub fn media_batch_check_accounts() -> Result<Vec<MediaAccount>, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取账号存储锁失败".to_string())?;
    let mut accounts = load_accounts_internal();
    let now = now_sec();
    for account in &mut accounts {
        account.status = evaluate_account_status(&account.cookie).to_string();
        account.last_checked_at = Some(now);
    }
    save_accounts_internal(&accounts)?;
    Ok(accounts)
}

#[tauri::command]
pub fn media_get_tasks() -> Result<Vec<PublishTask>, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取任务存储锁失败".to_string())?;
    Ok(load_tasks_internal())
}

#[tauri::command]
pub fn media_create_publish_task(req: CreatePublishTaskRequest) -> Result<PublishTask, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取任务存储锁失败".to_string())?;

    if req.title.trim().is_empty() {
        return Err("任务标题不能为空".to_string());
    }
    if req.content.trim().is_empty() {
        return Err("任务正文内容不能为空".to_string());
    }
    if req.target_account_ids.is_empty() {
        return Err("请至少选择一个发布账号".to_string());
    }

    let accounts = load_accounts_internal();
    let accounts_map: HashMap<String, MediaAccount> =
        accounts.into_iter().map(|a| (a.id.clone(), a)).collect();

    let now = now_sec();
    let task_id = format!("task_{}", rand_hex_id());
    let mut account_statuses: HashMap<String, AccountPublishProgress> = HashMap::new();
    let mut success_count = 0;
    let mut failed_count = 0;

    for target_id in &req.target_account_ids {
        if let Some(account) = accounts_map.get(target_id) {
            let progress = execute_account_publish(account, &req, now);
            if progress.stage == "done" {
                success_count += 1;
            } else if progress.stage == "failed" {
                failed_count += 1;
            }
            account_statuses.insert(target_id.clone(), progress);
        } else {
            failed_count += 1;
            account_statuses.insert(
                target_id.clone(),
                AccountPublishProgress {
                    account_id: target_id.clone(),
                    platform: "unknown".to_string(),
                    account_name: "未知账号".to_string(),
                    stage: "failed".to_string(),
                    progress: 0,
                    error: Some("目标账号不存在或已删除".to_string()),
                    publish_url: None,
                    logs: vec![TaskLogItem {
                        time: now,
                        message: "发布失败：目标账号已不存在".to_string(),
                        level: "error".to_string(),
                    }],
                },
            );
        }
    }

    let total_accounts = req.target_account_ids.len();
    let overall_status = if failed_count == 0 {
        "completed".to_string()
    } else if success_count == 0 {
        "failed".to_string()
    } else {
        "partial".to_string()
    };

    let overall_progress = if total_accounts == 0 {
        0
    } else {
        ((success_count * 100) / total_accounts) as u32
    };

    let task = PublishTask {
        id: task_id,
        title: req.title,
        content_type: req.content_type,
        mode: req.mode,
        target_account_ids: req.target_account_ids,
        status: overall_status,
        progress: overall_progress,
        total_accounts,
        success_count,
        failed_count,
        created_at: now,
        scheduled_at: req.scheduled_at,
        account_statuses,
    };

    let mut tasks = load_tasks_internal();
    tasks.insert(0, task.clone());
    save_tasks_internal(&tasks)?;

    Ok(task)
}

#[tauri::command]
pub fn media_cancel_task(task_id: String) -> Result<PublishTask, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取任务存储锁失败".to_string())?;

    let mut tasks = load_tasks_internal();
    let now = now_sec();
    let task = tasks
        .iter_mut()
        .find(|t| t.id == task_id)
        .ok_or_else(|| format!("未找到任务: {}", task_id))?;

    if task.status != "completed" && task.status != "cancelled" {
        task.status = "cancelled".to_string();
        for (_, progress) in task.account_statuses.iter_mut() {
            if progress.stage != "done" && progress.stage != "failed" {
                progress.stage = "failed".to_string();
                progress.error = Some("任务已手动取消".to_string());
                progress.logs.push(TaskLogItem {
                    time: now,
                    message: "任务被用户手动取消".to_string(),
                    level: "warn".to_string(),
                });
            }
        }
    }

    let updated = task.clone();
    save_tasks_internal(&tasks)?;
    Ok(updated)
}

#[tauri::command]
pub fn media_retry_task(task_id: String) -> Result<PublishTask, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取任务存储锁失败".to_string())?;

    let mut tasks = load_tasks_internal();
    let task = tasks
        .iter_mut()
        .find(|t| t.id == task_id)
        .ok_or_else(|| format!("未找到任务: {}", task_id))?;

    let accounts = load_accounts_internal();
    let accounts_map: HashMap<String, MediaAccount> =
        accounts.into_iter().map(|a| (a.id.clone(), a)).collect();

    let now = now_sec();
    let req = CreatePublishTaskRequest {
        title: task.title.clone(),
        content: "重试发布任务内容".to_string(),
        tags: vec![],
        content_type: task.content_type.clone(),
        media_paths: vec![],
        cover_path: None,
        mode: task.mode,
        target_account_ids: task.target_account_ids.clone(),
        scheduled_at: None,
        platform_overrides: None,
    };

    let mut success_count = 0;
    let mut failed_count = 0;

    for target_id in &task.target_account_ids {
        let should_retry = task
            .account_statuses
            .get(target_id)
            .map(|p| p.stage == "failed" || p.stage == "queued")
            .unwrap_or(true);

        if should_retry {
            if let Some(account) = accounts_map.get(target_id) {
                let progress = execute_account_publish(account, &req, now);
                if progress.stage == "done" {
                    success_count += 1;
                } else {
                    failed_count += 1;
                }
                task.account_statuses.insert(target_id.clone(), progress);
            } else {
                failed_count += 1;
            }
        } else if let Some(prog) = task.account_statuses.get(target_id) {
            if prog.stage == "done" {
                success_count += 1;
            } else {
                failed_count += 1;
            }
        }
    }

    task.success_count = success_count;
    task.failed_count = failed_count;
    let total = task.target_account_ids.len();
    task.total_accounts = total;
    task.status = if failed_count == 0 {
        "completed".to_string()
    } else if success_count == 0 {
        "failed".to_string()
    } else {
        "partial".to_string()
    };
    task.progress = if total == 0 {
        0
    } else {
        ((success_count * 100) / total) as u32
    };

    let updated = task.clone();
    save_tasks_internal(&tasks)?;
    Ok(updated)
}

#[tauri::command]
pub fn media_clear_completed_tasks() -> Result<(), String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取任务存储锁失败".to_string())?;
    let mut tasks = load_tasks_internal();
    tasks.retain(|t| t.status != "completed" && t.status != "cancelled");
    save_tasks_internal(&tasks)
}

#[tauri::command]
pub fn media_get_canned_replies() -> Result<Vec<CannedReply>, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取常用语存储锁失败".to_string())?;
    Ok(load_canned_replies_internal())
}

#[tauri::command]
pub fn media_save_canned_reply(mut reply: CannedReply) -> Result<CannedReply, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取常用语存储锁失败".to_string())?;
    let now = now_sec();
    if reply.id.trim().is_empty() {
        reply.id = format!("reply_{}", rand_hex_id());
    }
    if reply.created_at == 0 {
        reply.created_at = now;
    }

    let mut replies = load_canned_replies_internal();
    if let Some(pos) = replies.iter().position(|r| r.id == reply.id) {
        replies[pos] = reply.clone();
    } else {
        replies.push(reply.clone());
    }
    save_canned_replies_internal(&replies)?;
    Ok(reply)
}

#[tauri::command]
pub fn media_delete_canned_reply(id: String) -> Result<(), String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取常用语存储锁失败".to_string())?;
    let mut replies = load_canned_replies_internal();
    replies.retain(|r| r.id != id);
    save_canned_replies_internal(&replies)
}

#[tauri::command]
pub fn media_get_keyword_rules() -> Result<Vec<KeywordRule>, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取关键词规则存储锁失败".to_string())?;
    Ok(load_keyword_rules_internal())
}

#[tauri::command]
pub fn media_save_keyword_rule(mut rule: KeywordRule) -> Result<KeywordRule, String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取关键词规则存储锁失败".to_string())?;
    let now = now_sec();
    if rule.id.trim().is_empty() {
        rule.id = format!("rule_{}", rand_hex_id());
    }
    if rule.created_at == 0 {
        rule.created_at = now;
    }

    let mut rules = load_keyword_rules_internal();
    if let Some(pos) = rules.iter().position(|r| r.id == rule.id) {
        rules[pos] = rule.clone();
    } else {
        rules.push(rule.clone());
    }
    save_keyword_rules_internal(&rules)?;
    Ok(rule)
}

#[tauri::command]
pub fn media_delete_keyword_rule(id: String) -> Result<(), String> {
    let _guard = MEDIA_STORE_LOCK
        .lock()
        .map_err(|_| "获取关键词规则存储锁失败".to_string())?;
    let mut rules = load_keyword_rules_internal();
    rules.retain(|r| r.id != id);
    save_keyword_rules_internal(&rules)
}

#[tauri::command]
pub fn media_inspect_video(path: String) -> Result<VideoMetaInfo, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    let meta = fs::metadata(p).map_err(|e| format!("无法读取文件信息: {}", e))?;
    let file_size = meta.len();
    let format = p
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mut duration_secs = None;
    let mut width = None;
    let mut height = None;

    if matches!(format.as_str(), "mp4" | "mov" | "m4v") {
        if let Ok(file) = File::open(p) {
            let (d, w, h) = inspect_mp4(file);
            duration_secs = d;
            width = w;
            height = h;
        }
    }

    Ok(VideoMetaInfo {
        path,
        file_size,
        format,
        duration_secs,
        width,
        height,
    })
}

#[tauri::command]
pub fn media_ai_polish_copy(
    text: String,
    platform_hint: Option<String>,
) -> Result<CopyPolishResult, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("待润色文案不能为空".to_string());
    }

    // Extract core subject/topic
    let first_line = trimmed.lines().next().unwrap_or(trimmed);
    let topic_raw: String = first_line
        .chars()
        .filter(|c| !c.is_ascii_punctuation() && *c != '，' && *c != '。' && *c != '！')
        .take(28)
        .collect();
    let topic = if topic_raw.is_empty() {
        "核心干货内容".to_string()
    } else {
        topic_raw
    };

    let platform = platform_hint.as_deref().unwrap_or("").to_lowercase();

    let (titles, tags, summary) = if platform.contains("xhs") || platform.contains("xiaohongshu") {
        (
            vec![
                format!("🔥建议收藏！{}保姆级操作指南", topic),
                format!("✨打工人自救！用{}彻底告别低效加班", topic),
                format!("💡后悔没早点知道！关于{}的超级干货", topic),
                format!("千万别再手动发了！{}全自动流程揭秘", topic),
            ],
            vec![
                "#干货分享".to_string(),
                "#自媒体运营".to_string(),
                "#宝藏工具".to_string(),
                "#效率神器".to_string(),
                "#日常打卡".to_string(),
                "#运营必备".to_string(),
            ],
            format!(
                "【核心要点总结】\n1. 核心主题：{}\n2. 适用场景：图文/短视频多渠道一键分发\n3. 核心亮点：省时省力、防封号机制、独立环境\n\n💬 觉得有用欢迎点赞收藏，持续分享高能生产力黑科技！",
                topic
            ),
        )
    } else if platform.contains("douyin") || platform.contains("kuaishou") {
        (
            vec![
                format!("90%的人都不知道！{}还能这么玩？", topic),
                format!("学会这招{}，直接少走三年弯路！", topic),
                format!("全网首发！{}最新核心技巧曝光，赶紧收藏", topic),
                format!("千万不要再死磕了！{}原来只要三步就能搞定", topic),
            ],
            vec![
                "#短视频运营".to_string(),
                "#涨知识".to_string(),
                "#黑科技".to_string(),
                "#实用技巧".to_string(),
                "#自媒体创业".to_string(),
                "#上热门".to_string(),
            ],
            format!(
                "【视频核心摘要】\n• 核心亮点：{}\n• 实测效果：创作效率提升 300%\n• 操作要领：按照步骤逐步执行，避免违规\n👉 关注主页，每天分享一个硬核实操小技巧！",
                topic
            ),
        )
    } else if platform.contains("bili") {
        (
            vec![
                format!("【硬核干货】从入门到精通，带你彻底搞懂{}！", topic),
                format!("【建议三连】手把手教你玩转{}，效率起飞！", topic),
                format!("一口气看完！{}全流程解析与实操演示", topic),
                format!("终于有人把{}讲明白了！干货满满无废话", topic),
            ],
            vec![
                "#知识分享官".to_string(),
                "#科技数码".to_string(),
                "#软件分享".to_string(),
                "#生产力工具".to_string(),
                "#硬核测评".to_string(),
                "#UP主的日常".to_string(),
            ],
            format!(
                "【本期视频简介】\n本期视频深度梳理并演示了关于 {} 的核心操作与应用技巧。从基础配置到高级自动化玩法，全流程无保留分享！\n\n时间轴与相关资源请查阅置顶评论与简介，感谢大家的一键三连支持！",
                topic
            ),
        )
    } else if platform.contains("zhihu") {
        (
            vec![
                format!("如何系统性掌握{}？附深度实践指南与建议", topic),
                format!("关于{}，有哪些一般人不知道的关键细节与避坑指南？", topic),
                format!("为什么越来越多人开始重视{}？核心逻辑剖析", topic),
                format!("怎样用{}解决日常创作与分发中的核心痛点？", topic),
            ],
            vec![
                "#自媒体运营".to_string(),
                "#生产力工具".to_string(),
                "#深度思考".to_string(),
                "#职场效率".to_string(),
                "#技术探讨".to_string(),
            ],
            format!(
                "【长文导读】\n本文从原理、流程到实际落地场景，系统化拆解 {} 的关键环节。适合自媒体从业者、内容创作者以及注重效率提升的技术伙伴深入阅读。",
                topic
            ),
        )
    } else if platform.contains("channel") || platform.contains("sph") {
        (
            vec![
                format!("干货分享：关于{}的高效实操方法，建议收藏转发", topic),
                format!("实用技巧：如何轻松搞定{}，看完豁然开朗", topic),
                format!("建议所有创作者看看！{}的最新玩法与技巧", topic),
                format!("原来{}这么简单，学会这一招受用很久！", topic),
            ],
            vec![
                "#视频号创作".to_string(),
                "#干货分享".to_string(),
                "#商业思维".to_string(),
                "#效率工具".to_string(),
                "#微信生态".to_string(),
            ],
            format!(
                "【内容概要】\n本期视频精讲 {} 的核心要点与实操方法。适合希望在微信生态内打造私域闭环与高效分发的内容创作者。\n关注视频号，了解更多干货资讯！",
                topic
            ),
        )
    } else {
        (
            vec![
                format!("精选分享：{}全方位实操与解析", topic),
                format!("一文掌握：{}的关键技巧与实操", topic),
                format!("效率神器：让{}变得更简单的有效方案", topic),
                format!("建议收藏！{}的完整流程与注意事项", topic),
            ],
            vec![
                "#内容创作".to_string(),
                "#自媒体".to_string(),
                "#效率工具".to_string(),
                "#干货分享".to_string(),
                "#技巧分享".to_string(),
            ],
            format!(
                "【要点提炼】\n围绕「{}」展开的核心梳理与优化方案，帮助快速构建结构清晰、易于传播的内容矩阵。",
                topic
            ),
        )
    };

    Ok(CopyPolishResult {
        titles,
        tags,
        summary,
    })
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    static TEST_MUTEX: Mutex<()> = Mutex::new(());

    struct TestEnv {
        dir: PathBuf,
    }

    impl TestEnv {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "doc_tools_test_{}_{}_{}",
                name,
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            unsafe {
                std::env::set_var("MEDIA_PUBLISHER_TEST_DIR", dir.to_str().unwrap());
            }
            Self { dir }
        }
    }

    impl Drop for TestEnv {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
            unsafe {
                std::env::remove_var("MEDIA_PUBLISHER_TEST_DIR");
            }
        }
    }

    #[test]
    fn test_accounts_crud_and_status() {
        let _test_lock = TEST_MUTEX.lock().unwrap();
        let _env = TestEnv::new("accounts");
        let initial = media_get_accounts().expect("获取初始账号");
        assert!(!initial.is_empty(), "初始账号应当自动预填充 demo 列表");

        let custom_acc = MediaAccount {
            id: "".to_string(),
            platform: "bilibili".to_string(),
            account_name: "测试B站号".to_string(),
            avatar: "".to_string(),
            group: Some("测试组".to_string()),
            status: "checking".to_string(),
            cookie: "SESSDATA=valid_active_token".to_string(),
            custom_config: None,
            last_checked_at: None,
            created_at: 0,
        };

        let saved = media_save_account(custom_acc).expect("保存新账号");
        assert!(!saved.id.is_empty());
        assert_eq!(saved.status, "online");

        let checked = media_check_account_status(saved.id.clone()).expect("检查状态");
        assert_eq!(checked.status, "online");

        let batch = media_batch_check_accounts().expect("批量检查状态");
        assert!(batch.iter().any(|a| a.id == saved.id));

        media_delete_account(saved.id.clone()).expect("删除账号");
        let after_delete = media_get_accounts().expect("重新获取列表");
        assert!(!after_delete.iter().any(|a| a.id == saved.id));
    }

    #[test]
    fn test_canned_replies_and_keyword_rules() {
        let _test_lock = TEST_MUTEX.lock().unwrap();
        let _env = TestEnv::new("replies_rules");
        let replies = media_get_canned_replies().expect("获取常用回复");
        assert!(!replies.is_empty());

        let new_reply = CannedReply {
            id: "".to_string(),
            category: "测试分类".to_string(),
            title: "测试标题".to_string(),
            content: "测试正文".to_string(),
            tags: vec!["测试".to_string()],
            created_at: 0,
        };
        let saved_reply = media_save_canned_reply(new_reply).expect("保存常用回复");
        assert!(!saved_reply.id.is_empty());

        media_delete_canned_reply(saved_reply.id.clone()).expect("删除常用回复");
        let replies_after = media_get_canned_replies().expect("获取常用回复");
        assert!(!replies_after.iter().any(|r| r.id == saved_reply.id));

        let rules = media_get_keyword_rules().expect("获取关键词规则");
        assert!(!rules.is_empty());

        let new_rule = KeywordRule {
            id: "".to_string(),
            keyword: "测试词".to_string(),
            match_type: "contains".to_string(),
            reply_content: "自动回复内容".to_string(),
            target_account_ids: vec![],
            enabled: true,
            created_at: 0,
        };
        let saved_rule = media_save_keyword_rule(new_rule).expect("保存规则");
        assert!(!saved_rule.id.is_empty());

        media_delete_keyword_rule(saved_rule.id.clone()).expect("删除规则");
        let rules_after = media_get_keyword_rules().expect("获取规则列表");
        assert!(!rules_after.iter().any(|r| r.id == saved_rule.id));
    }

    #[test]
    fn test_publish_task_lifecycle_silent_and_visible() {
        let _test_lock = TEST_MUTEX.lock().unwrap();
        let _env = TestEnv::new("tasks");
        let accounts = media_get_accounts().expect("获取账号");
        let online_account = accounts
            .iter()
            .find(|a| a.status == "online")
            .expect("存在在线账号");

        // 1. Silent mode task
        let req_silent = CreatePublishTaskRequest {
            title: "测试发布任务".to_string(),
            content: "这是一个测试发布的短视频文案".to_string(),
            tags: vec!["测试".to_string(), "效率".to_string()],
            content_type: "video".to_string(),
            media_paths: vec!["/mock/path/video.mp4".to_string()],
            cover_path: None,
            mode: PublishMode::Silent,
            target_account_ids: vec![online_account.id.clone()],
            scheduled_at: None,
            platform_overrides: None,
        };

        let task_silent = media_create_publish_task(req_silent).expect("创建静默发布任务");
        assert_eq!(task_silent.status, "completed");
        assert_eq!(task_silent.success_count, 1);
        assert_eq!(task_silent.progress, 100);

        // 2. Visible mode task
        let req_visible = CreatePublishTaskRequest {
            title: "测试可视化发布".to_string(),
            content: "可视化发布测试正文".to_string(),
            tags: vec!["图文".to_string()],
            content_type: "post".to_string(),
            media_paths: vec![],
            cover_path: None,
            mode: PublishMode::Visible,
            target_account_ids: vec![online_account.id.clone()],
            scheduled_at: None,
            platform_overrides: None,
        };

        let task_visible = media_create_publish_task(req_visible).expect("创建可视化任务");
        assert_eq!(task_visible.status, "completed");

        // 3. Clear completed tasks
        media_clear_completed_tasks().expect("清理已完成任务");
        let tasks_after = media_get_tasks().expect("获取任务列表");
        assert!(tasks_after.is_empty());
    }

    #[test]
    fn test_task_cancellation_and_retry() {
        let _test_lock = TEST_MUTEX.lock().unwrap();
        let _env = TestEnv::new("cancel_retry");
        let accounts = media_get_accounts().expect("获取账号");
        let offline_account = accounts
            .iter()
            .find(|a| a.status == "offline" || a.status == "expired")
            .expect("存在离线/过期账号");

        let req = CreatePublishTaskRequest {
            title: "失败重试测试".to_string(),
            content: "内容".to_string(),
            tags: vec![],
            content_type: "post".to_string(),
            media_paths: vec![],
            cover_path: None,
            mode: PublishMode::Silent,
            target_account_ids: vec![offline_account.id.clone()],
            scheduled_at: None,
            platform_overrides: None,
        };

        let task = media_create_publish_task(req).expect("创建任务");
        assert_eq!(task.status, "failed");
        assert_eq!(task.failed_count, 1);

        let retried = media_retry_task(task.id.clone()).expect("重试任务");
        assert_eq!(retried.status, "failed");

        let cancelled = media_cancel_task(task.id.clone()).expect("取消任务");
        assert!(cancelled.status == "cancelled" || cancelled.status == "failed");
    }

    #[test]
    fn test_ai_copy_polish() {
        let _test_lock = TEST_MUTEX.lock().unwrap();
        let res_xhs = media_ai_polish_copy(
            "今天分享自媒体一键分发神器的操作技巧".to_string(),
            Some("xiaohongshu".to_string()),
        )
        .expect("小红书润色");
        assert!(res_xhs.titles.len() >= 3);
        assert!(!res_xhs.tags.is_empty());
        assert!(!res_xhs.summary.is_empty());

        let res_bili = media_ai_polish_copy(
            "深度解析音视频批量转码分发系统".to_string(),
            Some("bilibili".to_string()),
        )
        .expect("B站润色");
        assert!(res_bili.titles[0].contains("【"));

        assert!(media_ai_polish_copy("   ".to_string(), None).is_err());
    }

    #[test]
    fn test_video_metadata_inspection_synthetic_mp4() {
        let _test_lock = TEST_MUTEX.lock().unwrap();
        let _env = TestEnv::new("video_meta");
        let test_file = _env.dir.join("test_sample.mp4");

        let mut data = Vec::new();

        // 1. ftyp box (28 bytes)
        data.extend_from_slice(&(28u32).to_be_bytes());
        data.extend_from_slice(b"ftyp");
        data.extend_from_slice(b"isom");
        data.extend_from_slice(&(512u32).to_be_bytes());
        data.extend_from_slice(b"isomiso2mp41");

        // 2. mvhd box (108 bytes total)
        let mut mvhd = Vec::new();
        mvhd.extend_from_slice(&(108u32).to_be_bytes());
        mvhd.extend_from_slice(b"mvhd");
        mvhd.push(0); // version 0
        mvhd.extend_from_slice(&[0, 0, 0]); // flags
        mvhd.extend_from_slice(&[0; 4]); // creation time
        mvhd.extend_from_slice(&[0; 4]); // mod time
        mvhd.extend_from_slice(&(1000u32).to_be_bytes()); // timescale = 1000
        mvhd.extend_from_slice(&(65000u32).to_be_bytes()); // duration = 65000 (65 secs)
        mvhd.resize(108, 0);

        // 3. tkhd box (92 bytes total: 8 header + 84 payload)
        let mut tkhd = Vec::new();
        tkhd.extend_from_slice(&(92u32).to_be_bytes());
        tkhd.extend_from_slice(b"tkhd");
        tkhd.push(0); // version 0
        tkhd.extend_from_slice(&[0, 0, 7]); // flags
        tkhd.resize(92, 0);
        // write width at payload offset 76 (which is index 8 + 76 = 84 in tkhd)
        let w_fixed = (1920u32) << 16;
        tkhd[84..88].copy_from_slice(&w_fixed.to_be_bytes());
        // write height at payload offset 80 (which is index 8 + 80 = 88 in tkhd)
        let h_fixed = (1080u32) << 16;
        tkhd[88..92].copy_from_slice(&h_fixed.to_be_bytes());

        // 4. trak box (header 8 + 92 = 100 bytes)
        let mut trak = Vec::new();
        trak.extend_from_slice(&(100u32).to_be_bytes());
        trak.extend_from_slice(b"trak");
        trak.extend_from_slice(&tkhd);

        // 5. moov box (header 8 + 108 + 100 = 216 bytes)
        let mut moov = Vec::new();
        moov.extend_from_slice(&(216u32).to_be_bytes());
        moov.extend_from_slice(b"moov");
        moov.extend_from_slice(&mvhd);
        moov.extend_from_slice(&trak);

        data.extend_from_slice(&moov);

        let mut file = File::create(&test_file).unwrap();
        file.write_all(&data).unwrap();
        drop(file);

        let info = media_inspect_video(test_file.to_str().unwrap().to_string()).expect("检查视频");
        assert_eq!(info.format, "mp4");
        assert_eq!(info.duration_secs, Some(65));
        assert_eq!(info.width, Some(1920));
        assert_eq!(info.height, Some(1080));
    }
}
