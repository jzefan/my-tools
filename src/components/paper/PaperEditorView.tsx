import React, { useState, useEffect } from 'react';
import {
  PaperDraftEdit,
  PaperItem,
  ReferenceEntry,
  AiProviderConfig,
} from '../../types/paper';
import { paperApi } from '../../services/paperApi';
import { polishPaperText, PolishMode, POLISH_MODE_LABELS, PolishResult } from '../../utils/paperAi';
import { confirmDialog, alertDialog } from '../../utils/dialog';
import {
  Save,
  Sparkles,
  Download,
  RotateCw,
  Trash2,
  MoveUp,
  MoveDown,
  Layers,
  Check,
  RefreshCw,
  Eye,
  FileCode,
  BookOpen,
  Wand2,
} from 'lucide-react';

interface PaperEditorViewProps {
  paper: PaperItem;
  pdfData: Uint8Array | null;
  config: AiProviderConfig;
  allReferences: ReferenceEntry[];
  extractedPagesText: Array<{ pageNo: number; text: string }>;
  draft: PaperDraftEdit | null;
  onSaveDraft: (draft: PaperDraftEdit) => void;
  onClose: () => void;
}

export const PaperEditorView: React.FC<PaperEditorViewProps> = ({
  paper,
  config,
  allReferences,
  extractedPagesText,
  draft,
  onSaveDraft,
  onClose,
}) => {
  // Draft content state
  const [title, setTitle] = useState(draft?.title || paper.title);
  const [abstract, setAbstract] = useState(draft?.abstract || paper.abstract || '');
  const [content, setContent] = useState(
    draft?.content ||
      `# ${paper.title}\n\n## 摘要\n${paper.abstract || '在此输入摘要...'}\n\n## 1. 引言 (Introduction)\n在此输入引言...\n\n## 2. 核心方法 (Methodology)\n在此输入方法...\n\n## 3. 实验与评估 (Experiments & Results)\n在此输入实验结果...\n\n## 4. 结论与未来工作 (Conclusion)\n在此输入结论...\n\n## 参考文献 (References)\n`
  );

  // Editor View modes: 'split' = Editor + Preview side-by-side; 'edit_only'; 'preview_only'
  const [editorMode, setEditorMode] = useState<'split' | 'edit_only' | 'preview_only'>('split');
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // AI Polish Assistant State
  const [showAiPolish, setShowAiPolish] = useState(false);
  const [selectedTextForPolish, setSelectedTextForPolish] = useState('');
  const [polishMode, setPolishMode] = useState<PolishMode>('academic_style');
  const [isPolishing, setIsPolishing] = useState(false);
  const [polishResult, setPolishResult] = useState<PolishResult | null>(null);

  // PDF Page Manager Modal State
  const [showPageManager, setShowPageManager] = useState(false);
  const [pageOrder, setPageOrder] = useState<Array<{ pageNo: number; rotation: number }>>([]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Initialize page order for page management
  useEffect(() => {
    setPageOrder(
      Array.from({ length: paper.pageCount }, (_, i) => ({
        pageNo: i + 1,
        rotation: 0,
      }))
    );
  }, [paper.pageCount]);

  // Handle Save
  const handleSave = () => {
    const updatedDraft: PaperDraftEdit = {
      paperId: paper.id,
      title: title.trim(),
      abstract: abstract.trim(),
      content,
      references: allReferences,
      lastModified: Date.now(),
    };
    onSaveDraft(updatedDraft);
    setSaveNotice('已保存草稿');
    setTimeout(() => {
      setSaveNotice(null);
    }, 1500);
  };

  // Extract from original PDF into draft
  const handleExtractFromPdf = async () => {
    if (extractedPagesText.length === 0) return;
    const confirmed = await confirmDialog('是否将原文档正文追加至编辑器？');
    if (!confirmed) return;

    let fullBody = `\n\n## 原文提取内容:\n\n`;
    for (const p of extractedPagesText) {
      fullBody += `### [第 ${p.pageNo} 页]\n${p.text.slice(0, 1500)}\n\n`;
    }

    setContent((prev) => prev + fullBody);
    setSaveNotice('已提取文本');
    setTimeout(() => setSaveNotice(null), 1500);
  };

  // Run AI Polish on selected text
  const handleRunPolish = async () => {
    const textToPolish = selectedTextForPolish.trim();
    if (!textToPolish) return;

    setIsPolishing(true);
    setPolishResult(null);
    try {
      const res = await polishPaperText(textToPolish, polishMode, config);
      setPolishResult(res);
    } catch (e: any) {
      console.error('润色失败:', e);
    } finally {
      setIsPolishing(false);
    }
  };

  // Accept Polished Text
  const handleAcceptPolish = () => {
    if (!polishResult) return;
    setContent((prev) => prev.replace(polishResult.original, polishResult.revised));
    setPolishResult(null);
    setShowAiPolish(false);
    setSaveNotice('已采纳修改');
    setTimeout(() => setSaveNotice(null), 1500);
  };

  // Page Manager Actions
  const movePage = (index: number, direction: 'up' | 'down') => {
    setPageOrder((prev) => {
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[target];
      copy[target] = temp;
      return copy;
    });
  };

  const rotatePage = (index: number) => {
    setPageOrder((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, rotation: (item.rotation + 90) % 360 } : item
      )
    );
  };

  const removePage = async (index: number) => {
    if (pageOrder.length <= 1) {
      await alertDialog('至少保留一页');
      return;
    }
    setPageOrder((prev) => prev.filter((_, i) => i !== index));
  };

  const handleExportEditedPdf = async () => {
    setIsExportingPdf(true);
    try {
      const safePath = paper.path || paper.name || 'untitled.pdf';
      const outPath = safePath.replace(/\.(pdf|docx|doc)$/i, '_已编辑重排.pdf');
      const res = await paperApi.exportEditedPdf(
        paper.path || safePath,
        outPath,
        pageOrder.map((p) => ({
          original_page_no: p.pageNo,
          rotation: p.rotation,
        }))
      );
      if (res.success) {
        await alertDialog(`已导出重排 PDF:\n${outPath}`);
        setShowPageManager(false);
      } else {
        await alertDialog(`导出失败: ${res.message}`);
      }
    } catch (e: any) {
      await alertDialog(`导出异常: ${e?.message || e}`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Export Markdown Draft
  const handleExportMarkdown = async () => {
    const safePath = paper.path || paper.name || 'untitled.pdf';
    const mdPath = safePath.replace(/\.(pdf|docx|doc)$/i, '_论文手稿.md');
    try {
      await paperApi.exportMarkdown(mdPath, content);
      await alertDialog(`已导出 Markdown 手稿:\n${mdPath}`);
    } catch (e: any) {
      navigator.clipboard.writeText(content);
      await alertDialog('已复制到剪贴板');
    }
  };

  // Export BibTeX
  const handleExportBibTeX = () => {
    const bib = `@article{${paper.title.replace(/\s+/g, '_').slice(0, 20)}_${paper.year || 2026},
  title={${paper.title}},
  author={${paper.authors.join(' and ') || 'Unknown'}},
  year={${paper.year || 2026}},
  journal={${paper.venue || 'Academic Repository'}},
  doi={${paper.doi || ''}}
}`;
    navigator.clipboard.writeText(bib);
    setSaveNotice('已复制 BibTeX');
    setTimeout(() => setSaveNotice(null), 1500);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-slate-950">
      {/* Top Studio Toolbar */}
      <div className="px-4 py-2.5 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 flex items-center justify-between">
        <div className="flex items-center space-x-2 min-w-0 mr-4">
          <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
            <BookOpen className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
              {title || paper.name}
            </div>
            <div className="text-[10px] text-slate-400">手稿编辑</div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5 shrink-0">
          {saveNotice && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 animate-fade-in flex items-center space-x-1">
              <Check className="w-3 h-3" />
              <span>{saveNotice}</span>
            </span>
          )}

          {/* Mode Switcher */}
          <div className="flex items-center p-0.5 bg-slate-200/60 dark:bg-slate-800 rounded-lg text-xs font-medium">
            <button
              type="button"
              onClick={() => setEditorMode('edit_only')}
              className={`px-2 py-1 rounded-md transition-colors ${
                editorMode === 'edit_only'
                  ? 'bg-white dark:bg-slate-900 text-cyan-600 shadow-2xs font-bold'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
              title="源码编辑"
            >
              <FileCode className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditorMode('split')}
              className={`px-2 py-1 rounded-md transition-colors ${
                editorMode === 'split'
                  ? 'bg-white dark:bg-slate-900 text-cyan-600 shadow-2xs font-bold'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
              title="双栏对照"
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditorMode('preview_only')}
              className={`px-2 py-1 rounded-md transition-colors ${
                editorMode === 'preview_only'
                  ? 'bg-white dark:bg-slate-900 text-cyan-600 shadow-2xs font-bold'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
              title="排版预览"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          </div>

          <span className="w-px h-4 bg-slate-200 dark:border-slate-800" />

          {/* AI Polish Trigger */}
          <button
            type="button"
            onClick={() => setShowAiPolish(!showAiPolish)}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              showAiPolish
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI 润色</span>
          </button>

          {/* Extract From PDF */}
          <button
            type="button"
            onClick={handleExtractFromPdf}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
            title="提取原稿正文"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>提取原稿</span>
          </button>

          {/* Page Management */}
          <button
            type="button"
            onClick={() => setShowPageManager(true)}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
            title="页面管理"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>页面管理 ({pageOrder.length})</span>
          </button>

          {/* Export BibTeX */}
          <button
            type="button"
            onClick={handleExportBibTeX}
            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors cursor-pointer font-mono"
            title="复制 BibTeX"
          >
            BibTeX
          </button>

          {/* Export Markdown */}
          <button
            type="button"
            onClick={handleExportMarkdown}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>导出</span>
          </button>

          {/* Save Draft */}
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center space-x-1 px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>保存</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            返回阅读
          </button>
        </div>
      </div>

      {/* Main Split Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Markdown / Academic Text Editor */}
        {(editorMode === 'edit_only' || editorMode === 'split') && (
          <div
            className={`flex flex-col h-full border-r border-slate-200/80 dark:border-slate-800 ${
              editorMode === 'split' ? 'w-1/2' : 'w-full'
            }`}
          >
            {/* Title & Abstract Quick Edit Header */}
            <div className="p-3 border-b border-slate-200/60 dark:border-slate-800/60 bg-slate-50/40 dark:bg-slate-900/40 space-y-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="论文标题..."
                className="w-full font-bold text-sm bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-cyan-500 focus:outline-hidden pb-1"
              />
              <textarea
                value={abstract}
                onChange={(e) => setAbstract(e.target.value)}
                placeholder="论文摘要..."
                rows={2}
                className="w-full text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2 focus:outline-hidden focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            {/* Markdown Main Body Area */}
            <div className="flex-1 p-3 overflow-hidden flex flex-col">
              <div className="text-[11px] text-slate-400 pb-1 flex items-center justify-between">
                <span>正文内容 (Markdown / LaTeX):</span>
                <span>{content.length} 字符</span>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onSelect={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  const sel = target.value.substring(target.selectionStart, target.selectionEnd);
                  if (sel.trim()) {
                    setSelectedTextForPolish(sel.trim());
                  }
                }}
                className="flex-1 w-full p-3 font-mono text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-cyan-500 resize-none leading-relaxed"
                placeholder="支持 Markdown 与 LaTeX 公式..."
              />
            </div>
          </div>
        )}

        {/* Right Side: Formatted Live Preview */}
        {(editorMode === 'preview_only' || editorMode === 'split') && (
          <div
            className={`flex flex-col h-full overflow-y-auto p-6 bg-slate-50/50 dark:bg-slate-900/30 ${
              editorMode === 'split' ? 'w-1/2' : 'w-full'
            }`}
          >
            <div className="max-w-2xl mx-auto w-full bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4">
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 text-center pb-2 border-b border-slate-100 dark:border-slate-800">
                {title}
              </h1>

              {abstract && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
                  <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    Abstract
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 italic leading-relaxed">
                    {abstract}
                  </p>
                </div>
              )}

              {/* Rendered content */}
              <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed space-y-2 whitespace-pre-wrap font-serif">
                {content}
              </div>
            </div>
          </div>
        )}

        {/* AI Polish Drawer / Panel */}
        {showAiPolish && (
          <div className="w-80 border-l border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col h-full shadow-lg animate-pop-in">
            <div className="p-3 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  AI 润色
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAiPolish(false)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                关闭
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  润色模式:
                </label>
                <select
                  value={polishMode}
                  onChange={(e) => setPolishMode(e.target.value as PolishMode)}
                  className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs focus:outline-hidden"
                >
                  {Object.entries(POLISH_MODE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.title}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  {POLISH_MODE_LABELS[polishMode].desc}
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  待润色文本:
                </label>
                <textarea
                  value={selectedTextForPolish}
                  onChange={(e) => setSelectedTextForPolish(e.target.value)}
                  placeholder="选择句子或直接粘贴..."
                  rows={4}
                  className="w-full p-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden"
                />
              </div>

              <button
                type="button"
                onClick={handleRunPolish}
                disabled={isPolishing || !selectedTextForPolish.trim()}
                className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-xs flex items-center justify-center space-x-1.5 shadow-xs cursor-pointer"
              >
                {isPolishing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>正在润色...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>开始润色</span>
                  </>
                )}
              </button>

              {/* Polish Diff & Suggestion Results */}
              {polishResult && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/60 space-y-2.5 animate-pop-in">
                  <div className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                    润色建议:
                  </div>

                  <div className="p-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/80 text-emerald-900 dark:text-emerald-300 font-serif leading-relaxed">
                    {polishResult.revised}
                  </div>

                  {polishResult.suggestions.length > 0 && (
                    <div className="space-y-1 text-[11px] text-slate-500">
                      <span className="font-semibold">优化依据:</span>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {polishResult.suggestions.map((s, idx) => (
                          <li key={idx}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-center space-x-2 pt-1">
                    <button
                      type="button"
                      onClick={handleAcceptPolish}
                      className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center space-x-1 shadow-xs cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>采纳替换</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPolishResult(null)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 text-xs"
                    >
                      放弃
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Page Management Modal */}
      {showPageManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 animate-pop-in">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center space-x-2">
                <RotateCw className="w-4 h-4 text-cyan-600" />
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  页面管理
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowPageManager(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              可调整页面顺序、旋转或删除页面。
            </p>

            {/* Page Items Grid */}
            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1 text-xs">
              {pageOrder.map((item, idx) => (
                <div
                  key={`${item.pageNo}_${idx}`}
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between"
                >
                  <div className="flex items-center space-x-2 font-mono">
                    <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-[11px]">
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      原第 {item.pageNo} 页
                    </span>
                    {item.rotation !== 0 && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-700 font-bold">
                        旋转 {item.rotation}°
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <button
                      type="button"
                      onClick={() => rotatePage(idx)}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                      title="旋转 90°"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => movePage(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 disabled:opacity-30"
                      title="上移"
                    >
                      <MoveUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => movePage(idx, 'down')}
                      disabled={idx === pageOrder.length - 1}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 disabled:opacity-30"
                      title="下移"
                    >
                      <MoveDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePage(idx)}
                      className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950/40 text-rose-500"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal Actions */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-mono">
                保留 {pageOrder.length} 页
              </span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowPageManager(false)}
                  className="px-3 py-1.5 rounded-xl text-slate-400 hover:text-slate-600 text-xs"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleExportEditedPdf}
                  disabled={isExportingPdf}
                  className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-xs flex items-center space-x-1.5 cursor-pointer"
                >
                  {isExportingPdf ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>正在导出...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      <span>导出 PDF</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
