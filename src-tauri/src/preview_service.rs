use crate::models::DocumentPreviewData;
use base64::prelude::*;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub fn quick_look_file(path_str: &str) -> Result<(), String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(format!("文件不存在: {}", path_str));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("qlmanage")
            .args(["-p", path_str])
            .spawn()
            .map_err(|e| format!("启动 macOS 快速查看失败: {}", e))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        tauri_plugin_opener::open_path(path, None::<&str>)
            .map_err(|e| format!("打开文件失败: {}", e))
    }
}

fn find_file_recursive(dir: &Path, filename: &str) -> Option<PathBuf> {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if let Some(found) = find_file_recursive(&p, filename) {
                    return Some(found);
                }
            } else if p.file_name().and_then(|s| s.to_str()) == Some(filename) {
                return Some(p);
            }
        }
    }
    None
}

fn inline_images_in_html(html: &str, dir: &Path) -> String {
    if !html.contains("<img") && !html.contains("src=") {
        return html.to_string();
    }

    let Ok(re) = regex::Regex::new(r#"src=["']([^"']+)["']"#) else {
        return html.to_string();
    };

    re.replace_all(html, |caps: &regex::Captures| {
        let src = &caps[1];
        if src.starts_with("data:") || src.starts_with("http:") || src.starts_with("https:") {
            return caps[0].to_string();
        }

        let img_path = dir.join(src);
        if img_path.exists() {
            if let Ok(bytes) = fs::read(&img_path) {
                let ext = img_path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("png")
                    .to_lowercase();
                let mime = match ext.as_str() {
                    "jpg" | "jpeg" => "image/jpeg",
                    "gif" => "image/gif",
                    "svg" => "image/svg+xml",
                    "webp" => "image/webp",
                    _ => "image/png",
                };
                let b64 = BASE64_STANDARD.encode(&bytes);
                return format!(r#"src="data:{};base64,{}""#, mime, b64);
            }
        }
        caps[0].to_string()
    })
    .to_string()
}

fn wrap_html_with_card_theme(html: &str, title: &str) -> String {
    let custom_css = r#"
<style>
  html, body {
    margin: 0;
    padding: 0;
    background-color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    display: flex;
    justify-content: center;
    overflow-y: auto !important;
    height: auto !important;
  }
  .s1.s1.s1, .document-container {
    overflow: visible !important;
    margin: 28px auto !important;
    background: #ffffff !important;
    padding: 56px 64px !important;
    box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05) !important;
    border-radius: 12px !important;
    width: 720px !important;
    max-width: calc(100vw - 48px) !important;
    box-sizing: border-box !important;
  }
  .doc-page-separator {
    display: block !important;
    margin: 40px -64px !important;
    padding: 12px 0 !important;
    border-top: 1px dashed #cbd5e1 !important;
    border-bottom: 12px solid #f1f5f9 !important;
    text-align: center !important;
    background: #f8fafc !important;
    font-size: 11px !important;
    color: #94a3b8 !important;
    font-weight: 600 !important;
    letter-spacing: 0.05em !important;
    user-select: none !important;
  }
  @media (prefers-color-scheme: dark) {
    html, body {
      background-color: #0f172a;
    }
    .s1.s1.s1, .document-container {
      background: #1e293b !important;
      color: #f1f5f9 !important;
      box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
    }
    span, p, h1, h2, h3, h4, td, th {
      color: inherit !important;
    }
    .doc-page-separator {
      border-top-color: #334155 !important;
      border-bottom: 12px solid #0f172a !important;
      background: #1e293b !important;
      color: #64748b !important;
    }
  }
</style>
"#;

    if html.contains("</head>") {
        html.replace("</head>", &format!("{}</head>", custom_css))
    } else {
        format!(
            r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>{}</title>{}</head><body><div class="document-container">{}</div></body></html>"#,
            title, custom_css, html
        )
    }
}

