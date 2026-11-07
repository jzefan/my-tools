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
    Wechat,     // 微信专清
    Qq,         // QQ 专清
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

struct RuleDefinition {
    id: &'static str,
    name: &'static str,
    category: CleanCategory,
    risk_level: RiskLevel,
    description: &'static str,
    default_selected: bool,
    // Relative paths from user home directory
    sub_paths: &'static [&'static str],
}

const CLEAN_RULES: &[RuleDefinition] = &[
    // --- 微信专清 ---
    RuleDefinition {
        id: "wechat_webkit_cache",
        name: "微信网页内核缓存",
        category: CleanCategory::Wechat,
        risk_level: RiskLevel::Safe,
        description: "微信内置网页内核与小程序引擎渲染缓存，清理后按需重建",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.xinWeChat/Data/Library/Caches",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/app_data/radium/Cache",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/app_data/radium/Code Cache",
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/app_data/radium/GPUCache",
            "Library/Containers/com.tencent.xinWeChat.WeChatMacShare/Data/Library/Caches",
        ],
    },
    RuleDefinition {
        id: "wechat_timeline_stream",
        name: "微信朋友圈与流媒体缓存",
        category: CleanCategory::Wechat,
        risk_level: RiskLevel::Safe,
        description: "朋友圈、公众号图文与短视频临时播放缓存，清理临时播放与缩略图缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/cache",
        ],
    },
    RuleDefinition {
        id: "wechat_group_container_cache",
        name: "微信共享群组缓存",
        category: CleanCategory::Wechat,
        risk_level: RiskLevel::Safe,
        description: "微信主程序与系统扩展组件间共享的数据缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Group Containers/5A4RE8SF68.com.tencent.xinWeChat/Library/Caches",
            "Library/Group Containers/5A4RE8SF68.com.tencent.xinWeChat/Library/WebKit",
        ],
    },
    RuleDefinition {
        id: "wechat_temp_preview",
        name: "微信接收文件临时预览副本",
        category: CleanCategory::Wechat,
        risk_level: RiskLevel::Recommended,
        description: "在微信中双击预览文档或视频时生成的系统临时副本",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/*/temp",
            "Library/Containers/com.tencent.xinWeChat/Data/tmp",
        ],
    },
    // --- QQ 专清 ---
    RuleDefinition {
        id: "qq_engine_cache",
        name: "QQ 核心渲染与代码缓存",
        category: CleanCategory::Qq,
        risk_level: RiskLevel::Safe,
        description: "QQ NT 架构的 GPU 渲染缓存、代码编译缓存与崩溃日志",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.qq/Data/Library/Caches",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/Cache",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/Code Cache",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/GPUCache",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/Crashpad",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/blob_storage",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/Shared Dictionary",
        ],
    },
    RuleDefinition {
        id: "qq_emoji_stickers",
        name: "QQ 表情包与缩略图缓存",
        category: CleanCategory::Qq,
        risk_level: RiskLevel::Safe,
        description: "聊天表情包、头像与临时多媒体缩略图，清理后自动按需拉取",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/global/nt_data/Emoji",
        ],
    },
    RuleDefinition {
        id: "qq_temp_files",
        name: "QQ 临时运行文件与预览",
        category: CleanCategory::Qq,
        risk_level: RiskLevel::Recommended,
        description: "QQ 运行期间生成的临时下载交换文件与多媒体预览流",
        default_selected: true,
        sub_paths: &[
            "Library/Containers/com.tencent.qq/Data/tmp",
            "Library/Containers/com.tencent.qq/Data/Library/Application Support/QQ/global/nt_temp",
            "Library/Containers/com.tencent.qqexdoc/Data/Library/Caches",
        ],
    },
    // --- 浏览器缓存 ---
    RuleDefinition {
        id: "chrome_cache",
        name: "Google Chrome 浏览缓存",
        category: CleanCategory::Browser,
        risk_level: RiskLevel::Safe,
        description: "网页图片、脚本与静态资源缓存，清理不影响书签与登录密码",
        default_selected: true,
        sub_paths: &[
            "Library/Caches/Google/Chrome/Default/Cache",
            "Library/Caches/Google/Chrome/Default/Code Cache",
            "Library/Caches/Google/Chrome/Default/GPUCache",
        ],
    },
    RuleDefinition {
        id: "edge_cache",
        name: "Microsoft Edge 浏览缓存",
        category: CleanCategory::Browser,
        risk_level: RiskLevel::Safe,
        description: "Edge 浏览器网页静态缓存与 GPU 渲染缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Caches/Microsoft Edge/Default/Cache",
            "Library/Caches/Microsoft Edge/Default/Code Cache",
            "Library/Caches/Microsoft Edge/Default/GPUCache",
        ],
    },
    RuleDefinition {
        id: "safari_cache",
        name: "Safari 浏览缓存",
        category: CleanCategory::Browser,
        risk_level: RiskLevel::Safe,
        description: "苹果原生 Safari 浏览器的图片与网页资源临时缓存",
        default_selected: true,
        sub_paths: &[
            "Library/Caches/com.apple.Safari",
            "Library/Containers/com.apple.Safari/Data/Library/Caches",
        ],
    },
    // --- 开发者工具垃圾 ---
    RuleDefinition {
        id: "xcode_derived_data",
        name: "Xcode 编译衍生数据 (DerivedData)",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "工程编译索引、模块缓存与中间产物，可安全删除，每次编译重新生成",
        default_selected: true,
        sub_paths: &["Library/Developer/Xcode/DerivedData"],
    },
    RuleDefinition {
        id: "xcode_archives",
        name: "Xcode 历史打包归档 (Archives)",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Recommended,
        description: "历史发布打包保留的归档文件，占用巨大，清理前请确认无需保留",
        default_selected: false,
        sub_paths: &["Library/Developer/Xcode/Archives"],
    },
    RuleDefinition {
        id: "homebrew_cache",
        name: "Homebrew 安装包缓存",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "通过 brew install 下载的二进制安装包与源码镜像，安装后可删除",
        default_selected: true,
        sub_paths: &["Library/Caches/Homebrew"],
    },
    RuleDefinition {
        id: "node_pnpm_npm_cache",
        name: "Node.js 包管理工具缓存 (npm / pnpm / yarn)",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "npm、pnpm 与 yarn 下载的 tar 压缩包缓存，重新安装依赖时会自动拉取",
        default_selected: true,
        sub_paths: &[
            ".npm/_cacache",
            "Library/Caches/pnpm",
            "Library/Caches/Yarn",
        ],
    },
    RuleDefinition {
        id: "pip_python_cache",
        name: "Python pip 下载包缓存",
        category: CleanCategory::Developer,
        risk_level: RiskLevel::Safe,
        description: "pip install 下载的 wheel 包和安装归档缓存",
        default_selected: true,
        sub_paths: &["Library/Caches/pip"],
    },
    // --- 系统与应用日志 ---
    RuleDefinition {
        id: "system_user_logs",
        name: "用户级应用运行日志",
        category: CleanCategory::SystemLogs,
        risk_level: RiskLevel::Safe,
        description: "各类应用程序运行期间记录的调试日志与历史滚动日志",
        default_selected: true,
        sub_paths: &["Library/Logs"],
    },
    // --- 应用通用缓存 ---
    RuleDefinition {
        id: "general_app_caches",
        name: "常用应用通用临时缓存",
        category: CleanCategory::AppCache,
        risk_level: RiskLevel::Safe,
        description: "系统中各软件存放于 Caches 目录下的网络流、字体与临时索引",
        default_selected: true,
        sub_paths: &[
            ".cache",
            "Library/Caches/CloudKit",
            "Library/Caches/com.apple.helpd",
        ],
    },
    // --- 废纸篓与安装残留 ---
    RuleDefinition {
        id: "user_trash",
        name: "系统废纸篓 (Trash)",
        category: CleanCategory::Trash,
        risk_level: RiskLevel::Recommended,
        description: "已放入废纸篓但仍占用磁盘空间的文件，彻底清理后释放存储",
        default_selected: true,
        sub_paths: &[".Trash"],
    },
    RuleDefinition {
        id: "downloads_installers",
        name: "下载目录安装包 (DMG / PKG)",
        category: CleanCategory::Trash,
        risk_level: RiskLevel::Recommended,
        description: "Downloads 目录中残留的磁盘镜像与安装器文件",
        default_selected: false,
        sub_paths: &["Downloads"],
    },
];

// `*` matches one directory level, so per-account folders do not have to be hardcoded.
fn expand_sub_path(home: &Path, pattern: &str) -> (Vec<PathBuf>, bool) {
    let mut acc = vec![home.to_path_buf()];
    let mut denied = false;
    for part in pattern.split('/').filter(|part| !part.is_empty()) {
        let mut next = Vec::new();
        if part == "*" {
            for dir in acc {
                match fs::read_dir(&dir) {
                    Ok(entries) => {
                        for entry in entries.flatten() {
                            let name = entry.file_name();
                            let name = name.to_string_lossy();
                            if name.starts_with('.') {
                                continue;
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

// Never follow links, including links in an ancestor of a rule root.
fn checked_path(home: &Path, path: &Path) -> Result<(), String> {
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
        let p = entry.path();
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
                    modified_at: meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs()),
                });
            }
            Err(_) => failed = true,
        }
    }
    details.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    details.truncate(20);
    (bytes, files, details, failed)
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

        for sub_path in rule.sub_paths {
            let (candidates, list_denied) = expand_sub_path(&home_dir, sub_path);
            if list_denied {
                is_denied = true;
                has_permission_issues = true;
            }
            for full_path in candidates {
                if !full_path.try_exists().unwrap_or(true) {
                    continue;
                }
                let path_str = full_path.to_string_lossy().to_string();
                existing_paths.push(path_str);

                let (sz, cnt, sub_details, denied) = if checked_path(&home_dir, &full_path).is_ok()
                {
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
        }

        // Sort details by size
        rule_details.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
        if rule_details.len() > 20 {
            rule_details.truncate(20);
        }

        // Only include item if it exists on disk or was flagged with permission issues
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
        for relative in rule.sub_paths {
            let root = home.join(relative);
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
                                        || !fs::symlink_metadata(&p).is_ok_and(|m| m.is_file()))
                                {
                                    continue;
                                }
                                if processed.insert(p.clone()) {
                                    remove_checked(home, &p, &mut result);
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
    let allowed = CLEAN_RULES.iter().any(|rule| {
        rule.sub_paths.iter().any(|relative| {
            let root = home.join(relative);
            if rule.id == "downloads_installers" {
                target.parent() == Some(root.as_path())
                    && installer(target)
                    && fs::symlink_metadata(target).is_ok_and(|m| m.is_file())
            } else {
                target != root && target.starts_with(root)
            }
        })
    });
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
        Some(home) => single_at(&home, Path::new(target)),
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
            item_ids: vec!["general_app_caches".into()],
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
                item_ids: vec!["general_app_caches".into()],
                delete_permanently: false,
            },
        );
        assert!(!refused.success);
        assert!(p.exists());
        let result = execute_at(
            &f.0,
            CleanExecutionRequest {
                item_ids: vec!["general_app_caches".into()],
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
        let roots: Vec<_> = CLEAN_RULES
            .iter()
            .flat_map(|r| r.sub_paths.iter())
            .collect();
        for a in &roots {
            for b in &roots {
                if a != b {
                    assert!(!Path::new(a).starts_with(b), "overlapping rules: {a}, {b}");
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
                item_ids: vec!["general_app_caches".into()],
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
        let scan = scan_path_stats(&f.0.join(".cache"), false);
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
                item_ids: vec!["general_app_caches".into()],
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
                item_ids: vec!["general_app_caches".into()],
                delete_permanently: true,
            },
        );
        assert!(!result.success);
        assert!(p.exists());
    }
}
