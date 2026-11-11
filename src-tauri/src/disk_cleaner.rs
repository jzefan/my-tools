use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Safe,        // 安全可删 (临时可再生缓存、编译衍生文件、系统日志)
    Recommended, // 建议清理 (废纸篓、过期归档、历史安装包)
    Caution,     // 谨慎确认 (近期接收的大文件、聊天媒体原件)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CleanCategory {
    Wechat,     // 微信清理
    Qq,         // QQ 清理
    Browser,    // 浏览器缓存
    Developer,  // 开发者工具缓存
    SystemLogs, // 系统日志与崩溃报告
    AppCache,   // 应用通用缓存
    Trash,      // 废纸篓与安装包
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanSubDetail {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub modified_at: Option<u64>,
    #[serde(default)]
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanItem {
    pub id: String,
    pub name: String,
    pub category: CleanCategory,
    pub risk_level: RiskLevel,
    pub description: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub paths: Vec<String>,
    pub default_selected: bool,
    pub details: Vec<CleanSubDetail>,
    pub is_permission_denied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskCleanScanResult {
    pub supported: bool,
    pub total_scanned_bytes: u64,
    pub total_safe_bytes: u64,
    pub total_recommended_bytes: u64,
    pub total_caution_bytes: u64,
    pub total_files: u64,
    pub items: Vec<CleanItem>,
    pub has_permission_issues: bool,
    pub disk_total_bytes: u64,
    pub disk_free_bytes: u64,
    /// Name of this process in System Settings → Full Disk Access.
    pub full_disk_client_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanExecutionRequest {
    pub item_ids: Vec<String>,
    pub delete_permanently: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanExecutionResult {
    pub freed_bytes: u64,
    pub deleted_files_count: u64,
    pub errors: Vec<String>,
    pub success: bool,
}

/// How a rule discovers delete targets under the home directory.
enum RuleScope {
    /// Expand `sub_paths`; delete children of each existing root.
    Paths,
    /// Aggregate historical chat media by year-month (e.g. `2024-05`).
    MonthlyAggregate,
    /// Expand `sub_paths`; delete immediate children, skipping `excludes`.
    DirChildren(&'static [&'static str]),
    /// `~/Library/Application Support/<App>/{Cache, Code Cache, ...}`
    AppSupportLeaves,
    /// Files directly under `$HOME` whose name starts with the prefix.
    HomeFiles(&'static str),
}

struct RuleDefinition {
    id: &'static str,
    name: &'static str,
    category: CleanCategory,
    risk_level: RiskLevel,
    description: &'static str,
    default_selected: bool,
    /// Relative paths from user home directory (`*` = one directory level).
    sub_paths: &'static [&'static str],
    scope: RuleScope,
}

const APP_SUPPORT_LEAF_NAMES: &[&str] = &[
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnCache",
    "DawnWebGPUCache",
    "GraphiteDawnCache",
    "ShaderCache",
    "GrShaderCache",
    "Crashpad",
    "CachedData",
];

/// Top-level `Library/Caches` names owned by more specific browser/dev rules.
const LIBRARY_CACHES_EXCLUDES: &[&str] = &[
    "Google",
    "Microsoft Edge",
    "BraveSoftware",
    "Homebrew",
    "pnpm",
    "Yarn",
    "pip",
    "com.apple.Safari",
];

/// Large model / env stores under `~/.cache` that should not be swept blindly.
/// `node` is owned by `bun_corepack_cache`.
const DOT_CACHE_EXCLUDES: &[&str] = &[
    "huggingface",
    "huggingface-cli",
    "torch",
    "whisper",
    "llama.cpp",
    "gpt4all",
    "ollama",
    "mlx",
    "models",
    "node",
];

const CLEAN_RULES: &[RuleDefinition] = &[
    // --- 微信清理 ---
    RuleDefinition {
        id: "wechat_webkit_cache",
        name: "微信网页内核与小程序缓存",
        category: CleanCategory::Wechat,
        risk_level: RiskLevel::Safe,
        description: "WebKit 页面渲染、小程序包与浏览器内核引擎缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.xinWeChat/Data/Library/Caches",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/app_data/radium/Cache",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/app_data/radium/Code Cache",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/app_data/radium/GPUCache",
            "Library/Containers/com.tencent.xinWeChat.WeChatMacShare/Data/Library/Caches",
            "Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/*/radium/Cache",
            "Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/*/radium/Code Cache",
            "Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/*/radium/GPUCache",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "wechat_timeline_stream",
        name: "微信朋友圈与流媒体缓存",
        category: CleanCategory::Wechat,
        risk_level: RiskLevel::Safe,
        description: "朋友圈图片/视频、公众号图文、视频号流媒体与头像缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/cache",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/avatar",
            "Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/*/*/Cache",
            "Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/*/*/Avatar",
            "Documents/xwechat_files/*/cache",
            "Documents/xwechat_files/*/avatar",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "wechat_temp_preview",
        name: "微信临时运行文件与预览副本",
        category: CleanCategory::Wechat,
        risk_level: RiskLevel::Safe,
        description: "查看文档/视频时生成的临时解压包与中转交换数据",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/temp",
            "Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat/*/*/Message/MessageTemp",
            "Library/Containers/com.tencent.xinWeChat/Data/tmp",
            "Documents/xwechat_files/*/temp",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "wechat_group_container_cache",
        name: "微信系统共享扩展缓存",
        category: CleanCategory::Wechat,
        risk_level: RiskLevel::Safe,
        description: "主程序与 macOS 分享扩展交互产生的共享临时缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Group Containers/5A4RE8SF68.com.tencent.xinWeChat/Library/Caches",
            "Library/Group Containers/5A4RE8SF68.com.tencent.xinWeChat/Library/WebKit",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "wechat_chat_images",
        name: "微信聊天历史图片",
        category: CleanCategory::Wechat,
        risk_level: RiskLevel::Recommended,
        description: "聊天中收发的历史图片（清理后聊天记录中原图将提示已过期）",
        default_selected: false,
        sub_paths: &[
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/FileStorage/Image",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/Image",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/msg/attach",
            "Documents/xwechat_files/*/FileStorage/Image",
            "Documents/xwechat_files/*/Image",
        ],
        scope: RuleScope::MonthlyAggregate,
    },
    RuleDefinition {
        id: "wechat_chat_videos",
        name: "微信聊天接收视频",
        category: CleanCategory::Wechat,
        risk_level: RiskLevel::Caution,
        description: "聊天接收的视频文件（空间大户，清理后聊天窗口内无法直接播放）",
        default_selected: false,
        sub_paths: &[
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/FileStorage/Video",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/Video",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/msg/video",
            "Documents/xwechat_files/*/FileStorage/Video",
            "Documents/xwechat_files/*/Video",
        ],
        scope: RuleScope::MonthlyAggregate,
    },
    // --- QQ 清理 ---
    RuleDefinition {
        id: "qq_engine_cache",
        name: "QQ 核心渲染与代码缓存",
        category: CleanCategory::Qq,
        risk_level: RiskLevel::Safe,
        description: "QQNT 架构 Electron 渲染缓存、GPU 缓存、崩溃日志与转储",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.qq/Data/Library/Caches",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/Cache",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/Code Cache",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/GPUCache",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/Crashpad",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/blob_storage",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/Shared Dictionary",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/DawnCache",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "qq_emoji_stickers",
        name: "QQ 表情包与缩略图缓存",
        category: CleanCategory::Qq,
        risk_level: RiskLevel::Safe,
        description: "表情包、群自定义表情及缩略图缓存（再次浏览自动下载）",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/global/nt_data/Emoji",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/nt_qq*/nt_data/Emoji",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/nt_qq*/nt_data/Pic/Thumb",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/nt_qq*/nt_data/Pic/Cache",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "qq_temp_files",
        name: "QQ 运行临时文件与截图暂存",
        category: CleanCategory::Qq,
        risk_level: RiskLevel::Safe,
        description: "截图剪贴板交换区、上传中转临时文件及预览流",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.qq/Data/tmp",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/global/nt_temp",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/nt_qq*/nt_temp",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/nt_qq*/nt_data/temp",
            "Library/Containers/com.tencent.qqexdoc/Data/Library/Caches",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "qq_chat_images",
        name: "QQ 聊天高清原图",
        category: CleanCategory::Qq,
        risk_level: RiskLevel::Recommended,
        description: "聊天中收发的高清原图文件（位于 Pic/Ori，清理后无法查看原图）",
        default_selected: false,
        sub_paths: &[
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/nt_qq*/nt_data/Pic/Ori",
        ],
        scope: RuleScope::MonthlyAggregate,
    },
    RuleDefinition {
        id: "qq_chat_videos",
        name: "QQ 聊天接收视频",
        category: CleanCategory::Qq,
        risk_level: RiskLevel::Caution,
        description: "群聊与私聊接收的短视频与高清视频（位于 Video 目录，占用较大）",
        default_selected: false,
        sub_paths: &[
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/nt_qq*/nt_data/Video",
        ],
        scope: RuleScope::MonthlyAggregate,
    },
    // --- 浏览器缓存 ---
    RuleDefinition {
        id: "chrome_cache",
        name: "Google Chrome 浏览缓存",
        category: CleanCategory::Browser,
        risk_level: RiskLevel::Safe,
        description: "各配置文件网页与 GPU 缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Caches/Google/Chrome/*/Cache",
            "Library/Caches/Google/Chrome/*/Code Cache",
            "Library/Caches/Google/Chrome/*/GPUCache",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "edge_cache",
        name: "Microsoft Edge 浏览缓存",
        category: CleanCategory::Browser,
        risk_level: RiskLevel::Safe,
        description: "各配置文件网页与 GPU 缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Caches/Microsoft Edge/*/Cache",
            "Library/Caches/Microsoft Edge/*/Code Cache",
            "Library/Caches/Microsoft Edge/*/GPUCache",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "brave_cache",
        name: "Brave 浏览缓存",
        category: CleanCategory::Browser,
        risk_level: RiskLevel::Safe,
        description: "各配置文件网页与 GPU 缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Caches/BraveSoftware/Brave-Browser/*/Cache",
            "Library/Caches/BraveSoftware/Brave-Browser/*/Code Cache",
            "Library/Caches/BraveSoftware/Brave-Browser/*/GPUCache",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "safari_cache",
        name: "Safari 浏览缓存",
        category: CleanCategory::Browser,
        risk_level: RiskLevel::Safe,
        description: "Safari 网页资源缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Caches/com.apple.Safari",
            "Library/Containers/com.apple.Safari/Data/Library/Caches",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "google_updater_cache",
        name: "GoogleUpdater 组件缓存",
        category: CleanCategory::Browser,
        risk_level: RiskLevel::Safe,
        description: "Chrome 组件更新 CRX 缓存",
        default_selected: true,
        sub_paths: &["Library/Application Support/Google/GoogleUpdater/crx_cache"],
        scope: RuleScope::Paths,
    },
    // --- 开发者工具 ---
    RuleDefinition {
        id: "xcode_derived_data",
        name: "Xcode DerivedData",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "编译索引与中间产物",
        default_selected: true,
        sub_paths: &["Library/Developer/Xcode/DerivedData"],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "xcode_archives",
        name: "Xcode Archives",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Recommended,
        description: "历史打包归档",
        default_selected: false,
        sub_paths: &["Library/Developer/Xcode/Archives"],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "homebrew_cache",
        name: "Homebrew 安装包缓存",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "brew 下载的安装包与源码",
        default_selected: true,
        sub_paths: &["Library/Caches/Homebrew"],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "node_pnpm_npm_cache",
        name: "npm / pnpm / yarn 缓存",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "Node 包管理器下载缓存",
        default_selected: true,
        sub_paths: &[
            ".npm/_cacache",
            ".npm/_logs",
            ".npm/_prebuilds",
            "Library/Caches/pnpm",
            "Library/Caches/Yarn",
        ],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "bun_corepack_cache",
        name: "Bun / Corepack 缓存",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "Bun 安装缓存与 Corepack",
        default_selected: true,
        sub_paths: &[".bun/install/cache", ".cache/node/corepack"],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "pip_python_cache",
        name: "pip 下载包缓存",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "pip wheel 与安装归档",
        default_selected: true,
        sub_paths: &["Library/Caches/pip"],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "cargo_rustup_cache",
        name: "Rust cargo / rustup 缓存",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "crates 下载缓存与 rustup 安装包",
        default_selected: true,
        sub_paths: &[".cargo/registry/cache", ".rustup/downloads"],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "expo_cache",
        name: "Expo 工具缓存",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "Expo 原生模块与版本缓存",
        default_selected: true,
        sub_paths: &[
            ".expo/native-modules-cache",
            ".expo/versions-cache",
            ".expo/schema-cache",
            ".expo/template-cache",
            ".expo/android-apk-cache",
            ".expo/ios-simulator-app-cache",
        ],
        scope: RuleScope::Paths,
    },
    // --- 系统与应用日志 ---
    RuleDefinition {
        id: "system_user_logs",
        name: "用户级应用运行日志",
        category: CleanCategory::SystemLogs,
        risk_level: RiskLevel::Safe,
        description: "应用调试与滚动日志",
        default_selected: true,
        sub_paths: &["Library/Logs"],
        scope: RuleScope::Paths,
    },
    // --- 应用通用缓存（贴近 Mole 的 Caches / App Support 扫） ---
    RuleDefinition {
        id: "library_caches",
        name: "用户应用缓存 (Library/Caches)",
        category: CleanCategory::AppCache,
        risk_level: RiskLevel::Safe,
        description: "其余应用缓存目录（已排除浏览器与开发工具专属项）",
        default_selected: true,
        sub_paths: &["Library/Caches"],
        scope: RuleScope::DirChildren(LIBRARY_CACHES_EXCLUDES),
    },
    RuleDefinition {
        id: "dot_cache",
        name: "用户 .cache 目录",
        category: CleanCategory::AppCache,
        risk_level: RiskLevel::Safe,
        description: "含 uv、工具链等；已排除模型权重目录",
        default_selected: true,
        sub_paths: &[".cache"],
        scope: RuleScope::DirChildren(DOT_CACHE_EXCLUDES),
    },
    RuleDefinition {
        id: "app_support_caches",
        name: "Application Support 可再生缓存",
        category: CleanCategory::AppCache,
        risk_level: RiskLevel::Safe,
        description: "各应用下的 Cache / Code Cache / GPUCache 等",
        default_selected: true,
        sub_paths: &["Library/Application Support"],
        scope: RuleScope::AppSupportLeaves,
    },
    RuleDefinition {
        id: "zsh_completion_cache",
        name: "Zsh 补全缓存",
        category: CleanCategory::AppCache,
        risk_level: RiskLevel::Safe,
        description: "`.zcompdump` 补全转储",
        default_selected: true,
        sub_paths: &[],
        scope: RuleScope::HomeFiles(".zcompdump"),
    },
    // --- 废纸篓与安装残留 ---
    RuleDefinition {
        id: "user_trash",
        name: "废纸篓",
        category: CleanCategory::Trash,
        risk_level: RiskLevel::Recommended,
        description: "废纸篓中仍占空间的文件",
        default_selected: true,
        sub_paths: &[".Trash"],
        scope: RuleScope::Paths,
    },
    RuleDefinition {
        id: "downloads_installers",
        name: "下载目录安装包 (DMG / PKG)",
        category: CleanCategory::Trash,
        risk_level: RiskLevel::Recommended,
        description: "Downloads 顶层安装包",
        default_selected: false,
        sub_paths: &["Downloads"],
        scope: RuleScope::Paths,
    },
];

// `*` matches one directory level (or `prefix*` matches directories starting with prefix).
fn expand_sub_path(home: &Path, pattern: &str) -> (Vec<PathBuf>, bool) {
    let mut acc = vec![home.to_path_buf()];
    let mut denied = false;
    for part in pattern.split('/').filter(|part| !part.is_empty()) {
        let mut next = Vec::new();
        if part == "*" || (part.contains('*') && !part.starts_with('.')) {
            let prefix = part.strip_suffix('*');
            for dir in acc {
                match fs::read_dir(&dir) {
                    Ok(entries) => {
                        for entry in entries.flatten() {
                            let name = entry.file_name();
                            let name = name.to_string_lossy();
                            if name.starts_with('.') {
                                continue;
                            }
                            if let Some(pre) = prefix {
                                if !name.starts_with(pre) {
                                    continue;
                                }
                            }
                            match entry.file_type() {
                                Ok(kind) if kind.is_dir() && !kind.is_symlink() => {
                                    next.push(entry.path());
                                }
                                _ => {}
                            }
                        }
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => denied = true,
                }
            }
        } else {
            for dir in acc {
                next.push(dir.join(part));
            }
        }
        acc = next;
    }
    (acc, denied)
}

/// Strict protection: Never delete chat databases, journals, or core message directories.
pub fn is_protected_chat_database(path: &Path) -> bool {
    // 1. Never delete SQLite database files or journal/WAL files
    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        let ext = ext.to_ascii_lowercase();
        if matches!(
            ext.as_str(),
            "db" | "db-wal" | "db-shm" | "sqlite" | "sqlite3" | "db3" | "db-journal"
        ) {
            return true;
        }
    }

    // 2. Protect core message directories like `msg`, `Msg`, `db`
    let path_str = path.to_string_lossy();
    if path_str.contains("com.tencent.xinWeChat")
        || path_str.contains("xwechat_files")
        || path_str.contains("com.tencent.qq")
        || path_str.contains("nt_data")
    {
        for component in path.components() {
            if let std::path::Component::Normal(name) = component {
                let name_str = name.to_string_lossy();
                if name_str == "db" && (path_str.ends_with("/db") || path_str.ends_with("\\db")) {
                    return true;
                }
                if name_str.eq_ignore_ascii_case("msg")
                    && !path_str.contains("attach")
                    && !path_str.contains("video")
                    && !path_str.contains("file")
                    && !path_str.contains("temp")
                {
                    return true;
                }
            }
        }
    }

    false
}

// Never follow links, including links in an ancestor of a rule root.
fn checked_path(home: &Path, path: &Path) -> Result<(), String> {
    if is_protected_chat_database(path) {
        return Err(format!("受保护的核心聊天记录数据库，禁止删除: {}", path.display()));
    }
    use std::path::Component;
    let relative = path
        .strip_prefix(home)
        .map_err(|_| "路径超出清理范围".to_string())?;
    let mut current = home.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err("路径包含非法分量".into());
        }
        current.push(component);
        let metadata =
            fs::symlink_metadata(&current).map_err(|e| format!("{}: {}", current.display(), e))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("不清理符号链接: {}", current.display()));
        }
    }
    let canonical_home = home.canonicalize().map_err(|e| e.to_string())?;
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_home) || canonical == canonical_home {
        return Err("路径超出清理范围".into());
    }
    Ok(())
}

