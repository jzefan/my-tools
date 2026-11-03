use doc_tools_lib::models::{CompressRequest, MergeItem, MergeRequest, WatermarkRemoveRequest};
use doc_tools_lib::pdf_compress::compress_pdf;
use doc_tools_lib::pdf_convert::convert_single_pdf_to_word;
use doc_tools_lib::pdf_merge::{convert_image_to_pdf, merge_documents};
use doc_tools_lib::pdf_watermark::{analyze_pdf_watermarks, remove_pdf_watermarks};
use doc_tools_lib::system_integration;
use image::{ImageBuffer, Rgb};
use lopdf::content::{Content, Operation};
use lopdf::{Dictionary, Document, Object, Stream};
use std::fs;
use std::path::PathBuf;

fn create_sample_pdf_with_watermark(path: &PathBuf, watermark_text: &str) {
    let mut doc = Document::with_version("1.5");
    let pages_id = (1, 0);

    // Create 2 pages
    let mut page_refs = Vec::new();

    for p in 1..=2 {
        // Content with main text + watermark text
        let content_ops = vec![
            Operation::new("BT", vec![]),
            Operation::new("/F1", vec![Object::Integer(24)]),
            Operation::new("Td", vec![Object::Real(100.0), Object::Real(700.0)]),
            Operation::new("Tj", vec![Object::string_literal(format!("Page {} Content", p))]),
            // Watermark
            Operation::new("Td", vec![Object::Real(0.0), Object::Real(-200.0)]),
            Operation::new("Tj", vec![Object::string_literal(watermark_text)]),
            Operation::new("ET", vec![]),
        ];

        let content = Content { operations: content_ops };
        let content_bytes = content.encode().unwrap();
        let content_stream = Stream::new(Dictionary::new(), content_bytes);
        let content_id = doc.add_object(Object::Stream(content_stream));

        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(pages_id));
        page_dict.set(
            "MediaBox",
            Object::Array(vec![
                Object::Real(0.0),
                Object::Real(0.0),
                Object::Real(595.0),
                Object::Real(842.0),
            ]),
        );
        page_dict.set("Contents", Object::Reference(content_id));

        let page_id = doc.add_object(Object::Dictionary(page_dict));
        page_refs.push(Object::Reference(page_id));
    }

    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Count", Object::Integer(2));
    pages_dict.set("Kids", Object::Array(page_refs));
    doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

    let catalog_id = (20, 0);
    let mut catalog_dict = Dictionary::new();
    catalog_dict.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog_dict.set("Pages", Object::Reference(pages_id));
    doc.objects.insert(catalog_id, Object::Dictionary(catalog_dict));
    doc.trailer.set("Root", Object::Reference(catalog_id));

    doc.save(path).unwrap();
}

fn create_sample_image(path: &PathBuf) {
    let mut img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(200, 200);
    for (_, _, pixel) in img.enumerate_pixels_mut() {
        *pixel = Rgb([100, 150, 250]);
    }
    img.save(path).unwrap();
}

