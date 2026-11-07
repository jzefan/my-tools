use doc_tools_lib::paper_service::{PageEditItem, ReorderPagesRequest, export_edited_pdf_pages};
use lopdf::{Document, Object, Stream, dictionary};
use std::{fs, path::PathBuf};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let sequence = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "doc-tools-edit-{}-{id}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&dir).unwrap();
        Self(dir)
    }
    fn request(&self, pages: &[(u32, i32)]) -> ReorderPagesRequest {
        ReorderPagesRequest {
            input_pdf_path: self.0.join("input.pdf").to_string_lossy().into_owned(),
            output_pdf_path: self.0.join("output.pdf").to_string_lossy().into_owned(),
            pages: pages
                .iter()
                .map(|&(original_page_no, rotation)| PageEditItem {
                    original_page_no,
                    rotation,
                })
                .collect(),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn make_pdf(f: &Fixture) {
    let mut doc = Document::with_version("1.5");
    let root_pages = doc.new_object_id();
    let font = doc.add_object(
        dictionary! {"Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica"},
    );
    let mut kids = Vec::new();
    for number in 1..=3 {
        let contents = doc.add_object(Stream::new(
            dictionary! {},
            format!("BT /F1 12 Tf 72 700 Td (Page {number}) Tj ET").into_bytes(),
        ));
        let page = doc.add_object(
            dictionary! {"Type" => "Page", "Parent" => root_pages, "Contents" => contents},
        );
        kids.push(Object::Reference(page));
    }
    doc.objects.insert(
        root_pages,
        dictionary! {
            "Type" => "Pages", "Kids" => kids, "Count" => 3,
            "Resources" => dictionary! {"Font" => dictionary! {"F1" => font}},
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "CropBox" => vec![0.into(), 0.into(), 590.into(), 840.into()], "Rotate" => 90
        }
        .into(),
    );
    let catalog = doc.add_object(dictionary! {"Type" => "Catalog", "Pages" => root_pages});
    doc.trailer.set("Root", catalog);
    doc.save(f.0.join("input.pdf")).unwrap();
}

#[test]
fn reorder_preserves_content_inherited_resources_and_rotation() {
    let fixture = Fixture::new();
    make_pdf(&fixture);
    export_edited_pdf_pages(fixture.request(&[(3, 270), (1, 90)])).unwrap();
    let doc = Document::load(fixture.0.join("output.pdf")).unwrap();
    assert_eq!(doc.get_pages().len(), 2);
    assert!(doc.extract_text(&[1]).unwrap().contains("Page 3"));
    assert!(doc.extract_text(&[2]).unwrap().contains("Page 1"));
    for (index, page) in doc.get_pages().values().enumerate() {
        let dict = doc.get_dictionary(*page).unwrap();
        assert!(dict.has(b"Resources"));
        assert_eq!(dict.get(b"MediaBox").unwrap().as_array().unwrap().len(), 4);
        assert!(dict.has(b"CropBox"));
        assert_eq!(
            dict.get(b"Rotate").unwrap().as_i64().unwrap(),
            [0, 180][index]
        );
    }
}

#[test]
fn invalid_edits_do_not_write_output() {
    let fixture = Fixture::new();
    make_pdf(&fixture);
    for pages in [
        &[][..],
        &[(0, 0)][..],
        &[(4, 0)][..],
        &[(1, 0), (1, 90)][..],
        &[(1, 45)][..],
    ] {
        assert!(export_edited_pdf_pages(fixture.request(pages)).is_err());
        assert!(!fixture.0.join("output.pdf").exists());
    }
}

#[test]
fn grayscale_jpeg_keeps_matching_colorspace_and_removes_old_decode_params() {
    use doc_tools_lib::{models::CompressRequest, pdf_compress::compress_native};
    let fixture = Fixture::new();
    make_pdf(&fixture);
    let input = fixture.0.join("input.pdf");
    let mut doc = Document::load(&input).unwrap();
    // Deterministic noise makes the Flate source larger than JPEG so replacement occurs.
    let mut seed = 1u32;
    let bytes: Vec<u8> = (0..65536)
        .map(|_| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 24) as u8
        })
        .collect();
    let mut image = Stream::new(
        dictionary! {
            "Type" => "XObject", "Subtype" => "Image", "Width" => 256, "Height" => 256,
            "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8
        },
        bytes,
    );
    image.compress().unwrap();
    image
        .dict
        .set("DecodeParms", dictionary! {"Predictor" => 1});
    let image_id = doc.add_object(image);
    let pages = doc
        .catalog()
        .unwrap()
        .get(b"Pages")
        .unwrap()
        .as_reference()
        .unwrap();
    doc.get_object_mut(pages)
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .get_mut(b"Resources")
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .set("XObject", dictionary! {"Image" => image_id});
    doc.save(&input).unwrap();
    let output = fixture.0.join("compressed.pdf");
    compress_native(&CompressRequest {
        input_path: input.to_string_lossy().into_owned(),
        output_path: output.to_string_lossy().into_owned(),
        quality: 35,
        max_dpi: 150,
        strip_metadata: false,
        use_advanced_engine: false,
    })
    .unwrap();
    let result = Document::load(output).unwrap();
    let stream = result.get_object(image_id).unwrap().as_stream().unwrap();
    assert_eq!(
        stream.dict.get(b"Filter").unwrap().as_name().unwrap(),
        b"DCTDecode"
    );
    assert_eq!(
        stream.dict.get(b"ColorSpace").unwrap().as_name().unwrap(),
        b"DeviceGray"
    );
    assert!(!stream.dict.has(b"DecodeParms"));
    let decoded = image::load_from_memory(&stream.content).unwrap();
    assert_eq!(decoded.color().channel_count(), 1);
}
