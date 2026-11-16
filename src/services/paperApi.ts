import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  PaperItem,
  AnnotationItem,
  OverviewRecord,
  PaperDraftEdit,
  AiProviderConfig,
} from '../types/paper';
import { normalizeAcademicExternalUrl, buildDoiUrl } from '../utils/citations';
import { OperationResult } from '../types';

export interface PaperLibraryState {
  papers: PaperItem[];
  annotations: Record<string, AnnotationItem[]>; // paperId -> AnnotationItem[]
  overviews: Record<string, OverviewRecord>; // paperId -> OverviewRecord
  drafts: Record<string, PaperDraftEdit>; // paperId -> PaperDraftEdit
  aiConfig?: AiProviderConfig;
  updatedAt?: number;
  references?: Record<string, import('../types/paper').ReferenceEntry[]>;
}

const DEFAULT_AI_CONFIG: AiProviderConfig = {
  provider: 'deepseek',
  apiKey: '',
  endpoint: 'https://api.deepseek.com/v1',
  model: 'deepseek-flash',
  temperature: 0.3,
};

const isBrowserNonTauri = (): boolean =>
  typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window);

const browserPaperBytes = new Map<string, { name: string; bytes: Uint8Array; sha256: string }>();

async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `web-${bytes.byteLength}-${Date.now()}`;
}

function openPaperIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('doc-tools-papers', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器文献存储'));
  });
}

async function idbPutPaperBytes(key: string, bytes: Uint8Array): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openPaperIdb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        tx.objectStore('files').put(copy.buffer, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // fallback to in-memory map only
  }
}

async function idbGetPaperBytes(key: string): Promise<Uint8Array | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openPaperIdb();
    try {
      const buf = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
        const req = db.transaction('files', 'readonly').objectStore('files').get(key);
        req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
        req.onerror = () => reject(req.error);
      });
      return buf ? new Uint8Array(buf) : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function pickPaperFilesInBrowser(): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.docx,.doc';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      const paths: string[] = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sha256 = await computeSha256Hex(bytes);
        const virtualPath = `browser://${sha256.slice(0, 12)}/${file.name}`;
        browserPaperBytes.set(virtualPath, { name: file.name, bytes, sha256 });
        browserPaperBytes.set(sha256, { name: file.name, bytes, sha256 });
        await idbPutPaperBytes(sha256, bytes);
        paths.push(virtualPath);
      }
      resolve(paths);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

class PaperApiService {
  private current: PaperLibraryState | null = null;
  private sessionKeys = new Map<string, string>();
  private writes: Promise<void> = Promise.resolve();

  async loadLibrary(): Promise<PaperLibraryState> {
    if (isBrowserNonTauri()) {
      let backup: PaperLibraryState | undefined;
      try {
        backup = this.parseLibrary(localStorage.getItem('doc_tools_paper_library_backup') || '{}');
      } catch {}
      const state = backup || this.emptyLibrary();
      const config = state.aiConfig || this.loadLocalAiConfig();
      config.keyPersistence = config.apiKey ? 'session' : 'none';
      if (config.apiKey) this.sessionKeys.set(config.provider, config.apiKey);
      state.aiConfig = config;
      this.current = state;
      return state;
    }

    let native: PaperLibraryState | undefined;
    let failure: unknown;
    try { native = this.parseLibrary(await invoke<string>('load_paper_library')); }
    catch (error) { failure = error; }
    let backup: PaperLibraryState | undefined;
    try { backup = this.parseLibrary(localStorage.getItem('doc_tools_paper_library_backup') || '{}'); } catch {}
    if (!native && !backup && failure) throw new Error(`资料库读取失败：${String(failure)}`);
    const state = backup && (!native || (backup.updatedAt || 0) > (native.updatedAt || 0)) ? backup : native || this.emptyLibrary();
    const config = state.aiConfig || this.loadLocalAiConfig();
    if (config.apiKey) {
      state.aiConfig = await this.saveAiConfig(config);
      state.updatedAt = Date.now();
    } else {
      try { config.apiKey = await invoke<string>('load_paper_ai_key', { provider: config.provider }); } catch {}
      config.keyPersistence = config.apiKey ? 'system' : 'none';
      this.sessionKeys.set(config.provider, config.apiKey);
      state.aiConfig = config;
    }
    this.current = state;
    return state;
  }

