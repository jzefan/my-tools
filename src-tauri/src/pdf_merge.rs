use crate::models::{MergeRequest, OperationResult};
use flate2::write::ZlibEncoder;
use flate2::Compression;
use image::GenericImageView;
use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn merge_documents(request: MergeRequest) -> Result<OperationResult, String> {
    if request.items.is_empty() {
        return Err("请至少选择一个需要合并的文件".to_string());
    }

    let output_path = PathBuf::from(&request.output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建输出目录: {}", e))?;
    }

    // Step 1: Normalize all items into PDFs (convert images/docx to temporary PDFs)
    let temp_dir = std::env::temp_dir().join(format!("doctools_merge_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("无法创建临时目录: {}", e))?;

    let mut pdf_files: Vec<(PathBuf, Option<String>)> = Vec::new();

    for (idx, item) in request.items.iter().enumerate() {
        let path = Path::new(&item.path);
        if !path.exists() {
            return Err(format!("文件不存在: {}", item.path));
        }

        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        match ext.as_str() {
            "pdf" => {
                pdf_files.push((path.to_path_buf(), item.page_range.clone()));
            }
            "png" | "jpg" | "jpeg" | "webp" | "bmp" | "tiff" => {
                let temp_pdf = temp_dir.join(format!("img_{}.pdf", idx));
                convert_image_to_pdf(path, &temp_pdf)
                    .map_err(|e| format!("转换图片失败 [{}]: {}", item.name, e))?;
                pdf_files.push((temp_pdf, None));
            }
            "docx" | "doc" => {
                let temp_pdf = temp_dir.join(format!("doc_{}.pdf", idx));
                convert_word_to_pdf(path, &temp_pdf)
                    .map_err(|e| format!("转换 Word 文档失败 [{}]: {}", item.name, e))?;
                pdf_files.push((temp_pdf, None));
            }
            _ => {
                return Err(format!("不支持的文件格式: {}", item.name));
            }
        }
    }

    // Step 2: Merge the PDF files into a single master document
    let merge_res = combine_pdf_files(&pdf_files, &output_path);

    // Clean up temporary files
    let _ = fs::remove_dir_all(&temp_dir);

    match merge_res {
        Ok(total_pages) => Ok(OperationResult {
            success: true,
            message: format!("合并成功！共合并 {} 个文件，包含 {} 页", request.items.len(), total_pages),
            output_path: Some(output_path.to_string_lossy().to_string()),
            details: Some(serde_json::json!({
                "file_count": request.items.len(),
                "total_pages": total_pages,
            })),
        }),
        Err(e) => Err(format!("合并失败: {}", e)),
    }
}

pub fn convert_image_to_pdf(image_path: &Path, output_pdf: &Path) -> Result<(), String> {
    let img = image::open(image_path).map_err(|e| format!("无法加载图片: {}", e))?;
    let img_rgb = img.to_rgb8();
    let (width, height) = img.dimensions();

    let mut doc = Document::with_version("1.5");

    // A4 standard points: 595.28 x 841.89
    let a4_w = 595.28f32;
    let a4_h = 841.89f32;
    let margin = 36.0f32;

    let usable_w = a4_w - margin * 2.0;
    let usable_h = a4_h - margin * 2.0;

    let scale_w = usable_w / width as f32;
    let scale_h = usable_h / height as f32;
    let scale = scale_w.min(scale_h).min(1.0);

    let draw_w = width as f32 * scale;
    let draw_h = height as f32 * scale;
    let offset_x = (a4_w - draw_w) / 2.0;
    let offset_y = (a4_h - draw_h) / 2.0;

    // Compress raw RGB bytes using Flate (zlib)
    let raw_bytes = img_rgb.into_raw();
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&raw_bytes).map_err(|e| e.to_string())?;
    let compressed_data = encoder.finish().map_err(|e| e.to_string())?;

    // Image XObject dictionary
    let mut img_dict = Dictionary::new();
    img_dict.set("Type", Object::Name(b"XObject".to_vec()));
    img_dict.set("Subtype", Object::Name(b"Image".to_vec()));
    img_dict.set("Width", Object::Integer(width as i64));
    img_dict.set("Height", Object::Integer(height as i64));
    img_dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
    img_dict.set("BitsPerComponent", Object::Integer(8));
    img_dict.set("Filter", Object::Name(b"FlateDecode".to_vec()));

    let img_stream = Stream::new(img_dict, compressed_data);
    let img_id = doc.add_object(Object::Stream(img_stream));

    // Content stream to position and draw the image
    let content_ops = format!(
        "q\n{:.3} 0 0 {:.3} {:.3} {:.3} cm\n/Im0 Do\nQ\n",
        draw_w, draw_h, offset_x, offset_y
    );
    let content_stream = Stream::new(Dictionary::new(), content_ops.into_bytes());
    let content_id = doc.add_object(Object::Stream(content_stream));

    // Resources dictionary
    let mut xobject_dict = Dictionary::new();
    xobject_dict.set("Im0", Object::Reference(img_id));

    let mut resources_dict = Dictionary::new();
    resources_dict.set("XObject", Object::Dictionary(xobject_dict));

    // Page dictionary
    let pages_id = (doc.max_id + 1, 0);
    doc.max_id += 1;

    let mut page_dict = Dictionary::new();
    page_dict.set("Type", Object::Name(b"Page".to_vec()));
    page_dict.set("Parent", Object::Reference(pages_id));
    page_dict.set(
        "MediaBox",
        Object::Array(vec![
            Object::Real(0.0f32),
            Object::Real(0.0f32),
            Object::Real(a4_w),
            Object::Real(a4_h),
        ]),
    );
    page_dict.set("Resources", Object::Dictionary(resources_dict));
    page_dict.set("Contents", Object::Reference(content_id));

    let page_id = doc.add_object(Object::Dictionary(page_dict));

    // Pages dictionary
    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Count", Object::Integer(1));
    pages_dict.set("Kids", Object::Array(vec![Object::Reference(page_id)]));

    doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

    // Catalog dictionary
    let catalog_id = (doc.max_id + 1, 0);
    doc.max_id += 1;
    let mut catalog_dict = Dictionary::new();
    catalog_dict.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog_dict.set("Pages", Object::Reference(pages_id));

    doc.objects.insert(catalog_id, Object::Dictionary(catalog_dict));
    doc.trailer.set("Root", Object::Reference(catalog_id));

    doc.save(output_pdf).map_err(|e| format!("保存生成的 PDF 失败: {}", e))?;
    Ok(())
}

pub fn convert_word_to_pdf(doc_path: &Path, output_pdf: &Path) -> Result<(), String> {
    crate::pdf_convert::convert_single_word_to_pdf(doc_path, output_pdf).map(|_| ())
}

fn parse_page_range(range_str: &str, total_pages: u32) -> Vec<u32> {
    if range_str.trim().is_empty() || range_str.trim().eq_ignore_ascii_case("all") {
        return (1..=total_pages).collect();
    }

    let mut pages = Vec::new();
    let parts = range_str.split(',');
    for part in parts {
        let part = part.trim();
        if let Some((start_s, end_s)) = part.split_once('-') {
            if let (Ok(start), Ok(end)) = (start_s.trim().parse::<u32>(), end_s.trim().parse::<u32>()) {
                for p in start..=end {
                    if p >= 1 && p <= total_pages && !pages.contains(&p) {
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

pub fn combine_pdf_files(
    pdf_files: &[(PathBuf, Option<String>)],
    output_path: &Path,
) -> Result<u32, String> {
    if pdf_files.is_empty() {
        return Err("没有可合并的 PDF 文件".to_string());
    }

    let mut master_doc = Document::with_version("1.5");
    let mut current_id: u32 = 2; // leave 1 free
    let mut all_page_refs: Vec<Object> = Vec::new();

    let pages_id = (current_id, 0);
    current_id += 1;

    for (pdf_path, page_range_opt) in pdf_files {
        let mut doc = Document::load(pdf_path)
            .map_err(|e| format!("无法加载 PDF [{}]: {}", pdf_path.display(), e))?;

        let doc_pages = doc.get_pages();
        let total_pages = doc_pages.len() as u32;
        let selected_pages = if let Some(range) = page_range_opt {
            parse_page_range(range, total_pages)
        } else {
            (1..=total_pages).collect()
        };

        // Create mapping for renumbering source objects
        let mut id_map: BTreeMap<ObjectId, ObjectId> = BTreeMap::new();
        for &old_id in doc.objects.keys() {
            id_map.insert(old_id, (current_id, 0));
            current_id += 1;
        }

        // Remap references inside source document
        for (_, obj) in doc.objects.iter_mut() {
            remap_object_refs(obj, &id_map);
        }

        // Collect the selected page objects in exact order
        let mut selected_page_ids = Vec::new();
        for page_num in selected_pages {
            if let Some(&orig_page_id) = doc_pages.get(&page_num) {
                if let Some(&new_page_id) = id_map.get(&orig_page_id) {
                    selected_page_ids.push(new_page_id);
                    all_page_refs.push(Object::Reference(new_page_id));
                }
            }
        }

        // Move all remapped objects to master doc
        for (old_id, mut obj) in doc.objects {
            if let Some(&new_id) = id_map.get(&old_id) {
                if selected_page_ids.contains(&new_id) {
                    if let Object::Dictionary(dict) = &mut obj {
                        dict.set("Parent", Object::Reference(pages_id));
                    }
                }
                master_doc.objects.insert(new_id, obj);
            }
        }
    }

    let total_pages_count = all_page_refs.len() as i64;
    if total_pages_count == 0 {
        return Err("合并后没有有效页面".to_string());
    }

    // Build master Pages object
    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Count", Object::Integer(total_pages_count));
    pages_dict.set("Kids", Object::Array(all_page_refs));

    master_doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

    // Build master Catalog object
    let catalog_id = (current_id, 0);
    current_id += 1;

    let mut catalog_dict = Dictionary::new();
    catalog_dict.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog_dict.set("Pages", Object::Reference(pages_id));

    master_doc.objects.insert(catalog_id, Object::Dictionary(catalog_dict));
    master_doc.trailer.set("Root", Object::Reference(catalog_id));

    // Crucial: update master_doc.max_id so xref stream generation never collides
    master_doc.max_id = current_id;

    // Save master doc
    master_doc.save(output_path).map_err(|e| format!("保存合并文件失败: {}", e))?;

    Ok(total_pages_count as u32)
}

fn remap_object_refs(obj: &mut Object, map: &BTreeMap<ObjectId, ObjectId>) {
    match obj {
        Object::Reference(id) => {
            if let Some(&new_id) = map.get(id) {
                *id = new_id;
            }
        }
        Object::Array(arr) => {
            for item in arr.iter_mut() {
                remap_object_refs(item, map);
            }
        }
        Object::Dictionary(dict) => {
            for (_, val) in dict.iter_mut() {
                remap_object_refs(val, map);
            }
        }
        Object::Stream(stream) => {
            for (_, val) in stream.dict.iter_mut() {
                remap_object_refs(val, map);
            }
        }
        _ => {}
    }
}
