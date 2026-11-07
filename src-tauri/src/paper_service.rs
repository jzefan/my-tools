use crate::models::OperationResult;
use lopdf::{Document, Object};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::io::Write;
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPaper {
    pub path: String,
    pub source_path: String,
    pub name: String,
    pub sha256: String,
    pub size: u64,
}

pub fn import_paper_file(path: &str) -> Result<ImportedPaper, String> {
    import_paper_to_dir(Path::new(path), &get_paper_data_dir()?.join("assets"))
}

fn import_paper_to_dir(source: &Path, dir: &Path) -> Result<ImportedPaper, String> {
    let ext = source.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    if !["pdf", "docx", "doc"].contains(&ext.as_str()) { return Err("请选择 PDF 或 Word 文档".into()); }
    let bytes = fs::read(source).map_err(|e| format!("读取文档失败: {}", e))?;
    let valid = match ext.as_str() {
        "pdf" => bytes.starts_with(b"%PDF-"),
        "docx" => bytes.starts_with(b"PK\x03\x04"),
        _ => bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    };
    if !valid { return Err("文档内容与文件格式不符".into()); }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("{}.{}", hash, ext));
    // A managed copy remains readable after the original file is moved.
    if !target.exists() || fs::read(&target).map(|stored| stored != bytes).unwrap_or(true) {
        let temporary = target.with_extension(format!("{}.tmp", ext));
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
        sync_directory(dir)?;
    }
    Ok(ImportedPaper {
        path: target.to_string_lossy().into_owned(),
        source_path: source.to_string_lossy().into_owned(),
        name: source.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        sha256: hash, size: bytes.len() as u64,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BurnAnnotationItem {
    pub page_no: u32,
    pub rects: Vec<BurnRect>,
    pub color_rgba: [f32; 4], // e.g. [1.0, 1.0, 0.0, 0.4] for yellow highlight
    pub note_text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BurnRect {
    pub x: f64, // 0..1 canonical coordinate
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BurnAnnotationsRequest {
    pub input_pdf_path: String,
    pub output_pdf_path: String,
    pub annotations: Vec<BurnAnnotationItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PageEditItem {
    pub original_page_no: u32,
    pub rotation: i32, // 0, 90, 180, 270
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReorderPagesRequest {
    pub input_pdf_path: String,
    pub output_pdf_path: String,
    pub pages: Vec<PageEditItem>,
}

fn get_paper_data_dir() -> Result<PathBuf, String> {
    let mut dir = dirs::data_dir().ok_or_else(|| "无法确定资料库目录".to_string())?;
    dir.push("doc-tools");
    dir.push("paper_library");
    fs::create_dir_all(&dir).map_err(|e| format!("无法访问资料库目录: {}", e))?;
    Ok(dir)
}

pub fn paper_data_directory() -> Result<String, String> {
    Ok(get_paper_data_dir()?.to_string_lossy().into_owned())
}

fn hash_string(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::Hasher;
    let mut hasher = DefaultHasher::new();
    hasher.write(s.as_bytes());
    format!("{:016x}", hasher.finish())
}

/// Ensure a document is available as PDF. If already PDF, returns original path.
/// If Word (.docx / .doc), converts and caches in paper_library/word_cache/.
pub fn get_or_convert_to_pdf(path: &Path) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("文件不存在: {}", path.to_string_lossy()));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if ext == "pdf" {
        return Ok(path.to_path_buf());
    }

    if ext == "docx" || ext == "doc" {
        let cache_dir = get_paper_data_dir()?.join("word_cache");
        let _ = fs::create_dir_all(&cache_dir);

        let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
        let mtime = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let file_stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("document");
        let hash_input = format!("{}:{}:{}", path.to_string_lossy(), metadata.len(), mtime);
        let hash_val = hash_string(&hash_input);
        let cached_pdf_path = cache_dir.join(format!("{}_{}.pdf", file_stem, hash_val));

        let cache_valid = if cached_pdf_path.exists() {
            if let Ok(c_meta) = fs::metadata(&cached_pdf_path) {
                if c_meta.len() > 0 {
                    let c_mtime = c_meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    c_mtime >= mtime
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            false
        };

        if !cache_valid {
            crate::pdf_convert::convert_single_word_to_pdf(path, &cached_pdf_path)
                .map_err(|e| format!("Word 文档排版转换失败: {}", e))?;
        }

        return Ok(cached_pdf_path);
    }

    Err(format!("不支持的文档格式: .{}", ext))
}

/// Read arbitrary local binary file (PDF, DOCX, DOC) directly into byte vector for instant frontend rendering
pub fn read_binary_file(path_str: &str) -> Result<Vec<u8>, String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(format!("文件不存在: {}", path_str));
    }
    // Binary .doc uses OLE, which the browser's DOCX renderer cannot open.
    // Preserve DOCX bytes; only legacy Word documents need an installed converter.
    let converted;
    let readable = if path.extension().and_then(|s| s.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("doc")) {
        converted = get_or_convert_to_pdf(path)
            .map_err(|e| format!("读取 .doc 需要可用的 Word 或 LibreOffice 转换引擎: {}", e))?;
        converted.as_path()
    } else { path };
    fs::read(readable).map_err(|e| format!("读取文档内容失败 [{}]: {}", path_str, e))
}

pub fn read_paper_file(path: &str, sha256: &str) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if format!("{:x}", Sha256::digest(&bytes)) != sha256 {
        return Err("论文文件已改变，请重新导入后阅读".into());
    }
    if Path::new(path).extension().and_then(|s| s.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("doc")) {
        read_binary_file(path)
    } else { Ok(bytes) }
}

/// Save paper library state JSON
pub fn save_paper_library_data(data: &str) -> Result<(), String> {
    let dir = get_paper_data_dir()?;
    save_library_to_dir(&dir, data)
}

pub fn save_library_to_dir(dir: &Path, data: &str) -> Result<(), String> {
    validate_library_json(data)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let file_path = dir.join("library.json");
    let temp_path = dir.join("library.json.tmp");
    let mut file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
    file.write_all(data.as_bytes()).and_then(|_| file.sync_all())
        .map_err(|e| format!("写入资料库临时文件失败: {}", e))?;
    if let Some(mut previous) = fs::read_to_string(&file_path).ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()) {
        // Migrate historical libraries without copying plaintext credentials into backups.
        if let Some(config) = previous.get_mut("aiConfig").and_then(|value| value.as_object_mut()) {
            config.remove("apiKey");
        }
        let backup_tmp = dir.join("library.json.bak.tmp");
        let mut backup = fs::File::create(&backup_tmp).map_err(|e| e.to_string())?;
        backup.write_all(&serde_json::to_vec(&previous).map_err(|e| e.to_string())?)
            .and_then(|_| backup.sync_all()).map_err(|e| e.to_string())?;
        fs::rename(backup_tmp, dir.join("library.json.bak")).map_err(|e| e.to_string())?;
    }
    fs::rename(&temp_path, &file_path).map_err(|e| format!("持久化资料库失败: {}", e))?;
    sync_directory(dir)?;
    Ok(())
}

/// Load paper library state JSON
pub fn load_paper_library_data() -> Result<String, String> {
    let dir = get_paper_data_dir()?;
    load_library_from_dir(&dir)
}

pub fn load_library_from_dir(dir: &Path) -> Result<String, String> {
    let file_path = dir.join("library.json");
    let backup = dir.join("library.json.bak");
    if !file_path.try_exists().map_err(|e| e.to_string())? && !backup.try_exists().map_err(|e| e.to_string())? {
        return Ok("{}".to_string());
    }
    for candidate in [&file_path, &backup] {
        if let Ok(data) = fs::read_to_string(candidate) {
            if validate_library_json(&data).is_ok() { return Ok(data); }
        }
    }
    Err("资料库损坏，无法读取备份".into())
}

fn validate_library_json(data: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(data).map_err(|e| format!("资料库格式无效: {}", e))?;
    let Some(object) = value.as_object() else { return Err("资料库格式无效".into()); };
    if !object.is_empty() && !value.get("papers").is_some_and(|papers| papers.is_array()) {
        return Err("论文列表格式无效".into());
    }
    Ok(())
}

fn sync_directory(dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(dir).and_then(|file| file.sync_all()).map_err(|e| e.to_string())?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

/// Export edited paper pages (reorder, rotate, delete)
pub fn export_edited_pdf_pages(request: ReorderPagesRequest) -> Result<OperationResult, String> {
    let input_path = Path::new(&request.input_pdf_path);
    let pdf_path = get_or_convert_to_pdf(input_path)?;

    let mut doc = Document::load(&pdf_path).map_err(|e| format!("加载 PDF 失败: {}", e))?;
    let orig_pages = doc.get_pages();
    let total_pages = orig_pages.len() as u32;

    if request.pages.is_empty() {
        return Err("页面列表为空，无法生成新 PDF".to_string());
    }

    let mut seen = std::collections::HashSet::new();
    for item in &request.pages {
        if !orig_pages.contains_key(&item.original_page_no) {
            return Err(format!(
                "页码超出范围: {} (共 {} 页)",
                item.original_page_no, total_pages
            ));
        }
        if !seen.insert(item.original_page_no) {
            return Err(format!("重复页码: {}", item.original_page_no));
        }
        if ![0, 90, 180, 270].contains(&item.rotation) {
            return Err(format!("无效的旋转角度: {}", item.rotation));
        }
    }

    // Flatten the selected leaves only after resolving inheritable attributes from
    // their original ancestors. Changing Parent first would lose these values.
    let pages_id = doc.new_object_id();
    let mut kids = Vec::new();
    for item in &request.pages {
        let page_id = orig_pages[&item.original_page_no];
        let mut page = doc
            .get_dictionary(page_id)
            .map_err(|e| e.to_string())?
            .clone();
        for key in [b"Resources".as_slice(), b"MediaBox", b"CropBox", b"Rotate"] {
            let mut ancestor = page_id;
            let mut visited = std::collections::HashSet::new();
            loop {
                if !visited.insert(ancestor) {
                    return Err("PDF 页面继承结构存在循环".to_string());
                }
                let dict = doc.get_dictionary(ancestor).map_err(|e| e.to_string())?;
                if let Ok(value) = dict.get(key) {
                    page.set(key.to_vec(), value.clone());
                    break;
                }
                match dict.get(b"Parent").and_then(Object::as_reference) {
                    Ok(parent) => ancestor = parent,
                    Err(_) => break,
                }
            }
        }
        let rotation = match page.get(b"Rotate") {
            Ok(value) => doc
                .dereference(value)
                .and_then(|(_, value)| value.as_i64())
                .map_err(|e| format!("无效的页面旋转属性: {}", e))?,
            Err(_) => 0,
        };
        page.set(
            "Rotate",
            (rotation + i64::from(item.rotation)).rem_euclid(360),
        );
        page.set("Parent", pages_id);
        doc.objects.insert(page_id, Object::Dictionary(page));
        kids.push(Object::Reference(page_id));
    }
    doc.objects.insert(
        pages_id,
        lopdf::dictionary! {
            "Type" => "Pages", "Kids" => kids, "Count" => request.pages.len() as i64
        }
        .into(),
    );
    let catalog_id = doc
        .trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .map_err(|e| e.to_string())?;
    doc.get_object_mut(catalog_id)
        .and_then(Object::as_dict_mut)
        .map_err(|e| e.to_string())?
        .set("Pages", pages_id);
    doc.prune_objects();

    let output_path = Path::new(&request.output_pdf_path);
    if let Some(parent) = output_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    doc.save(output_path)
        .map_err(|e| format!("保存编辑后的 PDF 失败: {}", e))?;

    let output_size = fs::metadata(output_path).map(|m| m.len()).unwrap_or(0);

    Ok(OperationResult {
        success: true,
        message: format!(
            "已成功重排并导出 {} 页的 PDF 文档 (文件大小: {} 字节)",
            request.pages.len(),
            output_size
        ),
        output_path: Some(request.output_pdf_path),
        details: None,
    })
}

/// Save markdown text to target file
pub fn save_markdown_file(path_str: &str, content: &str) -> Result<OperationResult, String> {
    let path = Path::new(path_str);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(path, content).map_err(|e| format!("写入文件失败 [{}]: {}", path_str, e))?;
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    Ok(OperationResult {
        success: true,
        message: format!("成功导出 Markdown 笔记文件至: {}", path_str),
        output_path: Some(path_str.to_string()),
        details: Some(serde_json::json!({ "size": size })),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_paper_library_save_and_load() {
        let temp_dir = std::env::temp_dir().join(format!("test_paper_lib_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let test_json = r#"{"papers":[{"id":"p1","path":"/test/p1.pdf","title":"Attention Is All You Need"}],"annotations":{}}"#;
        assert!(save_library_to_dir(&temp_dir, test_json).is_ok());
        let loaded = load_library_from_dir(&temp_dir).unwrap();
        assert!(loaded.contains("Attention Is All You Need"));
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_save_markdown_file() {
        let dir = std::env::temp_dir().join(format!("test_paper_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let md_path = dir.join("notes.md");
        let content = "# Research Notes\nKey finding: 99.8% accuracy";
        let res = save_markdown_file(md_path.to_str().unwrap(), content).unwrap();
        assert!(res.success);
        let read = fs::read_to_string(&md_path).unwrap();
        assert_eq!(read, content);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn managed_import_deduplicates_bytes_and_survives_source_removal() {
        let root = std::env::temp_dir().join(format!("paper_import_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let source = root.join("one.pdf");
        fs::write(&source, b"%PDF-1.7\nfixture").unwrap();
        let first = import_paper_to_dir(&source, &root.join("assets")).unwrap();
        let another = root.join("two.pdf");
        fs::copy(&source, &another).unwrap();
        let second = import_paper_to_dir(&another, &root.join("assets")).unwrap();
        assert_eq!(first.path, second.path);
        assert_eq!(first.sha256.len(), 64);
        fs::remove_file(source).unwrap();
        assert_eq!(fs::read(&first.path).unwrap(), b"%PDF-1.7\nfixture");
        assert!(read_paper_file(&first.path, &first.sha256).is_ok());
        fs::write(&first.path, b"%PDF-1.7\ntampered").unwrap();
        assert!(read_paper_file(&first.path, &first.sha256).is_err());
        fs::write(&another, b"not a PDF").unwrap();
        assert!(import_paper_to_dir(&another, &root.join("assets")).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn library_recovers_backup_and_rejects_invalid_write() {
        let root = std::env::temp_dir().join(format!("paper_backup_{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        save_library_to_dir(&root, r#"{"papers":[],"aiConfig":{"apiKey":"secret"}}"#).unwrap();
        save_library_to_dir(&root, r#"{"papers":[{"id":"new"}]}"#).unwrap();
        assert!(!fs::read_to_string(root.join("library.json.bak")).unwrap().contains("secret"));
        assert!(save_library_to_dir(&root, "broken").is_err());
        assert!(load_library_from_dir(&root).unwrap().contains("new"));
        fs::write(root.join("library.json"), "broken").unwrap();
        assert!(load_library_from_dir(&root).unwrap().contains("papers"));
        fs::write(root.join("library.json.bak"), "broken").unwrap();
        assert!(load_library_from_dir(&root).is_err());
        let _ = fs::remove_dir_all(root);
    }
}

pub fn save_ai_key(provider: &str, key: &str) -> Result<(), String> {
    if !["openai", "deepseek", "qwen", "siliconflow", "custom"].contains(&provider) || key.len() > 10_000 {
        return Err("AI 配置无效".into());
    }
    #[cfg(target_os = "macos")]
    {
        security_framework::passwords::set_generic_password("doc-tools.paper-ai", provider, key.as_bytes())
            .map_err(|_| "系统凭据不可用，密钥仅在本次会话中使用".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Security::Credentials::*;
        let mut target: Vec<u16> = format!("doc-tools.paper-ai/{}", provider).encode_utf16().chain(Some(0)).collect();
        let mut user: Vec<u16> = provider.encode_utf16().chain(Some(0)).collect();
        let mut secret = key.as_bytes().to_vec();
        let credential = CREDENTIALW { Type: CRED_TYPE_GENERIC, TargetName: target.as_mut_ptr(),
            UserName: user.as_mut_ptr(), CredentialBlobSize: secret.len() as u32,
            CredentialBlob: secret.as_mut_ptr(), Persist: CRED_PERSIST_LOCAL_MACHINE, ..Default::default() };
        let saved = unsafe { CredWriteW(&credential, 0) };
        secret.fill(0);
        if saved == 0 { Err("系统凭据不可用，密钥仅在本次会话中使用".into()) } else { Ok(()) }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { let _ = key; Err("密钥仅在本次会话中使用".into()) }
}

pub fn load_ai_key(provider: &str) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let value = security_framework::passwords::get_generic_password("doc-tools.paper-ai", provider)
            .unwrap_or_default();
        String::from_utf8(value).map_err(|_| "系统凭据无效".into())
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Security::Credentials::*;
        let target: Vec<u16> = format!("doc-tools.paper-ai/{}", provider).encode_utf16().chain(Some(0)).collect();
        let mut credential = std::ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 { return Ok(String::new()); }
        let bytes = unsafe { std::slice::from_raw_parts((*credential).CredentialBlob, (*credential).CredentialBlobSize as usize) }.to_vec();
        unsafe { CredFree(credential.cast()); }
        String::from_utf8(bytes).map_err(|_| "系统凭据无效".into())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { let _ = provider; Ok(String::new()) }
}
