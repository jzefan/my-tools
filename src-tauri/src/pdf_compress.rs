use crate::models::{CompressRequest, CompressResult};
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::DynamicImage;
use lopdf::{Document, Object};
use std::fs;
use std::path::Path;
use std::process::Command;

pub fn compress_pdf(request: CompressRequest) -> Result<CompressResult, String> {
    let input_path = Path::new(&request.input_path);
    if !input_path.exists() {
        return Err(format!("输入文件不存在: {}", request.input_path));
    }

    let original_size = fs::metadata(input_path)
        .map_err(|e| e.to_string())?
        .len();

    let output_path = Path::new(&request.output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建输出目录: {}", e))?;
    }

    // Try Ghostscript if requested and available
    let gs_available = check_ghostscript_available();
    let use_gs = request.use_advanced_engine && gs_available;

    let res = if use_gs {
        compress_with_ghostscript(&request)
    } else {
        compress_native(&request)
    };

    match res {
        Ok(_) => {
            let compressed_size = fs::metadata(output_path)
                .map_err(|e| e.to_string())?
                .len();

            let reduction_percent = if original_size > 0 {
                let diff = original_size as f64 - compressed_size as f64;
                ((diff / original_size as f64) * 100.0).max(0.0)
            } else {
                0.0
            };

            let engine_name = if use_gs { "Ghostscript 专业引擎" } else { "DocTools 原生引擎" };
            let message = format!(
                "压缩完成（{}）！体积由 {} 减少至 {}，缩减了 {:.1}%",
                engine_name,
                format_file_size(original_size),
                format_file_size(compressed_size),
                reduction_percent
            );

            Ok(CompressResult {
                success: true,
                original_size,
                compressed_size,
                reduction_percent,
                output_path: request.output_path,
                message,
            })
        }
        Err(e) => {
            // If Ghostscript failed, try fallback to native
            if use_gs {
                match compress_native(&request) {
                    Ok(_) => {
                        let compressed_size = fs::metadata(output_path)
                            .map_err(|e| e.to_string())?
                            .len();
                        let reduction_percent = if original_size > 0 {
                            let diff = original_size as f64 - compressed_size as f64;
                            ((diff / original_size as f64) * 100.0).max(0.0)
                        } else {
                            0.0
                        };
                        Ok(CompressResult {
                            success: true,
                            original_size,
                            compressed_size,
                            reduction_percent,
                            output_path: request.output_path,
                            message: format!(
                                "原生引擎压缩完成！体积由 {} 减少至 {}，缩减了 {:.1}%",
                                format_file_size(original_size),
                                format_file_size(compressed_size),
                                reduction_percent
                            ),
                        })
                    }
                    Err(native_err) => Err(format!("压缩失败: {}; 原生回退也失败: {}", e, native_err)),
                }
            } else {
                Err(format!("压缩失败: {}", e))
            }
        }
    }
}

pub fn check_ghostscript_available() -> bool {
    let candidates = [
        "/opt/homebrew/bin/gs",
        "/usr/local/bin/gs",
        "/usr/bin/gs",
        "gs",
        "gswin64c.exe",
        "gswin32c.exe",
    ];

    for c in candidates {
        if let Ok(output) = Command::new(c).arg("--version").output() {
            if output.status.success() {
                return true;
            }
        }
    }
    false
}

