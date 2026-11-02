use crate::models::{DirContent, FileItem, QuickPath};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "webp", "bmp", "tiff", "docx", "doc",
];

pub fn get_quick_paths() -> Vec<QuickPath> {
    let mut list = Vec::new();

    if let Some(desktop) = dirs::desktop_dir() {
        list.push(QuickPath {
            name: "桌面 (Desktop)".to_string(),
            path: desktop.to_string_lossy().to_string(),
            icon_type: "desktop".to_string(),
        });
    }

    if let Some(downloads) = dirs::download_dir() {
        list.push(QuickPath {
            name: "下载 (Downloads)".to_string(),
            path: downloads.to_string_lossy().to_string(),
            icon_type: "download".to_string(),
        });
    }

    if let Some(documents) = dirs::document_dir() {
        list.push(QuickPath {
            name: "文稿 (Documents)".to_string(),
            path: documents.to_string_lossy().to_string(),
            icon_type: "folder".to_string(),
        });
    }

    if let Some(pictures) = dirs::picture_dir() {
        list.push(QuickPath {
            name: "图片 (Pictures)".to_string(),
            path: pictures.to_string_lossy().to_string(),
            icon_type: "image".to_string(),
        });
    }

    if let Some(home) = dirs::home_dir() {
        list.push(QuickPath {
            name: "个人主目录 (Home)".to_string(),
            path: home.to_string_lossy().to_string(),
            icon_type: "home".to_string(),
        });
    }

    list
}

pub fn get_default_start_dir() -> String {
    dirs::desktop_dir()
        .or_else(|| dirs::document_dir())
        .or_else(|| dirs::home_dir())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string())
}

pub fn read_dir_content(dir_path: &str, show_hidden: bool) -> Result<DirContent, String> {
    let path = Path::new(dir_path);
    if !path.exists() {
        return Err(format!("目录不存在: {}", dir_path));
    }
    if !path.is_dir() {
        return Err(format!("指定路径不是有效目录: {}", dir_path));
    }

    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let canonical_str = canonical.to_string_lossy().to_string();

    let parent_path = canonical.parent().map(|p| p.to_string_lossy().to_string());

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&canonical).map_err(|e| format!("无法读取目录: {}", e))?;

    for entry in read_dir.flatten() {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if !show_hidden && name.starts_with('.') {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_dir = metadata.is_dir();
        let size = if is_dir { 0 } else { metadata.len() };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let extension = entry_path
            .extension()
            .map(|ext| ext.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let is_supported = if is_dir {
            true
        } else {
            SUPPORTED_EXTENSIONS.contains(&extension.as_str())
        };

        let mut page_count = None;
        if extension == "pdf" && size < 50 * 1024 * 1024 {
            // Read fast page count
            page_count = read_pdf_page_count_fast(&entry_path);
        }

        entries.push(FileItem {
            path: entry_path.to_string_lossy().to_string(),
            name,
            extension,
            size,
            is_dir,
            modified,
            page_count,
            is_supported,
        });
    }

    // Sort: directories first, then alphabetical by name
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    let total_count = entries.len();

    Ok(DirContent {
        current_path: canonical_str,
        parent_path,
        entries,
        total_count,
    })
}

pub fn read_pdf_page_count_fast(path: &Path) -> Option<u32> {
    // Fast page count using lopdf document load with pages map
    match lopdf::Document::load(path) {
        Ok(doc) => {
            let pages = doc.get_pages();
            Some(pages.len() as u32)
        }
        Err(_) => None,
    }
}

pub fn get_file_metadata(path_str: &str) -> Result<FileItem, String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(format!("文件不存在: {}", path_str));
    }

    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let is_dir = metadata.is_dir();
    let size = if is_dir { 0 } else { metadata.len() };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.to_string());

    let extension = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let is_supported = if is_dir {
        true
    } else {
        SUPPORTED_EXTENSIONS.contains(&extension.as_str())
    };

    let page_count = if extension == "pdf" {
        read_pdf_page_count_fast(path)
    } else {
        None
    };

    Ok(FileItem {
        path: path.canonicalize().unwrap_or_else(|_| PathBuf::from(path_str)).to_string_lossy().to_string(),
        name,
        extension,
        size,
        is_dir,
        modified,
        page_count,
        is_supported,
    })
}