pub fn generate_office_preview_html(path: &Path) -> Option<(String, Option<u32>)> {
    let file_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("文档预览");

    // Strategy 1: macOS native qlmanage -p (highest fidelity)
    #[cfg(target_os = "macos")]
    {
        let temp_dir = std::env::temp_dir().join(format!(
            "doctools_prev_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));
        let _ = fs::create_dir_all(&temp_dir);

        let output = std::process::Command::new("qlmanage")
            .args(["-p", "-o"])
            .arg(&temp_dir)
            .arg(path)
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                if let Some(preview_file) = find_file_recursive(&temp_dir, "Preview.html") {
                    if let Ok(mut html) = fs::read_to_string(&preview_file) {
                        let preview_dir = preview_file.parent().unwrap_or(&temp_dir);
                        html = inline_images_in_html(&html, preview_dir);

                        let form_feed_count = html.matches('\x0c').count();
                        let page_count = if form_feed_count > 0 {
                            Some((form_feed_count + 1) as u32)
                        } else {
                            None
                        };

                        let mut page_num = 1;
                        let mut formatted_html = String::with_capacity(html.len() + 2048);
                        for part in html.split('\x0c') {
                            if page_num > 1 {
                                formatted_html.push_str(&format!(
                                    r#"<span class="doc-page-separator">—— 第 {} 页 ——</span>"#,
                                    page_num
                                ));
                            }
                            formatted_html.push_str(part);
                            page_num += 1;
                        }

                        let styled = wrap_html_with_card_theme(&formatted_html, file_name);
                        let _ = fs::remove_dir_all(&temp_dir);
                        return Some((styled, page_count));
                    }
                }
            }
        }
        let _ = fs::remove_dir_all(&temp_dir);
    }

    // Strategy 2: macOS textutil -convert html
    #[cfg(target_os = "macos")]
    {
        let temp_html = std::env::temp_dir().join(format!(
            "doctools_tu_{}_{}.html",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));

        let output = std::process::Command::new("/usr/bin/textutil")
            .args(["-convert", "html", "-output"])
            .arg(&temp_html)
            .arg(path)
            .output();

        if let Ok(out) = output {
            if out.status.success() && temp_html.exists() {
                if let Ok(html) = fs::read_to_string(&temp_html) {
                    let _ = fs::remove_file(&temp_html);
                    let styled = wrap_html_with_card_theme(&html, file_name);
                    return Some((styled, None));
                }
            }
        }
        let _ = fs::remove_file(&temp_html);
    }

    // Strategy 3: pandoc
    {
        let temp_html = std::env::temp_dir().join(format!(
            "doctools_pan_{}_{}.html",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));

        let output = std::process::Command::new("pandoc")
            .args(["-s", "-o"])
            .arg(&temp_html)
            .arg(path)
            .output();

        if let Ok(out) = output {
            if out.status.success() && temp_html.exists() {
                if let Ok(html) = fs::read_to_string(&temp_html) {
                    let _ = fs::remove_file(&temp_html);
                    let styled = wrap_html_with_card_theme(&html, file_name);
                    return Some((styled, None));
                }
            }
        }
        let _ = fs::remove_file(&temp_html);
    }

    // Strategy 4: Fallback to extracted text if available
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "docx" {
        if let Some((text, _, _, _)) = extract_docx_text(path) {
            let mut paragraphs_html = String::new();
            for line in text.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    let escaped = trimmed
                        .replace('&', "&amp;")
                        .replace('<', "&lt;")
                        .replace('>', "&gt;")
                        .replace('"', "&quot;");
                    paragraphs_html.push_str(&format!(
                        r#"<p style="margin-bottom: 1.2em; line-height: 1.8; text-indent: 2em;">{}</p>"#,
                        escaped
                    ));
                }
            }
            let styled = wrap_html_with_card_theme(&paragraphs_html, file_name);
            return Some((styled, None));
        }
    }

    None
}

