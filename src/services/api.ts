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
    const usesPdfWord = request.items.some(item => /\.pdf$/i.test(item.input_path) &&
      /^(docx|doc|auto)?$/i.test(item.target_format));
    if (!usesPdfWord) return await invoke<ConvertResult>('convert_documents', { request });

    const results: ConvertResult['results'] = [];
    for (const item of request.items) {
      const batch = await invoke<ConvertResult>('convert_documents', { request: { ...request, items: [item] } });
      const { local_pdf_pages: pages, ...result } = batch.results[0];
      if (pages) {
        try {
          const { pdfToWord } = await import('../utils/pdfToWord');
          const source = await invoke<ArrayBuffer>('read_pdf_for_word', { path: item.input_path });
          const { bytes, imagePages } = await pdfToWord(new Uint8Array(source), pages);
          const output = new TextEncoder().encode(result.output_path);
          const pathHeader = btoa(Array.from(output, byte => String.fromCharCode(byte)).join(''));
          const size = await invoke<number>('save_local_pdf_word', bytes, {
            headers: {
              'x-doc-tools-output': pathHeader,
              'x-doc-tools-overwrite': String(item.overwrite ?? request.overwrite ?? false),
            },
          });
          const engine = imagePages
            ? `内置转换 · ${imagePages} 页为图像`
            : '内置转换 · 文本可编辑';
          Object.assign(result, { success: true, message: `转换成功（${engine}）`, converted_size: size, engine_used: engine });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.message = `转换失败：${message}`;
        }
      }
      results.push(result);
    }
    const successes = results.filter(result => result.success).length;
    return {
      success: successes > 0,
      message: `转换任务完成：成功 ${successes} / ${results.length} 个文件`,
      results,
    };
  },

  checkConvertConflicts: async (request: ConvertRequest): Promise<string[]> => {
    return await invoke<string[]>('check_convert_conflicts', { request });
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
