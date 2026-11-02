use crate::models::{
    OperationResult, WatermarkAnalysis, WatermarkCandidate, WatermarkRemoveRequest,
};
use lopdf::content::{Content, Operation};
use lopdf::{Document, Object};
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub fn analyze_pdf_watermarks(file_path: &str) -> Result<WatermarkAnalysis, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }

    let doc = Document::load(path).map_err(|e| format!("无法加载 PDF: {}", e))?;
    let pages = doc.get_pages();
    let total_pages = pages.len() as u32;

    if total_pages == 0 {
        return Err("PDF 不包含任何页面".to_string());
    }

    let mut text_freq_map: HashMap<String, (u32, HashSet<u32>)> = HashMap::new();
    let mut form_xobjects_map: HashMap<String, HashSet<u32>> = HashMap::new();
    let mut has_annotation_watermarks = false;

    for (&page_num, &page_id) in &pages {
        // 1. Analyze Content Streams
        let content_data = doc.get_page_content(page_id);
        if !content_data.is_empty() {
            if let Ok(content) = Content::decode(&content_data) {
                for op in &content.operations {
                    let extracted = extract_text_from_op(op);
                    for text in extracted {
                        let cleaned = text.trim();
                        if cleaned.chars().count() >= 2 && cleaned.chars().count() <= 60 {
                            let entry = text_freq_map
                                .entry(cleaned.to_string())
                                .or_insert_with(|| (0, HashSet::new()));
                            entry.0 += 1;
                            entry.1.insert(page_num);
                        }
                    }

                    // Check for /Do operator invoking XObjects
                    if op.operator == "Do" {
                        if let Some(Object::Name(name_bytes)) = op.operands.first() {
                            let name = String::from_utf8_lossy(name_bytes).to_string();
                            form_xobjects_map
                                .entry(name)
                                .or_default()
                                .insert(page_num);
                        }
                    }
                }
            }
        }

        // 2. Check Annotations
        if let Ok(page_dict) = doc.get_dictionary(page_id) {
            if let Ok(annots_obj) = page_dict.get(b"Annots") {
                if let Object::Array(annots_arr) = annots_obj {
                    for annot_ref in annots_arr {
                        if let Object::Reference(annot_id) = annot_ref {
                            if let Ok(annot_dict) = doc.get_dictionary(*annot_id) {
                                if let Ok(subtype) = annot_dict.get(b"Subtype") {
                                    if let Object::Name(st) = subtype {
                                        if st == b"Watermark" || st == b"Stamp" {
                                            has_annotation_watermarks = true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Filter text candidates: watermark heuristics
    let common_keywords = [
        "机密", "绝密", "保密", "内部", "草稿", "样品", "作废", "仅供", "副本",
        "confidential", "draft", "sample", "copy", "watermark", "internal", "do not copy", "strictly private"
    ];

    let mut candidates = Vec::new();
    for (text, (occurrences, page_set)) in text_freq_map {
        let pages_count = page_set.len() as u32;
        let lower = text.to_lowercase();
        let matches_keyword = common_keywords.iter().any(|&k| lower.contains(k));

        let is_candidate = if total_pages == 1 {
            matches_keyword || occurrences >= 2
        } else {
            matches_keyword || pages_count >= 2 || (pages_count as f32 / total_pages as f32) >= 0.5
        };

        if is_candidate {
            let sample_page = page_set.into_iter().next().unwrap_or(1);
            candidates.push(WatermarkCandidate {
                text,
                occurrences,
                page_count: pages_count,
                sample_page,
            });
        }
    }

    // Sort candidates: keyword matches and highest occurrences first
    candidates.sort_by(|a, b| {
        let a_keyword = common_keywords.iter().any(|&k| a.text.to_lowercase().contains(k));
        let b_keyword = common_keywords.iter().any(|&k| b.text.to_lowercase().contains(k));
        match (a_keyword, b_keyword) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => b.page_count.cmp(&a.page_count).then_with(|| b.occurrences.cmp(&a.occurrences)),
        }
    });

    // Candidates for XObjects that appear across multiple pages
    let xobject_candidates: Vec<String> = form_xobjects_map
        .into_iter()
        .filter(|(_, p_set)| p_set.len() >= 2 || total_pages == 1)
        .map(|(name, _)| name)
        .collect();

    Ok(WatermarkAnalysis {
        total_pages,
        text_watermarks: candidates,
        xobject_watermarks: xobject_candidates,
        has_annotation_watermarks,
    })
}

pub fn remove_pdf_watermarks(request: WatermarkRemoveRequest) -> Result<OperationResult, String> {
    let input_path = Path::new(&request.input_path);
    if !input_path.exists() {
        return Err(format!("输入文件不存在: {}", request.input_path));
    }

    let mut doc = Document::load(input_path).map_err(|e| format!("无法加载 PDF: {}", e))?;
    let pages = doc.get_pages();

    let target_texts: Vec<String> = request
        .target_texts
        .iter()
        .map(|s| {
            if request.case_sensitive {
                s.trim().to_string()
            } else {
                s.trim().to_lowercase()
            }
        })
        .filter(|s| !s.is_empty())
        .collect();

    let target_xobjects: HashSet<String> = request
        .target_xobjects
        .into_iter()
        .map(|s| s.trim_start_matches('/').to_string())
        .collect();

    let mut removed_text_count = 0;
    let mut removed_xobject_count = 0;
    let mut removed_annot_count = 0;

    for (&_page_num, &page_id) in &pages {
        // 1. Process Content Stream operations
        let content_data = doc.get_page_content(page_id);
        if !content_data.is_empty() {
            if let Ok(mut content) = Content::decode(&content_data) {
                let mut modified = false;
                let mut new_operations = Vec::with_capacity(content.operations.len());

                for mut op in content.operations {
                    let mut should_keep = true;

                    // Check XObject /Do calls
                    if op.operator == "Do" {
                        if let Some(Object::Name(name_bytes)) = op.operands.first() {
                            let name = String::from_utf8_lossy(name_bytes).to_string();
                            let clean_name = name.trim_start_matches('/');
                            if target_xobjects.contains(clean_name) {
                                should_keep = false;
                                modified = true;
                                removed_xobject_count += 1;
                            }
                        }
                    }

                    // Check Text operators: Tj, TJ, ', "
                    if should_keep && !target_texts.is_empty() {
                        match op.operator.as_str() {
                            "Tj" | "'" => {
                                if let Some(Object::String(bytes, _)) = op.operands.first() {
                                    let s = decode_pdf_string(bytes);
                                    let comp = if request.case_sensitive {
                                        s.clone()
                                    } else {
                                        s.to_lowercase()
                                    };
                                    if target_texts.iter().any(|target| comp.contains(target)) {
                                        should_keep = false;
                                        modified = true;
                                        removed_text_count += 1;
                                    }
                                }
                            }
                            "\"" => {
                                if let Some(Object::String(bytes, _)) = op.operands.get(2) {
                                    let s = decode_pdf_string(bytes);
                                    let comp = if request.case_sensitive {
                                        s.clone()
                                    } else {
                                        s.to_lowercase()
                                    };
                                    if target_texts.iter().any(|target| comp.contains(target)) {
                                        should_keep = false;
                                        modified = true;
                                        removed_text_count += 1;
                                    }
                                }
                            }
                            "TJ" => {
                                if let Some(Object::Array(arr)) = op.operands.first() {
                                    // Assemble text from array
                                    let mut full_text = String::new();
                                    for item in arr {
                                        if let Object::String(bytes, _) = item {
                                            full_text.push_str(&decode_pdf_string(bytes));
                                        }
                                    }

                                    let comp = if request.case_sensitive {
                                        full_text.clone()
                                    } else {
                                        full_text.to_lowercase()
                                    };

                                    if target_texts.iter().any(|target| comp.contains(target)) {
                                        should_keep = false;
                                        modified = true;
                                        removed_text_count += 1;
                                    } else {
                                        // Also check individual array elements
                                        let mut new_arr = Vec::new();
                                        let mut piece_removed = false;
                                        for item in arr {
                                            if let Object::String(bytes, _) = item {
                                                let piece = decode_pdf_string(bytes);
                                                let piece_comp = if request.case_sensitive {
                                                    piece.clone()
                                                } else {
                                                    piece.to_lowercase()
                                                };
                                                if target_texts.iter().any(|t| piece_comp.contains(t)) {
                                                    piece_removed = true;
                                                    removed_text_count += 1;
                                                    continue;
                                                }
                                            }
                                            new_arr.push(item.clone());
                                        }
                                        if piece_removed {
                                            op.operands[0] = Object::Array(new_arr);
                                            modified = true;
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }

                    if should_keep {
                        new_operations.push(op);
                    }
                }

                if modified {
                    content.operations = new_operations;
                    if let Ok(encoded) = content.encode() {
                        let _ = doc.change_page_content(page_id, encoded);
                    }
                }
            }
        }

        // 2. Process Annotations (Watermark/Stamp)
        if request.remove_annotations {
            let mut watermark_annot_ids = HashSet::new();
            if let Ok(page_dict) = doc.get_dictionary(page_id) {
                if let Ok(annots_obj) = page_dict.get(b"Annots") {
                    if let Object::Array(annots_arr) = annots_obj {
                        for annot_ref in annots_arr {
                            if let Object::Reference(annot_id) = annot_ref {
                                if let Ok(annot_dict) = doc.get_dictionary(*annot_id) {
                                    if let Ok(subtype) = annot_dict.get(b"Subtype") {
                                        if let Object::Name(st) = subtype {
                                            if st == b"Watermark" || st == b"Stamp" {
                                                watermark_annot_ids.insert(*annot_id);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if !watermark_annot_ids.is_empty() {
                removed_annot_count += watermark_annot_ids.len();
                if let Ok(page_dict) = doc.get_dictionary_mut(page_id) {
                    if let Ok(annots_obj) = page_dict.get_mut(b"Annots") {
                        if let Object::Array(annots_arr) = annots_obj {
                            annots_arr.retain(|annot_ref| {
                                if let Object::Reference(annot_id) = annot_ref {
                                    !watermark_annot_ids.contains(annot_id)
                                } else {
                                    true
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    doc.compress();
    doc.save(&request.output_path)
        .map_err(|e| format!("无法保存去水印后的 PDF: {}", e))?;

    let total_removed = removed_text_count + removed_xobject_count + removed_annot_count;
    let message = if total_removed > 0 {
        format!(
            "水印清除完成！已清除 {} 处文字水印，{} 处图层/XObject，{} 个批注水印",
            removed_text_count, removed_xobject_count, removed_annot_count
        )
    } else {
        "已处理完成，未发现匹配的目标水印元素或已无残留".to_string()
    };

    Ok(OperationResult {
        success: true,
        message,
        output_path: Some(request.output_path),
        details: Some(serde_json::json!({
            "removed_text_count": removed_text_count,
            "removed_xobject_count": removed_xobject_count,
            "removed_annot_count": removed_annot_count,
        })),
    })
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
