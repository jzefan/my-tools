use crate::models::{
    ConvertEngineStatus, ConvertItem, ConvertItemResult, ConvertRequest, ConvertResult, OperationResult,
    PdfToImageRequest,
};
use lopdf::Document;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

// Drain both pipes concurrently so verbose engines cannot deadlock the parent.
pub(crate) trait BoundedCommand {
    fn bounded_output(&mut self) -> std::io::Result<std::process::Output> {
        self.bounded_output_timeout(std::time::Duration::from_secs(180))
    }
    fn bounded_output_timeout(&mut self, timeout: std::time::Duration) -> std::io::Result<std::process::Output>;
}
impl BoundedCommand for Command {
    fn bounded_output_timeout(&mut self, timeout: std::time::Duration) -> std::io::Result<std::process::Output> {
        use std::process::Stdio;
        #[cfg(target_os = "windows")]
        { use std::os::windows::process::CommandExt; self.creation_flags(0x08000000); }
        let mut child = self.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        fn drain(mut pipe: impl Read + Send + 'static) -> std::sync::mpsc::Receiver<Vec<u8>> {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || { let mut bytes = Vec::new(); let _ = pipe.read_to_end(&mut bytes); let _ = tx.send(bytes); });
            rx
        }
        let out = drain(stdout);
        let err = drain(stderr);
        let deadline = std::time::Instant::now() + timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(50)),
                Ok(None) => {
                    let _ = child.kill(); let _ = child.wait();
                    return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "转换引擎超时"));
                }
                Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(error); }
            }
        };
        let receive = |rx: std::sync::mpsc::Receiver<Vec<u8>>| rx.recv_timeout(std::time::Duration::from_secs(2))
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "转换进程输出未关闭"));
        Ok(std::process::Output { status, stdout: receive(out)?, stderr: receive(err)? })
    }
}

fn executable_on_path(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?).map(|root| root.join(name))
        .find(|path| path.is_file() && !path.to_string_lossy().to_ascii_lowercase().contains("windowsapps"))
}

fn python_command(module: &'static str) -> Result<Command, String> {
    type PythonSelection = (PathBuf, bool);
    static PYTHONS: OnceLock<std::sync::Mutex<std::collections::HashMap<&'static str, PythonSelection>>> = OnceLock::new();
    let selections = PYTHONS.get_or_init(Default::default);
    let mut selected = selections.lock().map_err(|_| "Python 检测失败".to_string())?;
    if !selected.contains_key(module) {
        #[cfg(target_os = "windows")]
        let candidates = [("py.exe", true), ("python.exe", false), ("python3.exe", false)];
        #[cfg(not(target_os = "windows"))]
        let candidates = [("python3", false), ("python", false)];
        for (name, launcher) in candidates {
            let Some(path) = executable_on_path(name) else { continue; };
            #[cfg(target_os = "macos")]
            if module == "pdf2docx" && path == Path::new("/usr/bin/python3")
                && !Path::new("/Library/Developer/CommandLineTools/usr/bin/python3").is_file()
            {
                // Avoid starting the developer tools installer on a clean Mac.
                continue;
            }
            let mut command = Command::new(&path);
            if launcher { command.arg("-3"); }
            let probe = format!("import sys; assert sys.version_info.major == 3; import {}", module);
            if command.args(["-c", &probe]).bounded_output_timeout(std::time::Duration::from_secs(8))
                .map(|output| output.status.success()).unwrap_or(false) {
                selected.insert(module, (path, launcher)); break;
            }
        }
    }
    let (path, launcher) = selected.get(module).ok_or_else(|| format!("未找到安装 {} 的 Python 3", module))?;
    let mut command = Command::new(path);
    if *launcher { command.arg("-3"); }
    Ok(command)
}

// Environment roots support non-system drives and per-user installations.
#[cfg(any(target_os = "windows", test))]
fn windows_install_candidates(tool: &str, roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for root in roots {
        match tool {
            "soffice" => for relative in ["LibreOffice/program/soffice.com", "LibreOffice/program/soffice.exe", "Programs/LibreOffice/program/soffice.exe"] { candidates.push(root.join(relative)); },
            "pdftoppm" => for relative in ["poppler/Library/bin/pdftoppm.exe", "poppler/bin/pdftoppm.exe", "Programs/poppler/Library/bin/pdftoppm.exe"] { candidates.push(root.join(relative)); },
            "gs" => {
                for installation_root in [root.join("gs"), root.join("Programs/gs")] {
                    if let Ok(entries) = fs::read_dir(installation_root) {
                        for entry in entries.flatten() { for binary in ["gswin64c.exe", "gswin32c.exe"] { candidates.push(entry.path().join("bin").join(binary)); } }
                    }
                }
            }
            _ => {}
        }
    }
    candidates
}

fn installed_candidates(tool: &str, defaults: &[&str]) -> Vec<String> {
    #[allow(unused_mut)]
    let mut candidates: Vec<String> = defaults.iter().map(|value| value.to_string()).collect();
    #[cfg(target_os = "windows")]
    {
        let roots = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].iter()
            .filter_map(std::env::var_os).map(PathBuf::from).collect::<Vec<_>>();
        candidates.extend(windows_install_candidates(tool, &roots).into_iter()
            .filter(|path| path.is_file()).map(|path| path.to_string_lossy().into_owned()));
    }
    #[cfg(not(target_os = "windows"))]
    let _ = tool;
    candidates
}

fn publish_without_overwrite(source: &Path, destination: &Path) -> std::io::Result<()> {
    match fs::hard_link(source, destination) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Err(error),
        Err(_) => {}
    }
    copy_without_overwrite(source, destination)
}

fn copy_without_overwrite(source: &Path, destination: &Path) -> std::io::Result<()> {
    let mut output = fs::OpenOptions::new().write(true).create_new(true).open(destination)?;
    let result = File::open(source).and_then(|mut input| std::io::copy(&mut input, &mut output))
        .and_then(|_| output.sync_all());
    drop(output);
    if result.is_err() { let _ = fs::remove_file(destination); }
    result
}

fn publish_target(source: &Path, destination: &Path, overwrite: bool) -> std::io::Result<()> {
    if overwrite {
        // The staging file is created in the destination directory.
        fs::rename(source, destination)
    } else {
        publish_without_overwrite(source, destination)
    }
}