fn get_ghostscript_cmd() -> Option<String> {
    let candidates = [
        "/opt/homebrew/bin/gs",
        "/usr/local/bin/gs",
        "/usr/bin/gs",
        "gs",
        "gswin64c.exe",
        "gswin32c.exe",
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

fn compress_with_ghostscript(request: &CompressRequest) -> Result<(), String> {
    let gs = get_ghostscript_cmd().ok_or_else(|| "未找到 Ghostscript".to_string())?;

    let pdf_setting = match request.max_dpi {
        0..=90 => "/screen",      // ~72 DPI
        91..=180 => "/ebook",     // ~150 DPI
        181..=250 => "/printer",  // ~300 DPI
        _ => "/prepress",
    };

    let status = Command::new(gs)
        .args([
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            &format!("-dPDFSETTINGS={}", pdf_setting),
            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH",
            "-dColorImageDownsampleType=/Bicubic",
            &format!("-dColorImageResolution={}", request.max_dpi),
            "-dGrayImageDownsampleType=/Bicubic",
            &format!("-dGrayImageResolution={}", request.max_dpi),
            "-dOptimize=true",
            "-dFastWebView=true",
            &format!("-sOutputFile={}", request.output_path),
            &request.input_path,
        ])
        .output()
        .map_err(|e| format!("执行 Ghostscript 失败: {}", e))?;

    if status.status.success() {
        Ok(())
    } else {
        let err_msg = String::from_utf8_lossy(&status.stderr);
        Err(format!("Ghostscript 错误: {}", err_msg))
    }
}

pub fn compress_native(request: &CompressRequest) -> Result<(), String> {
    let mut doc = Document::load(&request.input_path)
        .map_err(|e| format!("无法加载 PDF 文档: {}", e))?;

    // Determine target max dimension from DPI
    let max_dim = match request.max_dpi {
        0..=80 => 750,
        81..=120 => 1000,
        121..=200 => 1600,
        _ => 2400,
    };

    // Recompress image objects
    let object_ids: Vec<lopdf::ObjectId> = doc.objects.keys().copied().collect();

    for id in object_ids {
        if let Some(Object::Stream(stream)) = doc.objects.get_mut(&id) {
            let is_image = stream.dict.get(b"Subtype").ok().and_then(|obj| {
                if let Object::Name(name) = obj {
                    Some(name.as_slice() == b"Image")
                } else {
                    None
                }
            }).unwrap_or(false);

            if is_image {
                // Try decompressing image stream content
                if let Ok(decompressed) = stream.decompressed_content() {
                    let width = stream.dict.get(b"Width").ok().and_then(|w| {
                        if let Object::Integer(v) = w { Some(*v as u32) } else { None }
                    });
                    let height = stream.dict.get(b"Height").ok().and_then(|h| {
                        if let Object::Integer(v) = h { Some(*v as u32) } else { None }
                    });

                    let decoded_img = if let (Some(w), Some(h)) = (width, height) {
                        if decompressed.len() == (w * h * 3) as usize {
                            image::RgbImage::from_raw(w, h, decompressed)
                                .map(DynamicImage::ImageRgb8)
                        } else if decompressed.len() == (w * h) as usize {
                            image::GrayImage::from_raw(w, h, decompressed)
                                .map(DynamicImage::ImageLuma8)
                        } else {
                            image::load_from_memory(&decompressed).ok()
                        }
                    } else {
                        image::load_from_memory(&decompressed).ok()
                    };

                    if let Some(img) = decoded_img {
                        let (cur_w, cur_h) = (img.width(), img.height());
                        let target_img = if cur_w > max_dim || cur_h > max_dim {
                            let ratio = (max_dim as f32 / cur_w as f32).min(max_dim as f32 / cur_h as f32);
                            let new_w = ((cur_w as f32 * ratio) as u32).max(1);
                            let new_h = ((cur_h as f32 * ratio) as u32).max(1);
                            img.resize(new_w, new_h, FilterType::Triangle)
                        } else {
                            img
                        };

                        // Encode as JPEG with target quality
                        let mut jpeg_buf = Vec::new();
                        let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_buf, request.quality);
                        let encode_res = encoder.encode_image(&target_img);

                        if encode_res.is_ok() && !jpeg_buf.is_empty() {
                            stream.content = jpeg_buf;
                            stream.dict.set("Width", Object::Integer(target_img.width() as i64));
                            stream.dict.set("Height", Object::Integer(target_img.height() as i64));
                            stream.dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
                            stream.dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
                            stream.dict.set("BitsPerComponent", Object::Integer(8));
                        }
                    }
                }
            }
        }
    }

    // Strip metadata if requested
    if request.strip_metadata {
        doc.trailer.remove(b"Info");
        let keys_to_remove: Vec<lopdf::ObjectId> = doc
            .objects
            .iter()
            .filter_map(|(id, obj)| {
                if let Object::Dictionary(dict) = obj {
                    if let Ok(type_name) = dict.get(b"Type") {
                        if let Object::Name(n) = type_name {
                            if n.as_slice() == b"Metadata" {
                                return Some(*id);
                            }
                        }
                    }
                }
                None
            })
            .collect();

        for id in keys_to_remove {
            doc.objects.remove(&id);
        }
    }

    doc.prune_objects();
    doc.compress();
    doc.save(&request.output_path)
        .map_err(|e| format!("无法保存压缩后的 PDF: {}", e))?;

    Ok(())
}

fn format_file_size(size: u64) -> String {
    if size < 1024 {
        format!("{} B", size)
    } else if size < 1024 * 1024 {
        format!("{:.1} KB", size as f64 / 1024.0)
    } else {
        format!("{:.2} MB", size as f64 / (1024.0 * 1024.0))
    }
}
