import { invoke } from '@tauri-apps/api/core';
import {
  CompressRequest,
  CompressResult,
  ConvertEngineStatus,
  ConvertRequest,
  ConvertResult,
  DirContent,
  DocumentPreviewData,
  FileItem,
  InsertPagesRequest,
  IntegrationStatus,
  LaunchContext,
  MergeRequest,
  OperationResult,
  PdfToImageRequest,
  QuickPath,
  WatermarkAnalysis,
  WatermarkRemoveRequest,
} from '../types';

export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

export const api = {
  getLaunchContext: async (): Promise<LaunchContext> => {
    if (!isTauriEnvironment()) {
      return {
        initial_paths: [],
        initial_directory: '',
        initial_action: 'browse',
      };
    }
    return await invoke<LaunchContext>('get_launch_context');
  },

  pollPendingAction: async (): Promise<LaunchContext | null> => {
    if (!isTauriEnvironment()) {
      return null;
    }
    return await invoke<LaunchContext | null>('poll_pending_action');
  },

  getDirectoryContents: async (path: string, showHidden?: boolean): Promise<DirContent> => {
    return await invoke<DirContent>('get_directory_contents', { path, showHidden });
  },

  getQuickDirectories: async (): Promise<QuickPath[]> => {
    return await invoke<QuickPath[]>('get_quick_directories');
  },

  getFileInfo: async (path: string): Promise<FileItem> => {
    return await invoke<FileItem>('get_file_info', { path });
  },

  mergeFiles: async (request: MergeRequest): Promise<OperationResult> => {
    return await invoke<OperationResult>('merge_files', { request });
  },

  insertPagesIntoPdf: async (request: InsertPagesRequest): Promise<OperationResult> => {
    return await invoke<OperationResult>('insert_pages_into_pdf', { request });
  },

  compressPdf: async (request: CompressRequest): Promise<CompressResult> => {
    return await invoke<CompressResult>('compress_pdf_file', { request });
  },

  analyzeWatermarks: async (path: string): Promise<WatermarkAnalysis> => {
    return await invoke<WatermarkAnalysis>('analyze_watermarks', { path });
  },

  removeWatermarks: async (request: WatermarkRemoveRequest): Promise<OperationResult> => {
    return await invoke<OperationResult>('remove_watermarks_from_pdf', { request });
  },

  convertDocuments: async (request: ConvertRequest): Promise<ConvertResult> => {
    return await invoke<ConvertResult>('convert_documents', { request });
  },

  convertPdfToImages: async (request: PdfToImageRequest): Promise<OperationResult> => {
    return await invoke<OperationResult>('convert_pdf_to_images', { request });
  },

  getConvertEngineStatus: async (): Promise<ConvertEngineStatus> => {
    return await invoke<ConvertEngineStatus>('get_convert_engine_status');
  },

  pickFileDialog: async (prompt?: string, forFolder?: boolean): Promise<string | null> => {
    return await invoke<string | null>('pick_file_dialog', { prompt, forFolder });
  },

  openFilePath: async (path: string): Promise<void> => {
    return await invoke<void>('open_file_path', { path });
  },

  getIntegrationStatus: async (): Promise<IntegrationStatus> => {
    if (!isTauriEnvironment()) {
      return {
        platform: 'web',
        macos_service_installed: false,
        ghostscript_available: false,
        libreoffice_available: false,
        textutil_available: false,
      };
    }
    return await invoke<IntegrationStatus>('get_integration_status');
  },

  installFinderService: async (): Promise<string> => {
    return await invoke<string>('install_finder_service');
  },

  uninstallFinderService: async (): Promise<string> => {
    return await invoke<string>('uninstall_finder_service');
  },

  getWindowsRegContent: async (): Promise<string> => {
    return await invoke<string>('get_windows_reg_content');
  },

  revealInFinder: async (path: string): Promise<void> => {
    return await invoke<void>('reveal_in_finder', { path });
  },

  setWindowMode: async (mode: 'compact' | 'full'): Promise<void> => {
    return await invoke<void>('set_window_mode', { mode });
  },

  getDocumentPreview: async (path: string): Promise<DocumentPreviewData> => {
    return await invoke<DocumentPreviewData>('get_document_preview', { path });
  },

  quickLookFile: async (path: string): Promise<void> => {
    return await invoke<void>('quick_look_file', { path });
  },
};