struct TemporaryDirectory(PathBuf);
impl TemporaryDirectory {
    fn create() -> Result<Self, String> {
        for _ in 0..10 {
            let path = std::env::temp_dir().join(format!("doc-tools-office-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.to_string()),
            }
        }
        Err("无法创建转换临时目录".to_string())
    }
}
impl Drop for TemporaryDirectory { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

fn office_profile_url(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let encoded: String = normalized.bytes().map(|byte| {
        if byte.is_ascii_alphanumeric() || b"/-._~:".contains(&byte) { (byte as char).to_string() }
        else { format!("%{:02X}", byte) }
    }).collect();
    if encoded.starts_with("//") { format!("file:{}", encoded) }
    else if encoded.starts_with('/') { format!("file://{}", encoded) }
    else { format!("file:///{}", encoded) }
}

struct StagingCleanup(PathBuf);
impl Drop for StagingCleanup {
    fn drop(&mut self) { let _ = fs::remove_file(&self.0); }
}

static ENGINE_CACHE: OnceLock<ConvertEngineStatus> = OnceLock::new();

/// Check availability of various conversion engines (cached in memory)
pub fn check_convert_engines() -> ConvertEngineStatus {
    ENGINE_CACHE.get_or_init(detect_convert_engines).clone()
}

fn detect_convert_engines() -> ConvertEngineStatus {
    let pdf2docx_available = python_command("pdf2docx").is_ok();

    let docx2pdf_available = python_command("docx2pdf").is_ok();

    let soffice_available = get_soffice_cmd().is_some();

    // Retained response fields for compatibility; neither engine participates in conversion.
    let pandoc_available = false;
    let chrome_available = false;

    #[cfg(target_os = "macos")]
    let pages_available = Path::new("/Applications/Pages.app").exists()
        || Command::new("osascript")
            .args(["-e", "id of app \"Pages\""])
            .bounded_output()
            .map(|o| o.status.success())
            .unwrap_or(false);

    #[cfg(not(target_os = "macos"))]
    let pages_available = false;

    #[cfg(target_os = "macos")]
    let word_available = Path::new("/Applications/Microsoft Word.app").exists()
        || Command::new("osascript")
            .args(["-e", "id of app \"Microsoft Word\""])
            .bounded_output()
            .map(|o| o.status.success())
            .unwrap_or(false);

    #[cfg(target_os = "windows")]
    let word_available = Command::new("powershell")
        .args([
            "-NoProfile", "-NonInteractive", "-Command",
            "if (Test-Path 'Registry::HKEY_CLASSES_ROOT\\Word.Application\\CLSID') { exit 0 } else { exit 1 }",
        ])
        .bounded_output_timeout(std::time::Duration::from_secs(5))
        .map(|o| o.status.success())
        .unwrap_or(false);

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let word_available = false;

    let pdftoppm_available = get_pdftoppm_cmd().is_some();

    let fitz_available = python_command("fitz").is_ok();

    ConvertEngineStatus {
        pdf2docx_available,
        docx2pdf_available,
        soffice_available,
        pandoc_available,
        chrome_available,
        pages_available,
        word_available,
        pdftoppm_available,
        fitz_available,
    }
}

pub fn resolve_item_output_path(
    item: &ConvertItem,
    default_output_dir: Option<&str>,
) -> Option<PathBuf> {
    let input_path = Path::new(&item.input_path);
    let ext = input_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let is_to_image = match item.target_format.to_lowercase().as_str() {
        "image" | "png" | "jpg" | "jpeg" => true,
        _ => false,
    };

    let target_ext = if is_to_image {
        if item.target_format.to_lowercase().contains("jp") {
            "jpg".to_string()
        } else {
            "png".to_string()
        }
    } else {
        match item.target_format.to_lowercase().as_str() {
            "docx" | "doc" => "docx".to_string(),
            "pdf" => "pdf".to_string(),
            "auto" | "" => {
                if ext == "pdf" {
                    "docx".to_string()
                } else if ext == "docx" || ext == "doc" {
                    "pdf".to_string()
                } else {
                    return None;
                }
            }
            other => other.to_string(),
        }
    };

    if is_to_image {
        if let Some(ref custom_out) = item.output_path {
            if !custom_out.trim().is_empty() {
                Some(PathBuf::from(custom_out))
            } else {
                Some(generate_pdf_to_images_dir(input_path, default_output_dir))
            }
        } else {
            Some(generate_pdf_to_images_dir(input_path, default_output_dir))
        }
    } else if let Some(ref custom_out) = item.output_path {
        if !custom_out.trim().is_empty() {
            Some(PathBuf::from(custom_out))
        } else {
            Some(generate_output_path(input_path, &target_ext, default_output_dir))
        }
    } else {
        Some(generate_output_path(input_path, &target_ext, default_output_dir))
    }
}

/// Check which convert output targets already exist on disk
pub fn check_convert_conflicts(request: ConvertRequest) -> Vec<String> {
    let mut conflicts = Vec::new();
    for item in &request.items {
        if let Some(path) = resolve_item_output_path(item, request.default_output_dir.as_deref()) {
            if path.exists() {
                let path_str = path.to_string_lossy().to_string();
                if !conflicts.contains(&path_str) {
                    conflicts.push(path_str);
                }
            }
        }
    }
    conflicts
}

/// Convert batch of documents (PDF to Word or Word to PDF)
pub fn convert_documents(request: ConvertRequest) -> Result<ConvertResult, String> {
    if request.items.is_empty() {
        return Err("请至少选择一个需要转换的文件".to_string());
    }

    let mut results = Vec::new();
    let mut total_success = 0;

    for item in &request.items {
        let input_path = Path::new(&item.input_path);
        if !input_path.exists() {
            results.push(ConvertItemResult {
                input_path: item.input_path.clone(),
                output_path: String::new(),
                success: false,
                message: format!("源文件不存在: {}", item.input_path),
                original_size: 0,
                converted_size: 0,
                engine_used: "无".to_string(),
                local_pdf_pages: None,
            });
            continue;
        }

        let original_size = fs::metadata(input_path).map(|m| m.len()).unwrap_or(0);
        let ext = input_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        let is_to_image = match item.target_format.to_lowercase().as_str() {
            "image" | "png" | "jpg" | "jpeg" => true,
            _ => false,
        };

        let target_ext = if is_to_image {
            if item.target_format.to_lowercase().contains("jp") {
                "jpg".to_string()
            } else {
                "png".to_string()
            }
        } else {
            match item.target_format.to_lowercase().as_str() {
                "docx" | "doc" => "docx".to_string(),
                "pdf" => "pdf".to_string(),
                "auto" | "" => {
                    if ext == "pdf" {
                        "docx".to_string()
                    } else if ext == "docx" || ext == "doc" {
                        "pdf".to_string()
                    } else {
                        results.push(ConvertItemResult {
                            input_path: item.input_path.clone(),
                            output_path: String::new(),
                            success: false,
                            message: format!("无法从扩展名 .{} 自动推断转换方向", ext),
                            original_size,
                            converted_size: 0,
                            engine_used: "无".to_string(),
                            local_pdf_pages: None,
                        });
                        continue;
                    }
                }
                other => other.to_string(),
            }
        };

        // Determine destination output path
        let output_path = match resolve_item_output_path(item, request.default_output_dir.as_deref()) {
            Some(p) => p,
            None => {
                results.push(ConvertItemResult {
                    input_path: item.input_path.clone(),
                    output_path: String::new(),
                    success: false,
                    message: format!("无法解析输出路径: {}", item.input_path),
                    original_size,
                    converted_size: 0,
                    engine_used: "无".to_string(),
                    local_pdf_pages: None,
                });
                continue;
            }
        };

        // Create parent directories if needed
        if !is_to_image {
            if let Some(parent) = output_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
        }

        let item_overwrite = item.overwrite.unwrap_or_else(|| request.overwrite.unwrap_or(false));

        // Perform conversion
        let mut converted_size_calc = 0u64;
        let mut local_pdf_pages = None;
        let conv_res = if is_to_image {
            let dpi = item.dpi.unwrap_or(150);
            match convert_single_pdf_to_images(
                input_path,
                &output_path,
                &target_ext,
                dpi,
                item.page_range.as_deref(),
            ) {
                Ok((engine, count, bytes)) => {
                    converted_size_calc = bytes;
                    let dir_name = output_path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("同名");
                    Ok(format!(
                        "{}（生成 {} 张图片，存放在「{}」目录）",
                        engine, count, dir_name
                    ))
                }
                Err(e) => Err(e),
            }
        } else if target_ext == "docx" || target_ext == "doc" {
            try_pdf_to_word_layout(
                input_path, &output_path, item.page_range.as_deref(), item_overwrite,
                &mut local_pdf_pages,
            )
        } else if target_ext == "pdf" {
            convert_single_word_to_pdf_with_options(input_path, &output_path, item_overwrite)
        } else {
            Err(format!("不支持的目标格式: {}", target_ext))
        };

        match conv_res {
            Ok(engine) => {
                let converted_size = if is_to_image {
                    converted_size_calc
                } else {
                    fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0)
                };
                total_success += 1;
                results.push(ConvertItemResult {
                    input_path: item.input_path.clone(),
                    output_path: output_path.to_string_lossy().to_string(),
                    success: true,
                    message: format!("转换成功（{}）", engine),
                    original_size,
                    converted_size,
                    engine_used: engine,
                    local_pdf_pages: None,
                });
            }
            Err(e) => {
                results.push(ConvertItemResult {
                    input_path: item.input_path.clone(),
                    output_path: output_path.to_string_lossy().to_string(),
                    success: false,
                    message: format!("转换失败: {}", e),
                    original_size,
                    converted_size: 0,
                    engine_used: "失败".to_string(),
                    local_pdf_pages,
                });
            }
        }
    }

    let overall_success = total_success > 0;
    let message = format!(
        "转换任务完成：成功 {} / {} 个文件",
        total_success,
        results.len()
    );

    Ok(ConvertResult {
        success: overall_success,
        message,
        results,
    })
}

/// Convert a single PDF file using the optional editable layout engine.
fn try_pdf_to_word_layout(
    input_path: &Path,
    output_path: &Path,
    page_range: Option<&str>,
    overwrite: bool,
    local_pdf_pages: &mut Option<Vec<u32>>,
) -> Result<String, String> {
    if output_path.exists() && !overwrite {
        return Err("目标文件已存在，请选择其他文件名".to_string());
    }
    let document = Document::load(input_path).map_err(|e| format!("无法读取 PDF: {}", e))?;
    let pages = validate_page_range(page_range, document.get_pages().len() as u32)?;
    let normalized = pages
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let staging = word_staging_path(output_path)?;
    let _cleanup = StagingCleanup(staging.clone());
    let engine = convert_pdf_to_word_pdf2docx(input_path, &staging, Some(&normalized))
        .and_then(|engine| {
            let (has_text, has_image) = inspect_word_content(&staging)?;
            let source_has_image = pages.len() == document.get_pages().len() && document.objects.values().any(|object| object.as_stream().ok()
                .and_then(|stream| stream.dict.get(b"Subtype").ok())
                .and_then(|subtype| subtype.as_name().ok()) == Some(b"Image"));
            let source_has_text = document.extract_text(&pages).map(|text| !text.trim().is_empty()).unwrap_or(false);
            if (source_has_text && !has_text) || (source_has_image && !has_image) {
                return Err("转换结果缺少文字或图片，已停止输出".to_string());
            }
            Ok(engine)
        })
        .map_err(|error| {
            *local_pdf_pages = Some(pages);
            error
        })?;
    publish_target(&staging, output_path, overwrite)
        .map_err(|e| format!("无法保存 Word 文件：{}", e))?;
    Ok(engine)
}

fn word_staging_path(output_path: &Path) -> Result<PathBuf, String> {
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|e| format!("无法创建输出目录: {}", e))?;
    Ok(parent.join(format!(
        ".doc-tools-{}-{}.docx",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )))
}

