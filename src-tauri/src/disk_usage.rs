//! One-level disk usage: each directory's size is the sum of files inside it.
//! Children are measured in parallel. Symlinks are not followed. APFS firmlink
//! copies under `/System/Volumes/Data` are skipped so `/Users` is not counted twice.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageKind {
    Dir,
    File,
    Files,
    Dirs,
    Volume,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiskUsageEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub kind: UsageKind,
    pub permission_denied: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiskUsageScan {
    pub supported: bool,
    pub root_path: String,
    pub root_name: String,
    pub home_path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub entries: Vec<DiskUsageEntry>,
    pub volumes: Vec<DiskUsageEntry>,
    pub permission_denied: bool,
    pub disk_total_bytes: u64,
    pub disk_free_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiskUsageProgress {
    pub root_path: String,
    pub current_path: String,
    pub scanned_files: u64,
    pub scanned_bytes: u64,
    pub home_path: String,
}

const CANCELLED: &str = "cancelled";
const OTHER_DIRS: &str = "其余目录";
const OTHER_FILES: &str = "其余文件";
const DATA_VOLUME: &str = "/System/Volumes/Data";

struct PackLimits {
    max_dirs: usize,
    max_files: usize,
    always_file_bytes: u64,
}

const DEFAULT_LIMITS: PackLimits = PackLimits {
    max_dirs: 300,
    max_files: 40,
    always_file_bytes: 50 * 1024 * 1024,
};

#[derive(Clone)]
struct Raw {
    name: String,
    path: String,
    size_bytes: u64,
    file_count: u64,
    kind: UsageKind,
    permission_denied: bool,
}

struct Measure {
    bytes: u64,
    files: u64,
    denied: bool,
    cancelled: bool,
}

pub fn scan_disk_usage(
    path: &str,
    progress: &(dyn Fn(DiskUsageProgress) + Sync),
    cancel: &(dyn Fn() -> bool + Sync),
) -> Result<DiskUsageScan, String> {
    #[cfg(unix)]
    {
        scan_unix(path, progress, cancel)
    }
    #[cfg(not(unix))]
    {
        let _ = (path, progress, cancel);
        Ok(empty_scan(false, "", ""))
    }
}

#[cfg(unix)]
fn scan_unix(
    raw_path: &str,
    progress: &(dyn Fn(DiskUsageProgress) + Sync),
    cancel: &(dyn Fn() -> bool + Sync),
) -> Result<DiskUsageScan, String> {
    use std::os::unix::fs::MetadataExt;

    if cancel() {
        return Err(CANCELLED.into());
    }
    let path: PathBuf = Path::new(raw_path).components().collect();
    if !path.is_absolute() {
        return Err("需要绝对路径".into());
    }
    let meta = fs::symlink_metadata(&path).map_err(|e| format!("无法读取目录: {e}"))?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("不是目录".into());
    }

    let root_path = path.to_string_lossy().into_owned();
    let home = home_path();
    let emit = {
        let root_path = root_path.clone();
        let home = home.clone();
        move |files: u64, bytes: u64, current: &str| {
            progress(DiskUsageProgress {
                root_path: root_path.clone(),
                current_path: current.to_string(),
                scanned_files: files,
                scanned_bytes: bytes,
                home_path: home.clone(),
            });
        }
    };
    emit(0, 0, &root_path);

    let device = meta.dev();
    let dirs_seen = Mutex::new(HashSet::new());
    claim_dir(&dirs_seen, device, meta.ino());

    let mut dir_jobs: Vec<(String, PathBuf)> = Vec::new();
    let mut files: Vec<Raw> = Vec::new();
    let mut volumes: Vec<DiskUsageEntry> = Vec::new();
    let mut volume_devs: HashSet<u64> = HashSet::from([device]);
    let mut denied = false;
    let mut file_inodes: HashSet<(u64, u64)> = HashSet::new();

    let entries = match fs::read_dir(&path) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Err("目录不存在".into()),
        Err(_) => {
            let mut scan = empty_scan(true, &root_path, &home);
            scan.permission_denied = true;
            scan.root_name = root_name(&path);
            return Ok(scan);
        }
    };

    for (index, item) in entries.enumerate() {
        if index % 256 == 0 && cancel() {
            return Err(CANCELLED.into());
        }
        let entry = match item {
            Ok(entry) => entry,
            Err(_) => {
                denied = true;
                continue;
            }
        };
        let child = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path == Path::new("/") && (name == "dev" || name == ".vol") {
            continue;
        }
        let child_meta = match fs::symlink_metadata(&child) {
            Ok(meta) => meta,
            Err(_) => {
                denied = true;
                continue;
            }
        };
        if child_meta.file_type().is_symlink() {
            continue;
        }
        if child_meta.dev() != device {
            push_volume(&mut volumes, &mut volume_devs, &child, &name, child_meta.dev());
            continue;
        }
        if child_meta.is_dir() {
            if is_data_volume_mirror(&child, &path) {
                continue;
            }
            if !claim_dir(&dirs_seen, child_meta.dev(), child_meta.ino()) {
                continue;
            }
            dir_jobs.push((name, child));
        } else if child_meta.is_file() {
            let inode = (child_meta.dev(), child_meta.ino());
            if !file_inodes.insert(inode) {
                continue;
            }
            let size = child_meta.len();
            if size == 0 {
                continue;
            }
            files.push(Raw {
                name,
                path: child.to_string_lossy().into_owned(),
                size_bytes: size,
                file_count: 1,
                kind: UsageKind::File,
                permission_denied: false,
            });
        }
    }

    if path == Path::new("/") {
        collect_mounts(Path::new("/Volumes"), device, &mut volumes, &mut volume_devs);
    }

    let tick_files = AtomicU64::new(0);
    let tick_bytes = AtomicU64::new(0);
    let last_emit = AtomicU64::new(now_ms());
    let stop = AtomicBool::new(false);
    let tick = Tick {
        files: &tick_files,
        bytes: &tick_bytes,
        last_emit: &last_emit,
        emit: &emit,
    };

    let queue = Mutex::new(dir_jobs);
    let results: Mutex<Vec<Raw>> = Mutex::new(Vec::new());
    let job_count = lock(&queue).len();
    let workers = if job_count == 0 {
        0
    } else {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(1, 8)
            .min(job_count)
    };

    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                loop {
                    if cancel() || stop.load(Ordering::Relaxed) {
                        stop.store(true, Ordering::Relaxed);
                        break;
                    }
                    let job = lock(&queue).pop();
                    let Some((name, job_path)) = job else { break };
                    // Each subtree keeps its own directory set. Sharing one set across
                    // sibling walks drops folders whose inode was first seen elsewhere,
                    // so a child can measure larger than its parent.
                    let measured = measure_tree(&job_path, device, &path, &tick, cancel);
                    if measured.cancelled {
                        stop.store(true, Ordering::Relaxed);
                        break;
                    }
                    if measured.bytes == 0 && !measured.denied {
                        continue;
                    }
                    lock(&results).push(Raw {
                        name,
                        path: job_path.to_string_lossy().into_owned(),
                        size_bytes: measured.bytes,
                        file_count: measured.files,
                        kind: UsageKind::Dir,
                        permission_denied: measured.denied,
                    });
                }
            });
        }
    });

    if cancel() || stop.load(Ordering::Relaxed) {
        return Err(CANCELLED.into());
    }

    let dirs = lock(&results).clone();
    denied = denied || dirs.iter().any(|dir| dir.permission_denied);
    let entries = pack_entries(dirs, files, &DEFAULT_LIMITS);
    let size_bytes = entries.iter().fold(0u64, |sum, entry| sum.saturating_add(entry.size_bytes));
    let file_count = entries.iter().fold(0u64, |sum, entry| sum.saturating_add(entry.file_count));
    denied = denied || entries.iter().any(|entry| entry.permission_denied);
    emit(file_count, size_bytes, &root_path);

    volumes.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.name.cmp(&b.name))
    });
    let (disk_total_bytes, disk_free_bytes) = crate::disk_cleaner::get_disk_capacity();
    Ok(DiskUsageScan {
        supported: true,
        root_name: root_name(&path),
        root_path,
        home_path: home,
        size_bytes,
        file_count,
        entries,
        volumes,
        permission_denied: denied,
        disk_total_bytes,
        disk_free_bytes,
    })
}