pub fn generate_thumbnail_base64(path: &Path) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let temp_dir = std::env::temp_dir().join(format!(
            "doctools_thumb_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ));
        let _ = fs::create_dir_all(&temp_dir);

        let output = std::process::Command::new("qlmanage")
            .args(["-t", "-s", "800", "-o"])
            .arg(&temp_dir)
            .arg(path)
            .output();

        if output.is_ok() {
            let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let expected_thumb = temp_dir.join(format!("{}.png", file_name));

            if expected_thumb.exists() {
                if let Ok(bytes) = fs::read(&expected_thumb) {
                    let b64 = BASE64_STANDARD.encode(&bytes);
                    let _ = fs::remove_dir_all(&temp_dir);
                    return Some(format!("data:image/png;base64,{}", b64));
                }
            }

            // Search for any generated png in temp_dir
            if let Ok(entries) = fs::read_dir(&temp_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.extension().and_then(|s| s.to_str()) == Some("png") {
                        if let Ok(bytes) = fs::read(&p) {
                            let b64 = BASE64_STANDARD.encode(&bytes);
                            let _ = fs::remove_dir_all(&temp_dir);
                            return Some(format!("data:image/png;base64,{}", b64));
                        }
                    }
                }
            }
        }
        let _ = fs::remove_dir_all(&temp_dir);
    }

    None
}

fn extract_docx_text(path: &Path) -> Option<(String, usize, usize, usize)> {
    let file = fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut doc_xml = archive.by_name("word/document.xml").ok()?;
    let mut content = String::new();
    doc_xml.read_to_string(&mut content).ok()?;

    let with_newlines = content.replace("</w:p>", "\n");
    let re = regex::Regex::new(r"<[^>]+>").ok()?;
    let plain_text = re.replace_all(&with_newlines, "").to_string();

    let cleaned = plain_text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");

    let lines: Vec<&str> = cleaned
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    let paragraph_count = lines.len();
    let joined = lines.join("\n\n");
    let word_count = joined.split_whitespace().count();
    let char_count = joined.chars().count();

    // Limit text to first 8000 characters to prevent memory explosion
    let preview_text = if joined.chars().count() > 8000 {
        let truncated: String = joined.chars().take(8000).collect();
        format!(
            "{}...\n\n[已截取前 8000 字符预览，可使用系统应用查看完整内容]",
            truncated
        )
    } else {
        joined
    };

    Some((preview_text, paragraph_count, word_count, char_count))
}