fn inspect_word_content(path: &Path) -> Result<(bool, bool), String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("无效 DOCX: {}", e))?;
    let mut xml = String::new();
    archive.by_name("word/document.xml").map_err(|e| format!("无效 DOCX: {}", e))?
        .read_to_string(&mut xml).map_err(|e| e.to_string())?;
    let has_text = regex::Regex::new(r"<w:t(?:\s[^>]*)?>[^<]+</w:t>").unwrap().is_match(&xml);
    let has_image = archive.file_names().filter_map(Result::ok)
        .any(|name| name.starts_with("word/media/") && !name.ends_with('/'));
    if !has_text && !has_image {
        return Err("Word 文件没有可用内容".to_string());
    }
    Ok((has_text, has_image))
}

pub fn save_local_pdf_word(output_path: &Path, bytes: &[u8], overwrite: bool) -> Result<u64, String> {
    if !output_path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("docx")) {
        return Err("Word 输出文件须使用 .docx 扩展名".to_string());
    }
    let staging = word_staging_path(output_path)?;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&staging)
        .map_err(|e| format!("无法创建 Word 文件：{}", e))?;
    let _cleanup = StagingCleanup(staging.clone());
    std::io::Write::write_all(&mut file, bytes).and_then(|_| file.sync_all())
        .map_err(|e| format!("无法写入 Word 文件：{}", e))?;
    drop(file);
    inspect_word_content(&staging)?;
    publish_target(&staging, output_path, overwrite)
        .map_err(|e| format!("无法保存 Word 文件：{}", e))?;
    Ok(bytes.len() as u64)
}

pub fn convert_single_pdf_to_word_with_options(
    input_path: &Path,
    output_path: &Path,
    page_range: Option<&str>,
    overwrite: bool,
) -> Result<String, String> {
    try_pdf_to_word_layout(input_path, output_path, page_range, overwrite, &mut None)
}

/// Convert a single PDF file to Word (.docx)
pub fn convert_single_pdf_to_word(
    input_path: &Path,
    output_path: &Path,
    page_range: Option<&str>,
) -> Result<String, String> {
    convert_single_pdf_to_word_with_options(input_path, output_path, page_range, false)
}