#[cfg(unix)]
struct Tick<'a> {
    files: &'a AtomicU64,
    bytes: &'a AtomicU64,
    last_emit: &'a AtomicU64,
    emit: &'a (dyn Fn(u64, u64, &str) + Send + Sync),
}

#[cfg(unix)]
impl Tick<'_> {
    fn add(&self, path: &Path, file_delta: u64, byte_delta: u64) {
        let files = self.files.fetch_add(file_delta, Ordering::Relaxed) + file_delta;
        let bytes = self.bytes.fetch_add(byte_delta, Ordering::Relaxed) + byte_delta;
        let now = now_ms();
        let prev = self.last_emit.load(Ordering::Relaxed);
        if now.saturating_sub(prev) < 180 {
            return;
        }
        if self
            .last_emit
            .compare_exchange(prev, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
        {
            return;
        }
        (self.emit)(files, bytes, &path.to_string_lossy());
    }
}

#[cfg(unix)]
fn measure_tree(
    root: &Path,
    device: u64,
    scan_root: &Path,
    tick: &Tick<'_>,
    cancel: &(dyn Fn() -> bool + Sync),
) -> Measure {
    use std::os::unix::fs::MetadataExt;

    let mut bytes = 0u64;
    let mut files = 0u64;
    let mut denied = false;
    let mut file_inodes: HashSet<(u64, u64)> = HashSet::new();
    let mut dirs_seen: HashSet<(u64, u64)> = HashSet::new();
    if let Ok(meta) = fs::symlink_metadata(root) {
        dirs_seen.insert((meta.dev(), meta.ino()));
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if cancel() {
            return Measure { bytes, files, denied, cancelled: true };
        }
        tick.add(&dir, 0, 0);
        let iter = match fs::read_dir(&dir) {
            Ok(iter) => iter,
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(_) => {
                denied = true;
                continue;
            }
        };
        let mut pending_files = 0u64;
        let mut pending_bytes = 0u64;
        for item in iter {
            let entry = match item {
                Ok(entry) => entry,
                Err(_) => {
                    denied = true;
                    continue;
                }
            };
            let child = entry.path();
            let meta = match fs::symlink_metadata(&child) {
                Ok(meta) => meta,
                Err(_) => {
                    denied = true;
                    continue;
                }
            };
            if meta.file_type().is_symlink() || meta.dev() != device {
                continue;
            }
            if meta.is_dir() {
                if is_data_volume_mirror(&child, scan_root) {
                    continue;
                }
                if dirs_seen.insert((meta.dev(), meta.ino())) {
                    stack.push(child);
                }
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            if !file_inodes.insert((meta.dev(), meta.ino())) {
                continue;
            }
            let size = meta.len();
            if size == 0 {
                continue;
            }
            bytes = bytes.saturating_add(size);
            files += 1;
            pending_files += 1;
            pending_bytes = pending_bytes.saturating_add(size);
            if pending_files >= 64 {
                tick.add(&dir, pending_files, pending_bytes);
                pending_files = 0;
                pending_bytes = 0;
            }
        }
        if pending_files > 0 || pending_bytes > 0 {
            tick.add(&dir, pending_files, pending_bytes);
        }
    }
    Measure { bytes, files, denied, cancelled: false }
}

#[cfg(unix)]
fn claim_dir(seen: &Mutex<HashSet<(u64, u64)>>, dev: u64, ino: u64) -> bool {
    lock(seen).insert((dev, ino))
}

#[cfg(unix)]
fn is_data_volume_mirror(path: &Path, scan_root: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    if path == scan_root {
        return false;
    }
    let Ok(rest) = path.strip_prefix(DATA_VOLUME) else {
        return false;
    };
    if rest.as_os_str().is_empty() {
        return false;
    }
    let canonical = Path::new("/").join(rest);
    if canonical == path {
        return false;
    }
    match (fs::symlink_metadata(&canonical), fs::symlink_metadata(path)) {
        (Ok(canonical_meta), Ok(path_meta)) => {
            canonical_meta.is_dir()
                && path_meta.is_dir()
                && canonical_meta.dev() == path_meta.dev()
                && canonical_meta.ino() == path_meta.ino()
        }
        _ => false,
    }
}

#[cfg(unix)]
fn collect_mounts(
    dir: &Path,
    root_device: u64,
    volumes: &mut Vec<DiskUsageEntry>,
    seen_devs: &mut HashSet<u64>,
) {
    use std::os::unix::fs::MetadataExt;

    let Ok(entries) = fs::read_dir(dir) else { return };
    for item in entries.flatten() {
        let child = item.path();
        let Ok(meta) = fs::symlink_metadata(&child) else { continue };
        if meta.file_type().is_symlink() || !meta.is_dir() || meta.dev() == root_device {
            continue;
        }
        push_volume(
            volumes,
            seen_devs,
            &child,
            &item.file_name().to_string_lossy(),
            meta.dev(),
        );
    }
}

#[cfg(unix)]
fn push_volume(
    volumes: &mut Vec<DiskUsageEntry>,
    seen_devs: &mut HashSet<u64>,
    path: &Path,
    name: &str,
    dev: u64,
) {
    if !seen_devs.insert(dev) {
        return;
    }
    let Some(size_bytes) = volume_used_bytes(path) else { return };
    if size_bytes == 0 {
        return;
    }
    volumes.push(DiskUsageEntry {
        name: name.to_string(),
        path: path.to_string_lossy().into_owned(),
        size_bytes,
        file_count: 0,
        kind: UsageKind::Volume,
        permission_denied: false,
    });
}

#[cfg(unix)]
fn volume_used_bytes(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;

    let bytes = path.as_os_str().as_bytes();
    if bytes.contains(&0) {
        return None;
    }
    let mut buf = Vec::with_capacity(bytes.len() + 1);
    buf.extend_from_slice(bytes);
    buf.push(0);
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(buf.as_ptr() as *const libc::c_char, &mut stat) };
    if rc != 0 {
        return None;
    }
    let unit = if stat.f_frsize == 0 { stat.f_bsize } else { stat.f_frsize } as u64;
    let total = (stat.f_blocks as u64).saturating_mul(unit);
    let avail = (stat.f_bavail as u64).saturating_mul(unit);
    Some(total.saturating_sub(avail))
}

