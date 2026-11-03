use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileItem {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub is_dir: bool,
    pub modified: u64,
    pub page_count: Option<u32>,
    pub is_supported: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DirContent {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<FileItem>,
    pub total_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct QuickPath {
    pub name: String,
    pub path: String,
    pub icon_type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LaunchContext {
    pub initial_paths: Vec<String>,
    pub initial_directory: String,
    pub initial_action: String, // "merge", "compress", "watermark", "convert", "browse"
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MergeItem {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub page_count: Option<u32>,
    pub page_range: Option<String>, // e.g. "all", "1-3", "1,3,5"
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MergeRequest {
    pub items: Vec<MergeItem>,
    pub output_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CompressRequest {
    pub input_path: String,
    pub output_path: String,
    pub quality: u8, // 10 - 100
    pub max_dpi: u32, // e.g. 72, 96, 150, 300
    pub strip_metadata: bool,
    pub use_advanced_engine: bool, // uses Ghostscript if available
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CompressResult {
    pub success: bool,
    pub original_size: u64,
    pub compressed_size: u64,
    pub reduction_percent: f64,
    pub output_path: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WatermarkCandidate {
    pub text: String,
    pub occurrences: u32,
    pub page_count: u32,
    pub sample_page: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WatermarkAnalysis {
    pub total_pages: u32,
    pub text_watermarks: Vec<WatermarkCandidate>,
    pub xobject_watermarks: Vec<String>,
    pub has_annotation_watermarks: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WatermarkRemoveRequest {
    pub input_path: String,
    pub output_path: String,
    pub target_texts: Vec<String>,
    pub target_xobjects: Vec<String>,
    pub remove_annotations: bool,
    pub case_sensitive: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OperationResult {
    pub success: bool,
    pub message: String,
    pub output_path: Option<String>,
    pub details: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IntegrationStatus {
    pub macos_service_installed: bool,
    pub ghostscript_available: bool,
    pub libreoffice_available: bool,
    pub textutil_available: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConvertItem {
    pub input_path: String,
    pub output_path: Option<String>,
    pub target_format: String, // "docx" | "pdf" | "auto"
    pub page_range: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConvertRequest {
    pub items: Vec<ConvertItem>,
    pub default_output_dir: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConvertItemResult {
    pub input_path: String,
    pub output_path: String,
    pub success: bool,
    pub message: String,
    pub original_size: u64,
    pub converted_size: u64,
    pub engine_used: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConvertResult {
    pub success: bool,
    pub message: String,
    pub results: Vec<ConvertItemResult>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConvertEngineStatus {
    pub pdf2docx_available: bool,
    pub docx2pdf_available: bool,
    pub soffice_available: bool,
    pub pandoc_available: bool,
    pub chrome_available: bool,
    pub pages_available: bool,
    pub word_available: bool,
}
