use crate::models::{
    ConvertEngineStatus, ConvertItemResult, ConvertRequest, ConvertResult,
};
use lopdf::content::{Content, Operation};
use lopdf::{Dictionary, Document, Object, Stream};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// Check availability of various conversion engines
pub fn check_convert_engines() -> ConvertEngineStatus {
    let pdf2docx_available = Command::new("python3")
        .args(["-c", "import pdf2docx"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let docx2pdf_available = Command::new("python3")
        .args(["-c", "import docx2pdf"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let soffice_available = get_soffice_cmd().is_some();

    let pandoc_available = Command::new("pandoc")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let chrome_available = get_browser_cmd().is_some();

    #[cfg(target_os = "macos")]
    let pages_available = Path::new("/Applications/Pages.app").exists()
        || Command::new("osascript")
            .args(["-e", "id of app \"Pages\""])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

    #[cfg(not(target_os = "macos"))]
    let pages_available = false;

    #[cfg(target_os = "macos")]
    let word_available = Path::new("/Applications/Microsoft Word.app").exists()
        || Command::new("osascript")
            .args(["-e", "id of app \"Microsoft Word\""])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

    #[cfg(target_os = "windows")]
    let word_available = Command::new("powershell")
        .args([
            "-Command",
            "try { $w = New-Object -ComObject Word.Application; $w.Quit(); exit 0 } catch { exit 1 }",
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let word_available = false;

    ConvertEngineStatus {
        pdf2docx_available,
        docx2pdf_available,
        soffice_available,
        pandoc_available,
        chrome_available,
        pages_available,
        word_available,
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
        let target_ext = match item.target_format.to_lowercase().as_str() {
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
        };

        // Determine destination output path
        let output_path = if let Some(ref custom_out) = item.output_path {
            if !custom_out.trim().is_empty() {
                PathBuf::from(custom_out)
            } else {
                generate_output_path(input_path, &target_ext, request.default_output_dir.as_deref())
            }
        } else {
            generate_output_path(input_path, &target_ext, request.default_output_dir.as_deref())
        };

        // Create parent directories if needed
        if let Some(parent) = output_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        // Perform conversion
        let conv_res = if target_ext == "docx" || target_ext == "doc" {
            convert_single_pdf_to_word(input_path, &output_path, item.page_range.as_deref())
        } else if target_ext == "pdf" {
            convert_single_word_to_pdf(input_path, &output_path)
        } else {
            Err(format!("不支持的目标格式: {}", target_ext))
        };

        match conv_res {
            Ok(engine) => {
                let converted_size = fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);
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
    let mut errors = Vec::new();

    // Strategy 1: Python pdf2docx (AI layout analysis, preserves tables, fonts, formatting)
    match convert_pdf_to_word_pdf2docx(input_path, output_path, page_range) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("pdf2docx: {}", e)),
    }

    // Strategy 2: LibreOffice (soffice writer_pdf_import)
    match convert_pdf_to_word_soffice(input_path, output_path) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("LibreOffice: {}", e)),
    }

    // Strategy 3: PyMuPDF / fitz + Pandoc
    match convert_pdf_to_word_fitz_pandoc(input_path, output_path) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("PyMuPDF+Pandoc: {}", e)),
    }

    // Strategy 4: pdftotext + Pandoc
    match convert_pdf_to_word_pdftotext_pandoc(input_path, output_path) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("pdftotext+Pandoc: {}", e)),
    }

    // Strategy 5: Pure Rust native OpenXML DOCX generator
    match convert_pdf_to_word_native(input_path, output_path, page_range) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("Native DOCX: {}", e)),
    }

    Err(format!(
        "所有转换引擎均未能完成转换: {}",
        errors.join("; ")
    ))
}