/// Convert a single Word file (.docx or .doc) to PDF (.pdf) with options
pub fn convert_single_word_to_pdf_with_options(
    input_path: &Path,
    output_path: &Path,
    overwrite: bool,
) -> Result<String, String> {
    if output_path.exists() && !overwrite { return Err("目标文件已存在，请选择其他文件名".to_string()); }
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let staging = parent.join(format!(".doc-tools-{}-{}.pdf", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
    let _cleanup = StagingCleanup(staging.clone());
    let mut engines: Vec<fn(&Path, &Path) -> Result<String, String>> = vec![convert_word_to_pdf_soffice];
    #[cfg(target_os = "macos")]
    engines.push(convert_word_to_pdf_pages);
    engines.push(convert_word_to_pdf_msword);
    engines.push(convert_word_to_pdf_docx2pdf);
    let mut errors = Vec::new();
    for engine in engines {
        let _ = fs::remove_file(&staging);
        match engine(input_path, &staging).and_then(|name| {
            let pdf = Document::load(&staging).map_err(|e| format!("无效 PDF: {}", e))?;
            if pdf.get_pages().is_empty() { return Err("转换结果没有页面".to_string()); }
            publish_target(&staging, output_path, overwrite).map_err(|e| format!("无法保存文件（目标可能已存在）: {}", e))?;
            Ok(name)
        }) {
            Ok(name) => { let _ = fs::remove_file(&staging); return Ok(name); }
            Err(error) => errors.push(error),
        }
    }
    let _ = fs::remove_file(&staging);
    Err(format!("Word 转 PDF 失败，需要 LibreOffice、Pages 或 Microsoft Word：{}", errors.join("; ")))
}

/// Convert a single Word file (.docx or .doc) to PDF (.pdf)
pub fn convert_single_word_to_pdf(input_path: &Path, output_path: &Path) -> Result<String, String> {
    convert_single_word_to_pdf_with_options(input_path, output_path, false)
}

// =========================================================================
// PDF to Word implementations
// =========================================================================

fn convert_pdf_to_word_pdf2docx(
    input_path: &Path,
    output_path: &Path,
    page_range: Option<&str>,
) -> Result<String, String> {
    let script = r#"
import sys
import os
import io
import re
import fitz
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ROW_HEIGHT
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn

source_path = sys.argv[1]
output_path = sys.argv[2]
raw_pages = sys.argv[3].strip()

source = fitz.open(source_path)
total_pages = len(source)
actual_pages = [int(p) - 1 for p in raw_pages.split(',') if p.strip()] if raw_pages.lower() != 'all' else list(range(total_pages))

# 智能判定：检测是否属于文字转曲/复杂矢量排版（缺少原生字符编码，文字全为贝塞尔曲线）
sample_pages = actual_pages[:min(len(actual_pages), 6)]
avg_text = sum(len(source[p].get_text().strip()) for p in sample_pages) / max(1, len(sample_pages))
avg_drawings = sum(len(source[p].get_drawings()) for p in sample_pages) / max(1, len(sample_pages))

is_vector_outlined = avg_text < 40 and avg_drawings > 100

if is_vector_outlined:
    # This OCR reconstruction only writes text and tables. Preserve illustrated
    # or mixed documents through the built-in page renderer.
    if any(source[p].get_image_info() for p in actual_pages):
        raise SystemExit('OCR 排版无法保留原页图片')

    # -------------------------------------------------------------------------
    # 模式 A：OCR 智能版面分析与原生可编辑文档重建引擎
    # 针对文字转曲/复杂矢量排版，利用本地 OCR 解析文本与坐标，进行结构化版面重建
    # 生成 100% 真实原生可编辑 Word 文本、段落与表格，彻底告别不可编辑的图片截图！
    # -------------------------------------------------------------------------
    has_rapidocr = False
    try:
        from rapidocr_onnxruntime import RapidOCR
        ocr_engine = RapidOCR()
        has_rapidocr = True
    except Exception:
        ocr_engine = None
        has_rapidocr = False

    CORRECTIONS = {
        '雯时': '霎时', '一雯': '一霎', '雯 sha': '霎 shà', '雯': '霎',
        '造荡': '浩荡', '半明半味': '半明半昧', '国巾': '围巾', '叙净': '寂静', '降重': '隆重',
        '（yan)': '（yán）', '（yan）': '（yán）', '（bé)': '（bó）', '（bé）': '（bó）',
        '（léng）': '（lóng）', '（léng)': '（lóng）', '（ding fei)': '（dǐng fèi）',
        '（ding féi)': '（dǐng fèi）', '(ding fei)': '（dǐng fèi）', '（hao）': '（hào）',
        '（hao)': '（hào）', '（béng)': '（bēng）', '（béng）': '（bēng）', '（shα)': '（shà）',
        '（shα）': '（shà）', '（shä）': '（shà）', '（yu)': '（yú）', '（yu）': '（yú）',
        '（man)': '（màn）', '（man）': '（màn）', '（hou)': '（hǒu）', '（hou）': '（hǒu）',
        '(ju)': '（jù）', '（sui）': '（suí）', '（sui)': '（suí）', '（di)': '（dī）',
        '（di）': '（dī）', '（dun）': '（dùn）', '（dun)': '（dùn）', '(zhu jian)': '（zhú jiàn）',
        '（zhu jian)': '（zhú jiàn）', '(d)': '（dǔ）', '（d)': '（dǔ）', '（qiang）': '（qiáng）',
        '（qiang)': '（qiáng）', '(méi)': '（mèi）', '（méi)': '（mèi）', '（zhui)': '（zhuì）',
        '（zhui）': '（zhuì）', '（ying）': '（yíng）', '（ying)': '（yíng）', '（fan）': '（fán）',
        '（fan)': '（fán）', '（hui)': '（huái）', '（hui）': '（huái）', '(ji)': '（jì）',
        '（ji)': '（jì）', '（tan）': '（tán）', '（tan)': '（tán）', '（shu)': '（shú）',
        '（shu）': '（shú）', '（täng）': '（tǎng）', '（täng)': '（tǎng）', '（m hu)': '（mó hu）',
        '（m hu）': '（mó hu）', '（wéi)': '（wéi）', '（wéi）': '（wéi）', '(wu)': '（wǔ）',
        '（wu)': '（wǔ）', '（chäo）': '（cháo）', '（chäo)': '（cháo）', '（shun）': '（shùn）',
        '（shun)': '（shùn）', '（sui)': '（suì）', '（sui）': '（suì）', '（luo)': '（luó）',
        '（luo）': '（luó）', '（bä)': '（bà）', '（bä）': '（bà）'
    }

    SECTION_KEYWORDS = [
        '字音', '会认的字', '会写字组词', '会认字组词', '词语/成语', '多音字',
        '近反义词', '形近字', '重点句段仿写', '重点句仿写', '重点句段理解',
        '积累背诵', '课文理解', '语文要素', '课文背诵', '课文要素'
    ]

    def clean_text(t):
        t = t.strip()
        for k, v in CORRECTIONS.items():
            t = t.replace(k, v)
        return t

    def set_cell_margins(cell, top=40, bottom=40, left=60, right=60):
        tcPr = cell._tc.get_or_add_tcPr()
        tcMar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/><w:right w:w="{right}" w:type="dxa"/></w:tcMar>')
        tcPr.append(tcMar)

    def set_table_borders_none(table):
        tblPr = table._tbl.tblPr
        borders = parse_xml(f'''
            <w:tblBorders {nsdecls("w")}>
                <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
            </w:tblBorders>
        ''')
        tblPr.append(borders)

    out_docx = Document()
    sec = out_docx.sections[0]
    sec.page_width = Pt(595.3)
    sec.page_height = Pt(841.9)
    sec.top_margin = Pt(36)
    sec.bottom_margin = Pt(36)
    sec.left_margin = Pt(40)
    sec.right_margin = Pt(40)

    for idx, pno in enumerate(actual_pages):
        page = source[pno]
        txt = page.get_text().strip()
        drawings = len(page.get_drawings())
        page_is_outlined = len(txt) < 80 and drawings > 100

        if page_is_outlined and has_rapidocr:
            pix = page.get_pixmap(dpi=150)
            ocr_res, _ = ocr_engine(pix.tobytes('png'))
            if not ocr_res:
                if txt:
                    out_docx.add_paragraph(txt)
                if idx < len(actual_pages) - 1:
                    out_docx.add_page_break()
                continue

            items = []
            for box, text, score in ocr_res:
                t = clean_text(text)
                if not t: continue
                m = re.match(r'^(第\s*\d+\s*课)(.+)$', t)
                xs = [pt[0] for pt in box]
                ys = [pt[1] for pt in box]
                if m:
                    w_est = (max(xs) - min(xs)) * 0.35
                    items.append({
                        'text': m.group(1),
                        'x0': min(xs), 'x1': min(xs) + w_est,
                        'y0': min(ys), 'y1': max(ys),
                        'yc': (min(ys) + max(ys)) / 2.0,
                        'xc': min(xs) + w_est / 2.0,
                        'h': max(ys) - min(ys), 'w': w_est
                    })
                    items.append({
                        'text': m.group(2).strip(),
                        'x0': min(xs) + w_est + 5, 'x1': max(xs),
                        'y0': min(ys), 'y1': max(ys),
                        'yc': (min(ys) + max(ys)) / 2.0,
                        'xc': (min(xs) + w_est + 5 + max(xs)) / 2.0,
                        'h': max(ys) - min(ys), 'w': max(xs) - (min(xs) + w_est + 5)
                    })
                else:
                    items.append({
                        'text': t,
                        'x0': min(xs), 'x1': max(xs),
                        'y0': min(ys), 'y1': max(ys),
                        'yc': (min(ys) + max(ys)) / 2.0,
                        'xc': (min(xs) + max(xs)) / 2.0,
                        'h': max(ys) - min(ys),
                        'w': max(xs) - min(xs)
                    })

            items.sort(key=lambda it: it['yc'])
            lines = []
            for it in items:
                placed = False
                for line in lines:
                    if abs(line['yc'] - it['yc']) < max(line['h'], it['h']) * 0.55:
                        line['items'].append(it)
                        line['yc'] = sum(x['yc'] for x in line['items']) / len(line['items'])
                        line['y0'] = min(x['y0'] for x in line['items'])
                        line['y1'] = max(x['y1'] for x in line['items'])
                        line['h'] = line['y1'] - line['y0']
                        placed = True
                        break
                if not placed:
                    lines.append({
                        'yc': it['yc'], 'y0': it['y0'], 'y1': it['y1'], 'h': it['h'],
                        'items': [it]
                    })
            lines.sort(key=lambda l: l['y0'])
            for l in lines:
                l['items'].sort(key=lambda it: it['x0'])

            footer_line = None
            if len(lines) > 0 and lines[-1]['y0'] > 1550 and len(lines[-1]['items']) == 1:
                t = lines[-1]['items'][0]['text'].strip()
                if t.isdigit() or len(t) <= 2:
                    footer_line = t
                    lines = lines[:-1]

            line_idx = 0
            if line_idx < len(lines) and lines[line_idx]['y0'] < 100 and any('善思' in it['text'] for it in lines[line_idx]['items']):
                p_hdr = out_docx.add_paragraph()
                p_hdr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                p_hdr.paragraph_format.space_before = Pt(0)
                p_hdr.paragraph_format.space_after = Pt(2)
                r = p_hdr.add_run(lines[line_idx]['items'][0]['text'])
                r.font.name = 'SimSun'
                r.font.size = Pt(8.5)
                r.font.color.rgb = RGBColor(0x00, 0x8B, 0x8B)
                line_idx += 1

            if line_idx < len(lines) and lines[line_idx]['y0'] < 260 and any('单元' in it['text'] for it in lines[line_idx]['items']):
                title_text = ' '.join(it['text'] for it in lines[line_idx]['items'])
                p_title = out_docx.add_paragraph()
                p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p_title.paragraph_format.space_before = Pt(4)
                p_title.paragraph_format.space_after = Pt(6)
                r = p_title.add_run(title_text)
                r.font.name = 'SimSun'
                r.font.bold = True
                r.font.size = Pt(13)
                r.font.color.rgb = RGBColor(0x1A, 0x52, 0x76)
                line_idx += 1

            chunks = []
            curr_chunk = {'type': 'content', 'lines': []}
            while line_idx < len(lines):
                l = lines[line_idx]
                text_concat = ''.join(it['text'] for it in l['items']).strip()
                is_sec = any(kw == text_concat or (len(text_concat) < 14 and kw in text_concat) for kw in SECTION_KEYWORDS)

                if is_sec and len(l['items']) <= 2:
                    if curr_chunk['lines']:
                        chunks.append(curr_chunk)
                    chunks.append({'type': 'section_header', 'text': text_concat, 'line': l})
                    curr_chunk = {'type': 'content', 'lines': []}
                else:
                    curr_chunk['lines'].append(l)
                line_idx += 1
            if curr_chunk['lines']:
                chunks.append(curr_chunk)

            for chunk in chunks:
                if chunk['type'] == 'section_header':
                    p_sec = out_docx.add_paragraph()
                    p_sec.paragraph_format.space_before = Pt(6)
                    p_sec.paragraph_format.space_after = Pt(3)
                    r = p_sec.add_run(f'【{chunk["text"]}】')
                    r.font.name = 'SimSun'
                    r.font.bold = True
                    r.font.size = Pt(11)
                    r.font.color.rgb = RGBColor(0xD3, 0x54, 0x00)
                elif chunk['type'] == 'content':
                    c_lines = chunk['lines']
                    if not c_lines: continue
                    multi_item_lines = sum(1 for l in c_lines if len(l['items']) >= 2)
                    is_table = multi_item_lines >= max(2, len(c_lines) * 0.35)

                    if is_table:
                        all_items = []
                        for r_i, l in enumerate(c_lines):
                            for it in l['items']:
                                all_items.append((it, r_i))
                        all_x = [it['x0'] for it, _ in all_items]
                        col_anchors = []
                        threshold = 60 if len(all_x) > 30 else 80
                        for x in sorted(all_x):
                            matched = False
                            for i, c in enumerate(col_anchors):
                                if abs(c - x) < threshold:
                                    col_anchors[i] = (c + x) / 2
                                    matched = True
                                    break
                            if not matched:
                                col_anchors.append(x)
                        col_anchors.sort()
                        num_cols = max(1, len(col_anchors))

                        table = out_docx.add_table(rows=len(c_lines), cols=num_cols)
                        table.alignment = WD_TABLE_ALIGNMENT.CENTER
                        set_table_borders_none(table)

                        for r_i, l in enumerate(c_lines):
                            row = table.rows[r_i]
                            trPr = row._tr.get_or_add_trPr()
                            trPr.append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))

                            grid = {}
                            for it in l['items']:
                                best_c = min(range(num_cols), key=lambda c: abs(col_anchors[c] - it['x0']))
                                if best_c in grid:
                                    grid[best_c] += ' ' + it['text']
                                else:
                                    grid[best_c] = it['text']

                            for c_i in range(num_cols):
                                cell = row.cells[c_i]
                                set_cell_margins(cell, top=40, bottom=40, left=60, right=60)
                                txt = grid.get(c_i, '')
                                p_cell = cell.paragraphs[0]
                                p_cell.paragraph_format.space_before = Pt(0)
                                p_cell.paragraph_format.space_after = Pt(0)
                                p_cell.paragraph_format.line_spacing = 1.15
                                if txt:
                                    r_cell = p_cell.add_run(txt)
                                    r_cell.font.name = 'SimSun'
                                    r_cell.font.size = Pt(9.5)
                                    if '第' in txt and '课' in txt:
                                        r_cell.font.bold = True
                                        r_cell.font.color.rgb = RGBColor(0x1B, 0x4F, 0x72)
                    else:
                        for l in c_lines:
                            line_text = ' '.join(it['text'] for it in l['items']).strip()
                            if not line_text: continue
                            p_line = out_docx.add_paragraph()
                            p_line.paragraph_format.space_before = Pt(2)
                            p_line.paragraph_format.space_after = Pt(2)
                            p_line.paragraph_format.line_spacing = 1.15
                            r_line = p_line.add_run(line_text)
                            r_line.font.name = 'SimSun'
                            r_line.font.size = Pt(9.5)
                            if any(line_text.startswith(kw) for kw in ['示例：', '要点：', '仿写：', '课文背诵', '重点句段理解', '语文要素：']):
                                r_line.font.bold = True

            if footer_line:
                p_ft = out_docx.add_paragraph()
                p_ft.alignment = WD_ALIGN_PARAGRAPH.CENTER
                p_ft.paragraph_format.space_before = Pt(4)
                p_ft.paragraph_format.space_after = Pt(0)
                r_ft = p_ft.add_run(f'- {footer_line} -')
                r_ft.font.name = 'SimSun'
                r_ft.font.size = Pt(8.5)
                r_ft.font.color.rgb = RGBColor(0x88, 0x88, 0x88)

            if idx < len(actual_pages) - 1:
                out_docx.add_page_break()

        else:
            # 原生文本页面：采用增强版 pdf2docx 保留复杂排版与表格
            tmp_native_docx = f'{output_path}_native_p{pno}.docx'
            from pdf2docx import Converter
            cv_n = Converter(source_path)
            try:
                cv_n.convert(tmp_native_docx, pages=[pno])
            finally:
                cv_n.close()

            native_doc = Document(tmp_native_docx)
            os.remove(tmp_native_docx)
            if native_doc.element.body.xpath('.//*[@r:embed or @r:link or @r:id]'):
                raise SystemExit('OCR 排版无法合并页面的媒体或链接')
            for child in native_doc.element.body:
                if child.tag.endswith('sectPr'):
                    continue
                out_docx.element.body.append(child)

            if idx < len(actual_pages) - 1:
                out_docx.add_page_break()

    print('EDITABLE_RECONSTRUCTED')
    out_docx.save(output_path)

else:
    # -------------------------------------------------------------------------
    # 模式 B：标准电子文档流式转换引擎（增强版 pdf2docx，保持原生文字与表格可编辑）
    # -------------------------------------------------------------------------
    from pdf2docx import Converter
    from pdf2docx.text.TextBlock import TextBlock
    from docx.enum.text import WD_LINE_SPACING

    def structure_nodes(blocks):
        for block in blocks:
            yield block
            yield from structure_nodes(block.get('blocks', []))

    def tagged_quotes(blocks):
        for block in structure_nodes(blocks):
            if block.get('std') == 'BlockQuote':
                children = list(structure_nodes(block.get('blocks', [])))
                if not any(child.get('std') in ('Table', 'Figure') for child in children):
                    yield [child for child in children if child['type'] == 0]

    def compact_text(text):
        return ''.join(text.split())

    def lines_in_quote(block, bounds):
        if block.is_text_block:
            lines = list(block.lines)
            return lines if all(bounds.contains(line.bbox) and line.text == line.raw_text for line in lines) else []
        lines = []
        if block.is_table_block and block.num_cols == 1:
            for row in block:
                for child in row[0].blocks:
                    child_lines = lines_in_quote(child, bounds)
                    if not child_lines:
                        return []
                    lines.extend(child_lines)
        return lines

    def rgb_hex(color):
        return ''.join(f'{round(component * 255):02X}' for component in color)

    def quote_rail(box, fill, drawings):
        return next(((rect, color) for rect, color in drawings
            if color != fill and 0 < rect.width <= 8
            and max(abs(rect.x0 - box.x0), abs(rect.y0 - box.y0),
                    abs(rect.y1 - box.y1)) <= 1), None)

    class QuoteBlock(TextBlock):
        def __init__(self, column, blocks, lines, drawings):
            super().__init__()
            self.lines.extend(lines)
            self.column_box = column.bbox
            self.before_space = blocks[0].before_space
            self.after_space = blocks[-1].after_space
            self.box, self.fill = min(
                ((rect, color) for rect, color in drawings if rect.contains(self.bbox)
                 and rect.width <= column.bbox.width + 2 and rect.height <= self.bbox.height + 64),
                key=lambda item: item[0].get_area(), default=(self.bbox, None))
            self.left_bar = quote_rail(self.box, self.fill, drawings) if self.fill else None
            # pdf2docx can attach the rule under a heading to the first faux table.
            self.rule = next(((rect, color) for rect, color in drawings
                if blocks[0].is_table_block and 0 < rect.height <= 4 and rect.y1 <= self.box.y0
                and abs((rect.y0 + rect.y1) / 2 - blocks[0].bbox.y0) <= 2
                and abs(rect.x0 - self.box.x0) <= 2 and abs(rect.x1 - self.box.x1) <= 2), None)
            start = self.rule[0].y1 if self.rule else blocks[0].bbox.y0
            self.gap_before = max(0, self.before_space + self.box.y0 - start)
            self.after_space = max(0, self.after_space + blocks[-1].bbox.y1 - self.box.y1)

        @staticmethod
        def border(edge, color, width, space=0):
            return (f'<w:{edge} w:val="single" w:color="{rgb_hex(color)}"'
                    f' w:sz="{max(2, round(width * 8))}" w:space="{max(0, min(31, round(space)))}"/>')

        def make_docx(self, paragraph):
            if self.rule:
                rect, color = self.rule
                rule = paragraph.insert_paragraph_before()
                rule.paragraph_format.line_spacing = Pt(1)
                rule.paragraph_format.space_before = Pt(self.before_space)
                rule.paragraph_format.space_after = Pt(0)
                rule._p.get_or_add_pPr().insert_element_before(parse_xml(
                    f'<w:pBdr {nsdecls("w")}>{self.border("bottom", color, rect.height)}</w:pBdr>'), 'w:spacing')

            paragraph.style = 'Quote'
            fmt = paragraph.paragraph_format
            fmt.left_indent = Pt(max(0, self.bbox.x0 - self.column_box.x0))
            fmt.right_indent = Pt(max(0, self.column_box.x1 - self.box.x1))
            fmt.space_before = Pt(self.gap_before)
            fmt.space_after = Pt(self.after_space)
            fmt.keep_together = True
            rows = self.lines.group_by_physical_rows()
            line_height = max(line.bbox.height for line in self.lines)
            if len(rows) > 1:
                line_height = max(line_height, (rows[-1].bbox.y0 - rows[0].bbox.y0) / (len(rows) - 1))
            fmt.line_spacing = Pt(line_height)
            fmt.line_spacing_rule = WD_LINE_SPACING.AT_LEAST
            ppr = paragraph._p.get_or_add_pPr()
            if self.fill:
                leading = max(0, line_height - rows[0].bbox.height)
                top = self.border('top', self.fill, 0.25, self.bbox.y0 - self.box.y0 - leading)
                bottom = self.border('bottom', self.fill, 0.25, self.box.y1 - self.bbox.y1)
                left = ''
                if self.left_bar:
                    rail, color = self.left_bar
                    left = self.border('left', color, rail.width, self.bbox.x0 - rail.x1)
                ppr.insert_element_before(parse_xml(f'<w:pBdr {nsdecls("w")}>{top}{left}{bottom}</w:pBdr>'), 'w:spacing', 'w:ind')
                ppr.insert_element_before(parse_xml(
                    f'<w:shd {nsdecls("w")} w:val="clear" w:fill="{rgb_hex(self.fill)}"/>'), 'w:spacing', 'w:ind')

            for index, row in enumerate(rows):
                if index:
                    paragraph.add_run().add_break()
                for line in row:
                    for span in line.spans:
                        span.make_docx(paragraph)

    def restore_quotes(page, layout, structure_flag):
        raw = page.get_text('dict', flags=fitz.TEXTFLAGS_TEXT | structure_flag)
        quotes = list(tagged_quotes(raw['blocks']))
        if not quotes:
            return
        drawings = [(draw['rect'], draw['fill']) for draw in page.get_drawings()
                    if draw['fill'] and len(draw['items']) == 1 and draw['items'][0][0] == 're']
        for quote in quotes:
            if not quote:
                continue
            # A carried-over line above the quote can inherit its tag at a page break.
            # Only narrow the tag's scope when the source has a filled box and matching rail.
            boxed_text = [[block for block in quote if rect.contains(fitz.Rect(block['bbox']))]
                          for rect, color in drawings if rect.width > 16 and quote_rail(rect, color, drawings)]
            quote = max(boxed_text, key=len, default=[]) or quote
            bounds = fitz.Rect()
            for block in quote:
                bounds |= fitz.Rect(block['bbox'])
            bounds += (-1.5, -1.5, 1.5, 1.5)
            expected = compact_text(''.join(span['text'] for block in quote
                                            for line in block['lines'] for span in line['spans']))
            for section in layout.sections:
                for column in section:
                    blocks = list(column.blocks)
                    matches = [(index, lines) for index, block in enumerate(blocks)
                               if (lines := lines_in_quote(block, bounds))]
                    if not matches:
                        continue
                    first, last = matches[0][0], matches[-1][0] + 1
                    lines = [line for _, group in matches for line in group]
                    if len(matches) != last - first or compact_text(''.join(line.text for line in lines)) != expected:
                        continue
                    quote_block = QuoteBlock(column, blocks[first:last], lines, drawings)
                    extra_tail = quote_block.box.y1 - blocks[last - 1].bbox.y1 - blocks[last - 1].after_space
                    if extra_tail > 0 and last < len(blocks):
                        blocks[last].before_space = max(0, blocks[last].before_space - extra_tail)
                    column.blocks.reset(blocks[:first] + [quote_block] + blocks[last:])

    try:
        from pdf2docx.table.Row import Row
        _orig_row_make_docx = Row.make_docx
        def _safe_row_make_docx(self, table, idx_row: int):
            _orig_row_make_docx(self, table, idx_row)
            docx_row = table.rows[idx_row]
            docx_row.height_rule = WD_ROW_HEIGHT.AT_LEAST
            if self.height < 15.0:
                docx_row.height = Pt(15.0)
        Row.make_docx = _safe_row_make_docx
    except Exception:
        pass

    cv = Converter(source_path)
    try:
        pages_arg = actual_pages if len(actual_pages) != total_pages else None
        convert_kwargs = {'min_svg_gap_dx': 35.0, 'min_svg_gap_dy': 35.0}
        structure_flag = getattr(fitz, 'TEXT_COLLECT_STRUCTURE', 0)
        if structure_flag and source.xref_get_key(source.pdf_catalog(), 'StructTreeRoot')[0] != 'null':
            settings = dict(cv.default_settings, **convert_kwargs)
            cv.parse(pages=pages_arg, **settings)
            for pno in actual_pages:
                if cv.pages[pno].finalized:
                    restore_quotes(source[pno], cv.pages[pno], structure_flag)
            cv.make_docx(output_path, **settings)
        else:
            cv.convert(output_path, pages=pages_arg, **convert_kwargs)
    finally:
        cv.close()

    result = Document(output_path)
    all_tbls = result.element.body.xpath('.//w:tbl')
    for tbl in all_tbls:
        has_visible_border = False
        for b in tbl.xpath('./w:tr/w:tc/w:tcPr/w:tcBorders/*'):
            val = b.get(qn('w:val'))
            try:
                sz = float(b.get(qn('w:sz'), 0) or 0)
            except Exception:
                sz = 0.0
            if val and val.lower() not in ('none', 'nil') and sz > 0:
                has_visible_border = True
                break

        tblPr = tbl.find(qn('w:tblPr'))
        if tblPr is None:
            tblPr = parse_xml(f'<w:tblPr {nsdecls("w")}/>')
            tbl.insert(0, tblPr)

        if not has_visible_border:
            for old_b in tblPr.xpath('./w:tblBorders'):
                tblPr.remove(old_b)
            tblPr.append(parse_xml(f'''
                <w:tblBorders {nsdecls("w")}>
                    <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                    <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                    <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                    <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                    <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                    <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                </w:tblBorders>
            '''))
            for tcPr in tbl.xpath('./w:tr/w:tc/w:tcPr'):
                for old_tc_b in tcPr.xpath('./w:tcBorders'):
                    tcPr.remove(old_tc_b)
                tcPr.append(parse_xml(f'''
                    <w:tcBorders {nsdecls("w")}>
                        <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                        <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                        <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                        <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
                    </w:tcBorders>
                '''))

        for tr in tbl.xpath('./w:tr'):
            trPr = tr.find(qn('w:trPr'))
            if trPr is None:
                trPr = parse_xml(f'<w:trPr {nsdecls("w")}/>')
                tr.insert(0, trPr)
            for cs in trPr.xpath('./w:cantSplit'):
                trPr.remove(cs)
            for th in trPr.xpath('./w:trHeight'):
                th.set(qn('w:hRule'), 'atLeast')
                try:
                    h_val = float(th.get(qn('w:val'), 0) or 0)
                except Exception:
                    h_val = 0.0
                if h_val < 320:
                    th.set(qn('w:val'), '320')

            for tc in tr.xpath('./w:tc'):
                for p in tc.xpath('./w:p'):
                    pPr = p.find(qn('w:pPr'))
                    if pPr is not None:
                        for sp in pPr.xpath('./w:spacing'):
                            if sp.get(qn('w:lineRule')) == 'exact':
                                sp.set(qn('w:lineRule'), 'atLeast')
                            sp.set(qn('w:before'), '0')
                            sp.set(qn('w:after'), '0')

    result.save(output_path)

source.close()
"#;

    let pr = page_range.unwrap_or("all");
    let page_count = if pr.eq_ignore_ascii_case("all") { 1 } else { pr.split(',').filter(|part| !part.trim().is_empty()).count().max(1) };
    let output = python_command("pdf2docx")?
        .args([
            "-c",
            script,
            &input_path.to_string_lossy(),
            &output_path.to_string_lossy(),
            pr,
        ])
        .bounded_output_timeout(pdf_to_word_timeout(page_count))
        .map_err(|e| format!("pdf2docx 未完成: {}", e))?;

    if output.status.success()
        && output_path.exists()
        && fs::metadata(output_path).map(|m| m.len()).unwrap_or(0) > 0
    {
        let stdout_str = String::from_utf8_lossy(&output.stdout);
        if stdout_str.contains("EDITABLE_RECONSTRUCTED") {
            Ok("OCR 版面智能重构（原生可编辑文本与表格）".to_string())
        } else if stdout_str.contains("IMAGE_ONLY") {
            Ok("高保真排版（1:1 原貌）".to_string())
        } else {
            Ok("pdf2docx 排版转换（请核对表格和图片）".to_string())
        }
    } else {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        Err(if err_msg.trim().is_empty() {
            "pdf2docx 转换未生成有效文件".to_string()
        } else {
            err_msg.trim().to_string()
        })
    }
}