fn installer(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| ["dmg", "pkg", "iso"].contains(&s.to_ascii_lowercase().as_str()))
}

fn path_stats(path: &Path) -> Result<(u64, u64), String> {
    let mut bytes = 0;
    let mut files = 0;
    for entry in WalkDir::new(path).follow_links(false) {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
        if meta.is_file() {
            bytes += meta.len();
            files += 1;
        }
    }
    Ok((bytes, files))
}

fn modified_secs(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

fn max_opt(a: Option<u64>, b: Option<u64>) -> Option<u64> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.max(y)),
        (Some(x), None) => Some(x),
        (None, Some(y)) => Some(y),
        (None, None) => None,
    }
}

/// Parse a directory or filename as `YYYY-MM` (e.g. `2024-05` or `2024-5`).
fn parse_month_str(name: &str) -> Option<(i32, u32)> {
    let parts: Vec<&str> = name.split('-').collect();
    if parts.len() == 2 && parts[0].len() == 4 && (parts[1].len() == 1 || parts[1].len() == 2) {
        if let (Ok(year), Ok(month)) = (parts[0].parse::<i32>(), parts[1].parse::<u32>()) {
            if (2000..=2099).contains(&year) && (1..=12).contains(&month) {
                return Some((year, month));
            }
        }
    }
    None
}

