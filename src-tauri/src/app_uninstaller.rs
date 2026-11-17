//! Scan installed macOS apps and uninstall selected ones with optional leftovers.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppResidualKind {
    Cache,
    Support,
    Logs,
    Preferences,
    Container,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppResidualItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub kind: AppResidualKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppOrigin {
    /// Bundled with macOS or Apple (e.g. `/System`, `com.apple.*`).
    System,
    /// Third-party / user-installed.
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledAppItem {
    pub id: String,
    pub name: String,
    pub bundle_id: String,
    pub version: String,
    pub category: String,
    pub app_path: String,
    pub app_size_bytes: u64,
    pub residual_size_bytes: u64,
    pub residuals: Vec<AppResidualItem>,
    pub last_used_at: Option<u64>,
    /// System / protected apps stay listed but cannot be uninstalled.
    pub removable: bool,
    pub origin: AppOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstallAppTarget {
    pub app_id: String,
    pub delete_residuals: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstallAppsRequest {
    pub targets: Vec<UninstallAppTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstalledAppOutcome {
    pub app_id: String,
    pub app_name: String,
    pub freed_app_bytes: u64,
    pub freed_residual_bytes: u64,
    pub retained_residual_bytes: u64,
    pub deleted_residuals: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstallAppsResult {
    pub success: bool,
    pub freed_bytes: u64,
    pub freed_app_bytes: u64,
    pub freed_residual_bytes: u64,
    pub retained_residual_bytes: u64,
    pub outcomes: Vec<UninstalledAppOutcome>,
    pub errors: Vec<String>,
}

struct AppMeta {
    name: String,
    bundle_id: String,
    version: String,
    category: String,
}

struct ScanRoot {
    path: PathBuf,
    removable: bool,
    category_fallback: &'static str,
}

const PROTECTED_BUNDLE_IDS: &[&str] = &[
    "com.apple.finder",
    "com.apple.Safari",
    "com.apple.systempreferences",
    "com.apple.Terminal",
];

fn empty_result() -> UninstallAppsResult {
    UninstallAppsResult {
        success: true,
        freed_bytes: 0,
        freed_app_bytes: 0,
        freed_residual_bytes: 0,
        retained_residual_bytes: 0,
        outcomes: Vec::new(),
        errors: Vec::new(),
    }
}

fn is_app_bundle(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()) == Some("app")
        && path.join("Contents/Info.plist").is_file()
}

fn discover_app_bundles(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let mut apps = Vec::new();
    if !root.is_dir() {
        return apps;
    }
    fn walk(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if is_app_bundle(&path) {
                out.push(path);
                continue;
            }
            if meta.is_dir() && depth < max_depth {
                walk(&path, depth + 1, max_depth, out);
            }
        }
    }
    walk(root, 0, max_depth, &mut apps);
    apps
}

fn contains_cjk(text: &str) -> bool {
    text.chars().any(|c| {
        matches!(
            c,
            '\u{4E00}'..='\u{9FFF}'
                | '\u{3400}'..='\u{4DBF}'
                | '\u{F900}'..='\u{FAFF}'
                | '\u{3000}'..='\u{303F}'
        )
    })
}

fn plist_json(path: &Path) -> Option<serde_json::Value> {
    let output = Command::new("plutil")
        .args(["-convert", "json", "-o", "-", "--"])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

fn json_str_field(value: &serde_json::Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(s) = value.get(*key).and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return s.to_string();
            }
        }
    }
    String::new()
}

/// Prefer Simplified/Traditional Chinese display names from `*.lproj/InfoPlist.strings`.
fn localized_zh_name(app_path: &Path) -> Option<String> {
    const LOCALES: &[&str] = &[
        "zh-Hans.lproj",
        "zh_CN.lproj",
        "zh-Hant.lproj",
        "zh_TW.lproj",
        "zh_HK.lproj",
    ];
    let resources = app_path.join("Contents/Resources");
    for locale in LOCALES {
        let strings = resources.join(locale).join("InfoPlist.strings");
        if !strings.is_file() {
            continue;
        }
        let Some(value) = plist_json(&strings) else {
            continue;
        };
        let name = json_str_field(&value, &["CFBundleDisplayName", "CFBundleName"]);
        if contains_cjk(&name) {
            return Some(name);
        }
    }
    None
}

fn read_info_plist(app_path: &Path) -> Option<AppMeta> {
    let plist = app_path.join("Contents/Info.plist");
    if !plist.is_file() {
        return None;
    }
    let value = plist_json(&plist)?;
    let bundle_id = json_str_field(&value, &["CFBundleIdentifier"]);
    let fallback_name = {
        let display = json_str_field(&value, &["CFBundleDisplayName", "CFBundleName"]);
        if display.is_empty() {
            app_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("未知应用")
                .to_string()
        } else {
            display
        }
    };
    // Chinese localized name wins when present; otherwise keep plist / file name.
    let name = localized_zh_name(app_path)
        .or_else(|| {
            if contains_cjk(&fallback_name) {
                Some(fallback_name.clone())
            } else {
                None
            }
        })
        .unwrap_or(fallback_name);
    let version = {
        let v = json_str_field(&value, &["CFBundleShortVersionString", "CFBundleVersion"]);
        if v.is_empty() {
            "—".into()
        } else {
            v
        }
    };
    let category = category_label(&json_str_field(&value, &["LSApplicationCategoryType"]));
    Some(AppMeta {
        name,
        bundle_id,
        version,
        category,
    })
}

fn app_origin(app_path: &Path, bundle_id: &str) -> AppOrigin {
    if app_path.starts_with("/System") {
        return AppOrigin::System;
    }
    // Apple-bundled apps often live under /Applications (Keynote, Safari, …).
    if bundle_id == "com.apple"
        || bundle_id.starts_with("com.apple.")
        || bundle_id.starts_with("com.apple:")
    {
        return AppOrigin::System;
    }
    AppOrigin::User
}

fn category_label(raw: &str) -> String {
    let mapped = match raw {
        "public.app-category.business" => "商务",
        "public.app-category.developer-tools" => "开发工具",
        "public.app-category.education" => "教育",
        "public.app-category.entertainment" => "娱乐",
        "public.app-category.finance" => "财务",
        "public.app-category.games" => "游戏",
        "public.app-category.graphics-design" => "设计创意",
        "public.app-category.healthcare-fitness" => "健康",
        "public.app-category.lifestyle" => "生活",
        "public.app-category.medical" => "医疗",
        "public.app-category.music" => "音乐",
        "public.app-category.news" => "新闻",
        "public.app-category.photography" => "摄影",
        "public.app-category.productivity" => "效率",
        "public.app-category.reference" => "参考",
        "public.app-category.social-networking" => "社交",
        "public.app-category.sports" => "体育",
        "public.app-category.travel" => "旅行",
        "public.app-category.utilities" => "工具",
        "public.app-category.video" => "视频",
        "public.app-category.weather" => "天气",
        "" => "",
        other => other,
    };
    if mapped.is_empty() {
        "应用".into()
    } else {
        mapped.into()
    }
}

fn du_bytes(path: &Path) -> Option<u64> {
    let output = Command::new("du").args(["-sk"]).arg(path).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let kb = text.split_whitespace().next()?.parse::<u64>().ok()?;
    Some(kb.saturating_mul(1024))
}

fn path_size(path: &Path) -> (u64, u64) {
    if !path.exists() {
        return (0, 0);
    }
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return (0, 0),
    };
    if meta.file_type().is_symlink() {
        return (0, 0);
    }
    if meta.is_file() {
        return (meta.len(), 1);
    }
    let mut bytes = 0u64;
    let mut files = 0u64;
    for entry in WalkDir::new(path).follow_links(false).into_iter().flatten() {
        if let Ok(m) = fs::symlink_metadata(entry.path()) {
            if m.is_file() {
                bytes += m.len();
                files += 1;
            }
        }
    }
    (bytes, files)
}