/// Convert a single Word file (.docx or .doc) to PDF (.pdf)
pub fn convert_single_word_to_pdf(
    input_path: &Path,
    output_path: &Path,
) -> Result<String, String> {
    let mut errors = Vec::new();

    // Strategy 1: LibreOffice soffice
    match convert_word_to_pdf_soffice(input_path, output_path) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("LibreOffice: {}", e)),
    }

    // Strategy 2: Apple Pages on macOS
    #[cfg(target_os = "macos")]
    match convert_word_to_pdf_pages(input_path, output_path) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("Apple Pages: {}", e)),
    }

    // Strategy 3: Microsoft Word
    match convert_word_to_pdf_msword(input_path, output_path) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("MS Word: {}", e)),
    }

    // Strategy 4: Headless Chrome / Edge / Chromium + Pandoc / textutil
    match convert_word_to_pdf_browser(input_path, output_path) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("Headless Browser: {}", e)),
    }

    // Strategy 5: Python docx2pdf
    match convert_word_to_pdf_docx2pdf(input_path, output_path) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("docx2pdf: {}", e)),
    }

    // Strategy 6: Pure Rust fallback (text extraction from docx to PDF)
    match convert_word_to_pdf_native(input_path, output_path) {
        Ok(engine) => return Ok(engine),
        Err(e) => errors.push(format!("Native DOCX->PDF: {}", e)),
    }

    Err(format!(
        "所有 Word 转 PDF 引擎均未能完成转换: {}",
        errors.join("; ")
    ))
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
import sys, re
import docx
from docx.shared import Inches, Pt
from docx.enum.text import WD_TAB_ALIGNMENT, WD_TAB_LEADER
from pdf2docx import Converter
import pdf2docx.text.Lines as lines_module
import pdf2docx.layout.Blocks as blocks_module

in_p = sys.argv[1]
out_p = sys.argv[2]
range_str = sys.argv[3] if len(sys.argv) > 3 else "all"

TOC_PATTERN = re.compile(r'(\.{2,}|…+|·+|—+|-+|\s{3,})\s*\d+\s*$')

# Pre-patch 1: Lines.split_vertically_by_text - prevent TOC lines from collapsing into one paragraph
orig_split = lines_module.Lines.split_vertically_by_text
def custom_split(self, line_break_free_space_ratio, new_paragraph_free_space_ratio):
    rows = self.group_by_physical_rows()
    for row in rows:
        row.sort_in_line_order()
    if len(rows) <= 1:
        return rows
    is_toc = any(TOC_PATTERN.search(row.text().strip()) for row in rows)
    if is_toc:
        res = []
        for row in rows:
            l = lines_module.Lines()
            l.extend(row)
            res.append(l)
        return res
    return orig_split(self, line_break_free_space_ratio, new_paragraph_free_space_ratio)

lines_module.Lines.split_vertically_by_text = custom_split

# Pre-patch 2: Lines.parse_line_break - ensure each TOC line has a line break
orig_parse_lb = lines_module.Lines.parse_line_break
def custom_parse_line_break(self, bbox, line_break_width_ratio, line_break_free_space_ratio):
    rows = self.group_by_physical_rows()
    is_toc = any(TOC_PATTERN.search(row.text().strip()) for row in rows)
    if is_toc:
        for lines in rows:
            for line in lines:
                line.line_break = 0
            if len(lines) > 0:
                lines[-1].line_break = 1
        return
    return orig_parse_lb(self, bbox, line_break_width_ratio, line_break_free_space_ratio)

lines_module.Lines.parse_line_break = custom_parse_line_break

# Pre-patch 3: Blocks._remove_overlapped_lines - do not delete page numbers overlapping leader dots
orig_remove_overlap = blocks_module.Blocks._remove_overlapped_lines
def custom_remove_overlap(self, line_overlap_threshold: float):
    fun = lambda a, b: a.get_main_bbox(b, threshold=line_overlap_threshold)
    groups = self.group(fun)
    for group in filter(lambda g: len(g) > 1, groups):
        has_page_num = any(line.text.strip().isdigit() for line in group)
        has_dots = any('.' in line.text for line in group)
        if has_page_num and has_dots:
            num_line = next(line for line in group if line.text.strip().isdigit())
            for line in group:
                if line != num_line and '.' in line.text:
                    x0, y0, x1, y1 = line.bbox
                    if x1 > num_line.bbox[0]:
                        line.update_bbox((x0, y0, max(x0, num_line.bbox[0] - 2), y1))
            continue
        sorted_lines = sorted(group, key=lambda line: line.bbox.get_area())
        for line in sorted_lines[:-1]:
            if line.text.strip().isdigit():
                continue
            line.update_bbox((0, 0, 0, 0))
    return self