/// Convert unix timestamp in seconds to `(year, month)`.
fn timestamp_to_year_month(secs: u64) -> (i32, u32) {
    let days = (secs / 86400) as i64;
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m)
}

#[derive(Default)]
struct MonthEntry {
    size_bytes: u64,
    file_count: u64,
    paths: Vec<PathBuf>,
    latest_modified: Option<u64>,
}

fn scan_monthly_aggregate(home: &Path, roots: &[PathBuf]) -> (u64, u64, Vec<CleanSubDetail>, bool) {
    let mut total_bytes: u64 = 0;
    let mut total_files: u64 = 0;
    let mut month_map: std::collections::HashMap<(i32, u32), MonthEntry> =
        std::collections::HashMap::new();
    let mut failed = false;

    for root in roots {
        if !root.try_exists().unwrap_or(false) {
            continue;
        }
        if checked_path(home, root).is_err() {
            failed = true;
            continue;
        }
        let entries = match fs::read_dir(root) {
            Ok(e) => e,
            Err(_) => {
                failed = true;
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    failed = true;
                    continue;
                }
            };
            let p = entry.path();
            if is_protected_chat_database(&p) {
                continue;
            }
            let meta = match fs::symlink_metadata(&p) {
                Ok(m) => m,
                Err(_) => {
                    failed = true;
                    continue;
                }
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if file_name.starts_with('.') {
                continue;
            }

            // Case A: p is directly a YYYY-MM directory (e.g. FileStorage/Image/2024-05)
            if let Some((y, m)) = parse_month_str(&file_name) {
                match path_stats(&p) {
                    Ok((sz, cnt)) => {
                        if sz > 0 || cnt > 0 {
                            let entry = month_map.entry((y, m)).or_default();
                            entry.size_bytes += sz;
                            entry.file_count += cnt;
                            entry.paths.push(p);
                            entry.latest_modified =
                                max_opt(entry.latest_modified, modified_secs(&meta));
                        }
                    }
                    Err(_) => failed = true,
                }
            } else if meta.is_dir() {
                // Case B: p is an intermediate folder (e.g. session hash folder in msg/attach)
                let sub_entries = match fs::read_dir(&p) {
                    Ok(e) => e,
                    Err(_) => {
                        failed = true;
                        continue;
                    }
                };
                for sub in sub_entries {
                    let sub = match sub {
                        Ok(e) => e,
                        Err(_) => {
                            failed = true;
                            continue;
                        }
                    };
                    let sub_p = sub.path();
                    if is_protected_chat_database(&sub_p) {
                        continue;
                    }
                    let sub_meta = match fs::symlink_metadata(&sub_p) {
                        Ok(m) => m,
                        Err(_) => {
                            failed = true;
                            continue;
                        }
                    };
                    if sub_meta.file_type().is_symlink() {
                        continue;
                    }
                    let sub_name = sub.file_name().to_string_lossy().into_owned();
                    if sub_name.starts_with('.') {
                        continue;
                    }

                    if let Some((y, m)) = parse_month_str(&sub_name) {
                        match path_stats(&sub_p) {
                            Ok((sz, cnt)) => {
                                if sz > 0 || cnt > 0 {
                                    let entry = month_map.entry((y, m)).or_default();
                                    entry.size_bytes += sz;
                                    entry.file_count += cnt;
                                    entry.paths.push(sub_p);
                                    entry.latest_modified = max_opt(
                                        entry.latest_modified,
                                        modified_secs(&sub_meta),
                                    );
                                }
                            }
                            Err(_) => failed = true,
                        }
                    } else if sub_meta.is_file() {
                        let secs = modified_secs(&sub_meta).unwrap_or(0);
                        let (y, m) = if secs > 0 {
                            timestamp_to_year_month(secs)
                        } else {
                            (0, 0)
                        };
                        let key = if (2000..=2099).contains(&y) && (1..=12).contains(&m) {
                            (y, m)
                        } else {
                            (0, 0)
                        };
                        let entry = month_map.entry(key).or_default();
                        entry.size_bytes += sub_meta.len();
                        entry.file_count += 1;
                        entry.paths.push(sub_p);
                        entry.latest_modified = max_opt(entry.latest_modified, Some(secs));
                    } else {
                        // Check if child directory contains YYYY-MM
                        let mut found_month = false;
                        if let Ok(deep_entries) = fs::read_dir(&sub_p) {
                            for de in deep_entries.flatten() {
                                let de_p = de.path();
                                if is_protected_chat_database(&de_p) {
                                    continue;
                                }
                                let de_name = de.file_name().to_string_lossy().into_owned();
                                if let Some((y, m)) = parse_month_str(&de_name) {
                                    if let Ok((sz, cnt)) = path_stats(&de_p) {
                                        found_month = true;
                                        let entry = month_map.entry((y, m)).or_default();
                                        entry.size_bytes += sz;
                                        entry.file_count += cnt;
                                        entry.paths.push(de_p);
                                    }
                                }
                            }
                        }
                        if !found_month {
                            if let Ok((sz, cnt)) = path_stats(&sub_p) {
                                if sz > 0 || cnt > 0 {
                                    let secs = modified_secs(&sub_meta).unwrap_or(0);
                                    let (y, m) = if secs > 0 {
                                        timestamp_to_year_month(secs)
                                    } else {
                                        (0, 0)
                                    };
                                    let key = if (2000..=2099).contains(&y) && (1..=12).contains(&m)
                                    {
                                        (y, m)
                                    } else {
                                        (0, 0)
                                    };
                                    let entry = month_map.entry(key).or_default();
                                    entry.size_bytes += sz;
                                    entry.file_count += cnt;
                                    entry.paths.push(sub_p);
                                    entry.latest_modified =
                                        max_opt(entry.latest_modified, Some(secs));
                                }
                            }
                        }
                    }
                }
            } else {
                // Case C: p is a file directly under root
                let secs = modified_secs(&meta).unwrap_or(0);
                let (y, m) = if secs > 0 {
                    timestamp_to_year_month(secs)
                } else {
                    (0, 0)
                };
                let key = if (2000..=2099).contains(&y) && (1..=12).contains(&m) {
                    (y, m)
                } else {
                    (0, 0)
                };
                let entry = month_map.entry(key).or_default();
                entry.size_bytes += meta.len();
                entry.file_count += 1;
                entry.paths.push(p);
                entry.latest_modified = max_opt(entry.latest_modified, Some(secs));
            }
        }
    }

    let mut keys: Vec<(i32, u32)> = month_map.keys().copied().collect();
    // Sort chronologically descending: (2026, 3), (2026, 2), ..., (0, 0)
    keys.sort_by(|a, b| b.cmp(a));

    let mut details = Vec::new();
    for key in keys {
        let entry = month_map.get_mut(&key).unwrap();
        if entry.size_bytes == 0 && entry.file_count == 0 {
            continue;
        }
        total_bytes += entry.size_bytes;
        total_files += entry.file_count;

        let display_name = if key.0 > 0 && key.1 > 0 {
            format!("{}年{:02}月", key.0, key.1)
        } else {
            "更早之前".to_string()
        };

        entry.paths.sort();
        entry.paths.dedup();
        let paths_vec: Vec<String> = entry
            .paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        let primary_path = paths_vec.join("\n");

        details.push(CleanSubDetail {
            path: primary_path,
            name: display_name,
            size_bytes: entry.size_bytes,
            file_count: entry.file_count,
            modified_at: entry.latest_modified,
            paths: paths_vec,
        });
    }

    (total_bytes, total_files, details, failed)
}