fn app_bundle_bytes(path: &Path) -> u64 {
    du_bytes(path).unwrap_or_else(|| path_size(path).0)
}

/// Prefer `du` for leftover folders (Containers can be huge); avoid full walks on scan.
fn residual_path_size(path: &Path) -> (u64, u64) {
    if !path.exists() {
        return (0, 0);
    }
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return (0, 0),
    };
    if meta.file_type().is_symlink() {
        return (0, 0);
    }
    if meta.is_file() {
        return (meta.len(), 1);
    }
    if let Some(bytes) = du_bytes(path) {
        return (bytes, if bytes > 0 { 1 } else { 0 });
    }
    path_size(path)
}

fn last_used_at(app_path: &Path) -> Option<u64> {
    let output = Command::new("mdls")
        .args(["-name", "kMDItemLastUsedDate", "-raw"])
        .arg(app_path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() || text == "(null)" {
        return None;
    }
    // mdls raw date looks like: 2026-11-10 08:15:22 +0000
    let parsed = Command::new("date")
        .args(["-j", "-f", "%Y-%m-%d %H:%M:%S %z", &text, "+%s"])
        .output()
        .ok()?;
    if !parsed.status.success() {
        return None;
    }
    String::from_utf8_lossy(&parsed.stdout)
        .trim()
        .parse::<u64>()
        .ok()
}

fn app_id_for(path: &Path, bundle_id: &str) -> String {
    if !bundle_id.is_empty() {
        format!("app:{}", bundle_id)
    } else {
        format!("path:{}", path.to_string_lossy())
    }
}

fn is_protected(bundle_id: &str, app_path: &Path, self_path: Option<&Path>) -> bool {
    if PROTECTED_BUNDLE_IDS.contains(&bundle_id) {
        return true;
    }
    if let Some(self_path) = self_path {
        if let (Ok(a), Ok(b)) = (app_path.canonicalize(), self_path.canonicalize()) {
            if a == b {
                return true;
            }
        }
    }
    false
}

fn under_home(home: &Path, path: &Path) -> bool {
    path.starts_with(home)
}

fn checked_home_path(home: &Path, path: &Path) -> Result<(), String> {
    let relative = path
        .strip_prefix(home)
        .map_err(|_| "路径超出用户目录".to_string())?;
    let mut current = home.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err("路径包含非法分量".into());
        }
        current.push(component);
        let metadata =
            fs::symlink_metadata(&current).map_err(|e| format!("{}: {}", current.display(), e))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("不处理符号链接: {}", current.display()));
        }
    }
    let canonical_home = home.canonicalize().map_err(|e| e.to_string())?;
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(&canonical_home) || canonical == canonical_home {
        return Err("路径超出用户目录".into());
    }
    Ok(())
}

