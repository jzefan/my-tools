use crate::models::{
    ConvertEngineStatus, ConvertItemResult, ConvertRequest, ConvertResult, OperationResult,
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

/// Convert batch of documents (PDF to Word or Word to PDF)
pub fn convert_documents(request: ConvertRequest) -> Result<ConvertResult, String> {
    if request.items.is_empty() {
        return Err("请至少选择一个需要转换的文件".to_string());
    }

    let mut results = Vec::new();
    let mut total_success = 0;

    for item in request.items {
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
            });
            continue;
        }

        let original_size = fs::metadata(input_path).map(|m| m.len()).unwrap_or(0);
        let ext = input_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Determine target format
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
                        });
                        continue;
                    }
                }
                other => other.to_string(),
            }
        };

        // Determine destination output path
        let output_path = if is_to_image {
            if let Some(ref custom_out) = item.output_path {
                if !custom_out.trim().is_empty() {
                    PathBuf::from(custom_out)
                } else {
                    generate_pdf_to_images_dir(input_path, request.default_output_dir.as_deref())
                }
            } else {
                generate_pdf_to_images_dir(input_path, request.default_output_dir.as_deref())
            }
        } else if let Some(ref custom_out) = item.output_path {
            if !custom_out.trim().is_empty() {
                PathBuf::from(custom_out)
            } else {
                generate_output_path(
                    input_path,
                    &target_ext,
                    request.default_output_dir.as_deref(),
                )
            }
        } else {
            generate_output_path(
                input_path,
                &target_ext,
                request.default_output_dir.as_deref(),
            )
        };

        // Create parent directories if needed
        if !is_to_image {
            if let Some(parent) = output_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
        }

        // Perform conversion
        let mut converted_size_calc = 0u64;
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
            convert_single_pdf_to_word(input_path, &output_path, item.page_range.as_deref())
        } else if target_ext == "pdf" {
            convert_single_word_to_pdf(input_path, &output_path)
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

/// Convert a single PDF file to Word (.docx)
pub fn convert_single_pdf_to_word(
    input_path: &Path,
    output_path: &Path,
    page_range: Option<&str>,
) -> Result<String, String> {
    if output_path.exists() {
        return Err("目标文件已存在，请选择其他文件名".to_string());
    }
    let document = Document::load(input_path).map_err(|e| format!("无法读取 PDF: {}", e))?;
    let pages = validate_page_range(page_range, document.get_pages().len() as u32)?;
    let normalized = pages
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|e| format!("无法创建输出目录: {}", e))?;
    let staging = parent.join(format!(
        ".doc-tools-{}-{}.docx",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let _cleanup = StagingCleanup(staging.clone());
    let result = convert_pdf_to_word_pdf2docx(input_path, &staging, Some(&normalized))
        .or_else(|primary_error| {
            let _ = fs::remove_file(&staging);
            // LibreOffice does not accept a page selection. Use it only for the entire document.
            if pages.len() == document.get_pages().len() {
                convert_pdf_to_word_soffice(input_path, &staging).map_err(|fallback_error| {
                    format!("{}; LibreOffice: {}", primary_error, fallback_error)
                })
            } else {
                Err(primary_error)
            }
        })
        .and_then(|engine| {
            // Validate the package before publishing; a failed conversion never touches the destination.
            let file = File::open(&staging).map_err(|e| e.to_string())?;
            let mut archive =
                zip::ZipArchive::new(file).map_err(|e| format!("无效 DOCX: {}", e))?;
            let mut xml = String::new();
            archive.by_name("word/document.xml").map_err(|e| format!("无效 DOCX: {}", e))?
                .read_to_string(&mut xml).map_err(|e| e.to_string())?;
            let has_text = regex::Regex::new(r"<w:t(?:\s[^>]*)?>[^<]+</w:t>").unwrap().is_match(&xml);
            let has_image = archive.file_names().filter_map(Result::ok).any(|name| name.starts_with("word/media/"));
            let source_has_image = pages.len() == document.get_pages().len() && document.objects.values().any(|object| object.as_stream().ok()
                .and_then(|stream| stream.dict.get(b"Subtype").ok())
                .and_then(|subtype| subtype.as_name().ok()) == Some(b"Image"));
            let source_has_text = document.extract_text(&pages).map(|text| !text.trim().is_empty()).unwrap_or(false);
            if (!has_text && !has_image) || (source_has_text && !has_text) || (source_has_image && !has_image) {
                return Err("转换结果缺少文字或图片，已停止输出".to_string());
            }
            drop(archive);
            publish_without_overwrite(&staging, output_path)
                .map_err(|e| format!("无法保存文件（目标可能已存在）: {}", e))?;
            Ok(engine)
        });
    let _ = fs::remove_file(&staging);
    result.map_err(|e| {
        format!(
            "PDF 转 Word 失败：{}。需要 pdf2docx；未使用会丢失表格和图片的纯文本转换。",
            e
        )
    })
}

/// Convert a single Word file (.docx or .doc) to PDF (.pdf)
pub fn convert_single_word_to_pdf(input_path: &Path, output_path: &Path) -> Result<String, String> {
    if output_path.exists() { return Err("目标文件已存在，请选择其他文件名".to_string()); }
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
            publish_without_overwrite(&staging, output_path).map_err(|e| format!("无法保存文件（目标可能已存在）: {}", e))?;
            Ok(name)
        }) {
            Ok(name) => { let _ = fs::remove_file(&staging); return Ok(name); }
            Err(error) => errors.push(error),
        }
    }
    let _ = fs::remove_file(&staging);
    Err(format!("Word 转 PDF 失败，需要 LibreOffice、Pages 或 Microsoft Word：{}", errors.join("; ")))
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
from pdf2docx import Converter
cv = Converter(sys.argv[1])
try:
    # Rust validates and normalizes page numbers before invoking this engine.
    pages = [int(page) - 1 for page in sys.argv[3].split(',')]
    cv.convert(sys.argv[2], pages=pages)
    import fitz
    from docx import Document
    source = fitz.open(sys.argv[1])
    result = Document(sys.argv[2])
    source_has_images = any(source[p].get_images() for p in pages)
    output_has_images = any('/image' in rel.reltype for rel in result.part.rels.values())
    output_has_text = any(p.text.strip() for p in result.paragraphs) or any(
        cell.text.strip() for table in result.tables for row in table.rows for cell in row.cells)
    source_has_text = any(source[p].get_text().strip() for p in pages)
    if source_has_text and not output_has_text:
        raise RuntimeError('文字未保留，已停止输出')
    if source_has_images and not output_has_images:
        raise RuntimeError('图片未保留，已停止输出；扫描件需要 OCR 或保留图像的转换引擎')
    if not output_has_text and not output_has_images:
        raise RuntimeError('转换结果为空，扫描件可能需要 OCR')
    if not any(source[p].get_text().strip() for p in pages):
        print('IMAGE_ONLY')
    source.close()
