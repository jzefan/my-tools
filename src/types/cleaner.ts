export type RiskLevel = 'safe' | 'recommended' | 'caution';

export type CleanCategory =
  | 'wechat'
  | 'qq'
  | 'browser'
  | 'developer'
  | 'system_logs'
  | 'app_cache'
  | 'trash';

export interface CleanSubDetail {
  path: string;
  name: string;
  size_bytes: number;
  file_count: number;
  modified_at?: number;
  paths?: string[];
}

export interface CleanItem {
  id: string;
  name: string;
  category: CleanCategory;
  risk_level: RiskLevel;
  description: string;
  size_bytes: number;
  file_count: number;
  paths: string[];
  default_selected: boolean;
  details: CleanSubDetail[];
  is_permission_denied: boolean;
}

export interface DiskCleanScanResult {
  supported: boolean;
  total_scanned_bytes: number;
  total_safe_bytes: number;
  total_recommended_bytes: number;
  total_caution_bytes: number;
  total_files: number;
  items: CleanItem[];
  has_permission_issues: boolean;
  disk_total_bytes: number;
  disk_free_bytes: number;
  full_disk_client_name: string;
}

export interface CleanExecutionRequest {
  item_ids: string[];
  delete_permanently: boolean;
}

export interface CleanExecutionResult {
  freed_bytes: number;
  deleted_files_count: number;
  errors: string[];
  success: boolean;
}

export type UsageKind = 'dir' | 'file' | 'files' | 'dirs' | 'volume';

export interface DiskUsageEntry {
  name: string;
  path: string;
  size_bytes: number;
  file_count: number;
  kind: UsageKind;
  permission_denied: boolean;
}

export interface DiskUsageScan {
  supported: boolean;
  root_path: string;
  root_name: string;
  home_path: string;
  size_bytes: number;
  file_count: number;
  entries: DiskUsageEntry[];
  volumes: DiskUsageEntry[];
  permission_denied: boolean;
  disk_total_bytes: number;
  disk_free_bytes: number;
}

export interface UsageDeleteResult {
  success: boolean;
  errors: string[];
}

export interface DiskUsageProgress {
  root_path: string;
  current_path: string;
  scanned_files: number;
  scanned_bytes: number;
  home_path: string;
}