fn scan_path_stats(path: &Path, installers_only: bool) -> (u64, u64, Vec<CleanSubDetail>, bool) {
    let mut bytes = 0;
    let mut files = 0;
    let mut details = Vec::new();
    let mut failed = false;
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return (0, 0, details, true),
    };
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        let p = entry.path();
        if is_protected_chat_database(&p) {
            continue;
        }
        let meta = match fs::symlink_metadata(&p) {
            Ok(m) => m,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        if meta.file_type().is_symlink() || (installers_only && (!meta.is_file() || !installer(&p)))
        {
            continue;
        }
        match path_stats(&p) {
            Ok((size, count)) => {
                bytes += size;
                files += count;
                details.push(CleanSubDetail {
                    path: p.to_string_lossy().into_owned(),
                    name: entry.file_name().to_string_lossy().into_owned(),
                    size_bytes: size,
                    file_count: count,
                    modified_at: modified_secs(&meta),
                    paths: vec![p.to_string_lossy().into_owned()],
                });
            }
            Err(_) => failed = true,
        }
    }
    details.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    details.truncate(20);
    (bytes, files, details, failed)
}

fn name_excluded(name: &str, excludes: &[&str]) -> bool {
    excludes.iter().any(|item| *item == name)
}

fn expand_rule_roots(home: &Path, rule: &RuleDefinition) -> (Vec<PathBuf>, bool) {
    let mut raw_roots = Vec::new();
    let mut denied = false;
    for sub_path in rule.sub_paths {
        let (candidates, list_denied) = expand_sub_path(home, sub_path);
        denied |= list_denied;
        raw_roots.extend(candidates);
    }
    let mut roots = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for r in raw_roots {
        let key = r.canonicalize().unwrap_or_else(|_| r.clone());
        if seen.insert(key) {
            roots.push(r);
        }
    }
    (roots, denied)
}

fn scan_dir_children(
    root: &Path,
    excludes: &[&str],
) -> (u64, u64, Vec<CleanSubDetail>, bool) {
    let mut bytes = 0;
    let mut files = 0;
    let mut details = Vec::new();
    let mut failed = false;
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return (0, 0, details, true),
    };
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name_excluded(name.as_ref(), excludes) {
            continue;
        }
        let p = entry.path();
        if is_protected_chat_database(&p) {
            continue;
        }
        let meta = match fs::symlink_metadata(&p) {
            Ok(m) => m,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        match path_stats(&p) {
            Ok((size, count)) => {
                bytes += size;
                files += count;
                details.push(CleanSubDetail {
                    path: p.to_string_lossy().into_owned(),
                    name: name.into_owned(),
                    size_bytes: size,
                    file_count: count,
                    modified_at: modified_secs(&meta),
                    paths: vec![p.to_string_lossy().into_owned()],
                });
            }
            Err(_) => failed = true,
        }
    }
    details.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    details.truncate(20);
    (bytes, files, details, failed)
}

fn scan_app_support_leaves(root: &Path) -> (u64, u64, Vec<CleanSubDetail>, bool) {
    let mut bytes = 0;
    let mut files = 0;
    let mut details = Vec::new();
    let mut failed = false;
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return (0, 0, details, true),
    };
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        let app_name = entry.file_name();
        let app_name = app_name.to_string_lossy();
        if app_name.starts_with('.') {
            continue;
        }
        let app_dir = entry.path();
        let meta = match fs::symlink_metadata(&app_dir) {
            Ok(m) => m,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        if !meta.is_dir() || meta.file_type().is_symlink() {
            continue;
        }
        for leaf in APP_SUPPORT_LEAF_NAMES {
            let leaf_path = app_dir.join(leaf);
            let leaf_meta = match fs::symlink_metadata(&leaf_path) {
                Ok(m) => m,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => {
                    failed = true;
                    continue;
                }
            };
            if leaf_meta.file_type().is_symlink() {
                continue;
            }
            match path_stats(&leaf_path) {
                Ok((size, count)) if size > 0 || count > 0 => {
                    bytes += size;
                    files += count;
                    details.push(CleanSubDetail {
                        path: leaf_path.to_string_lossy().into_owned(),
                        name: format!("{app_name}/{leaf}"),
                        size_bytes: size,
                        file_count: count,
                        modified_at: modified_secs(&leaf_meta),
                        paths: vec![leaf_path.to_string_lossy().into_owned()],
                    });
                }
                Ok(_) => {}
                Err(_) => failed = true,
            }
        }
    }
    details.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    details.truncate(20);
    (bytes, files, details, failed)
}

fn scan_home_files(home: &Path, prefix: &str) -> (u64, u64, Vec<CleanSubDetail>, bool) {
    let mut bytes = 0;
    let mut files = 0;
    let mut details = Vec::new();
    let mut failed = false;
    let entries = match fs::read_dir(home) {
        Ok(e) => e,
        Err(_) => return (0, 0, details, true),
    };
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(prefix) {
            continue;
        }
        let p = entry.path();
        if is_protected_chat_database(&p) {
            continue;
        }
        let meta = match fs::symlink_metadata(&p) {
            Ok(m) => m,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        if !meta.is_file() || meta.file_type().is_symlink() {
            continue;
        }
        bytes += meta.len();
        files += 1;
        details.push(CleanSubDetail {
            path: p.to_string_lossy().into_owned(),
            name: name.into_owned(),
            size_bytes: meta.len(),
            file_count: 1,
            modified_at: modified_secs(&meta),
            paths: vec![p.to_string_lossy().into_owned()],
        });
    }
    details.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    details.truncate(20);
    (bytes, files, details, failed)
}