finally:
    cv.close()
"#;

    let pr = page_range.unwrap_or("all");
    let output = python_command("pdf2docx")?
        .args([
            "-c",
            script,
            &input_path.to_string_lossy(),
            &output_path.to_string_lossy(),
            pr,
        ])
        .bounded_output()
        .map_err(|e| format!("启动 python3 失败: {}", e))?;

    if output.status.success()
        && output_path.exists()
        && fs::metadata(output_path).map(|m| m.len()).unwrap_or(0) > 0
    {
        if String::from_utf8_lossy(&output.stdout).contains("IMAGE_ONLY") {
            Ok("pdf2docx（图像版，内容不可编辑）".to_string())
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

fn convert_pdf_to_word_soffice(input_path: &Path, output_path: &Path) -> Result<String, String> {
    let soffice = get_soffice_cmd().ok_or_else(|| "未找到 LibreOffice/soffice".to_string())?;
    let temporary = TemporaryDirectory::create()?;
    let temp_dir = &temporary.0;
    let profile = format!("-env:UserInstallation={}", office_profile_url(&temp_dir.join("profile")));

    let output = Command::new(&soffice)
        .args([
            &profile,
            "--headless",
            "--infilter=writer_pdf_import",
            "--convert-to",
            "docx",
            "--outdir",
            &temp_dir.to_string_lossy(),
            &input_path.to_string_lossy(),
        ])
        .bounded_output()
        .map_err(|e| format!("执行 soffice 失败: {}", e))?;

    if output.status.success() {
        let stem = input_path.file_stem().unwrap().to_string_lossy();
        let generated = temp_dir.join(format!("{}.docx", stem));
        if generated.exists() {
            fs::copy(&generated, output_path).map_err(|e| e.to_string())?;
            let _ = fs::remove_dir_all(&temp_dir);
            return Ok("LibreOffice 专业引擎".to_string());
        }
    }

    let _ = fs::remove_dir_all(&temp_dir);
    Err("LibreOffice PDF导入转换失败".to_string())
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
}