fn removable_app_path(path: &Path, home: &Path) -> bool {
    if path.starts_with("/System") {
        return false;
    }
    if path.starts_with("/Applications") {
        return true;
    }
    let user_apps = home.join("Applications");
    path.starts_with(&user_apps)
}

fn collect_residuals(home: &Path, bundle_id: &str, app_name: &str) -> Vec<AppResidualItem> {
    if bundle_id.is_empty() {
        return Vec::new();
    }
    let mut items = Vec::new();
    let mut seen = HashSet::new();

    let candidates: Vec<(PathBuf, AppResidualKind, String)> = vec![
        (
            home.join("Library/Caches").join(bundle_id),
            AppResidualKind::Cache,
            format!("{app_name} 缓存"),
        ),
        (
            home.join("Library/Application Support").join(bundle_id),
            AppResidualKind::Support,
            format!("{app_name} 支持文件"),
        ),
        (
            home.join("Library/Logs").join(bundle_id),
            AppResidualKind::Logs,
            format!("{app_name} 日志"),
        ),
        (
            home.join("Library/Preferences")
                .join(format!("{bundle_id}.plist")),
            AppResidualKind::Preferences,
            format!("{app_name} 偏好设置"),
        ),
        (
            home.join("Library/Containers").join(bundle_id),
            AppResidualKind::Container,
            format!("{app_name} 容器数据"),
        ),
        (
            home.join("Library/Group Containers").join(bundle_id),
            AppResidualKind::Container,
            format!("{app_name} 群组容器"),
        ),
        (
            home.join("Library/Saved Application State")
                .join(format!("{bundle_id}.savedState")),
            AppResidualKind::Support,
            format!("{app_name} 保存状态"),
        ),
        (
            home.join("Library/HTTPStorages").join(bundle_id),
            AppResidualKind::Cache,
            format!("{app_name} 网络存储"),
        ),
        (
            home.join("Library/WebKit").join(bundle_id),
            AppResidualKind::Cache,
            format!("{app_name} WebKit 数据"),
        ),
    ];

    for (path, kind, name) in candidates {
        if !path.exists() || !under_home(home, &path) {
            continue;
        }
        let key = path.to_string_lossy().into_owned();
        if !seen.insert(key.clone()) {
            continue;
        }
        let (size, files) = residual_path_size(&path);
        if size == 0 && files == 0 {
            continue;
        }
        items.push(AppResidualItem {
            id: format!("{bundle_id}:{}", path.file_name().and_then(|s| s.to_str()).unwrap_or("item")),
            name,
            path: key,
            size_bytes: size,
            file_count: files,
            kind,
        });
    }

    // Exact-name matches under Caches / Application Support / Logs (non-bundle-id folders).
    for (dir, kind, label) in [
        ("Library/Caches", AppResidualKind::Cache, "缓存"),
        (
            "Library/Application Support",
            AppResidualKind::Support,
            "支持文件",
        ),
        ("Library/Logs", AppResidualKind::Logs, "日志"),
    ] {
        let root = home.join(dir);
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.eq_ignore_ascii_case(app_name)
                || name.eq_ignore_ascii_case(bundle_id)
                || (bundle_id.contains('.') && name == bundle_id)
            {
                let path = entry.path();
                if path.join("Contents/Info.plist").exists() {
                    continue;
                }
                let key = path.to_string_lossy().into_owned();
                if !seen.insert(key.clone()) {
                    continue;
                }
                let (size, files) = residual_path_size(&path);
                if size == 0 && files == 0 {
                    continue;
                }
                items.push(AppResidualItem {
                    id: format!("{bundle_id}:name:{name}"),
                    name: format!("{app_name} {label}"),
                    path: key,
                    size_bytes: size,
                    file_count: files,
                    kind,
                });
            }
        }
    }

    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    items
}

