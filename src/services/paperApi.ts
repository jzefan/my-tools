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

class PaperApiService {
  private current: PaperLibraryState | null = null;
  private sessionKeys = new Map<string, string>();
  private writes: Promise<void> = Promise.resolve();

  async loadLibrary(): Promise<PaperLibraryState> {
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
    if (config.apiKey) {
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
    if (!apiKey) { try { apiKey = await invoke('load_paper_ai_key', { provider }); } catch {} }
    return { ...stored, apiKey, keyPersistence: apiKey ? 'system' : 'none' };
  }

  async revealData(): Promise<void> {
    const path = await invoke<string>('paper_data_directory');
    const { api } = await import('./api'); await api.openFilePath(path);
  }

  async importFile(path: string): Promise<{ path: string; sourcePath: string; name: string; sha256: string; size: number }> {
    return invoke('import_paper_file', { path });
  }

  async chooseFiles(): Promise<string[]> { return invoke('choose_paper_files'); }

  async saveMarkdown(name: string, content: string): Promise<string | null> {
    return invoke('export_paper_markdown', { name: name.replace(/[\\/:*?"<>|]/g, '_') + '.md', content });
  }

  async readPdfBinary(path: string, sha256?: string): Promise<Uint8Array> {
    const bytes = await invoke<number[]>(sha256 ? 'read_paper_file' : 'read_binary_file', { path, ...(sha256 ? { sha256 } : {}) });
    return new Uint8Array(bytes);
  }

  async exportEditedPdf(
    inputPdfPath: string,
    outputPdfPath: string,
    pages: Array<{ original_page_no: number; rotation: number }>
  ): Promise<OperationResult> {
    return invoke<OperationResult>('export_edited_pdf_pages', {
      request: {
        input_pdf_path: inputPdfPath,
        output_pdf_path: outputPdfPath,
        pages,
      },
    });
  }

  async exportMarkdown(path: string, content: string): Promise<OperationResult> {
    return invoke<OperationResult>('save_markdown_file', { path, content });
  }

  async openExternalUrl(url: string): Promise<void> {
    const destination = normalizeAcademicExternalUrl(url);
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