  private emptyLibrary(): PaperLibraryState {
    return { papers: [], annotations: {}, overviews: {}, drafts: {}, aiConfig: this.loadLocalAiConfig() };
  }

  private parseLibrary(json: string): PaperLibraryState | undefined {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('资料库格式无效');
    if (Object.keys(parsed).length === 0) return undefined;
    if (!Array.isArray(parsed.papers)) throw new Error('论文列表格式无效');
    return { ...this.emptyLibrary(), ...parsed,
      papers: parsed.papers.filter((p: PaperItem) => p && p.id && typeof p.path === 'string' && p.path.trim())
        .map((p: PaperItem) => ({ ...p, authors: p.authors || [], tags: p.tags || [], lastRotation: p.lastRotation || 0 })),
      aiConfig: { ...this.loadLocalAiConfig(parsed.aiConfig), apiKey: this.loadLocalAiConfig(parsed.aiConfig).apiKey || parsed.aiConfig?.apiKey || '' },
    };
  }

  saveLibrary(state: PaperLibraryState): Promise<void> {
    this.current = state;
    // The backup is readable on the next launch even when native persistence fails.
    const json = JSON.stringify({ ...state, aiConfig: state.aiConfig ? { ...state.aiConfig, apiKey: '' } : undefined });
    try { localStorage.setItem('doc_tools_paper_library_backup', json); } catch {}
    if (isBrowserNonTauri()) {
      return Promise.resolve();
    }
    const write = this.writes.catch(() => {}).then(() => invoke<void>('save_paper_library', { data: json }));
    this.writes = write;
    return write;
  }

  loadLocalAiConfig(fallback?: AiProviderConfig): AiProviderConfig {
    try {
      const saved = localStorage.getItem('doc_tools_ai_config');
      if (saved) { const config = { ...DEFAULT_AI_CONFIG, ...JSON.parse(saved) }; return { ...config, apiKey: this.sessionKeys.get(config.provider) || config.apiKey || '' }; }
    } catch {}
    return fallback || { ...DEFAULT_AI_CONFIG };
  }

  saveLocalAiConfig(config: AiProviderConfig): void {
    localStorage.setItem('doc_tools_ai_config', JSON.stringify({ ...config, apiKey: '' }));
    const providers = JSON.parse(localStorage.getItem('doc_tools_ai_providers') || '{}');
    providers[config.provider] = { ...config, apiKey: '' };
    localStorage.setItem('doc_tools_ai_providers', JSON.stringify(providers));
  }

  async storeOverview(record: OverviewRecord): Promise<void> {
    const state = this.current || await this.loadLibrary();
    if (!state.papers.some(p => p.id === record.paperId)) return;
    const write = this.saveLibrary({ ...state, overviews: { ...state.overviews, [record.paperId]: record }, updatedAt: Date.now() });
    window.dispatchEvent(new CustomEvent('paper-overview', { detail: record }));
    await write;
  }

  async saveAiConfig(config: AiProviderConfig): Promise<AiProviderConfig> {
    let keyPersistence: AiProviderConfig['keyPersistence'] = config.apiKey ? 'session' : 'none';
    this.sessionKeys.set(config.provider, config.apiKey);
    if (config.apiKey && !isBrowserNonTauri()) {
      try { await invoke('save_paper_ai_key', { provider: config.provider, key: config.apiKey }); keyPersistence = 'system'; } catch {}
    }
    this.saveLocalAiConfig(config);
    return { ...config, keyPersistence };
  }

  async providerConfig(provider: AiProviderConfig['provider']): Promise<AiProviderConfig | null> {
    let stored: AiProviderConfig | null = null;
    try { stored = JSON.parse(localStorage.getItem('doc_tools_ai_providers') || '{}')[provider] || null; } catch {}
    if (!stored) return null;
    let apiKey = this.sessionKeys.get(provider) || '';
    if (!apiKey && !isBrowserNonTauri()) { try { apiKey = await invoke('load_paper_ai_key', { provider }); } catch {} }
    return { ...stored, apiKey, keyPersistence: apiKey ? (isBrowserNonTauri() ? 'session' : 'system') : 'none' };
  }