fn collect_app_support_targets(root: &Path) -> Vec<PathBuf> {
    let mut targets = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return targets;
    };
    for entry in entries.flatten() {
        let app_dir = entry.path();
        let Ok(meta) = fs::symlink_metadata(&app_dir) else {
            continue;
        };
        if !meta.is_dir() || meta.file_type().is_symlink() {
            continue;
        }
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        for leaf in APP_SUPPORT_LEAF_NAMES {
            let leaf_path = app_dir.join(leaf);
            if leaf_path.try_exists().unwrap_or(false) {
                targets.push(leaf_path);
            }
        }
    }
    targets
}

fn path_allowed_for_rule(home: &Path, rule: &RuleDefinition, target: &Path) -> bool {
    match rule.scope {
        RuleScope::Paths | RuleScope::MonthlyAggregate => {
            let (roots, _) = expand_rule_roots(home, rule);
            if rule.id == "downloads_installers" {
                return roots.iter().any(|root| {
                    target.parent() == Some(root.as_path())
                        && installer(target)
                        && fs::symlink_metadata(target).is_ok_and(|m| m.is_file())
                });
            }
            roots
                .iter()
                .any(|root| target != root.as_path() && target.starts_with(root))
        }
        RuleScope::DirChildren(excludes) => {
            let (roots, _) = expand_rule_roots(home, rule);
            roots.iter().any(|root| {
                if target == root.as_path() || !target.starts_with(root) {
                    return false;
                }
                let Ok(relative) = target.strip_prefix(root) else {
                    return false;
                };
                let Some(std::path::Component::Normal(first)) = relative.components().next() else {
                    return false;
                };
                let first = first.to_string_lossy();
                !first.starts_with('.') && !name_excluded(first.as_ref(), excludes)
            })
        }
        RuleScope::AppSupportLeaves => {
            let root = home.join("Library/Application Support");
            if !target.starts_with(&root) || target == root {
                return false;
            }
            let Ok(relative) = target.strip_prefix(&root) else {
                return false;
            };
            let parts: Vec<_> = relative.components().collect();
            if parts.len() < 2 {
                return false;
            }
            match (&parts[0], &parts[1]) {
                (
                    std::path::Component::Normal(app),
                    std::path::Component::Normal(leaf),
                ) => {
                    !app.to_string_lossy().starts_with('.')
                        && APP_SUPPORT_LEAF_NAMES.iter().any(|name| *name == leaf.to_string_lossy())
                }
                _ => false,
            }
        }
        RuleScope::HomeFiles(prefix) => {
            target.parent() == Some(home)
                && target
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(prefix))
                && fs::symlink_metadata(target).is_ok_and(|m| m.is_file())
        }
    }
}

/// Get primary disk total and free capacity (bytes)
pub fn get_disk_capacity() -> (u64, u64) {
    if !cfg!(target_os = "macos") {
        return (0, 0);
    }
    let output = Command::new("df").args(["-k", "/"]).output();
    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = text.lines().collect();
        if lines.len() >= 2 {
            let parts: Vec<&str> = lines[1].split_whitespace().collect();
            // Typical macOS df -k format:
            // Filesystem 1024-blocks Used Available Capacity ...
            if parts.len() >= 4 {
                if let (Ok(total_kb), Ok(free_kb)) =
                    (parts[1].parse::<u64>(), parts[3].parse::<u64>())
                {
                    return (total_kb * 1024, free_kb * 1024);
                }
            }
        }
    }
    (0, 0)
}

/// Execute full system & application clean scan
pub fn scan_disk_clean_items() -> DiskCleanScanResult {
    if !cfg!(target_os = "macos") {
        return DiskCleanScanResult {
            supported: false,
            total_scanned_bytes: 0,
            total_safe_bytes: 0,
            total_recommended_bytes: 0,
            total_caution_bytes: 0,
            total_files: 0,
            items: Vec::new(),
            has_permission_issues: false,
            disk_total_bytes: 0,
            disk_free_bytes: 0,
            full_disk_client_name: String::new(),
        };
    }
    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/Users/current"));

    let mut scanned_items = Vec::new();
    let mut total_scanned_bytes = 0u64;
    let mut total_safe_bytes = 0u64;
    let mut total_recommended_bytes = 0u64;
    let mut total_caution_bytes = 0u64;
    let mut total_files = 0u64;
    let mut has_permission_issues = false;

    for rule in CLEAN_RULES {
        let is_installer_rule = rule.id == "downloads_installers";
        let mut rule_size = 0u64;
        let mut rule_file_count = 0u64;
        let mut rule_details = Vec::new();
        let mut existing_paths = Vec::new();
        let mut is_denied = false;

        match rule.scope {
            RuleScope::HomeFiles(prefix) => {
                let (sz, cnt, sub_details, denied) = scan_home_files(&home_dir, prefix);
                if denied {
                    is_denied = true;
                    has_permission_issues = true;
                }
                if !sub_details.is_empty() {
                    existing_paths.push(home_dir.to_string_lossy().into_owned());
                    rule_size = sz;
                    rule_file_count = cnt;
                    rule_details = sub_details;
                }
            }
            RuleScope::AppSupportLeaves => {
                let root = home_dir.join("Library/Application Support");
                if root.try_exists().unwrap_or(false) {
                    existing_paths.push(root.to_string_lossy().into_owned());
                    let (sz, cnt, sub_details, denied) =
                        if checked_path(&home_dir, &root).is_ok() {
                            scan_app_support_leaves(&root)
                        } else {
                            (0, 0, Vec::new(), true)
                        };
                    if denied {
                        is_denied = true;
                        has_permission_issues = true;
                    }
                    rule_size = sz;
                    rule_file_count = cnt;
                    rule_details = sub_details;
                }
            }
            RuleScope::DirChildren(excludes) => {
                let (roots, list_denied) = expand_rule_roots(&home_dir, rule);
                if list_denied {
                    is_denied = true;
                    has_permission_issues = true;
                }
                for full_path in roots {
                    if !full_path.try_exists().unwrap_or(true) {
                        continue;
                    }
                    existing_paths.push(full_path.to_string_lossy().into_owned());
                    let (sz, cnt, sub_details, denied) =
                        if checked_path(&home_dir, &full_path).is_ok() {
                            scan_dir_children(&full_path, excludes)
                        } else {
                            (0, 0, Vec::new(), true)
                        };
                    if denied {
                        is_denied = true;
                        has_permission_issues = true;
                    }
                    rule_size += sz;
                    rule_file_count += cnt;
                    rule_details.extend(sub_details);
                }
                existing_paths.sort();
                existing_paths.dedup();
                let mut seen_detail_paths = std::collections::HashSet::new();
                rule_details.retain(|d| {
                    let key = Path::new(&d.path)
                        .canonicalize()
                        .unwrap_or_else(|_| PathBuf::from(&d.path));
                    seen_detail_paths.insert(key)
                });
            }
            RuleScope::Paths => {
                let (roots, list_denied) = expand_rule_roots(&home_dir, rule);
                if list_denied {
                    is_denied = true;
                    has_permission_issues = true;
                }
                for full_path in roots {
                    if !full_path.try_exists().unwrap_or(true) {
                        continue;
                    }
                    existing_paths.push(full_path.to_string_lossy().into_owned());
                    let (sz, cnt, sub_details, denied) =
                        if checked_path(&home_dir, &full_path).is_ok() {
                            scan_path_stats(&full_path, is_installer_rule)
                        } else {
                            (0, 0, Vec::new(), true)
                        };
                    if denied {
                        is_denied = true;
                        has_permission_issues = true;
                    }
                    rule_size += sz;
                    rule_file_count += cnt;
                    rule_details.extend(sub_details);
                }
                existing_paths.sort();
                existing_paths.dedup();
                let mut seen_detail_paths = std::collections::HashSet::new();
                rule_details.retain(|d| {
                    let key = Path::new(&d.path)
                        .canonicalize()
                        .unwrap_or_else(|_| PathBuf::from(&d.path));
                    seen_detail_paths.insert(key)
                });
            }
            RuleScope::MonthlyAggregate => {
                let (roots, list_denied) = expand_rule_roots(&home_dir, rule);
                if list_denied {
                    is_denied = true;
                    has_permission_issues = true;
                }
                for r in &roots {
                    if r.try_exists().unwrap_or(true) {
                        existing_paths.push(r.to_string_lossy().into_owned());
                    }
                }
                let (sz, cnt, sub_details, denied) = scan_monthly_aggregate(&home_dir, &roots);
                if denied {
                    is_denied = true;
                    has_permission_issues = true;
                }
                rule_size = sz;
                rule_file_count = cnt;
                rule_details = sub_details;
            }
        }

        if !matches!(rule.scope, RuleScope::MonthlyAggregate) {
            rule_details.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
            if rule_details.len() > 20 {
                rule_details.truncate(20);
            }
        }

        // Include when roots exist (even if empty); HomeFiles only when matches found.
        if !existing_paths.is_empty() {
            match rule.risk_level {
                RiskLevel::Safe => total_safe_bytes += rule_size,
                RiskLevel::Recommended => total_recommended_bytes += rule_size,
                RiskLevel::Caution => total_caution_bytes += rule_size,
            }

            total_scanned_bytes += rule_size;
            total_files += rule_file_count;

            scanned_items.push(CleanItem {
                id: rule.id.to_string(),
                name: rule.name.to_string(),
                category: rule.category.clone(),
                risk_level: rule.risk_level.clone(),
                description: rule.description.to_string(),
                size_bytes: rule_size,
                file_count: rule_file_count,
                paths: existing_paths,
                default_selected: rule.default_selected && rule_size > 0,
                details: rule_details,
                is_permission_denied: is_denied,
            });
        }
    }

    let (disk_total, disk_free) = get_disk_capacity();

    DiskCleanScanResult {
        supported: true,
        total_scanned_bytes,
        total_safe_bytes,
        total_recommended_bytes,
        total_caution_bytes,
        total_files,
        items: scanned_items,
        has_permission_issues,
        disk_total_bytes: disk_total,
        disk_free_bytes: disk_free,
        full_disk_client_name: crate::macos_privacy::privacy_client_name(),
    }
}