#[test]
fn test_image_to_pdf_and_merge() {
    let temp_dir = std::env::temp_dir().join("doctools_test_merge");
    let _ = fs::create_dir_all(&temp_dir);

    let pdf1_path = temp_dir.join("test1.pdf");
    create_sample_pdf_with_watermark(&pdf1_path, "CONFIDENTIAL");

    let img_path = temp_dir.join("test_img.png");
    create_sample_image(&img_path);

    let img_pdf_path = temp_dir.join("img_converted.pdf");
    let res = convert_image_to_pdf(&img_path, &img_pdf_path);
    assert!(res.is_ok(), "Image to PDF conversion failed: {:?}", res);
    assert!(img_pdf_path.exists());

    // Test Merge Documents (PDF + Image)
    let merged_path = temp_dir.join("merged_output.pdf");
    let merge_req = MergeRequest {
        items: vec![
            MergeItem {
                path: pdf1_path.to_string_lossy().to_string(),
                name: "test1.pdf".to_string(),
                extension: "pdf".to_string(),
                page_count: Some(2),
                page_range: Some("all".to_string()),
            },
            MergeItem {
                path: img_path.to_string_lossy().to_string(),
                name: "test_img.png".to_string(),
                extension: "png".to_string(),
                page_count: Some(1),
                page_range: None,
            },
        ],
        output_path: merged_path.to_string_lossy().to_string(),
    };

    let merge_res = merge_documents(merge_req);
    assert!(merge_res.is_ok(), "Merge failed: {:?}", merge_res);
    assert!(merged_path.exists());

    // Verify merged page count
    let loaded = Document::load(&merged_path).unwrap();
    println!("merged_path: {:?}", merged_path);
    println!("loaded trailer: {:?}", loaded.trailer);
    println!("loaded catalog: {:?}", loaded.catalog());
    println!("object (1, 0): {:?}", loaded.objects.get(&(1, 0)));
    println!("all object keys: {:?}", loaded.objects.keys().collect::<Vec<_>>());
    println!("loaded pages: {:?}", loaded.get_pages());
    assert_eq!(loaded.get_pages().len(), 3);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_watermark_analysis_and_removal() {
    let temp_dir = std::env::temp_dir().join("doctools_test_wm");
    let _ = fs::create_dir_all(&temp_dir);

    let sample_pdf = temp_dir.join("watermarked.pdf");
    let wm_text = "机密内部文件";
    create_sample_pdf_with_watermark(&sample_pdf, wm_text);

    // 1. Analyze
    let analysis = analyze_pdf_watermarks(sample_pdf.to_str().unwrap()).unwrap();
    assert_eq!(analysis.total_pages, 2);
    let found = analysis.text_watermarks.iter().any(|c| c.text == wm_text);
    assert!(found, "Watermark text was not detected in candidates");

    // 2. Remove
    let cleaned_pdf = temp_dir.join("cleaned.pdf");
    let remove_req = WatermarkRemoveRequest {
        input_path: sample_pdf.to_string_lossy().to_string(),
        output_path: cleaned_pdf.to_string_lossy().to_string(),
        target_texts: vec![wm_text.to_string()],
        target_xobjects: vec![],
        remove_annotations: true,
        case_sensitive: false,
    };

    let rem_res = remove_pdf_watermarks(remove_req);
    assert!(rem_res.is_ok(), "Watermark removal failed: {:?}", rem_res);
    assert!(cleaned_pdf.exists());

    // 3. Verify cleaned document no longer has watermark
    let analysis_clean = analyze_pdf_watermarks(cleaned_pdf.to_str().unwrap()).unwrap();
    let still_found = analysis_clean.text_watermarks.iter().any(|c| c.text == wm_text);
    assert!(!still_found, "Watermark text should have been removed!");

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_pdf_compression() {
    let temp_dir = std::env::temp_dir().join("doctools_test_compress");
    let _ = fs::create_dir_all(&temp_dir);

    let sample_pdf = temp_dir.join("to_compress.pdf");
    create_sample_pdf_with_watermark(&sample_pdf, "SAMPLE");

    let compressed_pdf = temp_dir.join("compressed.pdf");
    let compress_req = CompressRequest {
        input_path: sample_pdf.to_string_lossy().to_string(),
        output_path: compressed_pdf.to_string_lossy().to_string(),
        quality: 60,
        max_dpi: 150,
        strip_metadata: true,
        use_advanced_engine: false, // test pure native
    };

    let comp_res = compress_pdf(compress_req);
    assert!(comp_res.is_ok(), "PDF compression failed: {:?}", comp_res);
    assert!(compressed_pdf.exists());

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_system_integration_install() {
    let status = system_integration::check_status();
    println!("Current system integration status: {:?}", status);

    // Test install
    let install_res = system_integration::install_macos_service();
    assert!(install_res.is_ok(), "Install macOS service failed: {:?}", install_res);

    let post_status = system_integration::check_status();
    assert!(post_status.macos_service_installed, "Service should be reported as installed");
}

#[test]
fn test_toc_conversion_formatting() {
    let temp_dir = std::env::temp_dir().join("doctools_test_toc");
    let _ = fs::create_dir_all(&temp_dir);

    let sample_pdf = temp_dir.join("toc_sample.pdf");
    let output_docx = temp_dir.join("toc_sample.docx");

    // Create a TOC PDF with Python PyMuPDF if available, or create with lopdf
    let _py_create = std::process::Command::new("python3")
        .args([
            "-c",
            &format!(
                r#"
import fitz, os
doc = fitz.open()
page = doc.new_page(width=595, height=842)
lines = [
    '目录',
    '一、项目立项资料................................................................................4',
    '(一) 项目升级改造方案....................................................................4',
    '(二) 项目评审意见 (缺)................................................................8',
    '(三) 项目采购合同..............................................................................11',
    '二、项目终验资料..............................................................................1',
    '(一) 开工报告....................................................................................1',
    'IRS 申请记录 (缺)..........................................................................2'
]
y = 80
for line in lines:
    page.insert_text((72, y), line, fontsize=12)
    y += 35
doc.save(r'{}')
"#,
                sample_pdf.to_string_lossy()
            ),
        ])
        .output();

    if !sample_pdf.exists() {
        // Fallback: create an English TOC PDF using lopdf
        let mut doc = Document::with_version("1.5");
        let pages_id = (1, 0);
        let content_ops = vec![
            Operation::new("BT", vec![]),
            Operation::new("/F1", vec![Object::Integer(16)]),
            Operation::new("Td", vec![Object::Real(72.0), Object::Real(750.0)]),
            Operation::new("Tj", vec![Object::string_literal("Table of Contents")]),
            Operation::new("Td", vec![Object::Real(0.0), Object::Real(-40.0)]),
            Operation::new("/F1", vec![Object::Integer(12)]),
            Operation::new("Tj", vec![Object::string_literal("1. Project Initiation Documentation............................................................4")]),
            Operation::new("Td", vec![Object::Real(0.0), Object::Real(-30.0)]),
            Operation::new("Tj", vec![Object::string_literal("   1.1 System Upgrade Plan......................................................................4")]),
            Operation::new("Td", vec![Object::Real(0.0), Object::Real(-30.0)]),
            Operation::new("Tj", vec![Object::string_literal("   1.2 Review Comments (Pending)................................................................8")]),
            Operation::new("ET", vec![]),
        ];
        let content = Content { operations: content_ops };
        let content_bytes = content.encode().unwrap();
        let content_stream = Stream::new(Dictionary::new(), content_bytes);
        let content_id = doc.add_object(Object::Stream(content_stream));

        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(pages_id));
        page_dict.set("MediaBox", Object::Array(vec![Object::Real(0.0), Object::Real(0.0), Object::Real(595.0), Object::Real(842.0)]));
        page_dict.set("Contents", Object::Reference(content_id));

        let mut font_dict = Dictionary::new();
        font_dict.set("Type", Object::Name(b"Font".to_vec()));
        font_dict.set("Subtype", Object::Name(b"Type1".to_vec()));
        font_dict.set("BaseFont", Object::Name(b"Helvetica".to_vec()));
        let font_id = doc.add_object(Object::Dictionary(font_dict));

        let mut f_dict = Dictionary::new();
        f_dict.set("F1", Object::Reference(font_id));
        let mut r_dict = Dictionary::new();
        r_dict.set("Font", Object::Dictionary(f_dict));
        page_dict.set("Resources", Object::Dictionary(r_dict));

        let page_id = doc.add_object(Object::Dictionary(page_dict));
        let mut pages_dict = Dictionary::new();
        pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
        pages_dict.set("Count", Object::Integer(1));
        pages_dict.set("Kids", Object::Array(vec![Object::Reference(page_id)]));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(Object::Dictionary(catalog));
        doc.trailer.set("Root", Object::Reference(catalog_id));

        doc.save(&sample_pdf).unwrap();
    }

    assert!(sample_pdf.exists(), "Sample TOC PDF should exist");

    // Perform conversion
    let res = convert_single_pdf_to_word(&sample_pdf, &output_docx, None);
    assert!(res.is_ok(), "PDF to Word conversion failed: {:?}", res);
    assert!(output_docx.exists(), "Output DOCX file should exist");
    let engine = res.unwrap();
    println!("TOC test completed using engine: {}", engine);

    // Verify DOCX content: unpack word/document.xml and check that paragraphs are separate and no collision
    let file = fs::File::open(&output_docx).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let mut doc_xml = String::new();
    if let Ok(mut doc_file) = archive.by_name("word/document.xml") {
        use std::io::Read;
        doc_file.read_to_string(&mut doc_xml).unwrap();
    }
    assert!(!doc_xml.is_empty(), "word/document.xml should not be empty");

    // Verify that TOC entries do not collide in a single paragraph run like "4 (一)"
    assert!(!doc_xml.contains("4 (一)"), "TOC lines should not collide together!");

    let _ = fs::remove_dir_all(&temp_dir);
}