fn pack_entries(mut dirs: Vec<Raw>, mut files: Vec<Raw>, limits: &PackLimits) -> Vec<DiskUsageEntry> {
    dirs.retain(|item| item.size_bytes > 0 || item.permission_denied);
    files.retain(|item| item.size_bytes > 0 || item.permission_denied);
    dirs.sort_by(by_size);
    files.sort_by(by_size);

    let omitted_dirs = if dirs.len() > limits.max_dirs {
        dirs.split_off(limits.max_dirs)
    } else {
        Vec::new()
    };
    let mut kept_files = Vec::new();
    let mut omitted_files = Vec::new();
    for file in files {
        let large = file.size_bytes >= limits.always_file_bytes;
        let room = kept_files.len() < limits.max_files || (large && kept_files.len() < limits.max_files + 60);
        if room {
            kept_files.push(file);
        } else {
            omitted_files.push(file);
        }
    }

    let mut entries: Vec<DiskUsageEntry> = dirs.into_iter().map(Raw::into_entry).collect();
    entries.extend(kept_files.into_iter().map(Raw::into_entry));
    if let Some(rollup) = rollup(OTHER_DIRS, UsageKind::Dirs, &omitted_dirs) {
        entries.push(rollup);
    }
    if let Some(rollup) = rollup(OTHER_FILES, UsageKind::Files, &omitted_files) {
        entries.push(rollup);
    }
    entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes).then_with(|| a.name.cmp(&b.name)));
    entries
}