  async revealData(): Promise<void> {
    if (isBrowserNonTauri()) {
      throw new Error('网页模式下文献数据保存在浏览器本地存储（IndexedDB / localStorage）中');
    }
    const path = await invoke<string>('paper_data_directory');
    const { api } = await import('./api'); await api.openFilePath(path);
  }

  async importFile(path: string): Promise<{ path: string; sourcePath: string; name: string; sha256: string; size: number }> {
    if (isBrowserNonTauri()) {
      const entry = browserPaperBytes.get(path);
      if (!entry) throw new Error('网页模式下请点击「导入」选择本地 PDF 或 DOCX 文件');
      return {
        path,
        sourcePath: path,
        name: entry.name,
        sha256: entry.sha256,
        size: entry.bytes.byteLength,
      };
    }
    return invoke('import_paper_file', { path });
  }

  async chooseFiles(): Promise<string[]> {
    if (isBrowserNonTauri()) {
      return pickPaperFilesInBrowser();
    }
    return invoke('choose_paper_files');
  }

  async saveMarkdown(name: string, content: string): Promise<string | null> {
    const filename = name.replace(/[\\/:*?"<>|]/g, '_') + '.md';
    if (isBrowserNonTauri()) {
      downloadTextFile(filename, content);
      return filename;
    }
    return invoke('export_paper_markdown', { name: filename, content });
  }

  async readPdfBinary(path: string, sha256?: string): Promise<Uint8Array> {
    if (isBrowserNonTauri()) {
      const hit = browserPaperBytes.get(path) || (sha256 ? browserPaperBytes.get(sha256) : undefined);
      if (hit) return hit.bytes;
      if (sha256) {
        const stored = await idbGetPaperBytes(sha256);
        if (stored) return stored;
      }
      throw new Error('未在浏览器缓存中找到该文献文件，请重新导入');
    }
    const bytes = await invoke<number[]>(sha256 ? 'read_paper_file' : 'read_binary_file', { path, ...(sha256 ? { sha256 } : {}) });
    return new Uint8Array(bytes);
  }

  async exportEditedPdf(
    inputPdfPath: string,
    outputPdfPath: string,
    pages: Array<{ original_page_no: number; rotation: number }>
  ): Promise<OperationResult> {
    if (isBrowserNonTauri()) {
      return {
        success: false,
        message: '网页预览模式不支持原生 PDF 导出编辑，请使用桌面端执行',
      };
    }
    return invoke<OperationResult>('export_edited_pdf_pages', {
      request: {
        input_pdf_path: inputPdfPath,
        output_pdf_path: outputPdfPath,
        pages,
      },
    });
  }

  async exportMarkdown(path: string, content: string): Promise<OperationResult> {
    if (isBrowserNonTauri()) {
      const filename = path.split(/[\\/]/).pop() || 'manuscript.md';
      downloadTextFile(filename, content);
      return { success: true, message: '已触发 Markdown 下载', output_path: filename };
    }
    return invoke<OperationResult>('save_markdown_file', { path, content });
  }

  async openExternalUrl(url: string): Promise<void> {
    const destination = normalizeAcademicExternalUrl(url);
    if (isBrowserNonTauri()) {
      window.open(destination, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await openUrl(destination);
    } catch {
      window.open(destination, '_blank', 'noopener,noreferrer');
    }
  }

  buildScholarSearchUrl(query: string): string {
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
  }

  buildArxivSearchUrl(arxivId: string): string {
    const clean = arxivId.replace(/^arxiv:\s*/i, '');
    return `https://arxiv.org/abs/${clean}`;
  }

  buildDoiUrl(doi: string): string {
    return buildDoiUrl(doi.replace(/^https?:\/\/doi\.org\//i, ''));
  }
}

export const paperApi = new PaperApiService();
