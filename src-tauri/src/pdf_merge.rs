use crate::models::{InsertPagesRequest, MergeRequest, OperationResult};
use flate2::Compression;
use flate2::write::ZlibEncoder;
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
    let temp_dir = std::env::temp_dir().join(format!(
        "doctools_merge_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("无法创建临时目录: {}", e))?;

    let mut pdf_files: Vec<(PathBuf, Option<String>)> = Vec::new();

    for (idx, item) in request.items.iter().enumerate() {
        let path = Path::new(&item.path);
        if !path.exists() {
            return Err(format!("文件不存在: {}", item.path));
        }

        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
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
            message: format!(
                "合并成功！共合并 {} 个文件，包含 {} 页",
                request.items.len(),
                total_pages
            ),
            output_path: Some(output_path.to_string_lossy().to_string()),
            details: Some(serde_json::json!({
                "file_count": request.items.len(),
                "total_pages": total_pages,
            })),
        }),
        Err(e) => Err(format!("合并失败: {}", e)),
    }
}

pub fn insert_pages_into_pdf(request: InsertPagesRequest) -> Result<OperationResult, String> {
    let target_path = PathBuf::from(&request.target_pdf_path);
    if !target_path.exists() {
        return Err(format!("目标 PDF 文件不存在: {}", request.target_pdf_path));
    }
    if request.insert_items.is_empty() {
        return Err("请至少选择一个需要插入的文件或图片".to_string());
    }

    let output_path = PathBuf::from(&request.output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建输出目录: {}", e))?;
    }

    // Inspect target PDF to get total pages
    let doc = Document::load(&target_path).map_err(|e| format!("无法读取目标 PDF 文件: {}", e))?;
    let total_pages = doc.get_pages().len() as u32;
    if total_pages == 0 {
        return Err("目标 PDF 没有有效页面".to_string());
    }

    let temp_dir = std::env::temp_dir().join(format!(
        "doctools_insert_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("无法创建临时目录: {}", e))?;

    // Convert all insert_items into temporary PDFs
    let mut inserted_pdf_files: Vec<(PathBuf, Option<String>)> = Vec::new();
    for (idx, item) in request.insert_items.iter().enumerate() {
        let path = Path::new(&item.path);
        if !path.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
            return Err(format!("待插入文件不存在: {}", item.path));
        }

        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        match ext.as_str() {
            "pdf" => {
                inserted_pdf_files.push((path.to_path_buf(), item.page_range.clone()));
            }
            "png" | "jpg" | "jpeg" | "webp" | "bmp" | "tiff" => {
                let temp_pdf = temp_dir.join(format!("ins_img_{}.pdf", idx));
                convert_image_to_pdf(path, &temp_pdf)
                    .map_err(|e| format!("转换待插入图片失败 [{}]: {}", item.name, e))?;
                inserted_pdf_files.push((temp_pdf, None));
            }
            "docx" | "doc" => {
                let temp_pdf = temp_dir.join(format!("ins_doc_{}.pdf", idx));
                convert_word_to_pdf(path, &temp_pdf)
                    .map_err(|e| format!("转换待插入 Word 文档失败 [{}]: {}", item.name, e))?;
                inserted_pdf_files.push((temp_pdf, None));
            }
            _ => {
                let _ = fs::remove_dir_all(&temp_dir);
                return Err(format!("不支持的文件格式: {}", item.name));
            }
        }
    }

    // Determine segments based on insert_after_page
    // 0 = insert at beginning (before page 1)
    // N = insert after page N
    // >= total_pages = insert at the very end
    let insert_after = request.insert_after_page.min(total_pages);
    let mut final_segments: Vec<(PathBuf, Option<String>)> = Vec::new();

    // Segment 1: Target PDF pages before insertion point
    if insert_after > 0 {
        let range_str = format!("1-{}", insert_after);
        final_segments.push((target_path.clone(), Some(range_str)));
    }

    // Segment 2: All inserted items
    for item in inserted_pdf_files {
        final_segments.push(item);
    }

    // Segment 3: Target PDF pages after insertion point
    if insert_after < total_pages {
        let range_str = format!("{}-{}", insert_after + 1, total_pages);
        final_segments.push((target_path.clone(), Some(range_str)));
    }

    let merge_res = combine_pdf_files(&final_segments, &output_path);
    let _ = fs::remove_dir_all(&temp_dir);

    match merge_res {
        Ok(new_total_pages) => Ok(OperationResult {
            success: true,
            message: format!(
                "插入成功！已在第 {} 页后插入 {} 个文件，新 PDF 共 {} 页",
                insert_after,
                request.insert_items.len(),
                new_total_pages
            ),
            output_path: Some(output_path.to_string_lossy().to_string()),
            details: Some(serde_json::json!({
                "original_pages": total_pages,
                "inserted_count": request.insert_items.len(),
                "new_total_pages": new_total_pages,
                "insert_after_page": insert_after,
            })),
        }),
        Err(e) => Err(format!("插入合并失败: {}", e)),
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

    doc.objects
        .insert(catalog_id, Object::Dictionary(catalog_dict));
    doc.trailer.set("Root", Object::Reference(catalog_id));

    doc.save(output_pdf)
        .map_err(|e| format!("保存生成的 PDF 失败: {}", e))?;
    Ok(())
}

pub fn convert_word_to_pdf(doc_path: &Path, output_pdf: &Path) -> Result<(), String> {
    crate::pdf_convert::convert_single_word_to_pdf(doc_path, output_pdf).map(|_| ())
}

fn parse_page_range(range_str: &str, total: u32) -> Result<Vec<u32>, String> {
    if total == 0 { return Err("PDF 没有可合并的页面".into()); }
    let range = range_str.trim();
    if range.is_empty() || range.eq_ignore_ascii_case("all") { return Ok((1..=total).collect()); }
    let mut pages = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for part in range.split(',') {
        let part = part.trim();
        let (start, end) = if let Some((a, b)) = part.split_once('-') {
            (a.trim().parse::<u32>(), b.trim().parse::<u32>())
        } else { (part.parse::<u32>(), part.parse::<u32>()) };
        let (start, end) = match (start, end) {
            (Ok(start), Ok(end)) if start > 0 && start <= end && end <= total => (start, end),
            _ => return Err(format!("页码范围无效：{}（共 {} 页）", part, total)),
        };
        for page in start..=end { if seen.insert(page) { pages.push(page); } }
    }
    Ok(pages)
}

fn materialize_page_attributes(doc: &mut Document, page_id: ObjectId) -> Result<(), String> {
    let mut page = doc.get_dictionary(page_id).map_err(|e| e.to_string())?.clone();
    for key in [b"Resources".as_slice(), b"MediaBox", b"CropBox", b"Rotate"] {
        let mut ancestor = page_id;
        let mut visited = std::collections::HashSet::new();
        loop {
            if !visited.insert(ancestor) { return Err("PDF 页面继承结构存在循环".into()); }
            let dict = doc.get_dictionary(ancestor).map_err(|e| e.to_string())?;
            if let Ok(value) = dict.get(key) { page.set(key.to_vec(), value.clone()); break; }
            match dict.get(b"Parent").and_then(Object::as_reference) {
                Ok(parent) => ancestor = parent,
                Err(_) => break,
            }
        }
    }
    doc.objects.insert(page_id, Object::Dictionary(page));
    Ok(())
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
            parse_page_range(range, total_pages)?
        } else {
            (1..=total_pages).collect()
        };

        for page_num in &selected_pages {
            if let Some(&page_id) = doc_pages.get(page_num) {
                materialize_page_attributes(&mut doc, page_id)?;
            }
        }

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

    master_doc
        .objects
        .insert(pages_id, Object::Dictionary(pages_dict));

    // Build master Catalog object
    let catalog_id = (current_id, 0);
    current_id += 1;

    let mut catalog_dict = Dictionary::new();
    catalog_dict.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog_dict.set("Pages", Object::Reference(pages_id));

    master_doc
        .objects
        .insert(catalog_id, Object::Dictionary(catalog_dict));
    master_doc
        .trailer
        .set("Root", Object::Reference(catalog_id));

    // Crucial: update master_doc.max_id so xref stream generation never collides
    master_doc.max_id = current_id;

    // Save master doc
    master_doc
        .save(output_path)
        .map_err(|e| format!("保存合并文件失败: {}", e))?;

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

#[cfg(test)]
mod merge_regression_tests {
    use super::*;
    #[test]
    fn invalid_ranges_never_fall_back_to_all_pages() {
        for range in ["0", "4", "2-1", "1-999999999", "bad", "1,bad", "1,", "1-2-3"] {
            assert!(parse_page_range(range, 3).is_err(), "{range}");
        }
        assert_eq!(parse_page_range("3,1-2,3", 3).unwrap(), vec![3,1,2]);
        assert!(parse_page_range("all", 0).is_err());
    }
    #[test]
    fn merge_keeps_inherited_font_geometry_and_rotation() {
        use lopdf::dictionary;
        let folder = std::env::temp_dir().join(format!("merge-inherit-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&folder).unwrap();
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" });
        let resources_id = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font_id } });
        let content_id = doc.add_object(Stream::new(Dictionary::new(), b"BT /F1 12 Tf 20 20 Td (Inherited text) Tj ET".to_vec()));
        let page_id = doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id, "Contents" => content_id });
        doc.objects.insert(pages_id, dictionary! { "Type" => "Pages", "Kids" => vec![Object::Reference(page_id)], "Count" => 1,
            "MediaBox" => vec![0.into(),0.into(),300.into(),400.into()], "CropBox" => vec![0.into(),0.into(),280.into(),380.into()], "Rotate" => 90,
            "Resources" => resources_id }.into());
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        let input = folder.join("source.pdf"); let output = folder.join("merged.pdf"); doc.save(&input).unwrap();
        assert_eq!(combine_pdf_files(&[(input.clone(), None), (input.clone(), None)], &output).unwrap(), 2);
        let merged = Document::load(&output).unwrap();
        for (_, page_id) in merged.get_pages() {
            let page = merged.get_dictionary(page_id).unwrap();
            assert_eq!(page.get(b"Rotate").unwrap().as_i64().unwrap(), 90);
            assert_eq!(page.get(b"MediaBox").unwrap().as_array().unwrap()[2].as_i64().unwrap(), 300);
            assert_eq!(page.get(b"CropBox").unwrap().as_array().unwrap()[2].as_i64().unwrap(), 280);
            let (_, resources) = merged.dereference(page.get(b"Resources").unwrap()).unwrap();
            let fonts = resources.as_dict().unwrap().get(b"Font").unwrap().as_dict().unwrap();
            assert!(fonts.get(b"F1").is_ok());
        }
        assert!(merged.extract_text(&[1,2]).unwrap().contains("Inherited text"));
        let invalid_output = folder.join("invalid.pdf");
        assert!(combine_pdf_files(&[(input, Some("2".into()))], &invalid_output).is_err());
        assert!(!invalid_output.exists());
        fs::remove_dir_all(folder).unwrap();
    }
}