fn rollup(name: &str, kind: UsageKind, items: &[Raw]) -> Option<DiskUsageEntry> {
    if items.is_empty() {
        return None;
    }
    Some(DiskUsageEntry {
        name: name.to_string(),
        path: String::new(),
        size_bytes: items.iter().fold(0, |sum, item| sum.saturating_add(item.size_bytes)),
        file_count: items.iter().fold(0, |sum, item| sum.saturating_add(item.file_count)),
        kind,
        permission_denied: items.iter().any(|item| item.permission_denied),
    })
}

fn by_size(a: &Raw, b: &Raw) -> std::cmp::Ordering {
    b.size_bytes.cmp(&a.size_bytes).then_with(|| a.name.cmp(&b.name))
}

impl Raw {
    fn into_entry(self) -> DiskUsageEntry {
        DiskUsageEntry {
            name: self.name,
            path: self.path,
            size_bytes: self.size_bytes,
            file_count: self.file_count,
            kind: self.kind,
            permission_denied: self.permission_denied,
        }
    }
}

fn root_name(path: &Path) -> String {
    if path == Path::new("/") {
        "本机磁盘".into()
    } else {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageDeleteResult {
    pub success: bool,
    pub errors: Vec<String>,
}

fn delete_error(message: impl Into<String>) -> UsageDeleteResult {
    UsageDeleteResult {
        success: false,
        errors: vec![message.into()],
    }
}

pub fn delete_home_directory(path: &str) -> UsageDeleteResult {
    #[cfg(not(unix))]
    {
        let _ = path;
        delete_error("磁盘清理暂仅支持macOS")
    }
    #[cfg(unix)]
    {
        let Some(home) = dirs::home_dir() else {
            return delete_error("无法获取用户目录");
        };
        delete_under_home(&home, Path::new(path))
    }
}

#[cfg(unix)]
fn delete_under_home(home: &Path, raw: &Path) -> UsageDeleteResult {
    if let Err(err) = assert_deletable_dir(home, raw) {
        return delete_error(err);
    }
    let mut errors = Vec::new();
    remove_unfollowed(home, raw, &mut errors);
    UsageDeleteResult {
        success: errors.is_empty(),
        errors,
    }
}

#[cfg(unix)]
fn assert_deletable_dir(home: &Path, raw: &Path) -> Result<(), String> {
    use std::path::Component;

    let path: PathBuf = raw.components().collect();
    if !path.is_absolute() {
        return Err("需要绝对路径".into());
    }
    let relative = path
        .strip_prefix(home)
        .map_err(|_| "只能删除用户目录下的文件夹".to_string())?;
    if relative.as_os_str().is_empty() {
        return Err("不能删除用户目录本身".into());
    }
    let mut current = home.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err("路径包含非法分量".into());
        };
        current.push(name);
        let metadata = fs::symlink_metadata(&current)
            .map_err(|err| format!("{}: {err}", current.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("不删除符号链接: {}", current.display()));
        }
    }
    let meta = fs::symlink_metadata(&path).map_err(|err| err.to_string())?;
    if !meta.is_dir() {
        return Err("只能删除文件夹".into());
    }
    let canonical_home = home.canonicalize().map_err(|err| err.to_string())?;
    let canonical = path.canonicalize().map_err(|err| err.to_string())?;
    if !canonical.starts_with(&canonical_home) || canonical == canonical_home {
        return Err("只能删除用户目录下的文件夹".into());
    }
    Ok(())
}

