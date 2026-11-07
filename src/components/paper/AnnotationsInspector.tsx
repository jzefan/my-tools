import React, { useState } from 'react';
import { AnnotationItem, PdfRect } from '../../types/paper';
import { annotationText, paperMarkdown } from '../../utils/paperReader';
import { paperApi } from '../../services/paperApi';
import {
  Highlighter,
  Trash2,
  Edit3,
  Search,
  Download,
  Check,
  Copy,
  ArrowRight,
} from 'lucide-react';

interface AnnotationsInspectorProps {
  paperTitle: string;
  locationUnit?: '页' | '段';
  annotations: AnnotationItem[];
  onJumpToPage: (pageNo: number, rect?: PdfRect) => void;
  onUpdateAnnotation: (id: string, noteText: string, patch?: Partial<AnnotationItem>) => void;
  onDeleteAnnotation: (id: string) => void;
}

export const AnnotationsInspector: React.FC<AnnotationsInspectorProps> = ({
  paperTitle,
  locationUnit = '页',
  annotations,
  onJumpToPage,
  onUpdateAnnotation,
  onDeleteAnnotation,
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [filterColor, setFilterColor] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const filtered = annotations.filter((a) => {
    if (filterType !== 'all' && a.type !== filterType) return false;
    if (filterColor !== 'all' && a.color !== filterColor) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inText = a.selectedText?.toLowerCase().includes(q);
      const inNote = a.noteText?.toLowerCase().includes(q);
      const inAnswer = a.answer?.toLowerCase().includes(q);
      if (!inText && !inNote && !inAnswer) return false;
    }
    return true;
  });

  const handleExportMarkdown = async () => {
    if (annotations.length === 0) return;
    const md = paperMarkdown({ id: annotations[0].paperId, title: paperTitle, path: locationUnit === '段' ? 'paper.docx' : 'paper.pdf' }, annotations);

    try {
      const path = await paperApi.saveMarkdown(paperTitle + '_研读笔记', md);
      if (path) setExportNotice('已导出');
    } catch (error) { setExportNotice(`导出失败：${String(error)}`); }

  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/40 dark:bg-slate-900/40">
      {/* Header & Filter Controls */}
      <div className="p-3 border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-950 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <Highlighter className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              批注与笔记 ({annotations.length})
            </span>
          </div>

          <button
            type="button"
            onClick={handleExportMarkdown}
            disabled={annotations.length === 0}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300 transition-colors cursor-pointer disabled:opacity-40"
            title="导出 Markdown"
          >
            {exportNotice ? (
              <>
                <Check className="w-3 h-3 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">已导出</span>
              </>
            ) : (
              <>
                <Download className="w-3 h-3" />
                <span>导出</span>
              </>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-3 h-3 text-slate-400 absolute left-2 top-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索批注或原文..."
            className="w-full pl-7 pr-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center space-x-1 overflow-x-auto text-[11px] pt-1">
          {['all', 'highlight', 'note', 'ai_qa', 'area'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterType(t)}
              className={`px-2 py-0.5 rounded-md transition-colors shrink-0 ${
                filterType === t
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t === 'all'
                ? '全部'
                : t === 'highlight'
                ? '高亮'
                : t === 'note'
                ? '笔记'
                : t === 'ai_qa'
                ? 'AI 问答'
                : '区域'}
            </button>
          ))}
        </div>

        {/* Color Filter */}
        <div className="flex items-center space-x-1 text-[10px] text-slate-400 pt-0.5">
          <span>颜色:</span>
          {['all', 'yellow', 'green', 'blue', 'purple', 'red'].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilterColor(c)}
              className={`px-1.5 py-0.5 rounded-md cursor-pointer ${
                filterColor === c ? 'bg-slate-200 dark:bg-slate-800 font-bold text-slate-800 dark:text-slate-200' : 'hover:text-slate-600'
              }`}
            >
              {c === 'all' ? '全部' : c === 'yellow' ? '黄' : c === 'green' ? '绿' : c === 'blue' ? '蓝' : c === 'purple' ? '紫' : '红'}
            </button>
          ))}
        </div>
      </div>

      {exportNotice && <p role="status" className="px-3 py-1 text-[11px] text-slate-500">{exportNotice}</p>}
      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filtered.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center text-xs text-slate-400 space-y-1">
            <Highlighter className="w-6 h-6 text-slate-300 dark:text-slate-600 stroke-1" />
            <div>暂无批注</div>
            <div className="text-[11px]">阅读时选中文字可添加高亮或笔记</div>
          </div>
        ) : (
          filtered.map((item) => {
            const colorDot =
              item.color === 'yellow'
                ? 'bg-amber-400'
                : item.color === 'green'
                ? 'bg-emerald-400'
                : item.color === 'blue'
                ? 'bg-blue-400'
                : item.color === 'purple'
                ? 'bg-purple-400'
                : 'bg-rose-400';

            return (
              <div
                key={item.id}
                className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-2 shadow-2xs hover:border-indigo-300 dark:hover:border-indigo-800 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <span className={`w-2 h-2 rounded-full ${colorDot}`} />
                    <span className="font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                      {item.orphaned ? '待定位' : `第 ${item.pageNo} ${locationUnit}`}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {item.type === 'highlight'
                        ? '高亮'
                        : item.type === 'note'
                        ? '笔记'
                        : item.type === 'ai_qa'
                        ? 'AI 问答'
                        : '图表'}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1">
                    <button title="复制批注" onClick={() => { void navigator.clipboard.writeText(annotationText(item)); }} className="p-1 text-slate-400 hover:text-indigo-600"><Copy className="w-3.5 h-3.5" /></button>
                    <button
                      type="button"
                      disabled={item.orphaned}
                      onClick={() => onJumpToPage(item.pageNo, item.rects[0])}
                      className="p-1 rounded text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                      title="跳转到该页"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditText(item.type === 'ai_qa' ? item.answer || item.noteText || '' : item.noteText || '');
                      }}
                      className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                      title="编辑"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteAnnotation(item.id)}
                      className="p-1 rounded text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {item.type === 'ai_qa' && <p className="text-[10px] text-slate-400">{item.qaState === 'verified' ? '引用已核验' : !item.qaState || item.qaState === 'legacy' ? '历史记录' : '草稿'}{item.answerEdited ? ' · 已编辑' : ''}</p>}
                {item.evidence?.map((e, index) => <button key={index} onClick={() => onJumpToPage(e.pageNo, e.rect)} className="text-[11px] text-indigo-600 mr-2">证据 · 第 {e.pageNo} {locationUnit}</button>)}
                {/* Screenshot preview for area crop */}
                {item.screenshotDataUrl && (
                  <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 max-h-32 bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
                    <img
                      src={item.screenshotDataUrl}
                      alt="截图"
                      className="max-h-32 object-contain"
                    />
                  </div>
                )}

                {/* Selected Text */}
                {item.selectedText && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 border-l-2 border-indigo-300 dark:border-indigo-700 pl-2 italic line-clamp-3">
                    "{item.selectedText}"
                  </p>
                )}

                {/* Note Text */}
                {editingId === item.id ? (
                  <div className="space-y-1.5 pt-1">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-hidden"
                      rows={3}
                    />
                    <div className="flex justify-end space-x-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-600"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateAnnotation(item.id, item.type === 'ai_qa' ? item.noteText : editText, item.type === 'ai_qa' ? { answer: editText, answerEdited: true, qaState: 'draft' } : undefined);
                          setEditingId(null);
                        }}
                        className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  item.noteText && (
                    <p className="text-xs text-slate-800 dark:text-slate-200 font-medium whitespace-pre-wrap">
                      {item.noteText}
                    </p>
                  )
                )}

                {/* AI QA result */}
                {item.question && (
                  <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 space-y-1 text-xs">
                    <div className="text-slate-500 font-medium">问: {item.question}</div>
                    <div className="text-slate-700 dark:text-slate-300 bg-indigo-50/40 dark:bg-indigo-950/20 p-2 rounded-lg leading-relaxed">
                      {item.answer}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