fn current_app_path() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|exe| {
        // …/Foo.app/Contents/MacOS/foo → Foo.app
        exe.ancestors().find(|p| is_app_bundle(p)).map(|p| p.to_path_buf())
    })
}

fn scan_roots(home: &Path) -> Vec<ScanRoot> {
    let mut roots = vec![
        ScanRoot {
            path: PathBuf::from("/Applications"),
            removable: true,
            category_fallback: "应用",
        },
        ScanRoot {
            path: home.join("Applications"),
            removable: true,
            category_fallback: "应用",
        },
        ScanRoot {
            path: PathBuf::from("/System/Applications"),
            removable: false,
            category_fallback: "系统",
        },
        ScanRoot {
            path: PathBuf::from("/System/Applications/Utilities"),
            removable: false,
            category_fallback: "系统工具",
        },
    ];
    // /Applications/Utilities is common for some installs
    roots.push(ScanRoot {
        path: PathBuf::from("/Applications/Utilities"),
        removable: true,
        category_fallback: "工具",
    });
    roots
}

/// List every discovered `.app` under standard install locations.
pub fn scan_installed_apps() -> Vec<InstalledAppItem> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };
    let self_path = current_app_path();
    let mut by_path: HashMap<String, InstalledAppItem> = HashMap::new();

    for root in scan_roots(&home) {
        // Utilities nested under Applications is depth 0 from that root;
        // top-level Applications needs depth 1 for Adobe-style folders.
        let depth = if root.path.ends_with("Utilities") {
            0
        } else {
            1
        };
        for app_path in discover_app_bundles(&root.path, depth) {
            let key = app_path.to_string_lossy().into_owned();
            if by_path.contains_key(&key) {
                continue;
            }
            let meta = read_info_plist(&app_path).unwrap_or_else(|| AppMeta {
                name: app_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("未知应用")
                    .to_string(),
                bundle_id: String::new(),
                version: "—".into(),
                category: root.category_fallback.to_string(),
            });
            let category = if meta.category == "应用" && root.category_fallback != "应用" {
                root.category_fallback.to_string()
            } else {
                meta.category.clone()
            };
            let protected = is_protected(&meta.bundle_id, &app_path, self_path.as_deref());
            let origin = app_origin(&app_path, &meta.bundle_id);
            let removable =
                root.removable && removable_app_path(&app_path, &home) && !protected;
            let app_size = app_bundle_bytes(&app_path);
            let residuals = if meta.bundle_id.is_empty() {
                Vec::new()
            } else {
                collect_residuals(&home, &meta.bundle_id, &meta.name)
            };
            let residual_size_bytes = residuals.iter().map(|r| r.size_bytes).sum();
            by_path.insert(
                key.clone(),
                InstalledAppItem {
                    id: app_id_for(&app_path, &meta.bundle_id),
                    name: meta.name,
                    bundle_id: if meta.bundle_id.is_empty() {
                        key.clone()
                    } else {
                        meta.bundle_id
                    },
                    version: meta.version,
                    category,
                    app_path: key,
                    app_size_bytes: app_size,
                    residual_size_bytes,
                    residuals,
                    last_used_at: last_used_at(&app_path),
                    removable,
                    origin,
                },
            );
        }
    }

    let mut apps: Vec<_> = by_path.into_values().collect();
    apps.sort_by(|a, b| {
        b.app_size_bytes
            .cmp(&a.app_size_bytes)
            .then_with(|| a.name.cmp(&b.name))
    });
    apps
}