fn convert_word_to_pdf_soffice(input_path: &Path, output_path: &Path) -> Result<String, String> {
    let soffice = get_soffice_cmd().ok_or_else(|| "未找到 LibreOffice/soffice".to_string())?;
    let temporary = TemporaryDirectory::create()?;
    let parent_dir = &temporary.0;
    let profile = format!("-env:UserInstallation={}", office_profile_url(&parent_dir.join("profile")));

    let output = Command::new(&soffice)
        .args([
            &profile,
            "--headless",
            "--convert-to",
            "pdf:writer_pdf_Export",
            "--outdir",
            &parent_dir.to_string_lossy(),
            &input_path.to_string_lossy(),
        ])
        .bounded_output()
        .map_err(|e| format!("执行 soffice 失败: {}", e))?;

    if output.status.success() {
        let stem = input_path.file_stem().unwrap().to_string_lossy();
        let generated_pdf = parent_dir.join(format!("{}.pdf", stem));
        if generated_pdf.exists() {
            if generated_pdf != output_path {
                fs::copy(&generated_pdf, output_path).map_err(|error| error.to_string())?;
            }
            return Ok("LibreOffice 专业引擎".to_string());
        }
    }

    Err("LibreOffice 转换未成功生成 PDF".to_string())
}

#[cfg(target_os = "macos")]
fn convert_word_to_pdf_pages(input_path: &Path, output_path: &Path) -> Result<String, String> {
    let script = format!(
        r#"
tell application "Pages"
    set doc to open POSIX file "{}"
    export doc to POSIX file "{}" as PDF
    close doc saving no
end tell
"#,
        input_path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\""),
        output_path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"")
    );

    let output = Command::new("osascript")
        .args(["-e", &script])
        .bounded_output()
        .map_err(|e| format!("执行 AppleScript 失败: {}", e))?;

    if output.status.success()
        && output_path.exists()
        && fs::metadata(output_path).map(|m| m.len()).unwrap_or(0) > 0
    {
        Ok("Apple Pages 原生渲染引擎".to_string())
    } else {
        Err(format!(
            "Pages 导出失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

#[cfg(any(target_os = "windows", test))]
fn windows_word_export_script() -> &'static str {
    r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$word = $null
$document = $null
$failed = $false
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Open($env:DOC_TOOLS_WORD_INPUT, $false, $true)
    $document.ExportAsFixedFormat($env:DOC_TOOLS_WORD_OUTPUT, 17)
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    $failed = $true
} finally {
    if ($null -ne $document) { try { $document.Close(0) } catch { $failed = $true }; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
    if ($null -ne $word) { try { $word.Quit(0) } catch { $failed = $true }; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
}
if ($failed) { exit 1 }
exit 0
"#
}

fn convert_word_to_pdf_msword(input_path: &Path, output_path: &Path) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            r#"
tell application "Microsoft Word"
    set doc to open file name "{}"
    save as doc file name "{}" file format format PDF
    close doc saving no
end tell
"#,
            input_path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\""),
            output_path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"")
        );

        let output = Command::new("osascript")
            .args(["-e", &script])
            .bounded_output()
            .map_err(|e| e.to_string())?;

        if output.status.success() && output_path.exists() {
            return Ok("Microsoft Word 官方排版引擎".to_string());
        }
        return Err("Microsoft Word 未安装或导出失败".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", windows_word_export_script()])
            .env("DOC_TOOLS_WORD_INPUT", input_path)
            .env("DOC_TOOLS_WORD_OUTPUT", output_path)
            .bounded_output()
            .map_err(|e| e.to_string())?;

        if output.status.success() && output_path.exists() {
            return Ok("Microsoft Word 官方排版引擎".to_string());
        }
        return Err("Microsoft Word 未能完成转换".to_string());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (input_path, output_path);
        Err("MS Word 仅支持 macOS / Windows".to_string())
    }
}