blocks_module.Blocks._remove_overlapped_lines = custom_remove_overlap

# Convert PDF to Word
cv = Converter(in_p)
if range_str.strip().lower() == "all" or not range_str.strip():
    cv.convert(out_p)
else:
    pages = []
    for part in range_str.split(','):
        part = part.strip()
        if '-' in part:
            s, e = part.split('-', 1)
            pages.extend(range(int(s)-1, int(e)))
        elif part.isdigit():
            pages.append(int(part)-1)
    cv.convert(out_p, pages=pages)
cv.close()

# Post-processing: repair any glued or wrapped TOC paragraphs with native Word right tab stops
try:
    doc = docx.Document(out_p)
    section = doc.sections[0]
    page_w = section.page_width
    left_m = section.left_margin or Inches(1.0)
    right_m = section.right_margin or Inches(1.0)
    tab_stop_pos = page_w - left_m - right_m

    TOC_ENTRY = re.compile(r'^(.*?)[.·…—\s]{2,}(\d+)\s*$')
    HEADING_LOOKAHEAD = r'(?=(?:[一二三四五六七八九十百]+[、.．]|\([一二三四五六七八九十\d]+\)|（[一二三四五六七八九十\d]+）|\d+[\.、．]|\d+\.\d+|第[一二三四五六七八九十\d]+[章节部分篇]))'
    TOC_COLLISION = re.compile(r'(\d+)\s*' + HEADING_LOOKAHEAD)
    GENERAL_TOC_COLLISION = re.compile(r'([.·…—]{2,}\s*\d+)\s+(?=[^\n]+?[.·…—]{2,}\s*\d+)')

    modified = False
    new_doc = docx.Document()
    for s_old, s_new in zip(doc.sections, new_doc.sections):
        s_new.page_width = s_old.page_width
        s_new.page_height = s_old.page_height
        s_new.left_margin = s_old.left_margin
        s_new.right_margin = s_old.right_margin
        s_new.top_margin = s_old.top_margin
        s_new.bottom_margin = s_old.bottom_margin

    for p in doc.paragraphs:
        raw_text = p.text.strip()
        if not raw_text:
            new_doc.add_paragraph()
            continue

        t = TOC_COLLISION.sub(r'\1\n', raw_text)
        t = GENERAL_TOC_COLLISION.sub(r'\1\n', t)
        lines = [l.strip() for l in t.split('\n') if l.strip()]

        has_toc = any(TOC_ENTRY.search(l) for l in lines)
        if has_toc and len(lines) > 0:
            modified = True
            for l in lines:
                m = TOC_ENTRY.search(l)
                if m:
                    title = m.group(1).strip()
                    pg = m.group(2).strip()
                    title = re.sub(r'[.·…—\s]+$', '', title).strip()

                    p_toc = new_doc.add_paragraph()
                    p_toc.paragraph_format.tab_stops.add_tab_stop(
                        tab_stop_pos, WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS
                    )
                    p_toc.paragraph_format.line_spacing = 1.3
                    p_toc.paragraph_format.space_after = Pt(2)

                    r_title = p_toc.add_run(title)
                    r_title.font.size = Pt(10.5)

                    r_tab = p_toc.add_run('\t')

                    r_pg = p_toc.add_run(pg)
                    r_pg.font.size = Pt(10.5)
                else:
                    new_doc.add_paragraph(l)
        else:
            p_new = new_doc.add_paragraph()
            p_new.alignment = p.alignment
            p_new.paragraph_format.space_before = p.paragraph_format.space_before
            p_new.paragraph_format.space_after = p.paragraph_format.space_after
            p_new.paragraph_format.line_spacing = p.paragraph_format.line_spacing
            for r in p.runs:
                r_new = p_new.add_run(r.text)
                r_new.bold = r.bold
                r_new.italic = r.italic
                r_new.font.size = r.font.size
                r_new.font.name = r.font.name

    for t in doc.tables:
        new_t = new_doc.add_table(rows=len(t.rows), cols=len(t.columns))
        for r_idx, row in enumerate(t.rows):
            for c_idx, cell in enumerate(row.cells):
                new_t.cell(r_idx, c_idx).text = cell.text

    if modified:
        new_doc.save(out_p)