#[cfg(unix)]
fn remove_unfollowed(home: &Path, path: &Path, errors: &mut Vec<String>) {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(err) => {
            errors.push(format!("{}: {err}", path.display()));
            return;
        }
    };
    if meta.file_type().is_symlink() || !meta.is_dir() {
        if let Err(err) = fs::remove_file(path) {
            errors.push(format!("{}: {err}", path.display()));
        }
        return;
    }
    match (home.canonicalize(), path.canonicalize()) {
        (Ok(home_real), Ok(path_real)) if path_real.starts_with(&home_real) => {}
        _ => {
            errors.push(format!("跳过超出用户目录的文件夹: {}", path.display()));
            return;
        }
    }
    match fs::read_dir(path) {
        Ok(entries) => {
            for entry in entries {
                match entry {
                    Ok(entry) => remove_unfollowed(home, &entry.path(), errors),
                    Err(err) => errors.push(err.to_string()),
                }
            }
        }
        Err(err) => {
            errors.push(format!("{}: {err}", path.display()));
            return;
        }
    }
    if let Err(err) = fs::remove_dir(path) {
        errors.push(format!("{}: {err}", path.display()));
    }
}

fn home_path() -> String {
    dirs::home_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn empty_scan(supported: bool, root_path: &str, home_path: &str) -> DiskUsageScan {
    DiskUsageScan {
        supported,
        root_path: root_path.to_string(),
        root_name: root_name(Path::new(root_path)),
        home_path: home_path.to_string(),
        size_bytes: 0,
        file_count: 0,
        entries: Vec::new(),
        volumes: Vec::new(),
        permission_denied: false,
        disk_total_bytes: 0,
        disk_free_bytes: 0,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    fn temp_dir() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        loop {
            let sequence = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("disk-usage-{}-{}", std::process::id(), sequence));
            match fs::create_dir(&path) {
                Ok(()) => return path,
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(e) => panic!("cannot create {}: {e}", path.display()),
            }
        }
    }

    struct Tmp(PathBuf);
    impl Tmp {
        fn new() -> Self {
            Self(temp_dir())
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn scan(path: &Path) -> DiskUsageScan {
        scan_disk_usage(path.to_str().unwrap(), &|_| {}, &|| false).unwrap()
    }

    fn raw(name: &str, size: u64, files: u64, kind: UsageKind) -> Raw {
        Raw {
            name: name.into(),
            path: name.into(),
            size_bytes: size,
            file_count: files,
            kind,
            permission_denied: false,
        }
    }

    #[test]
    fn pack_keeps_largest_and_rolls_up_the_tail() {
        let dirs = vec![raw("a", 300, 3, UsageKind::Dir), raw("b", 200, 2, UsageKind::Dir), raw("c", 10, 1, UsageKind::Dir)];
        let files = vec![
            raw("big", 5_000, 1, UsageKind::File),
            raw("s1", 10, 1, UsageKind::File),
            raw("s2", 10, 1, UsageKind::File),
            raw("s3", 10, 1, UsageKind::File),
        ];
        let entries = pack_entries(
            dirs,
            files,
            &PackLimits { max_dirs: 2, max_files: 1, always_file_bytes: 1_000 },
        );
        assert_eq!(
            entries.iter().map(|entry| entry.name.as_str()).collect::<Vec<_>>(),
            vec!["big", "a", "b", OTHER_FILES, OTHER_DIRS]
        );
        assert_eq!(entries[3].size_bytes, 30);
        assert_eq!(entries[3].kind, UsageKind::Files);
        assert_eq!(entries[4].size_bytes, 10);
        assert_eq!(entries[4].kind, UsageKind::Dirs);
    }

    #[cfg(unix)]
    #[test]
    fn sums_nested_files_without_following_symlinks_or_double_counting_links() {
        use std::os::unix::fs::symlink;

        let tmp = Tmp::new();
        let outside = Tmp::new();
        fs::create_dir_all(tmp.0.join("big/nested")).unwrap();
        fs::write(tmp.0.join("big/nested/a"), vec![1u8; 50]).unwrap();
        fs::write(tmp.0.join("big/b"), vec![2u8; 25]).unwrap();
        fs::create_dir_all(tmp.0.join("small")).unwrap();
        fs::write(tmp.0.join("small/c"), vec![3u8; 10]).unwrap();
        fs::write(tmp.0.join("top.bin"), vec![4u8; 5]).unwrap();
        fs::hard_link(tmp.0.join("top.bin"), tmp.0.join("top-link.bin")).unwrap();
        fs::write(outside.0.join("secret"), vec![9u8; 4000]).unwrap();
        symlink(outside.0.join("secret"), tmp.0.join("secret-link")).unwrap();
        symlink(&outside.0, tmp.0.join("dir-link")).unwrap();
        fs::create_dir_all(tmp.0.join("dev")).unwrap();
        fs::write(tmp.0.join("dev/keep"), vec![1u8; 40]).unwrap();

        let result = scan(&tmp.0);
        assert!(result.supported);
        assert_eq!(result.size_bytes, 50 + 25 + 10 + 5 + 40);
        assert_eq!(result.file_count, 5);
        let big = result.entries.iter().find(|entry| entry.name == "big").unwrap();
        assert_eq!((big.size_bytes, big.file_count, big.kind), (75, 2, UsageKind::Dir));
        assert_eq!(result.entries[0].name, "big");
        assert!(result.entries.iter().any(|entry| entry.name == "dev" && entry.size_bytes == 40));
        let names: Vec<_> = result.entries.iter().map(|entry| entry.name.as_str()).collect();
        assert!(!names.contains(&"secret-link"));
        assert!(!names.contains(&"dir-link"));
        assert_eq!(names.iter().filter(|name| **name == "top.bin" || **name == "top-link.bin").count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn nested_measurement_matches_a_direct_scan() {
        let tmp = Tmp::new();
        fs::create_dir_all(tmp.0.join("Users/jzefan/Library")).unwrap();
        fs::create_dir_all(tmp.0.join("Users/jzefan/work")).unwrap();
        fs::create_dir_all(tmp.0.join("System/other")).unwrap();
        fs::write(tmp.0.join("Users/jzefan/Library/a"), vec![1u8; 80]).unwrap();
        fs::write(tmp.0.join("Users/jzefan/work/b"), vec![2u8; 40]).unwrap();
        fs::write(tmp.0.join("System/other/c"), vec![3u8; 20]).unwrap();

        let root = scan(&tmp.0);
        let users = root.entries.iter().find(|entry| entry.name == "Users").unwrap();
        let direct_users = scan(&tmp.0.join("Users"));
        let jzefan = direct_users.entries.iter().find(|entry| entry.name == "jzefan").unwrap();
        assert!(users.size_bytes >= jzefan.size_bytes);
        assert_eq!(users.size_bytes, direct_users.size_bytes);
        assert_eq!(jzefan.size_bytes, 120);
        assert_eq!(root.size_bytes, 140);
    }

    #[cfg(unix)]
    #[test]
    fn deletes_a_directory_only_inside_the_home_folder() {
        use std::os::unix::fs::symlink;

        let tmp = Tmp::new();
        let home = tmp.0.join("home");
        fs::create_dir_all(home.join("Library/Caches")).unwrap();
        fs::write(home.join("Library/Caches/a"), b"abc").unwrap();
        let outside = tmp.0.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep"), b"keep").unwrap();
        symlink(&outside, home.join("Library/link")).unwrap();
        symlink(home.join("Library"), home.join("alias")).unwrap();

        let deleted = delete_under_home(&home, &home.join("Library"));
        assert!(deleted.success, "{:?}", deleted.errors);
        assert!(!home.join("Library").exists());
        assert_eq!(fs::read(outside.join("keep")).unwrap(), b"keep");

        let itself = delete_under_home(&home, &home);
        assert!(!itself.success);
        assert!(home.is_dir());

        let link = delete_under_home(&home, &home.join("alias"));
        assert!(!link.success);
        assert!(home.join("alias").symlink_metadata().unwrap().file_type().is_symlink());

        let other = tmp.0.join("other");
        fs::create_dir(&other).unwrap();
        assert!(!delete_under_home(&home, &other).success);
        assert!(other.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_directory_is_listed_and_not_counted() {
        use std::os::unix::fs::PermissionsExt;

        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let tmp = Tmp::new();
        let locked = tmp.0.join("locked");
        fs::create_dir(&locked).unwrap();
        fs::write(locked.join("hidden"), vec![1u8; 80]).unwrap();
        let mut perms = fs::metadata(&locked).unwrap().permissions();
        perms.set_mode(0);
        fs::set_permissions(&locked, perms).unwrap();
        struct Reset(PathBuf);
        impl Drop for Reset {
            fn drop(&mut self) {
                if let Ok(meta) = fs::metadata(&self.0) {
                    let mut perms = meta.permissions();
                    perms.set_mode(0o755);
                    let _ = fs::set_permissions(&self.0, perms);
                }
            }
        }
        let _reset = Reset(locked.clone());

        let result = scan(&tmp.0);
        let entry = result.entries.iter().find(|entry| entry.name == "locked").unwrap();
        assert!(entry.permission_denied);
        assert_eq!(entry.size_bytes, 0);
        assert!(result.permission_denied);
        assert_eq!(result.size_bytes, 0);
    }

    #[cfg(unix)]
    #[test]
    fn cancel_stops_before_walking() {
        let tmp = Tmp::new();
        fs::write(tmp.0.join("a"), vec![1u8; 10]).unwrap();
        let error = scan_disk_usage(tmp.0.to_str().unwrap(), &|_| {}, &|| true).unwrap_err();
        assert_eq!(error, CANCELLED);
    }

    #[cfg(unix)]
    #[test]
    fn reports_progress_for_a_real_directory() {
        let tmp = Tmp::new();
        fs::write(tmp.0.join("a"), vec![1u8; 12]).unwrap();
        let hits = AtomicU64::new(0);
        let result = scan_disk_usage(tmp.0.to_str().unwrap(), &|_| {
            hits.fetch_add(1, Ordering::Relaxed);
        }, &|| false)
        .unwrap();
        assert!(hits.load(Ordering::Relaxed) >= 1);
        assert_eq!(result.size_bytes, 12);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn data_volume_firmlinks_are_mirrors_of_the_visible_root() {
        let users = Path::new("/System/Volumes/Data/Users");
        if users.is_dir() {
            assert!(is_data_volume_mirror(users, Path::new("/")));
            assert!(!is_data_volume_mirror(users, users));
            assert!(!is_data_volume_mirror(Path::new("/Users"), Path::new("/")));
        }
        let local = Path::new("/System/Volumes/Data/usr/local");
        if local.is_dir() {
            assert!(is_data_volume_mirror(local, Path::new("/")));
        }
    }

    #[cfg(unix)]
    #[test]
    fn relative_paths_are_rejected() {
        let error = scan_disk_usage("relative", &|_| {}, &|| false).unwrap_err();
        assert_eq!(error, "需要绝对路径");
    }
}