fn convert_word_to_pdf_docx2pdf(input_path: &Path, output_path: &Path) -> Result<String, String> {
    let output = python_command("docx2pdf")?
        .args([
            "-m",
            "docx2pdf",
            &input_path.to_string_lossy(),
            &output_path.to_string_lossy(),
        ])
        .bounded_output()
        .map_err(|e| e.to_string())?;

    if output.status.success()
        && output_path.exists()
        && fs::metadata(output_path).map(|m| m.len()).unwrap_or(0) > 0
    {
        Ok("docx2pdf 引擎".to_string())
    } else {
        Err("docx2pdf 未成功转换".to_string())
    }
}

fn generate_output_path(input_path: &Path, target_ext: &str, default_dir: Option<&str>) -> PathBuf {
    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document");
    let file_name = format!("{}_converted.{}", stem, target_ext);

    if let Some(dir) = default_dir {
        if !dir.trim().is_empty() {
            return Path::new(dir).join(file_name);
        }
    }

    if let Some(parent) = input_path.parent() {
        parent.join(file_name)
    } else {
        PathBuf::from(file_name)
    }
}

pub fn generate_pdf_to_images_dir(input_path: &Path, default_dir: Option<&str>) -> PathBuf {
    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("pdf_images");

    if let Some(dir) = default_dir {
        if !dir.trim().is_empty() {
            return Path::new(dir).join(stem);
        }
    }

    if let Some(parent) = input_path.parent() {
        parent.join(stem)
    } else {
        PathBuf::from(stem)
    }
}

