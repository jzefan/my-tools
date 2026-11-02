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
  initial_action: 'merge' | 'compress' | 'watermark' | 'browse';
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
  macos_service_installed: boolean;
  ghostscript_available: boolean;
  libreoffice_available: boolean;
  textutil_available: boolean;
}