pub fn get_document_preview(path_str: &str) -> Result<DocumentPreviewData, String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(format!("文件不存在: {}", path_str));
    }

    let metadata = fs::metadata(path).map_err(|e| format!("读取文件属性失败: {}", e))?;
    let size = metadata.len();
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
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut page_count: Option<u32> = None;
    let mut mime_type = "application/octet-stream".to_string();
    let mut data_url: Option<String> = None;
    let mut thumbnail_url: Option<String> = None;
    let mut text_content: Option<String> = None;
    let mut html_content: Option<String> = None;
    let mut meta_json = serde_json::json!({});

    match extension.as_str() {
        "pdf" => {
            mime_type = "application/pdf".to_string();

            // 1. Load lopdf document to inspect page count and metadata
            if let Ok(doc) = lopdf::Document::load(path) {
                let pages = doc.get_pages();
                page_count = Some(pages.len() as u32);

                let mut pdf_meta = serde_json::Map::new();
                pdf_meta.insert("page_count".to_string(), serde_json::json!(pages.len()));

                if let Ok(info_ref) = doc.trailer.get(b"Info") {
                    let info_dict: Option<&lopdf::Dictionary> = match info_ref {
                        lopdf::Object::Reference(id) => {
                            doc.get_object(*id).ok().and_then(|o| o.as_dict().ok())
                        }
                        lopdf::Object::Dictionary(dict) => Some(dict),
                        _ => None,
                    };

                    if let Some(dict) = info_dict {
                        if let Ok(title) = dict.get(b"Title").and_then(|o| o.as_str()) {
                            pdf_meta.insert(
                                "title".to_string(),
                                serde_json::json!(String::from_utf8_lossy(title)),
                            );
                        }
                        if let Ok(author) = dict.get(b"Author").and_then(|o| o.as_str()) {
                            pdf_meta.insert(
                                "author".to_string(),
                                serde_json::json!(String::from_utf8_lossy(author)),
                            );
                        }
                        if let Ok(creator) = dict.get(b"Creator").and_then(|o| o.as_str()) {
                            pdf_meta.insert(
                                "creator".to_string(),
                                serde_json::json!(String::from_utf8_lossy(creator)),
                            );
                        }
                        if let Ok(producer) = dict.get(b"Producer").and_then(|o| o.as_str()) {
                            pdf_meta.insert(
                                "producer".to_string(),
                                serde_json::json!(String::from_utf8_lossy(producer)),
                            );
                        }
                    }
                }
                meta_json = serde_json::Value::Object(pdf_meta);
            }

            // 2. Generate high-res cover thumbnail
            thumbnail_url = generate_thumbnail_base64(path);

            // 3. If file size <= 60MB, provide base64 data url for embedded PDF viewer in WKWebView
            if size <= 60 * 1024 * 1024 {
                if let Ok(bytes) = fs::read(path) {
                    let b64 = BASE64_STANDARD.encode(&bytes);
                    data_url = Some(format!("data:application/pdf;base64,{}", b64));
                }
            }
        }
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "tiff" | "gif" => {
            mime_type = match extension.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "bmp" => "image/bmp",
                "tiff" => "image/tiff",
                "gif" => "image/gif",
                _ => "image/png",
            }
            .to_string();

            // Get image dimensions
            if let Ok((width, height)) = image::image_dimensions(path) {
                meta_json = serde_json::json!({
                    "width": width,
                    "height": height,
                    "aspect_ratio": format!("{:.2}", (width as f64) / (height.max(1) as f64)),
                });
            }

            // Read image bytes for rendering
            if size <= 25 * 1024 * 1024 {
                if let Ok(bytes) = fs::read(path) {
                    let b64 = BASE64_STANDARD.encode(&bytes);
                    let url = format!("data:{};base64,{}", mime_type, b64);
                    data_url = Some(url.clone());
                    thumbnail_url = Some(url);
                }
            } else {
                thumbnail_url = generate_thumbnail_base64(path);
            }
        }
        "docx" | "doc" | "xlsx" | "xls" | "pptx" | "ppt" => {
            mime_type = match extension.as_str() {
                "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "doc" => "application/msword",
                "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "xls" => "application/vnd.ms-excel",
                "pptx" => {
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                }
                "ppt" => "application/vnd.ms-powerpoint",
                _ => "application/octet-stream",
            }
            .to_string();

            // 1. Generate full multi-page rendered HTML preview
            if let Some((html, est_pages)) = generate_office_preview_html(path) {
                if est_pages.is_some() {
                    page_count = est_pages;
                }
                let b64 = BASE64_STANDARD.encode(html.as_bytes());
                data_url = Some(format!("data:text/html;charset=utf-8;base64,{}", b64));
                html_content = Some(html);
            }

            // 2. Generate cover thumbnail as fallback
            thumbnail_url = generate_thumbnail_base64(path);

            // 3. If docx, extract text and paragraphs
            if extension == "docx" {
                if let Some((text, p_count, w_count, c_count)) = extract_docx_text(path) {
                    text_content = Some(text);
                    let mut office_meta = serde_json::Map::new();
                    office_meta.insert("paragraph_count".to_string(), serde_json::json!(p_count));
                    office_meta.insert("word_count".to_string(), serde_json::json!(w_count));
                    office_meta.insert("character_count".to_string(), serde_json::json!(c_count));
                    if let Some(pc) = page_count {
                        office_meta.insert("page_count".to_string(), serde_json::json!(pc));
                    }
                    meta_json = serde_json::Value::Object(office_meta);
                }
            }
        }
        _ => {
            // Generic supported format
            thumbnail_url = generate_thumbnail_base64(path);
        }
    }

    Ok(DocumentPreviewData {
        path: path_str.to_string(),
        name,
        extension,
        size,
        modified,
        page_count,
        mime_type,
        data_url,
        thumbnail_url,
        text_content,
        html_content,
        metadata: meta_json,
    })
}