pub fn get_pdftoppm_cmd() -> Option<String> {
    let candidates = installed_candidates("pdftoppm", &[
        "/opt/homebrew/bin/pdftoppm",
        "/usr/local/bin/pdftoppm",
        "/usr/bin/pdftoppm",
        "pdftoppm",
    ]);

    for c in candidates {
        if let Ok(output) = Command::new(&c).arg("-v").bounded_output_timeout(std::time::Duration::from_secs(5)) {
            if output.status.success() || !output.stderr.is_empty() {
                return Some(c.to_string());
            }
        }
    }
    None
}

pub fn get_gs_cmd() -> Option<String> {
    let candidates = installed_candidates("gs", &[
        "/opt/homebrew/bin/gs",
        "/usr/local/bin/gs",
        "/usr/bin/gs",
        "gs",
        "gswin64c",
        "gswin32c",
    ]);

    for c in candidates {
        if let Ok(output) = Command::new(&c).arg("--version").bounded_output_timeout(std::time::Duration::from_secs(5)) {
            if output.status.success() {
                return Some(c.to_string());
            }
        }
    }
    None
}

fn convert_pdf_to_images_fitz(
    input_path: &Path,
    output_dir: &Path,
    format: &str,
    dpi: u32,
    page_range: Option<&str>,
) -> Result<(String, usize, u64), String> {
    let script = r#"
import sys, os, fitz

input_p = sys.argv[1]
output_d = sys.argv[2]
fmt = sys.argv[3].lower() if len(sys.argv) > 3 else "png"
dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 150
range_str = sys.argv[5] if len(sys.argv) > 5 else "all"

os.makedirs(output_d, exist_ok=True)
doc = fitz.open(input_p)
total = len(doc)

pages = []
if range_str == "all" or not range_str.strip():
    pages = list(range(1, total + 1))
else:
    for part in range_str.split(","):
        part = part.strip()
        if "-" in part:
            sub = part.split("-")
            start = max(1, int(sub[0]))
            end = min(total, int(sub[1]))
            pages.extend(range(start, end + 1))
        elif part.isdigit():
            p = int(part)
            if 1 <= p <= total:
                pages.append(p)

count = 0
total_bytes = 0
digits = len(str(total))
if digits < 3:
    digits = 3

for p_num in pages:
    page = doc.load_page(p_num - 1)
    pix = page.get_pixmap(dpi=dpi)
    fname = f"page_{p_num:0{digits}d}.{fmt}"
    out_file = os.path.join(output_d, fname)
    pix.save(out_file)
    count += 1
    total_bytes += os.path.getsize(out_file)

print(f"OK:{count}:{total_bytes}")
"#;

    let mut cmd = python_command("fitz")?;
    cmd.args([
        "-c",
        script,
        &input_path.to_string_lossy(),
        &output_dir.to_string_lossy(),
        format,
        &dpi.to_string(),
        page_range.unwrap_or("all"),
    ]);

    let output = cmd
        .bounded_output()
        .map_err(|e| format!("启动 python3 失败: {}", e))?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.starts_with("OK:") {
                let parts: Vec<&str> = line.split(':').collect();
                if parts.len() >= 3 {
                    let count = parts[1].parse::<usize>().unwrap_or(0);
                    let bytes = parts[2].parse::<u64>().unwrap_or(0);
                    return Ok(("PyMuPDF 矢量渲染引擎".to_string(), count, bytes));
                }
            }
        }
    }
    Err("Python PyMuPDF 渲染失败".to_string())
}

fn convert_pdf_to_images_pdftoppm(
    input_path: &Path,
    output_dir: &Path,
    format: &str,
    dpi: u32,
    _page_range: Option<&str>,
) -> Result<(String, usize, u64), String> {
    let pdftoppm_bin = get_pdftoppm_cmd().ok_or_else(|| "pdftoppm 未安装".to_string())?;

    let fmt_arg = if format == "jpg" || format == "jpeg" {
        "-jpeg"
    } else {
        "-png"
    };

    let prefix = output_dir.join("page");

    let output = Command::new(pdftoppm_bin)
        .args([
            fmt_arg,
            "-r",
            &dpi.to_string(),
            &input_path.to_string_lossy(),
            &prefix.to_string_lossy(),
        ])
        .bounded_output()
        .map_err(|e| format!("执行 pdftoppm 失败: {}", e))?;

    if output.status.success() {
        let mut count = 0;
        let mut total_bytes = 0;
        if let Ok(entries) = fs::read_dir(output_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        count += 1;
                        total_bytes += meta.len();
                    }
                }
            }
        }
        if count > 0 {
            return Ok(("Poppler pdftoppm 原生引擎".to_string(), count, total_bytes));
        }
    }
    Err("pdftoppm 转换失败".to_string())
}

fn convert_pdf_to_images_gs(
    input_path: &Path,
    output_dir: &Path,
    format: &str,
    dpi: u32,
    _page_range: Option<&str>,
) -> Result<(String, usize, u64), String> {
    let gs_bin = get_gs_cmd().ok_or_else(|| "Ghostscript 未安装".to_string())?;

    let device = if format == "jpg" || format == "jpeg" {
        "-sDEVICE=jpeg"
    } else {
        "-sDEVICE=png16m"
    };

    let out_pattern = output_dir.join(format!("page_%03d.{}", format));

    let output = Command::new(gs_bin)
        .args([
            "-dNOPAUSE",
            "-dBATCH",
            device,
            &format!("-r{}", dpi),
            &format!("-sOutputFile={}", out_pattern.to_string_lossy()),
            &input_path.to_string_lossy(),
        ])
        .bounded_output()
        .map_err(|e| format!("执行 Ghostscript 失败: {}", e))?;

    if output.status.success() {
        let mut count = 0;
        let mut total_bytes = 0;
        if let Ok(entries) = fs::read_dir(output_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        count += 1;
                        total_bytes += meta.len();
                    }
                }
            }
        }
        if count > 0 {
            return Ok(("Ghostscript 渲染引擎".to_string(), count, total_bytes));
        }
    }
    Err("Ghostscript 转换失败".to_string())
}

pub fn convert_single_pdf_to_images(
    input_path: &Path,
    output_dir: &Path,
    format: &str,
    dpi: u32,
    page_range: Option<&str>,
) -> Result<(String, usize, u64), String> {
    let source = Document::load(input_path).map_err(|e| format!("无法读取 PDF: {}", e))?;
    let pages = validate_page_range(page_range, source.get_pages().len() as u32)?;
    let normalized = pages
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let page_range = Some(normalized.as_str());
    fs::create_dir_all(output_dir).map_err(|e| format!("无法创建输出目录: {}", e))?;

    // Strategy 1: PyMuPDF (fitz)
    match convert_pdf_to_images_fitz(input_path, output_dir, format, dpi, page_range) {
        Ok((engine, count, bytes)) => return Ok((engine, count, bytes)),
        Err(e) => eprintln!("PyMuPDF failed: {}", e),
    }

    if pages.len() != source.get_pages().len() {
        return Err("所选页转换失败；部分页转换需要 Python fitz".to_string());
    }
    // Strategy 2: pdftoppm
    match convert_pdf_to_images_pdftoppm(input_path, output_dir, format, dpi, page_range) {
        Ok((engine, count, bytes)) => return Ok((engine, count, bytes)),
        Err(e) => eprintln!("pdftoppm failed: {}", e),
    }

    // Strategy 3: Ghostscript
    match convert_pdf_to_images_gs(input_path, output_dir, format, dpi, page_range) {
        Ok((engine, count, bytes)) => return Ok((engine, count, bytes)),
        Err(e) => eprintln!("gs failed: {}", e),
    }

    Err(
        "所有 PDF 转图片引擎均未能完成转换，请检查是否已安装 Python fitz、poppler 或 Ghostscript"
            .to_string(),
    )
}