except Exception as e:
    sys.stderr.write(f'TOC post-process notice: {e}\n')
"#;

    let pr = page_range.unwrap_or("all");
    let output = Command::new("python3")
        .args([
            "-c",
            script,
            &input_path.to_string_lossy(),
            &output_path.to_string_lossy(),
            pr,
        ])
        .output()
        .map_err(|e| format!("启动 python3 失败: {}", e))?;

    if output.status.success() && output_path.exists() && fs::metadata(output_path).map(|m| m.len()).unwrap_or(0) > 0 {
        Ok("pdf2docx 智能排版引擎".to_string())
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
    let temp_dir = std::env::temp_dir().join(format!("doctools_soffice_p2w_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
    let _ = fs::create_dir_all(&temp_dir);

    let output = Command::new(&soffice)
        .args([
            "--headless",
            "--infilter=writer_pdf_import",
            "--convert-to",
            "docx",
            "--outdir",
            &temp_dir.to_string_lossy(),
            &input_path.to_string_lossy(),
        ])
        .output()
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

fn convert_pdf_to_word_fitz_pandoc(input_path: &Path, output_path: &Path) -> Result<String, String> {
    let script = r#"
import sys
try:
    import fitz
    doc = fitz.open(sys.argv[1])
    html = ''.join(page.get_text('html') for page in doc)
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        f.write(html)
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
"#;
    let temp_html = output_path.with_extension("temp.html");
    let out = Command::new("python3")
        .args([
            "-c",
            script,
            &input_path.to_string_lossy(),
            &temp_html.to_string_lossy(),
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if out.status.success() && temp_html.exists() {
        let pandoc_out = Command::new("pandoc")
            .args([
                &temp_html.to_string_lossy().to_string(),
                "-o",
                &output_path.to_string_lossy().to_string(),
            ])
            .output();

        let _ = fs::remove_file(&temp_html);

        if let Ok(p_res) = pandoc_out {
            if p_res.status.success() && output_path.exists() {
                return Ok("PyMuPDF + Pandoc 引擎".to_string());
            }
        }
    }

    let _ = fs::remove_file(&temp_html);
    Err("PyMuPDF/Pandoc 转换不可用".to_string())
}

fn convert_pdf_to_word_pdftotext_pandoc(
    input_path: &Path,
    output_path: &Path,
) -> Result<String, String> {
    let temp_txt = output_path.with_extension("temp.txt");

    let ptt = Command::new("pdftotext")
        .args([
            "-layout",
            &input_path.to_string_lossy(),
            &temp_txt.to_string_lossy(),
        ])
        .output();

    if let Ok(p_out) = ptt {
        if p_out.status.success() && temp_txt.exists() {
            let pandoc_out = Command::new("pandoc")
                .args([
                    &temp_txt.to_string_lossy().to_string(),
                    "-o",
                    &output_path.to_string_lossy().to_string(),
                ])
                .output();

            let _ = fs::remove_file(&temp_txt);

            if let Ok(po) = pandoc_out {
                if po.status.success() && output_path.exists() {
                    return Ok("pdftotext + Pandoc 引擎".to_string());
                }
            }
        }
    }

    let _ = fs::remove_file(&temp_txt);
    Err("pdftotext/Pandoc 转换不可用".to_string())
}

/// Pure Rust native OpenXML DOCX generator
fn convert_pdf_to_word_native(
    input_path: &Path,
    output_path: &Path,
    page_range: Option<&str>,
) -> Result<String, String> {
    let doc = Document::load(input_path).map_err(|e| format!("加载 PDF 失败: {}", e))?;
    let all_pages = doc.get_pages();
    let total_pages = all_pages.len() as u32;

    if total_pages == 0 {
        return Err("PDF 不包含任何页面".to_string());
    }

    let target_pages: Vec<u32> = match page_range {
        Some(pr) if !pr.trim().is_empty() && !pr.trim().eq_ignore_ascii_case("all") => {
            parse_page_range(pr, total_pages)
        }
        _ => (1..=total_pages).collect(),
    };

    let mut paragraphs: Vec<String> = Vec::new();

    for &page_num in &target_pages {
        if let Some(&page_id) = all_pages.get(&page_num) {
            let content_data = doc.get_page_content(page_id);
            if !content_data.is_empty() {
                if let Ok(content) = Content::decode(&content_data) {
                    let mut current_line = String::new();
                    for op in &content.operations {
                        let texts = extract_text_from_op(op);
                        for t in texts {
                            if !t.trim().is_empty() {
                                if !current_line.is_empty() {
                                    current_line.push(' ');
                                }
                                current_line.push_str(&t);
                            }
                        }
                        if op.operator == "ET" || op.operator == "T*" || op.operator == "TD" || op.operator == "Td" {
                            if !current_line.trim().is_empty() {
                                paragraphs.push(current_line.trim().to_string());
                                current_line = String::new();
                            }
                        }
                    }
                    if !current_line.trim().is_empty() {
                        paragraphs.push(current_line.trim().to_string());
                    }
                }
            }
        }
    }

    if paragraphs.is_empty() {
        // Lopdf standard text fallback
        paragraphs.push(format!("PDF 转换文档 (来源: {})", input_path.file_name().unwrap_or_default().to_string_lossy()));
    }

    write_native_docx(&paragraphs, output_path)?;
    Ok("DocTools 原生轻量引擎".to_string())
}

// =========================================================================
// Word to PDF implementations
// =========================================================================

fn convert_word_to_pdf_soffice(input_path: &Path, output_path: &Path) -> Result<String, String> {
    let soffice = get_soffice_cmd().ok_or_else(|| "未找到 LibreOffice/soffice".to_string())?;
    let parent_dir = output_path.parent().unwrap_or(Path::new("."));

    let output = Command::new(&soffice)
        .args([
            "--headless",
            "--convert-to",
            "pdf:writer_pdf_Export",
            "--outdir",
            &parent_dir.to_string_lossy(),
            &input_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("执行 soffice 失败: {}", e))?;

    if output.status.success() {
        let stem = input_path.file_stem().unwrap().to_string_lossy();
        let generated_pdf = parent_dir.join(format!("{}.pdf", stem));
        if generated_pdf.exists() {
            if generated_pdf != output_path {
                let _ = fs::rename(&generated_pdf, output_path);
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
        input_path.to_string_lossy(),
        output_path.to_string_lossy()
    );

    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("执行 AppleScript 失败: {}", e))?;

    // Quit Pages in background so it doesn't leave an empty window
    let _ = Command::new("osascript")
        .args(["-e", "tell application \"Pages\" to quit"])
        .output();

    if output.status.success() && output_path.exists() && fs::metadata(output_path).map(|m| m.len()).unwrap_or(0) > 0 {
        Ok("Apple Pages 原生渲染引擎".to_string())
    } else {
        Err(format!("Pages 导出失败: {}", String::from_utf8_lossy(&output.stderr)))
    }
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
            input_path.to_string_lossy(),
            output_path.to_string_lossy()
        );

        let output = Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() && output_path.exists() {
            return Ok("Microsoft Word 官方排版引擎".to_string());
        }
        return Err("Microsoft Word 未安装或导出失败".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let ps_script = format!(
            "$w = New-Object -ComObject Word.Application; $w.Visible = $False; $d = $w.Documents.Open('{}'); $d.SaveAs([ref]'{}', [ref]17); $d.Close(); $w.Quit();",
            input_path.to_string_lossy().replace("'", "''"),
            output_path.to_string_lossy().replace("'", "''")
        );

        let output = Command::new("powershell")
            .args(["-Command", &ps_script])
            .output()
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

fn convert_word_to_pdf_browser(input_path: &Path, output_path: &Path) -> Result<String, String> {
    let browser = get_browser_cmd().ok_or_else(|| "未找到 Chromium/Chrome/Edge 浏览器".to_string())?;
    let temp_html = output_path.with_extension("temp.html");

    // Convert docx to html using pandoc or macOS textutil
    let mut html_created = false;

    // Try pandoc first
    let pandoc_res = Command::new("pandoc")
        .args([
            &input_path.to_string_lossy().to_string(),
            "-s",
            "-o",
            &temp_html.to_string_lossy().to_string(),
        ])
        .output();

    if let Ok(po) = pandoc_res {
        if po.status.success() && temp_html.exists() {
            html_created = true;
        }
    }

    #[cfg(target_os = "macos")]
    if !html_created {
        let tu_res = Command::new("/usr/bin/textutil")
            .args([
                "-convert",
                "html",
                "-output",
                &temp_html.to_string_lossy().to_string(),
                &input_path.to_string_lossy().to_string(),
            ])
            .output();

        if let Ok(tu) = tu_res {
            if tu.status.success() && temp_html.exists() {
                html_created = true;
            }
        }
    }

    if !html_created {
        let _ = fs::remove_file(&temp_html);
        return Err("无法将 Word 转换为 HTML 中间格式".to_string());
    }

    // Print to PDF via Headless Browser
    let print_arg = format!("--print-to-pdf={}", output_path.to_string_lossy());
    let browser_out = Command::new(&browser)
        .args([
            "--headless=new",
            "--disable-gpu",
            "--no-pdf-header-footer",
            &print_arg,
            &temp_html.to_string_lossy().to_string(),
        ])
        .output();

    let _ = fs::remove_file(&temp_html);

    if let Ok(bo) = browser_out {
        if bo.status.success() && output_path.exists() && fs::metadata(output_path).map(|m| m.len()).unwrap_or(0) > 0 {
            return Ok("Chrome/Pandoc 矢量打印引擎".to_string());
        }
    }

    Err("浏览器打印转换失败".to_string())
}

fn convert_word_to_pdf_docx2pdf(input_path: &Path, output_path: &Path) -> Result<String, String> {
    let output = Command::new("python3")
        .args([
            "-m",
            "docx2pdf",
            &input_path.to_string_lossy(),
            &output_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() && output_path.exists() && fs::metadata(output_path).map(|m| m.len()).unwrap_or(0) > 0 {
        Ok("docx2pdf 引擎".to_string())
    } else {
        Err("docx2pdf 未成功转换".to_string())
    }
}

/// Pure Rust fallback for docx to PDF
fn convert_word_to_pdf_native(input_path: &Path, output_path: &Path) -> Result<String, String> {
    // Read word/document.xml from docx zip
    let file = File::open(input_path).map_err(|e| format!("打开 docx 文件失败: {}", e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("解析 docx 压缩结构失败: {}", e))?;

    let mut doc_xml = String::new();
    if let Ok(mut xml_file) = archive.by_name("word/document.xml") {
        let _ = xml_file.read_to_string(&mut doc_xml);
    } else {
        return Err("docx 中未找到 document.xml".to_string());
    }

    // Extract text inside <w:t> tags
    let mut paragraphs = Vec::new();
    let p_regex = regex::Regex::new(r"<w:p\b[^>]*>(.*?)</w:p>").unwrap();
    let t_regex = regex::Regex::new(r"<w:t\b[^>]*>(.*?)</w:t>").unwrap();

    for cap in p_regex.captures_iter(&doc_xml) {
        let p_content = &cap[1];
        let mut p_text = String::new();
        for t_cap in t_regex.captures_iter(p_content) {
            p_text.push_str(&t_cap[1]);
        }
        let clean = p_text.trim();
        if !clean.is_empty() {
            // Unescape XML entities
            let unescaped = clean
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&apos;", "'");
            paragraphs.push(unescaped);
        }
    }

    if paragraphs.is_empty() {
        paragraphs.push("Word 文档（未提取到文字内容）".to_string());
    }

    // Build standard A4 PDF document using lopdf
    let mut doc = Document::with_version("1.5");
    let a4_w = 595.28f32;
    let a4_h = 841.89f32;
    let margin = 50.0f32;

    let mut page_ids = Vec::new();
    let pages_id = (doc.max_id + 1, 0);
    doc.max_id += 1;

    let mut current_y = a4_h - margin;
    let mut page_ops: Vec<Operation> = Vec::new();

    let flush_page = |doc: &mut Document, ops: &[Operation], page_ids: &mut Vec<Object>| -> Result<(), String> {
        let content_stream = Stream::new(Dictionary::new(), Content { operations: ops.to_vec() }.encode().unwrap_or_default());
        let content_id = doc.add_object(Object::Stream(content_stream));

        let mut font_dict = Dictionary::new();
        font_dict.set("Type", Object::Name(b"Font".to_vec()));
        font_dict.set("Subtype", Object::Name(b"Type1".to_vec()));
        font_dict.set("BaseFont", Object::Name(b"Helvetica".to_vec()));
        let font_id = doc.add_object(Object::Dictionary(font_dict));

        let mut fonts_dict = Dictionary::new();
        fonts_dict.set("F1", Object::Reference(font_id));

        let mut res_dict = Dictionary::new();
        res_dict.set("Font", Object::Dictionary(fonts_dict));

        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(pages_id));
        page_dict.set(
            "MediaBox",
            Object::Array(vec![
                Object::Real(0.0),
                Object::Real(0.0),
                Object::Real(a4_w),
                Object::Real(a4_h),
            ]),
        );
        page_dict.set("Resources", Object::Dictionary(res_dict));
        page_dict.set("Contents", Object::Reference(content_id));

        let pid = doc.add_object(Object::Dictionary(page_dict));
        page_ids.push(Object::Reference(pid));
        Ok(())
    };

    for p in &paragraphs {
        if current_y < margin + 40.0 {
            flush_page(&mut doc, &page_ops, &mut page_ids)?;
            page_ops.clear();
            current_y = a4_h - margin;
        }

        page_ops.push(Operation::new("BT", vec![]));
        page_ops.push(Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), Object::Real(12.0)]));
        page_ops.push(Operation::new("Td", vec![Object::Real(margin), Object::Real(current_y)]));
        page_ops.push(Operation::new("Tj", vec![Object::String(p.as_bytes().to_vec(), lopdf::StringFormat::Literal)]));
        page_ops.push(Operation::new("ET", vec![]));

        current_y -= 20.0;
    }

    if !page_ops.is_empty() || page_ids.is_empty() {
        flush_page(&mut doc, &page_ops, &mut page_ids)?;
    }

    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Count", Object::Integer(page_ids.len() as i64));
    pages_dict.set("Kids", Object::Array(page_ids));
    doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

    let catalog_id = (doc.max_id + 1, 0);
    doc.max_id += 1;
    let mut catalog_dict = Dictionary::new();
    catalog_dict.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog_dict.set("Pages", Object::Reference(pages_id));
    doc.objects.insert(catalog_id, Object::Dictionary(catalog_dict));
    doc.trailer.set("Root", Object::Reference(catalog_id));

    doc.save(output_path).map_err(|e| e.to_string())?;
    Ok("DocTools 原生轻量引擎".to_string())
}

// =========================================================================
// Helpers
// =========================================================================

fn generate_output_path(input_path: &Path, target_ext: &str, default_dir: Option<&str>) -> PathBuf {
    let stem = input_path.file_stem().and_then(|s| s.to_str()).unwrap_or("document");
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

pub fn get_soffice_cmd() -> Option<String> {
    let candidates = [
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/opt/homebrew/bin/soffice",
        "/usr/local/bin/soffice",
        "soffice",
        "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
        "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ];

    for c in candidates {
        if let Ok(output) = Command::new(c).arg("--version").output() {
            if output.status.success() {
                return Some(c.to_string());
            }
        }
    }
    None
}

pub fn get_browser_cmd() -> Option<String> {
    let candidates = [
        // macOS
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        // Windows
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        // Linux / PATH
        "google-chrome",
        "chromium-browser",
        "chromium",
        "microsoft-edge",
    ];

    for c in candidates {
        if Path::new(c).exists() {
            return Some(c.to_string());
        }
        if let Ok(output) = Command::new(c).arg("--version").output() {
            if output.status.success() {
                return Some(c.to_string());
            }
        }
    }
    None
}

fn parse_page_range(range_str: &str, total_pages: u32) -> Vec<u32> {
    let mut pages = Vec::new();
    let parts = range_str.split(',');
    for part in parts {
        let part = part.trim();
        if let Some((start_s, end_s)) = part.split_once('-') {
            if let (Ok(s), Ok(e)) = (start_s.trim().parse::<u32>(), end_s.trim().parse::<u32>()) {
                let start = s.max(1);
                let end = e.min(total_pages);
                for p in start..=end {
                    if !pages.contains(&p) {
                        pages.push(p);
                    }
                }
            }
        } else if let Ok(p) = part.parse::<u32>() {
            if p >= 1 && p <= total_pages && !pages.contains(&p) {
                pages.push(p);
            }
        }
    }
    if pages.is_empty() {
        (1..=total_pages).collect()
    } else {
        pages
    }
}

fn extract_text_from_op(op: &Operation) -> Vec<String> {
    let mut texts = Vec::new();
    match op.operator.as_str() {
        "Tj" | "'" => {
            if let Some(Object::String(bytes, _)) = op.operands.first() {
                let s = decode_pdf_string(bytes);
                if !s.is_empty() {
                    texts.push(s);
                }
            }
        }
        "\"" => {
            if let Some(Object::String(bytes, _)) = op.operands.get(2) {
                let s = decode_pdf_string(bytes);
                if !s.is_empty() {
                    texts.push(s);
                }
            }
        }
        "TJ" => {
            if let Some(Object::Array(arr)) = op.operands.first() {
                let mut combined = String::new();
                for item in arr {
                    if let Object::String(bytes, _) = item {
                        combined.push_str(&decode_pdf_string(bytes));
                    }
                }
                if !combined.is_empty() {
                    texts.push(combined);
                }
            }
        }
        _ => {}
    }
    texts
}

fn decode_pdf_string(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let u16_chars: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&u16_chars);
    }

    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }

    bytes.iter().map(|&b| b as char).collect()
}

fn write_native_docx(paragraphs: &[String], output_path: &Path) -> Result<(), String> {
    let file = File::create(output_path).map_err(|e| format!("无法创建输出文件: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // 1. [Content_Types].xml
    zip.start_file("[Content_Types].xml", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#,
    )
    .map_err(|e| e.to_string())?;

    // 2. _rels/.rels
    zip.start_file("_rels/.rels", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#,
    )
    .map_err(|e| e.to_string())?;

    // 3. word/document.xml
    zip.start_file("word/document.xml", options)
        .map_err(|e| e.to_string())?;

    let mut body_xml = String::new();
    body_xml.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
"#);

    let toc_re = regex::Regex::new(r"^(.*?)[.·…—\s]{2,}(\d+)\s*$").ok();

    for p in paragraphs {
        let p_trimmed = p.trim();
        if let (Some(re), true) = (&toc_re, !p_trimmed.is_empty()) {
            if let Some(caps) = re.captures(p_trimmed) {
                let raw_title = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let clean_title = raw_title.trim_end_matches(|c: char| c == '.' || c == '·' || c == '…' || c == '—' || c.is_whitespace()).trim();
                let page_num = caps.get(2).map(|m| m.as_str().trim()).unwrap_or("");

                if !clean_title.is_empty() && !page_num.is_empty() {
                    let esc_title = clean_title
                        .replace('&', "&amp;")
                        .replace('<', "&lt;")
                        .replace('>', "&gt;")
                        .replace('"', "&quot;")
                        .replace('\'', "&apos;");

                    let esc_pg = page_num
                        .replace('&', "&amp;")
                        .replace('<', "&lt;")
                        .replace('>', "&gt;");

                    body_xml.push_str(&format!(
                        "    <w:p>\n      <w:pPr>\n        <w:tabs>\n          <w:tab w:val=\"right\" w:leader=\"dot\" w:pos=\"9020\"/>\n        </w:tabs>\n      </w:pPr>\n      <w:r><w:t xml:space=\"preserve\">{}</w:t><w:tab/><w:t>{}</w:t></w:r>\n    </w:p>\n",
                        esc_title, esc_pg
                    ));
                    continue;
                }
            }
        }

        let escaped = p
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;");

        body_xml.push_str(&format!(
            "    <w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>\n",
            escaped
        ));
    }

    body_xml.push_str("    <w:sectPr/>\n  </w:body>\n</w:document>");

    zip.write_all(body_xml.as_bytes())
        .map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| format!("完成 docx 写入失败: {}", e))?;
    Ok(())
}
