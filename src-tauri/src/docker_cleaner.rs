//! Safe, selective Docker disk cleanup (scan → confirm → prune).
//! Defaults match Mole-style reclaim: builder prune + dangling images,
//! never `docker system prune -a --volumes` as a silent default.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DockerRiskLevel {
    Safe,
    Recommended,
    Caution,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerDfType {
    pub type_name: String,
    pub total_count: u64,
    pub active_count: u64,
    pub size_bytes: u64,
    pub reclaimable_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerCleanAction {
    pub id: String,
    pub name: String,
    pub risk_level: DockerRiskLevel,
    pub description: String,
    pub reclaimable_bytes: u64,
    pub item_count: u64,
    pub default_selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerScanResult {
    pub cli_available: bool,
    pub daemon_running: bool,
    pub docker_path: Option<String>,
    pub version: Option<String>,
    pub types: Vec<DockerDfType>,
    pub actions: Vec<DockerCleanAction>,
    pub total_size_bytes: u64,
    pub total_reclaimable_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerCleanupRequest {
    pub action_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerCleanupResult {
    pub freed_bytes: u64,
    pub actions_run: Vec<String>,
    pub errors: Vec<String>,
    pub success: bool,
}

const ACTION_STOPPED_CONTAINERS: &str = "stopped_containers";
const ACTION_DANGLING_IMAGES: &str = "dangling_images";
const ACTION_UNUSED_IMAGES: &str = "unused_images";
const ACTION_UNUSED_NETWORKS: &str = "unused_networks";
const ACTION_BUILD_CACHE: &str = "build_cache";
const ACTION_UNUSED_VOLUMES: &str = "unused_volumes";

const DOCKER_CANDIDATES: &[&str] = &[
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
];

/// Parse Docker human sizes: `4.113GB`, `1.29GB (100%)`, `63.17MB`, `0B`.
pub fn parse_docker_size(raw: &str) -> u64 {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let without_pct = trimmed
        .split('(')
        .next()
        .unwrap_or(trimmed)
        .trim();
    let bytes_idx = without_pct
        .find(|c: char| c.is_ascii_alphabetic())
        .unwrap_or(without_pct.len());
    let (num_part, unit_part) = without_pct.split_at(bytes_idx);
    let value: f64 = num_part.trim().parse().unwrap_or(0.0);
    if value <= 0.0 {
        return 0;
    }
    let unit = unit_part.trim().to_ascii_uppercase();
    let multiplier: f64 = match unit.as_str() {
        "" | "B" => 1.0,
        "KB" | "KIB" | "K" => 1_000.0,
        "MB" | "MIB" | "M" => 1_000_000.0,
        "GB" | "GIB" | "G" => 1_000_000_000.0,
        "TB" | "TIB" | "T" => 1_000_000_000_000.0,
        _ => 1.0,
    };
    (value * multiplier).round() as u64
}

/// Extract `Total reclaimed space: 1.23GB` from prune stdout/stderr.
pub fn parse_reclaimed_space(output: &str) -> u64 {
    for line in output.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(idx) = lower.find("reclaimed space:") {
            let rest = line[idx + "reclaimed space:".len()..].trim();
            return parse_docker_size(rest);
        }
        if let Some(idx) = lower.find("total reclaimed space:") {
            let rest = line[idx + "total reclaimed space:".len()..].trim();
            return parse_docker_size(rest);
        }
    }
    0
}

fn resolve_docker_bin() -> Option<PathBuf> {
    if let Ok(output) = Command::new("which").arg("docker").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && Path::new(&path).is_file() {
                return Some(PathBuf::from(path));
            }
        }
    }
    for candidate in DOCKER_CANDIDATES {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn run_docker(bin: &Path, args: &[&str]) -> Result<(String, String, bool), String> {
    let output = Command::new(bin)
        .args(args)
        .output()
        .map_err(|e| format!("无法执行 docker: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((stdout, stderr, output.status.success()))
}

fn docker_version(bin: &Path) -> Option<String> {
    let (stdout, _, ok) = run_docker(bin, &["version", "--format", "{{.Client.Version}}"]).ok()?;
    if !ok {
        return None;
    }
    let v = stdout.trim();
    if v.is_empty() {
        None
    } else {
        Some(v.to_string())
    }
}

fn daemon_is_up(bin: &Path) -> bool {
    matches!(run_docker(bin, &["info", "--format", "{{.ServerVersion}}"]), Ok((stdout, _, true)) if !stdout.trim().is_empty())
}

#[derive(Debug, Deserialize)]
struct DfJsonRow {
    #[serde(rename = "Type", default)]
    type_name: String,
    #[serde(rename = "TotalCount", default)]
    total_count: serde_json::Value,
    #[serde(rename = "Active", default)]
    active: serde_json::Value,
    #[serde(rename = "Size", default)]
    size: String,
    #[serde(rename = "Reclaimable", default)]
    reclaimable: String,
}

fn json_u64(v: &serde_json::Value) -> u64 {
    match v {
        serde_json::Value::Number(n) => n.as_u64().unwrap_or(0),
        serde_json::Value::String(s) => s.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

fn parse_df_json_lines(raw: &str) -> Vec<DockerDfType> {
    let mut rows = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(row) = serde_json::from_str::<DfJsonRow>(line) else {
            continue;
        };
        if row.type_name.is_empty() {
            continue;
        }
        rows.push(DockerDfType {
            type_name: row.type_name,
            total_count: json_u64(&row.total_count),
            active_count: json_u64(&row.active),
            size_bytes: parse_docker_size(&row.size),
            reclaimable_bytes: parse_docker_size(&row.reclaimable),
        });
    }
    rows
}

fn df_type<'a>(types: &'a [DockerDfType], name: &str) -> Option<&'a DockerDfType> {
    types.iter().find(|t| t.type_name.eq_ignore_ascii_case(name))
}

fn count_lines(stdout: &str) -> u64 {
    stdout.lines().filter(|l| !l.trim().is_empty()).count() as u64
}

fn dangling_image_stats(bin: &Path) -> (u64, u64) {
    let Ok((stdout, _, ok)) = run_docker(
        bin,
        &[
            "images",
            "-f",
            "dangling=true",
            "--format",
            "{{.ID}}\t{{.Size}}",
        ],
    ) else {
        return (0, 0);
    };
    if !ok {
        return (0, 0);
    }
    let mut count = 0u64;
    let mut bytes = 0u64;
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        count += 1;
        if let Some((_, size)) = line.split_once('\t') {
            bytes = bytes.saturating_add(parse_docker_size(size));
        }
    }
    (count, bytes)
}

fn stopped_container_count(bin: &Path) -> u64 {
    let Ok((stdout, _, ok)) = run_docker(bin, &["ps", "-aq", "-f", "status=exited"]) else {
        return 0;
    };
    if !ok {
        return 0;
    }
    count_lines(&stdout)
}

fn unused_network_count(bin: &Path) -> u64 {
    // Only networks not referenced by any container (`dangling=true`).
    let Ok((stdout, _, ok)) = run_docker(
        bin,
        &["network", "ls", "-q", "--filter", "dangling=true"],
    ) else {
        return 0;
    };
    if !ok {
        return 0;
    }
    count_lines(&stdout)
}

fn build_actions(bin: &Path, types: &[DockerDfType]) -> Vec<DockerCleanAction> {
    let containers = df_type(types, "Containers");
    let images = df_type(types, "Images");
    let volumes = df_type(types, "Local Volumes");
    let build_cache = df_type(types, "Build Cache");

    let stopped = stopped_container_count(bin);
    let (dangling_count, dangling_bytes) = dangling_image_stats(bin);
    // `docker image prune -a` reclaimable matches Images.Reclaimable from system df.
    let unused_images_bytes = images.map(|t| t.reclaimable_bytes).unwrap_or(0);
    let unused_image_count = images
        .map(|t| t.total_count.saturating_sub(t.active_count))
        .unwrap_or(0);

    let network_count = unused_network_count(bin);
    let volume_reclaim = volumes.map(|t| t.reclaimable_bytes).unwrap_or(0);
    let volume_unused = volumes
        .map(|t| t.total_count.saturating_sub(t.active_count))
        .unwrap_or(0);
    let cache_reclaim = build_cache.map(|t| t.reclaimable_bytes).unwrap_or(0);
    let cache_count = build_cache.map(|t| t.total_count).unwrap_or(0);

    let container_reclaim = containers.map(|t| t.reclaimable_bytes).unwrap_or(0);

    vec![
        DockerCleanAction {
            id: ACTION_STOPPED_CONTAINERS.to_string(),
            name: "已停止的容器".to_string(),
            risk_level: DockerRiskLevel::Safe,
            description: "删除 exited 容器".to_string(),
            reclaimable_bytes: container_reclaim,
            item_count: stopped,
            default_selected: stopped > 0 || container_reclaim > 0,
        },
        DockerCleanAction {
            id: ACTION_DANGLING_IMAGES.to_string(),
            name: "悬空镜像".to_string(),
            risk_level: DockerRiskLevel::Safe,
            description: "无标签中间层镜像".to_string(),
            reclaimable_bytes: dangling_bytes,
            item_count: dangling_count,
            default_selected: dangling_count > 0 || dangling_bytes > 0,
        },
        DockerCleanAction {
            id: ACTION_UNUSED_IMAGES.to_string(),
            name: "未使用镜像".to_string(),
            risk_level: DockerRiskLevel::Recommended,
            description: "未被容器引用的镜像".to_string(),
            reclaimable_bytes: unused_images_bytes,
            item_count: unused_image_count,
            default_selected: false,
        },
        DockerCleanAction {
            id: ACTION_UNUSED_NETWORKS.to_string(),
            name: "未使用网络".to_string(),
            risk_level: DockerRiskLevel::Safe,
            description: "无容器引用的网络".to_string(),
            reclaimable_bytes: 0,
            item_count: network_count,
            default_selected: network_count > 0,
        },
        DockerCleanAction {
            id: ACTION_BUILD_CACHE.to_string(),
            name: "构建缓存".to_string(),
            risk_level: DockerRiskLevel::Safe,
            description: "BuildKit / builder 缓存".to_string(),
            reclaimable_bytes: cache_reclaim,
            item_count: cache_count,
            default_selected: cache_reclaim > 0,
        },
        DockerCleanAction {
            id: ACTION_UNUSED_VOLUMES.to_string(),
            name: "未使用数据卷".to_string(),
            risk_level: DockerRiskLevel::Caution,
            description: "可能含数据库数据".to_string(),
            reclaimable_bytes: volume_reclaim,
            item_count: volume_unused,
            default_selected: false,
        },
    ]
}

pub fn scan_docker_reclaim() -> DockerScanResult {
    let Some(bin) = resolve_docker_bin() else {
        return DockerScanResult {
            cli_available: false,
            daemon_running: false,
            docker_path: None,
            version: None,
            types: vec![],
            actions: vec![],
            total_size_bytes: 0,
            total_reclaimable_bytes: 0,
        };
    };

    let version = docker_version(&bin);
    if !daemon_is_up(&bin) {
        return DockerScanResult {
            cli_available: true,
            daemon_running: false,
            docker_path: Some(bin.to_string_lossy().to_string()),
            version,
            types: vec![],
            actions: vec![],
            total_size_bytes: 0,
            total_reclaimable_bytes: 0,
        };
    }

    let (df_out, _df_err, df_ok) =
        match run_docker(&bin, &["system", "df", "--format", "{{json .}}"]) {
            Ok(v) => v,
            Err(_) => {
                return DockerScanResult {
                    cli_available: true,
                    daemon_running: true,
                    docker_path: Some(bin.to_string_lossy().to_string()),
                    version,
                    types: vec![],
                    actions: vec![],
                    total_size_bytes: 0,
                    total_reclaimable_bytes: 0,
                };
            }
        };

    // Older docker without json format leaves types empty; actions still use counts.
    let types = if df_ok {
        parse_df_json_lines(&df_out)
    } else {
        Vec::new()
    };

    let actions = build_actions(&bin, &types);
    let total_size_bytes = types.iter().map(|t| t.size_bytes).sum();
    let total_reclaimable_bytes = types.iter().map(|t| t.reclaimable_bytes).sum();

    DockerScanResult {
        cli_available: true,
        daemon_running: true,
        docker_path: Some(bin.to_string_lossy().to_string()),
        version,
        types,
        actions,
        total_size_bytes,
        total_reclaimable_bytes,
    }
}

fn prune_args_for(action_id: &str) -> Option<&'static [&'static str]> {
    match action_id {
        ACTION_STOPPED_CONTAINERS => Some(&["container", "prune", "-f"]),
        ACTION_DANGLING_IMAGES => Some(&["image", "prune", "-f"]),
        ACTION_UNUSED_IMAGES => Some(&["image", "prune", "-a", "-f"]),
        ACTION_UNUSED_NETWORKS => Some(&["network", "prune", "-f"]),
        ACTION_BUILD_CACHE => Some(&["builder", "prune", "-af"]),
        ACTION_UNUSED_VOLUMES => Some(&["volume", "prune", "-f"]),
        _ => None,
    }
}

/// Normalize selected actions: unused images supersedes dangling.
pub fn normalize_action_ids(ids: &[String]) -> Vec<String> {
    let set: std::collections::HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();
    let order = [
        ACTION_STOPPED_CONTAINERS,
        ACTION_UNUSED_IMAGES,
        ACTION_DANGLING_IMAGES,
        ACTION_UNUSED_NETWORKS,
        ACTION_BUILD_CACHE,
        ACTION_UNUSED_VOLUMES,
    ];
    let skip_dangling = set.contains(ACTION_UNUSED_IMAGES);
    let mut out = Vec::new();
    for id in order {
        if !set.contains(id) {
            continue;
        }
        if id == ACTION_DANGLING_IMAGES && skip_dangling {
            continue;
        }
        out.push(id.to_string());
    }
    out
}

pub fn execute_docker_cleanup(request: DockerCleanupRequest) -> DockerCleanupResult {
    let Some(bin) = resolve_docker_bin() else {
        return DockerCleanupResult {
            freed_bytes: 0,
            actions_run: vec![],
            errors: vec!["未找到 docker 命令".to_string()],
            success: false,
        };
    };

    if !daemon_is_up(&bin) {
        return DockerCleanupResult {
            freed_bytes: 0,
            actions_run: vec![],
            errors: vec!["Docker 未运行".to_string()],
            success: false,
        };
    }

    let actions = normalize_action_ids(&request.action_ids);
    if actions.is_empty() {
        return DockerCleanupResult {
            freed_bytes: 0,
            actions_run: vec![],
            errors: vec!["未选择清理项".to_string()],
            success: false,
        };
    }

    let mut freed = 0u64;
    let mut errors = Vec::new();
    let mut ran = Vec::new();

    for id in &actions {
        let Some(args) = prune_args_for(id) else {
            errors.push(format!("未知清理项: {id}"));
            continue;
        };
        match run_docker(&bin, args) {
            Ok((stdout, stderr, ok)) => {
                let combined = format!("{stdout}\n{stderr}");
                freed = freed.saturating_add(parse_reclaimed_space(&combined));
                if ok {
                    ran.push(id.clone());
                } else {
                    let msg = stderr.trim();
                    errors.push(if msg.is_empty() {
                        format!("{id} 失败")
                    } else {
                        format!("{id}: {msg}")
                    });
                }
            }
            Err(e) => errors.push(format!("{id}: {e}")),
        }
    }

    DockerCleanupResult {
        freed_bytes: freed,
        actions_run: ran.clone(),
        errors,
        success: !ran.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_human_sizes() {
        assert_eq!(parse_docker_size("0B"), 0);
        assert_eq!(parse_docker_size("500B"), 500);
        assert_eq!(parse_docker_size("1.5KB"), 1500);
        assert_eq!(parse_docker_size("2MB"), 2_000_000);
        assert_eq!(parse_docker_size("4.113GB (13%)"), 4_113_000_000);
        assert_eq!(parse_docker_size("  1.29GB (100%) "), 1_290_000_000);
        assert_eq!(parse_docker_size("63.17MB (0%)"), 63_170_000);
    }

    #[test]
    fn parses_reclaimed_line() {
        let out = "Deleted Images:\nuntagged: sha256:abc\nTotal reclaimed space: 1.234GB\n";
        assert_eq!(parse_reclaimed_space(out), 1_234_000_000);
        assert_eq!(
            parse_reclaimed_space("Total reclaimed space: 500MB"),
            500_000_000
        );
        assert_eq!(parse_reclaimed_space("nothing here"), 0);
    }

    #[test]
    fn parses_df_json() {
        let raw = r#"{"Type":"Images","TotalCount":"40","Active":"12","Size":"30.29GB","Reclaimable":"4.113GB (13%)"}
{"Type":"Containers","TotalCount":49,"Active":0,"Size":"1.29GB","Reclaimable":"1.29GB (100%)"}
{"Type":"Local Volumes","TotalCount":"5","Active":"1","Size":"8.481GB","Reclaimable":"63.17MB (0%)"}
{"Type":"Build Cache","TotalCount":"0","Active":"0","Size":"0B","Reclaimable":"0B"}
"#;
        let types = parse_df_json_lines(raw);
        assert_eq!(types.len(), 4);
        assert_eq!(types[0].type_name, "Images");
        assert_eq!(types[0].total_count, 40);
        assert_eq!(types[0].active_count, 12);
        assert_eq!(types[0].size_bytes, 30_290_000_000);
        assert_eq!(types[0].reclaimable_bytes, 4_113_000_000);
        assert_eq!(types[1].reclaimable_bytes, 1_290_000_000);
        assert_eq!(types[2].reclaimable_bytes, 63_170_000);
    }

    #[test]
    fn unused_images_supersedes_dangling() {
        let ids = normalize_action_ids(&[
            ACTION_DANGLING_IMAGES.to_string(),
            ACTION_UNUSED_IMAGES.to_string(),
            ACTION_BUILD_CACHE.to_string(),
        ]);
        assert_eq!(
            ids,
            vec![
                ACTION_UNUSED_IMAGES.to_string(),
                ACTION_BUILD_CACHE.to_string(),
            ]
        );
    }

    #[test]
    fn scan_without_daemon_is_graceful() {
        // On CI / machines without Docker daemon this must not panic.
        let result = scan_docker_reclaim();
        if !result.cli_available {
            assert!(!result.daemon_running);
            assert!(result.actions.is_empty());
        } else if !result.daemon_running {
            assert!(result.actions.is_empty());
            assert!(result.docker_path.is_some());
        } else {
            assert!(!result.actions.is_empty());
            assert!(
                result
                    .actions
                    .iter()
                    .any(|a| a.id == ACTION_UNUSED_VOLUMES && !a.default_selected)
            );
            assert!(
                result
                    .actions
                    .iter()
                    .any(|a| a.id == ACTION_UNUSED_IMAGES && !a.default_selected)
            );
        }
    }
}
