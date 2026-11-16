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

interface WebStoredFile {
  item: FileItem;
  bytes: Uint8Array;
}

const webFileStore = new Map<string, WebStoredFile>();

const WEB_QUICK_PATHS: QuickPath[] = [
  { name: '文档', path: '/workspace/documents', icon_type: 'documents' },
  { name: '下载', path: '/workspace/downloads', icon_type: 'downloads' },
  { name: '桌面', path: '/workspace/desktop', icon_type: 'desktop' },
];

function inferExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function isSupportedDocExt(ext: string): boolean {
  return ['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg', 'webp'].includes(ext.toLowerCase());
}

function buildWebFileItem(path: string, isDir = false, size = 0): FileItem {
  const parts = path.split('/').filter(Boolean);
  const name = parts[parts.length - 1] || path;
  const extension = isDir ? '' : inferExtension(name);
  return {
    path,
    name,
    extension,
    size,
    is_dir: isDir,
    modified: Math.floor(Date.now() / 1000),
    page_count: extension === 'pdf' ? 1 : undefined,
    is_supported: isDir ? false : isSupportedDocExt(extension),
  };
}

function pickWebFile(accept = '.pdf,.docx,.doc,.png,.jpg,.jpeg,.webp'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function triggerWebDownload(filename: string, bytes: Uint8Array, mime = 'application/octet-stream'): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

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
    if (!isTauriEnvironment()) {
      const normalized = path || '/workspace/documents';
      const parent = normalized === '/workspace'
        ? undefined
        : normalized.split('/').slice(0, -1).join('/') || '/workspace';
      const dirEntries: FileItem[] = normalized === '/workspace'
        ? WEB_QUICK_PATHS.map((q) => buildWebFileItem(q.path, true, 0))
        : Array.from(webFileStore.values())
            .filter((f) => f.item.path.startsWith(`${normalized}/`))
            .map((f) => f.item);
      return {
        current_path: normalized,
        parent_path: parent,
        entries: dirEntries,
        total_count: dirEntries.length,
      };
    }
    return await invoke<DirContent>('get_directory_contents', { path, showHidden });
  },

  getQuickDirectories: async (): Promise<QuickPath[]> => {
    if (!isTauriEnvironment()) {
      return WEB_QUICK_PATHS;
    }
    return await invoke<QuickPath[]>('get_quick_directories');
  },

  getFileInfo: async (path: string): Promise<FileItem> => {
    if (!isTauriEnvironment()) {
      const stored = webFileStore.get(path);
      if (stored) return stored.item;
      return buildWebFileItem(path, false, 0);
    }
    return await invoke<FileItem>('get_file_info', { path });
  },

  mergeFiles: async (request: MergeRequest): Promise<OperationResult> => {
    if (!isTauriEnvironment()) {
      return {
        success: false,
        message: '网页预览模式不支持原生文件合并，请使用桌面端执行本地 PDF/文档合并',
      };
    }
    return await invoke<OperationResult>('merge_files', { request });
  },

  insertPagesIntoPdf: async (request: InsertPagesRequest): Promise<OperationResult> => {
    if (!isTauriEnvironment()) {
      return {
        success: false,
        message: '网页预览模式不支持原生 PDF 插页，请使用桌面端执行',
      };
    }
    return await invoke<OperationResult>('insert_pages_into_pdf', { request });
  },

  compressPdf: async (request: CompressRequest): Promise<CompressResult> => {
    if (!isTauriEnvironment()) {
      return {
        success: false,
        original_size: 0,
        compressed_size: 0,
        reduction_percent: 0,
        output_path: request.output_path,
        message: '网页预览模式不支持本地 PDF 压缩，请使用桌面端执行',
      };
    }
    return await invoke<CompressResult>('compress_pdf_file', { request });
  },

  analyzeWatermarks: async (path: string): Promise<WatermarkAnalysis> => {
    if (!isTauriEnvironment()) {
      return {
        total_pages: 0,
        text_watermarks: [],
        xobject_watermarks: [],
        has_annotation_watermarks: false,
      };
    }
    return await invoke<WatermarkAnalysis>('analyze_watermarks', { path });
  },

  removeWatermarks: async (request: WatermarkRemoveRequest): Promise<OperationResult> => {
    if (!isTauriEnvironment()) {
      return {
        success: false,
        message: '网页预览模式不支持本地 PDF 去水印，请使用桌面端执行',
      };
    }
    return await invoke<OperationResult>('remove_watermarks_from_pdf', { request });
  },

  convertDocuments: async (request: ConvertRequest): Promise<ConvertResult> => {
    if (!isTauriEnvironment()) {
      const results: ConvertResult['results'] = [];
      for (const item of request.items) {
        const stored = webFileStore.get(item.input_path);
        const isPdfToWord =
          /\.pdf$/i.test(item.input_path) && /^(docx|doc|auto)?$/i.test(item.target_format);
        if (stored && isPdfToWord) {
          try {
            const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
            GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
            const task = getDocument({ data: stored.bytes.slice() });
            const probe = await task.promise;
            const totalPages = probe.numPages;
            await task.destroy();
            const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
            const { pdfToWord } = await import('../utils/pdfToWord');
            const { bytes, imagePages } = await pdfToWord(stored.bytes.slice(), pages);
            const outName = stored.item.name.replace(/\.pdf$/i, '') + '.docx';
            triggerWebDownload(
              outName,
              bytes,
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            );
            const engine = imagePages
              ? `内置转换 · ${imagePages} 页为图像`
              : '内置转换 · 文本可编辑';
            results.push({
              input_path: item.input_path,
              output_path: item.output_path || `/workspace/documents/${outName}`,
              success: true,
              message: `转换成功并已触发下载（${engine}）`,
              original_size: stored.bytes.byteLength,
              converted_size: bytes.byteLength,
              engine_used: engine,
            });
            continue;
          } catch (error) {
            results.push({
              input_path: item.input_path,
              output_path: item.output_path || '',
              success: false,
              message: `转换失败：${error instanceof Error ? error.message : String(error)}`,
              original_size: stored.bytes.byteLength,
              converted_size: 0,
              engine_used: '内置 JS 引擎',
            });
            continue;
          }
        }
        results.push({
          input_path: item.input_path,
          output_path: item.output_path || '',
          success: false,
          message: '网页预览模式仅支持浏览器选择的 PDF 转 Word，其余格式请使用桌面端',
          original_size: stored?.bytes.byteLength ?? 0,
          converted_size: 0,
          engine_used: 'browser',
        });
      }
      const successes = results.filter((r) => r.success).length;
      return {
        success: successes > 0,
        message: `转换任务完成：成功 ${successes} / ${results.length} 个文件`,
        results,
      };
    }

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
    if (!isTauriEnvironment()) {
      return [];
    }
    return await invoke<string[]>('check_convert_conflicts', { request });
  },

  convertPdfToImages: async (request: PdfToImageRequest): Promise<OperationResult> => {
    if (!isTauriEnvironment()) {
      return {
        success: false,
        message: '网页预览模式不支持原生 PDF 导出图片，请使用桌面端执行',
      };
    }
    return await invoke<OperationResult>('convert_pdf_to_images', { request });
  },

  getConvertEngineStatus: async (): Promise<ConvertEngineStatus> => {
    if (!isTauriEnvironment()) {
      return {
        pdf2docx_available: true,
        docx2pdf_available: false,
        soffice_available: false,
        pandoc_available: false,
        chrome_available: false,
        pages_available: false,
        word_available: false,
        pdftoppm_available: false,
        fitz_available: false,
      };
    }
    return await invoke<ConvertEngineStatus>('get_convert_engine_status');
  },

  pickFileDialog: async (prompt?: string, forFolder?: boolean): Promise<string | null> => {
    if (!isTauriEnvironment()) {
      if (forFolder) {
        return '/workspace/documents';
      }
      const file = await pickWebFile();
      if (!file) return null;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const virtualPath = `/workspace/documents/${file.name}`;
      const item = buildWebFileItem(virtualPath, false, bytes.byteLength);
      webFileStore.set(virtualPath, { item, bytes });
      return virtualPath;
    }
    return await invoke<string | null>('pick_file_dialog', { prompt, forFolder });
  },

  openFilePath: async (path: string): Promise<void> => {
    if (!isTauriEnvironment()) return;
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
    if (!isTauriEnvironment()) {
      return '当前为网页模式，系统右键菜单集成仅在桌面端可用';
    }
    return await invoke<string>('install_finder_service');
  },

  uninstallFinderService: async (): Promise<string> => {
    if (!isTauriEnvironment()) {
      return '当前为网页模式，系统右键菜单集成仅在桌面端可用';
    }
    return await invoke<string>('uninstall_finder_service');
  },

  getWindowsRegContent: async (): Promise<string> => {
    if (!isTauriEnvironment()) {
      return '; 仅 Windows 桌面端支持生成注册表脚本';
    }
    return await invoke<string>('get_windows_reg_content');
  },

  revealInFinder: async (path: string): Promise<void> => {
    if (!isTauriEnvironment()) return;
    return await invoke<void>('reveal_in_finder', { path });
  },

  setWindowMode: async (mode: 'compact' | 'full'): Promise<void> => {
    if (!isTauriEnvironment()) return;
    return await invoke<void>('set_window_mode', { mode });
  },

  getDocumentPreview: async (path: string): Promise<DocumentPreviewData> => {
    if (!isTauriEnvironment()) {
      const stored = webFileStore.get(path);
      const item = stored?.item ?? buildWebFileItem(path, false, 0);
      return {
        path: item.path,
        name: item.name,
        extension: item.extension,
        size: item.size,
        modified: item.modified,
        page_count: item.page_count,
        mime_type: item.extension === 'pdf' ? 'application/pdf' : 'application/octet-stream',
        text_content: stored ? undefined : '网页预览模式下仅可预览通过文件选择器上传的文档。',
      };
    }
    return await invoke<DocumentPreviewData>('get_document_preview', { path });
  },

  quickLookFile: async (path: string): Promise<void> => {
    if (!isTauriEnvironment()) return;
    return await invoke<void>('quick_look_file', { path });
  },
};