fn remove_path(path: &Path) -> Result<u64, String> {
    let bytes = if path.is_file() {
        fs::symlink_metadata(path).map(|m| m.len()).unwrap_or(0)
    } else {
        app_bundle_bytes(path)
    };
    let meta = fs::symlink_metadata(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    if meta.file_type().is_symlink() {
        return Err(format!("不删除符号链接: {}", path.display()));
    }
    if meta.is_file() {
        fs::remove_file(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    } else {
        fs::remove_dir_all(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    }
    Ok(bytes)
}

fn validate_app_uninstall_path(path: &Path, home: &Path) -> Result<(), String> {
    if !is_app_bundle(path) {
        return Err(format!("不是有效的应用包: {}", path.display()));
    }
    if !removable_app_path(path, home) {
        return Err(format!("不允许卸载该位置的应用: {}", path.display()));
    }
    // Refuse symlink escapes in the app path chain under /Applications or ~/Applications.
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        if current == Path::new("/") {
            continue;
        }
        if let Ok(meta) = fs::symlink_metadata(&current) {
            if meta.file_type().is_symlink() {
                return Err(format!("不卸载符号链接路径: {}", current.display()));
            }
        }
    }
    Ok(())
}

pub fn uninstall_apps(request: UninstallAppsRequest) -> UninstallAppsResult {
    if !cfg!(target_os = "macos") {
        return UninstallAppsResult {
            success: false,
            errors: vec!["软件卸载暂仅支持 macOS".into()],
            ..empty_result()
        };
    }
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => {
            return UninstallAppsResult {
                success: false,
                errors: vec!["无法获取用户目录".into()],
                ..empty_result()
            };
        }
    };

    let apps = scan_installed_apps();
    let by_id: HashMap<_, _> = apps.into_iter().map(|a| (a.id.clone(), a)).collect();
    let mut result = empty_result();

    for target in request.targets {
        let Some(app) = by_id.get(&target.app_id) else {
            result.errors.push(format!("未找到软件: {}", target.app_id));
            continue;
        };
        if !app.removable {
            result
                .errors
                .push(format!("系统或受保护应用不可卸载: {}", app.name));
            continue;
        }
        let app_path = PathBuf::from(&app.app_path);
        if let Err(e) = validate_app_uninstall_path(&app_path, &home) {
            result.errors.push(e);
            continue;
        }

        let mut freed_residual = 0u64;
        let residual_total: u64 = app.residuals.iter().map(|r| r.size_bytes).sum();

        let freed_app = match remove_path(&app_path) {
            Ok(bytes) => bytes,
            Err(e) => {
                result.errors.push(e);
                continue;
            }
        };

        if target.delete_residuals {
            for residual in &app.residuals {
                let residual_path = PathBuf::from(&residual.path);
                if !under_home(&home, &residual_path) {
                    result
                        .errors
                        .push(format!("跳过非用户目录残余: {}", residual.path));
                    continue;
                }
                if let Err(e) = checked_home_path(&home, &residual_path) {
                    result.errors.push(e);
                    continue;
                }
                match remove_path(&residual_path) {
                    Ok(bytes) => freed_residual += bytes,
                    Err(e) => result.errors.push(e),
                }
            }
        }

        let retained = if target.delete_residuals {
            residual_total.saturating_sub(freed_residual)
        } else {
            residual_total
        };

        result.freed_app_bytes += freed_app;
        result.freed_residual_bytes += freed_residual;
        result.retained_residual_bytes += retained;
        result.outcomes.push(UninstalledAppOutcome {
            app_id: app.id.clone(),
            app_name: app.name.clone(),
            freed_app_bytes: freed_app,
            freed_residual_bytes: freed_residual,
            retained_residual_bytes: retained,
            deleted_residuals: target.delete_residuals,
        });
    }

    result.freed_bytes = result.freed_app_bytes + result.freed_residual_bytes;
    result.success = result.errors.is_empty() && !result.outcomes.is_empty();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            loop {
                let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let p = std::env::temp_dir().join(format!(
                    "app-uninstaller-{}-{}",
                    std::process::id(),
                    n
                ));
                match fs::create_dir(&p) {
                    Ok(()) => return Self(p),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(e) => panic!("{}", e),
                }
            }
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn discover_nested_and_skips_non_apps() {
        let f = Fixture::new();
        let nested = f
            .path()
            .join("Adobe Photoshop 2025/Adobe Photoshop 2025.app/Contents");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("Info.plist"), b"test").unwrap();
        fs::create_dir_all(f.path().join("Notes")).unwrap();
        fs::write(f.path().join("readme.txt"), b"x").unwrap();

        let apps = discover_app_bundles(f.path(), 1);
        assert_eq!(apps.len(), 1);
        assert!(apps[0].ends_with("Adobe Photoshop 2025.app"));
    }

    #[test]
    fn category_label_maps_known_types() {
        assert_eq!(
            category_label("public.app-category.developer-tools"),
            "开发工具"
        );
        assert_eq!(category_label(""), "应用");
    }

    #[test]
    fn detects_cjk_and_app_origin() {
        assert!(contains_cjk("微信"));
        assert!(contains_cjk("Keynote讲演"));
        assert!(!contains_cjk("WeChat"));
        assert_eq!(
            app_origin(Path::new("/System/Applications/Calculator.app"), "com.apple.calculator"),
            AppOrigin::System
        );
        assert_eq!(
            app_origin(Path::new("/Applications/Keynote.app"), "com.apple.iWork.Keynote"),
            AppOrigin::System
        );
        assert_eq!(
            app_origin(Path::new("/Applications/WeChat.app"), "com.tencent.xinWeChat"),
            AppOrigin::User
        );
    }

    #[test]
    fn prefers_chinese_localized_display_name() {
        let f = Fixture::new();
        let app = f.path().join("Demo.app");
        let contents = app.join("Contents");
        let resources = contents.join("Resources/zh-Hans.lproj");
        fs::create_dir_all(&resources).unwrap();
        fs::write(
            contents.join("Info.plist"),
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.example.demo</string>
<key>CFBundleName</key><string>Demo</string>
<key>CFBundleDisplayName</key><string>Demo</string>
</dict></plist>"#,
        )
        .unwrap();
        // Use plutil to create a real binary InfoPlist.strings with Chinese display name.
        let strings_src = f.path().join("strings.plist");
        fs::write(
            &strings_src,
            format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>{}</string>
</dict></plist>"#,
                "示例应用"
            ),
        )
        .unwrap();
        let strings = resources.join("InfoPlist.strings");
        let status = Command::new("plutil")
            .args(["-convert", "binary1", "-o"])
            .arg(&strings)
            .arg(&strings_src)
            .status()
            .expect("plutil");
        assert!(status.success());
        let meta = read_info_plist(&app).expect("meta");
        assert_eq!(meta.name, "示例应用");
    }

    #[test]
    fn collect_residuals_matches_bundle_paths() {
        let f = Fixture::new();
        let bundle = "com.example.demo";
        let cache = f.path().join("Library/Caches").join(bundle);
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("a.bin"), vec![0u8; 100]).unwrap();
        let prefs = f
            .path()
            .join("Library/Preferences")
            .join(format!("{bundle}.plist"));
        fs::create_dir_all(prefs.parent().unwrap()).unwrap();
        fs::write(&prefs, b"plist").unwrap();

        let items = collect_residuals(f.path(), bundle, "Demo");
        assert!(items.iter().any(|i| i.kind == AppResidualKind::Cache));
        assert!(items.iter().any(|i| i.kind == AppResidualKind::Preferences));
        assert!(items.iter().all(|i| i.path.contains(bundle) || i.path.ends_with(".plist")));
    }

    #[test]
    fn removable_paths_reject_system() {
        let home = PathBuf::from("/Users/demo");
        assert!(!removable_app_path(Path::new("/System/Applications/Calculator.app"), &home));
        assert!(removable_app_path(Path::new("/Applications/Demo.app"), &home));
        assert!(removable_app_path(
            &home.join("Applications/Demo.app"),
            &home
        ));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn scan_lists_applications_folder_apps() {
        let apps = scan_installed_apps();
        // Machines without GUI apps still return a Vec; typically /Applications has entries.
        assert!(
            apps.iter().any(|a| a.app_path.starts_with("/Applications"))
                || apps
                    .iter()
                    .any(|a| a.app_path.starts_with("/System/Applications"))
                || Path::new("/Applications").read_dir().map(|mut d| d.next().is_none()).unwrap_or(true),
            "expected installed apps or empty Applications"
        );
        for app in &apps {
            if app.app_path.starts_with("/System/") {
                assert!(!app.removable, "{}", app.app_path);
            }
        }
        // Deduped by path
        let mut paths = HashSet::new();
        for app in &apps {
            assert!(paths.insert(app.app_path.clone()), "duplicate {}", app.app_path);
        }
    }
}