fn empty_result() -> CleanExecutionResult {
    CleanExecutionResult {
        freed_bytes: 0,
        deleted_files_count: 0,
        errors: Vec::new(),
        success: true,
    }
}

// Delete one entry at a time so partial failures report exactly what was removed.
fn remove_checked(home: &Path, path: &Path, result: &mut CleanExecutionResult) {
    if let Err(e) = checked_path(home, path) {
        result.errors.push(e);
        return;
    }
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                return;
            }
            result.errors.push(e.to_string());
            return;
        }
    };
    if meta.is_dir() {
        match fs::read_dir(path) {
            Ok(entries) => {
                for entry in entries {
                    match entry {
                        Ok(entry) => remove_checked(home, &entry.path(), result),
                        Err(e) => result.errors.push(e.to_string()),
                    }
                }
            }
            Err(e) => {
                result.errors.push(format!("{}: {}", path.display(), e));
                return;
            }
        }
        if let Err(e) = fs::remove_dir(path) {
            result.errors.push(format!("{}: {}", path.display(), e));
        }
    } else {
        match fs::remove_file(path) {
            Ok(()) => {
                result.freed_bytes += meta.len();
                result.deleted_files_count += 1;
            }
            Err(e) => result.errors.push(format!("{}: {}", path.display(), e)),
        }
    }
}

fn execute_rule(home: &Path, rule: &RuleDefinition, processed: &mut std::collections::HashSet<PathBuf>, result: &mut CleanExecutionResult) {
    match rule.scope {
        RuleScope::HomeFiles(prefix) => {
            let Ok(entries) = fs::read_dir(home) else {
                return;
            };
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if !name.starts_with(prefix) {
                    continue;
                }
                let p = entry.path();
                if fs::symlink_metadata(&p).is_ok_and(|m| m.is_file()) && processed.insert(p.clone())
                {
                    remove_checked(home, &p, result);
                }
            }
        }
        RuleScope::AppSupportLeaves => {
            let root = home.join("Library/Application Support");
            if !root.try_exists().unwrap_or(false) {
                return;
            }
            if let Err(e) = checked_path(home, &root) {
                result.errors.push(e);
                return;
            }
            for target in collect_app_support_targets(&root) {
                if processed.insert(target.clone()) {
                    remove_checked(home, &target, result);
                }
            }
        }
        RuleScope::DirChildren(excludes) => {
            let (roots, _) = expand_rule_roots(home, rule);
            for root in roots {
                if !root.try_exists().unwrap_or(true) {
                    continue;
                }
                if let Err(e) = checked_path(home, &root) {
                    result.errors.push(e);
                    continue;
                }
                match fs::read_dir(&root) {
                    Ok(entries) => {
                        for entry in entries {
                            match entry {
                                Ok(entry) => {
                                    let name = entry.file_name();
                                    let name = name.to_string_lossy();
                                    if name.starts_with('.')
                                        || name_excluded(name.as_ref(), excludes)
                                    {
                                        continue;
                                    }
                                    let p = entry.path();
                                    if processed.insert(p.clone()) {
                                        remove_checked(home, &p, result);
                                    }
                                }
                                Err(e) => result.errors.push(e.to_string()),
                            }
                        }
                    }
                    Err(e) => result.errors.push(format!("{}: {}", root.display(), e)),
                }
            }
        }
        RuleScope::Paths | RuleScope::MonthlyAggregate => {
            let (roots, _) = expand_rule_roots(home, rule);
            for root in roots {
                if !root.try_exists().unwrap_or(true) {
                    continue;
                }
                if let Err(e) = checked_path(home, &root) {
                    result.errors.push(e);
                    continue;
                }
                match fs::read_dir(&root) {
                    Ok(entries) => {
                        for entry in entries {
                            match entry {
                                Ok(entry) => {
                                    let p = entry.path();
                                    if rule.id == "downloads_installers"
                                        && (!installer(&p)
                                            || !fs::symlink_metadata(&p)
                                                .is_ok_and(|m| m.is_file()))
                                    {
                                        continue;
                                    }
                                    if processed.insert(p.clone()) {
                                        remove_checked(home, &p, result);
                                    }
                                }
                                Err(e) => result.errors.push(e.to_string()),
                            }
                        }
                    }
                    Err(e) => result.errors.push(format!("{}: {}", root.display(), e)),
                }
            }
        }
    }
}

fn execute_at(home: &Path, request: CleanExecutionRequest) -> CleanExecutionResult {
    let mut result = empty_result();
    if !request.delete_permanently {
        result
            .errors
            .push("暂不支持移至废纸篓；未删除任何文件".into());
        result.success = false;
        return result;
    }
    let mut processed = std::collections::HashSet::new();
    for id in request.item_ids {
        let Some(rule) = CLEAN_RULES.iter().find(|r| r.id == id) else {
            result.errors.push(format!("未知清理项目: {}", id));
            continue;
        };
        execute_rule(home, rule, &mut processed, &mut result);
    }
    result.success = result.errors.is_empty();
    result
}

pub fn execute_clean(request: CleanExecutionRequest) -> CleanExecutionResult {
    if !cfg!(target_os = "macos") {
        return CleanExecutionResult {
            errors: vec!["磁盘清理暂仅支持macOS".into()],
            success: false,
            ..empty_result()
        };
    }
    match dirs::home_dir() {
        Some(home) => execute_at(&home, request),
        None => CleanExecutionResult {
            errors: vec!["无法获取用户目录".into()],
            success: false,
            ..empty_result()
        },
    }
}

fn single_at(home: &Path, target: &Path) -> CleanExecutionResult {
    let mut result = empty_result();
    let allowed = CLEAN_RULES
        .iter()
        .any(|rule| path_allowed_for_rule(home, rule, target));
    if !allowed {
        result.errors.push("该路径不属于可清理范围".into());
    } else {
        remove_checked(home, target, &mut result);
    }
    result.success = result.errors.is_empty();
    result
}

