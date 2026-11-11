export interface FileItem {
  path: string;
  name: string;
  extension: string;
  size: number;
  is_dir: boolean;
  modified: number;
  page_count?: number;
  is_supported: boolean;
}

export interface DirContent {
  current_path: string;
  parent_path?: string;
  entries: FileItem[];
  total_count: number;
}

export interface QuickPath {
  name: string;
  path: string;
  icon_type: string;
}

export interface LaunchContext {
  initial_paths: string[];
  initial_directory: string;
  initial_action: 'merge' | 'compress' | 'watermark' | 'convert' | 'paper' | 'browse';
}

export interface MergeItem {
  path: string;
  name: string;
  extension: string;
  page_count?: number;
  page_range?: string;
}

export interface MergeRequest {
  items: MergeItem[];
  output_path: string;
}

export interface InsertPagesRequest {
  target_pdf_path: string;
  insert_items: MergeItem[];
  insert_after_page: number; // 0 = start (before page 1), N = after page N
  output_path: string;
}

export interface CompressRequest {
  input_path: string;
  output_path: string;
  quality: number; // 10 - 100
  max_dpi: number; // 72, 96, 150, 300
  strip_metadata: boolean;
  use_advanced_engine: boolean;
}

export interface CompressResult {
  success: boolean;
  original_size: number;
  compressed_size: number;
  reduction_percent: number;
  output_path: string;
  message: string;
}

export interface WatermarkCandidate {
  text: string;
  occurrences: number;
  page_count: number;
  sample_page: number;
}

export interface WatermarkAnalysis {
  total_pages: number;
  text_watermarks: WatermarkCandidate[];
  xobject_watermarks: string[];
  has_annotation_watermarks: boolean;
}

export interface WatermarkRemoveRequest {
  input_path: string;
  output_path: string;
  target_texts: string[];
  target_xobjects: string[];
  remove_annotations: boolean;
  case_sensitive: boolean;
}

export interface OperationResult {
  success: boolean;
  message: string;
  output_path?: string;
  details?: Record<string, any>;
}

export interface IntegrationStatus {
  platform: string;
  macos_service_installed: boolean;
  ghostscript_available: boolean;
  libreoffice_available: boolean;
  textutil_available: boolean;
}

export interface ConvertItem {
  input_path: string;
  output_path?: string;
  target_format: 'docx' | 'pdf' | 'image' | 'png' | 'jpg' | 'auto';
  page_range?: string;
  dpi?: number;
  overwrite?: boolean;
}

export interface PdfToImageRequest {
  input_path: string;
  output_dir?: string;
  format?: 'png' | 'jpg';
  dpi?: number;
  page_range?: string;
}

export interface ConvertRequest {
  items: ConvertItem[];
  default_output_dir?: string;
  overwrite?: boolean;
}

export interface ConvertItemResult {
  input_path: string;
  output_path: string;
  success: boolean;
  message: string;
  original_size: number;
  converted_size: number;
  engine_used: string;
  local_pdf_pages?: number[];
}

export interface ConvertResult {
  success: boolean;
  message: string;
  results: ConvertItemResult[];
}

export interface ConvertEngineStatus {
  pdf2docx_available: boolean;
  docx2pdf_available: boolean;
  soffice_available: boolean;
  pandoc_available: boolean;
  chrome_available: boolean;
  pages_available: boolean;
  word_available: boolean;
  pdftoppm_available?: boolean;
  fitz_available?: boolean;
}

export interface DocumentPreviewData {
  path: string;
  name: string;
  extension: string;
  size: number;
  modified: number;
  page_count?: number;
  mime_type: string;
  data_url?: string;
  thumbnail_url?: string;
  text_content?: string;
  html_content?: string;
  metadata?: {
    width?: number;
    height?: number;
    aspect_ratio?: string;
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    page_count?: number;
    paragraph_count?: number;
    word_count?: number;
    character_count?: number;
    [key: string]: any;
  };
}