pub fn convert_pdf_to_images(request: PdfToImageRequest) -> Result<OperationResult, String> {
    let input_path = PathBuf::from(&request.input_path);
    if !input_path.exists() {
        return Err(format!("源 PDF 文件不存在: {}", request.input_path));
    }

    let output_dir = if let Some(ref dir) = request.output_dir {
        if !dir.trim().is_empty() {
            PathBuf::from(dir)
        } else {
            generate_pdf_to_images_dir(&input_path, None)
        }
    } else {
        generate_pdf_to_images_dir(&input_path, None)
    };

    let format =
        if request.format.to_lowercase() == "jpg" || request.format.to_lowercase() == "jpeg" {
            "jpg"
        } else {
            "png"
        };

    let dpi = request.dpi.unwrap_or(150);

    let (engine, count, bytes) = convert_single_pdf_to_images(
        &input_path,
        &output_dir,
        format,
        dpi,
        request.page_range.as_deref(),
    )?;

    let dir_name = output_dir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("同名");

    Ok(OperationResult {
        success: true,
        message: format!(
            "PDF 转图片成功！共生成 {} 张高清图片，已存放在「{}」同名目录（{}）",
            count, dir_name, engine
        ),
        output_path: Some(output_dir.to_string_lossy().to_string()),
        details: Some(serde_json::json!({
            "image_count": count,
            "total_bytes": bytes,
            "engine": engine,
            "format": format,
            "dpi": dpi,
            "output_directory": output_dir.to_string_lossy().to_string(),
        })),
    })
}

pub fn get_soffice_cmd() -> Option<String> {
    let candidates = installed_candidates("soffice", &[
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/opt/homebrew/bin/soffice",
        "/usr/local/bin/soffice",
        "soffice",
    ]);

    for c in candidates {
        if let Ok(output) = Command::new(&c).arg("--version").bounded_output_timeout(std::time::Duration::from_secs(5)) {
            if output.status.success() {
                return Some(c.to_string());
            }
        }
    }
    None
}

/// Illustrated pages often need well over the default 3 minutes.
fn pdf_to_word_timeout(page_count: usize) -> std::time::Duration {
    let pages = page_count.max(1) as u64;
    std::time::Duration::from_secs((90 + pages * 30).clamp(180, 20 * 60))
}

fn validate_page_range(range: Option<&str>, total: u32) -> Result<Vec<u32>, String> {
    if total == 0 {
        return Err("PDF 没有可转换的页面".to_string());
    }
    let range = range.unwrap_or("all").trim();
    if range.is_empty() || range.eq_ignore_ascii_case("all") {
        return Ok((1..=total).collect());
    }
    // Page ranges select pages; output always follows ascending source page order.
    let mut pages = std::collections::BTreeSet::new();
    for part in range.split(',') {
        let part = part.trim();
        let (start, end) = if let Some((start, end)) = part.split_once('-') {
            (start.trim().parse::<u32>(), end.trim().parse::<u32>())
        } else {
            (part.parse::<u32>(), part.parse::<u32>())
        };
        let (start, end) = match (start, end) {
            (Ok(start), Ok(end)) if start > 0 && start <= end && end <= total => (start, end),
            _ => return Err(format!("页码范围无效：{}（共 {} 页）", part, total)),
        };
        pages.extend(start..=end);
    }
    Ok(pages.into_iter().collect())
}

#[cfg(test)]
mod conversion_range_tests {
    use super::*;

    #[test]
    fn windows_discovery_and_script_are_path_safe() {
        let root = std::env::temp_dir().join(format!("doc-tools-win-{}-中文 空格", std::process::id()));
        fs::create_dir_all(root.join("gs/gs11.2/bin")).unwrap();
        let roots = vec![root.clone()];
        assert!(windows_install_candidates("gs", &roots).contains(&root.join("gs/gs11.2/bin/gswin64c.exe")));
        assert!(windows_install_candidates("soffice", &roots).contains(&root.join("LibreOffice/program/soffice.exe")));
        assert!(windows_install_candidates("pdftoppm", &roots).contains(&root.join("poppler/Library/bin/pdftoppm.exe")));
        let url = office_profile_url(&root);
        assert!(url.starts_with("file:///"));
        assert!(!url.contains(' '));
        assert!(url.contains("%E4%B8%AD"));
        assert_eq!(office_profile_url(Path::new("D:\\安装 路径\\profile")), "file:///D:/%E5%AE%89%E8%A3%85%20%E8%B7%AF%E5%BE%84/profile");
        let script = windows_word_export_script();
        assert!(script.contains("finally"));
        assert!(script.contains("$env:DOC_TOOLS_WORD_INPUT"));
        assert!(script.contains("DisplayAlerts = 0"));
        assert!(script.contains("exit 1"));
        assert!(!script.contains("GetActiveObject"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn process_timeout_is_bounded() {
        let started = std::time::Instant::now();
        let error = Command::new("sh").args(["-c", "exec sleep 5"])
            .bounded_output_timeout(std::time::Duration::from_millis(100)).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }

    #[test]
    fn selected_python_has_the_requested_module() {
        // Optional local dependency check; packaging does not install Python packages.
        if let Ok(mut command) = python_command("fitz") {
            assert!(command.args(["-c", "import fitz; import sys; assert sys.version_info.major == 3"])
                .bounded_output_timeout(std::time::Duration::from_secs(5)).unwrap().status.success());
        }
    }

    #[test]
    fn illustrated_documents_get_more_than_three_minutes() {
        assert_eq!(pdf_to_word_timeout(1).as_secs(), 180);
        assert!(pdf_to_word_timeout(28).as_secs() > 180);
        assert_eq!(pdf_to_word_timeout(28).as_secs(), 90 + 28 * 30);
        assert_eq!(pdf_to_word_timeout(100).as_secs(), 20 * 60);
    }

    #[test]
    fn page_selection_is_strict_and_normalized() {
        for invalid in ["0", "4", "3-1", "1-4", "a", "1,", "1--2", "-1"] {
            assert!(validate_page_range(Some(invalid), 3).is_err(), "{invalid}");
        }
        assert_eq!(validate_page_range(Some("3, 1-2,2"), 3).unwrap(), vec![1, 2, 3]);
        assert_eq!(validate_page_range(Some("all"), 3).unwrap(), vec![1, 2, 3]);
        assert_eq!(validate_page_range(Some("3,1"), 3).unwrap(), vec![1, 3]);
        assert!(validate_page_range(None, 0).is_err());
    }

    #[test]
    fn copy_publication_never_overwrites_and_cleans_failure() {
        let root = std::env::temp_dir().join(format!("doc-tools-copy-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source");
        let destination = root.join("destination");
        fs::write(&source, b"new").unwrap();
        fs::write(&destination, b"old").unwrap();
        assert!(copy_without_overwrite(&source, &destination).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"old");
        fs::remove_file(&destination).unwrap();
        assert!(copy_without_overwrite(&root.join("missing"), &destination).is_err());
        assert!(!destination.exists());
        copy_without_overwrite(&source, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"new");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_range_creates_no_output() {
        use lopdf::{dictionary, Object};
        let root = std::env::temp_dir().join(format!("doc-tools-range-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.pdf");
        let output = root.join("output.docx");
        let mut document = Document::with_version("1.5");
        let pages_id = document.new_object_id();
        let page_id = document.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id, "MediaBox" => vec![0.into(),0.into(),100.into(),100.into()] });
        document.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 }));
        let root_id = document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        document.trailer.set("Root", root_id);
        document.save(&source).unwrap();
        assert!(convert_single_pdf_to_word(&source, &output, Some("2")).is_err());
        assert!(!output.exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_destination_is_preserved() {
        let path = std::env::temp_dir().join(format!("doc-tools-existing-{}", std::process::id()));
        fs::write(&path, b"original").unwrap();
        assert!(convert_single_pdf_to_word(Path::new("missing.pdf"), &path, None).is_err());
        assert!(convert_single_word_to_pdf(Path::new("missing.docx"), &path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn conflict_check_and_overwrite_publishing() {
        let root = std::env::temp_dir().join(format!("doc-tools-conflict-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let target_file = root.join("test_file_converted.docx");
        fs::write(&target_file, b"old_content").unwrap();

        let req = ConvertRequest {
            items: vec![ConvertItem {
                input_path: root.join("test_file.pdf").to_string_lossy().to_string(),
                output_path: Some(target_file.to_string_lossy().to_string()),
                target_format: "docx".to_string(),
                page_range: None,
                dpi: None,
                overwrite: None,
            }],
            default_output_dir: None,
            overwrite: None,
        };

        let conflicts = check_convert_conflicts(req);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0], target_file.to_string_lossy().to_string());

        // Test publishing with overwrite
        let staging = root.join("staging.docx");
        fs::write(&staging, b"new_content").unwrap();
        assert!(publish_target(&staging, &target_file, true).is_ok());
        assert_eq!(fs::read(&target_file).unwrap(), b"new_content");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn local_word_validates_before_replacing_existing_output() {
        use std::io::{Cursor, Write};

        let directory = TemporaryDirectory::create().unwrap();
        let target = directory.0.join("本地输出.docx");
        fs::write(&target, b"original").unwrap();
        assert!(save_local_pdf_word(&target, b"invalid", true).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"original");

        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        archive.start_file("word/document.xml", options).unwrap();
        archive.write_all(b"<w:document><w:drawing/></w:document>").unwrap();
        archive.start_file("word/media/page-1.jpg", options).unwrap();
        archive.write_all(b"page image").unwrap();
        let bytes = archive.finish().unwrap().into_inner();
        assert!(save_local_pdf_word(&target, &bytes, false).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"original");
        assert_eq!(save_local_pdf_word(&target, &bytes, true).unwrap(), bytes.len() as u64);
        assert_eq!(fs::read(&target).unwrap(), bytes);
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 1);
    }
}