pub fn execute_clean_single_path(target: &str) -> CleanExecutionResult {
    if !cfg!(target_os = "macos") {
        return CleanExecutionResult {
            errors: vec!["磁盘清理暂仅支持macOS".into()],
            success: false,
            ..empty_result()
        };
    }
    match dirs::home_dir() {
        Some(home) => {
            let mut total_result = empty_result();
            let mut attempted = false;
            for line in target.lines().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                attempted = true;
                let r = single_at(&home, Path::new(line));
                total_result.freed_bytes += r.freed_bytes;
                total_result.deleted_files_count += r.deleted_files_count;
                total_result.errors.extend(r.errors);
            }
            if !attempted {
                return empty_result();
            }
            total_result.success = total_result.errors.is_empty();
            total_result
        }
        None => CleanExecutionResult {
            errors: vec!["无法获取用户目录".into()],
            success: false,
            ..empty_result()
        },
    }
}

/// Open macOS Privacy & Security panel (Full Disk Access)
pub fn open_full_disk_access_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        crate::macos_privacy::register_for_full_disk_access();
        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn()
            .map_err(|e| format!("打开系统设置失败: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("仅 macOS 支持此功能".to_string())
    }
}

#[cfg(test)]
mod safety_tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT_FIXTURE: std::sync::atomic::AtomicU64 =
                std::sync::atomic::AtomicU64::new(0);
            loop {
                let sequence = NEXT_FIXTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let p = std::env::temp_dir().join(format!(
                    "cleaner-safety-{}-{}",
                    std::process::id(),
                    sequence
                ));
                // Exclusive creation is essential: wall-clock timestamps can repeat
                // across test threads, causing one fixture's Drop to delete another.
                match fs::create_dir(&p) {
                    Ok(()) => return Self(p),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(e) => panic!("cannot create isolated fixture {}: {}", p.display(), e),
                }
            }
        }
        fn file(&self, relative: &str) -> PathBuf {
            let p = self.0.join(relative);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, b"fixture").unwrap();
            p
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn unsupported_platform_never_scans_or_deletes() {
        let scan = scan_disk_clean_items();
        assert!(!scan.supported);
        assert!(scan.items.is_empty());
        assert_eq!(get_disk_capacity(), (0, 0));
        let f = Fixture::new();
        let path = f.file(".cache/preserve");
        let result = execute_clean_single_path(path.to_str().unwrap());
        assert!(!result.success);
        assert_eq!(result.freed_bytes, 0);
        assert!(path.exists());
        let result = execute_clean(CleanExecutionRequest {
            item_ids: vec!["dot_cache".into()],
            delete_permanently: true,
        });
        assert!(!result.success);
        assert_eq!(result.deleted_files_count, 0);
    }
    #[test]
    fn concurrent_fixtures_have_exclusive_directories() {
        let handles: Vec<_> = (0..32).map(|_| std::thread::spawn(Fixture::new)).collect();
        let fixtures: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let paths: std::collections::HashSet<_> = fixtures.iter().map(|f| &f.0).collect();
        assert_eq!(paths.len(), fixtures.len());
        assert!(fixtures.iter().all(|f| f.0.is_dir()));
    }
    #[test]
    fn rejects_escape_personal_data_and_non_installers() {
        let f = Fixture::new();
        for relative in [
            "Downloads/personal.txt",
            "Library/Containers/private/document",
            "Library/Developer/project/code",
        ] {
            let p = f.file(relative);
            assert!(!single_at(&f.0, &p).success);
            assert!(p.exists());
        }
        let p = f.file("Documents/important");
        fs::create_dir_all(f.0.join(".cache")).unwrap();
        assert!(!single_at(&f.0, &f.0.join(".cache/../Documents/important")).success);
        assert!(p.exists());
    }
    #[test]
    fn scans_deep_files_and_refuses_nonpermanent_delete() {
        let f = Fixture::new();
        let relative = format!(".cache/{}file", "nested/".repeat(16));
        let p = f.file(&relative);
        let stats = scan_path_stats(&f.0.join(".cache"), false);
        assert_eq!((stats.0, stats.1), (7, 1));
        let refused = execute_at(
            &f.0,
            CleanExecutionRequest {
                item_ids: vec!["dot_cache".into()],
                delete_permanently: false,
            },
        );
        assert!(!refused.success);
        assert!(p.exists());
        let result = execute_at(
            &f.0,
            CleanExecutionRequest {
                item_ids: vec!["dot_cache".into()],
                delete_permanently: true,
            },
        );
        assert!(result.success, "{:?}", result.errors);
        assert_eq!((result.freed_bytes, result.deleted_files_count), (7, 1));
        assert!(!p.exists());
    }
    #[test]
    fn installers_are_top_level_only_and_logs_do_not_overlap() {
        let f = Fixture::new();
        let dmg = f.file("Downloads/setup.DMG");
        let nested = f.file("Downloads/nested/setup.pkg");
        let personal = f.file("Downloads/private.txt");
        let scan = scan_path_stats(&f.0.join("Downloads"), true);
        assert_eq!((scan.0, scan.1), (7, 1));
        let result = execute_at(
            &f.0,
            CleanExecutionRequest {
                item_ids: vec!["downloads_installers".into(), "downloads_installers".into()],
                delete_permanently: true,
            },
        );
        assert!(result.success, "{:?}", result.errors);
        assert_eq!((result.freed_bytes, result.deleted_files_count), (7, 1));
        assert!(!dmg.exists());
        assert!(nested.exists());
        assert!(personal.exists());
        assert_rule_paths_do_not_conflict();
    }

    fn assert_rule_paths_do_not_conflict() {
        // Path-scoped rules must not nest under each other.
        let path_rules: Vec<_> = CLEAN_RULES
            .iter()
            .filter(|r| matches!(r.scope, RuleScope::Paths))
            .collect();
        for a in &path_rules {
            for b in &path_rules {
                if a.id == b.id {
                    continue;
                }
                for pa in a.sub_paths {
                    for pb in b.sub_paths {
                        if pa.contains('*') || pb.contains('*') {
                            continue;
                        }
                        assert!(
                            !Path::new(pa).starts_with(pb),
                            "overlapping path rules: {} ({pa}) under {} ({pb})",
                            a.id,
                            b.id
                        );
                    }
                }
            }
        }
        // DirChildren parents must exclude first-level names of more specific rules.
        for parent in CLEAN_RULES {
            let RuleScope::DirChildren(excludes) = parent.scope else {
                continue;
            };
            for child in CLEAN_RULES {
                if child.id == parent.id {
                    continue;
                }
                for parent_root in parent.sub_paths {
                    for child_path in child.sub_paths {
                        let prefix = format!("{parent_root}/");
                        let Some(rest) = child_path.strip_prefix(&prefix) else {
                            continue;
                        };
                        let first = rest.split('/').next().unwrap_or("");
                        if first.is_empty() || first == "*" {
                            continue;
                        }
                        assert!(
                            name_excluded(first, excludes),
                            "{} path {child_path} under {} but `{first}` not excluded",
                            child.id,
                            parent.id
                        );
                    }
                }
            }
        }
    }
    #[cfg(unix)]
    #[test]
    fn partial_failure_is_reported_and_counts_only_deleted_files() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let outside = Fixture::new();
        let secret = outside.file("secret");
        let good = f.file(".cache/good");
        symlink(&outside.0, f.0.join(".cache/link")).unwrap();
        let scan = scan_path_stats(&f.0.join(".cache"), false);
        assert_eq!((scan.0, scan.1), (7, 1));
        let result = execute_at(
            &f.0,
            CleanExecutionRequest {
                item_ids: vec!["dot_cache".into()],
                delete_permanently: true,
            },
        );
        assert!(!result.success);
        assert!(!result.errors.is_empty());
        assert_eq!((result.freed_bytes, result.deleted_files_count), (7, 1));
        assert!(!good.exists());
        assert!(secret.exists());
    }
    #[test]
    fn unknown_ids_and_rule_roots_are_rejected() {
        let f = Fixture::new();
        f.file(".cache/good");
        assert!(!single_at(&f.0, &f.0.join(".cache")).success);
        let result = execute_at(
            &f.0,
            CleanExecutionRequest {
                item_ids: vec!["unknown".into()],
                delete_permanently: true,
            },
        );
        assert!(!result.success);
        assert!(f.0.join(".cache/good").exists());
    }
    #[test]
    fn ten_thousand_small_files_fixture_timing() {
        let f = Fixture::new();
        for i in 0..10000 {
            f.file(&format!(".cache/group{}/file{}", i / 100, i));
        }
        let started = std::time::Instant::now();
        let scan = scan_dir_children(&f.0.join(".cache"), DOT_CACHE_EXCLUDES);
        let scan_time = started.elapsed();
        if (scan.0, scan.1) != (70000, 10000) {
            let mut counts = Vec::new();
            for group in fs::read_dir(f.0.join(".cache")).unwrap() {
                let group = group.unwrap();
                let paths: Vec<_> = fs::read_dir(group.path())
                    .unwrap()
                    .map(|e| e.unwrap().path())
                    .collect();
                let stats = path_stats(&group.path());
                if paths.len() != 100 || stats.as_ref().map_or(true, |s| s.1 != 100) {
                    counts.push((group.path(), paths.len(), stats));
                }
            }
            panic!(
                "scan mismatch {:?}, failed={}, root={}, anomalous groups={:?}",
                (scan.0, scan.1),
                scan.3,
                f.0.display(),
                counts
            );
        }
        let started = std::time::Instant::now();
        let result = execute_at(
            &f.0,
            CleanExecutionRequest {
                item_ids: vec!["dot_cache".into()],
                delete_permanently: true,
            },
        );
        eprintln!(
            "10000 small files: scan {:?}, delete {:?}",
            scan_time,
            started.elapsed()
        );
        assert!(result.success, "{:?}", result.errors);
        assert_eq!(result.deleted_files_count, 10000);
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_ancestors_and_preserves_external_files() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let outside = Fixture::new();
        let p = outside.file("secret");
        symlink(&outside.0, f.0.join(".cache")).unwrap();
        assert!(!single_at(&f.0, &f.0.join(".cache/secret")).success);
        let result = execute_at(
            &f.0,
            CleanExecutionRequest {
                item_ids: vec!["dot_cache".into()],
                delete_permanently: true,
            },
        );
        assert!(!result.success);
        assert!(p.exists());
    }
    #[test]
    fn wildcard_paths_expand_on_execute_and_dot_cache_skips_excluded() {
        let f = Fixture::new();
        let cache = f.file(
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/account1/cache/img",
        );
        let model = f.file(".cache/huggingface/weights.bin");
        let uv = f.file(".cache/uv/wheel");
        let result = execute_at(
            &f.0,
            CleanExecutionRequest {
                item_ids: vec!["wechat_timeline_stream".into(), "dot_cache".into()],
                delete_permanently: true,
            },
        );
        assert!(result.success, "{:?}", result.errors);
        assert!(!cache.exists());
        assert!(model.exists());
        assert!(!uv.exists());
    }
    #[test]
    fn chat_databases_are_strictly_protected_from_deletion() {
        let f = Fixture::new();
        let wechat_db = f.file(
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/account1/msg/msg_0.db",
        );
        let qq_db = f.file(
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/nt_qq/nt_data/db/nt_msg.db",
        );
        let qq_wal = f.file(
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/nt_qq/nt_data/db/nt_msg.db-wal",
        );
        assert!(is_protected_chat_database(&wechat_db));
        assert!(is_protected_chat_database(&qq_db));
        assert!(is_protected_chat_database(&qq_wal));

        assert!(checked_path(&f.0, &wechat_db).is_err());
        assert!(checked_path(&f.0, &qq_db).is_err());

        assert!(!single_at(&f.0, &wechat_db).success);
        assert!(wechat_db.exists());
        assert!(qq_db.exists());
    }

    #[test]
    fn date_helpers_parse_and_convert_correctly() {
        assert_eq!(parse_month_str("2024-05"), Some((2024, 5)));
        assert_eq!(parse_month_str("2026-12"), Some((2026, 12)));
        assert_eq!(parse_month_str("40a6b5761730dd5a01f84a4ca8c92c82"), None);
        assert_eq!(parse_month_str("thumb"), None);
        assert_eq!(parse_month_str("1998-01"), None);

        assert_eq!(timestamp_to_year_month(0), (1970, 1));
        assert_eq!(timestamp_to_year_month(1709164800), (2024, 2)); // 2024-02-29 leap day
        assert_eq!(timestamp_to_year_month(1709251200), (2024, 3)); // 2024-03-01
        assert_eq!(timestamp_to_year_month(1773532800), (2026, 3)); // 2026-03-15
    }

    #[test]
    fn monthly_aggregate_scans_and_deletes_by_month() {
        let f = Fixture::new();
        // Create WeChat structure:
        // Root: Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_user/msg/attach
        // Two sessions: hash_aaa and hash_bbb
        let img_may1 = f.file("Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_user/msg/attach/hash_aaa/2024-05/img1.jpg");
        let img_may2 = f.file("Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_user/msg/attach/hash_bbb/2024-05/img2.jpg");
        let img_jun1 = f.file("Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_user/msg/attach/hash_aaa/2024-06/img3.jpg");
        let img_jun2 = f.file("Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_user/FileStorage/Image/2024-06/img4.jpg");
        let protected_db = f.file("Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_user/msg/msg_0.db");

        let rule = CLEAN_RULES.iter().find(|r| r.id == "wechat_chat_images").unwrap();
        let (roots, denied) = expand_rule_roots(&f.0, rule);
        assert!(!denied);
        assert!(!roots.is_empty());

        let (total_bytes, total_files, details, failed) = scan_monthly_aggregate(&f.0, &roots);
        assert!(!failed);
        assert_eq!(total_files, 4);
        assert!(total_bytes > 0);
        assert_eq!(details.len(), 2);

        // Ordered chronologically descending: 2024年06月 first, 2024年05月 second
        assert_eq!(details[0].name, "2024年06月");
        assert_eq!(details[0].file_count, 2);
        assert_eq!(details[1].name, "2024年05月");
        assert_eq!(details[1].file_count, 2);

        // Delete only 2024年05月 using multi-line path in detail[1]
        let may_paths = &details[1].path;
        let mut clean_res = empty_result();
        for line in may_paths.lines() {
            let r = single_at(&f.0, Path::new(line));
            clean_res.freed_bytes += r.freed_bytes;
            clean_res.deleted_files_count += r.deleted_files_count;
            clean_res.errors.extend(r.errors);
        }
        clean_res.success = clean_res.errors.is_empty();
        assert!(clean_res.success, "{:?}", clean_res.errors);
        assert_eq!(clean_res.deleted_files_count, 2);

        // May files deleted
        assert!(!img_may1.exists());
        assert!(!img_may2.exists());
        // June files remain
        assert!(img_jun1.exists());
        assert!(img_jun2.exists());
        // Protected db remains
        assert!(protected_db.exists());
    }

    #[test]
    fn case_duplicates_and_hidden_files_are_deduplicated_and_filtered() {
        let f = Fixture::new();
        let cache_file = f.file(
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/account1/cache/2026-10/media.dat",
        );
        let ds_store = f.file(
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/account1/cache/.DS_Store",
        );
        let cache_dir = cache_file.parent().unwrap().parent().unwrap();

        // 1. scan_path_stats should ignore .DS_Store
        let (_bytes, _count, details, failed) = scan_path_stats(cache_dir, false);
        assert!(!failed);
        // Details should only show 2026-10, never .DS_Store!
        assert_eq!(details.len(), 1);
        assert_eq!(details[0].name, "2026-10");
        assert!(ds_store.exists());

        // 2. expand_rule_roots should deduplicate roots even if sub_paths has duplicate/case variations
        let rule = CLEAN_RULES
            .iter()
            .find(|r| r.id == "wechat_timeline_stream")
            .unwrap();
        let (roots, denied) = expand_rule_roots(&f.0, rule);
        assert!(!denied);
        let mut seen = std::collections::HashSet::new();
        for r in &roots {
            let key = r.canonicalize().unwrap_or_else(|_| r.clone());
            assert!(seen.insert(key), "Duplicate root found: {:?}", r);
        }
    }
}
