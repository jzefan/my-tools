import type { AnnotationItem, OverviewRecord, PaperItem } from '../types/paper';

/** Fold typography only; NFKC would change mathematical superscripts. */
export function normalizePaperText(value: string): string {
  const ligatures = ['ff', 'fi', 'fl', 'ffi', 'ffl', 'st', 'st'];
  return value.replace(/[\uFB00-\uFB06]/g, c => ligatures[c.charCodeAt(0) - 0xFB00])
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u00ad/g, '').replace(/[\u2010-\u2015]/g, '-').normalize('NFC');
}

export function findPaperMatches(pages: Array<{ pageNo: number; text: string }>, query: string) {
  const needle = normalizePaperText(query.trim()).toLocaleLowerCase();
  if (!needle) return [];
  return pages.flatMap(page => page.text.split(/\n+/).filter(text => normalizePaperText(text).toLocaleLowerCase().includes(needle))
    .map(text => ({ pageNo: page.pageNo, text }))).slice(0, 100);
}

export function annotationText(item: AnnotationItem): string {
  return [item.selectedText && `> ${item.selectedText}`, item.question && `问题：${item.question}`,
    item.answer && `回答：${item.answer}`, item.noteText && item.noteText !== item.answer && item.noteText,
    ...(item.evidence || []).map(e => `> [第 ${e.pageNo} 页] ${e.quote}`)].filter(Boolean).join('\n\n');
}

export function overviewMarkdown(overview: OverviewRecord, locationUnit = '页'): string {
  const labels = { author_claim: '作者陈述', model_synthesis: '模型归纳', model_critique: '评论分析' };
  return overview.sections.map(section => `### ${section.label}\n\n${(section.claims?.length ? section.claims : [section]).map(claim => `**${labels[claim.category]}**\n\n${claim.content}\n\n${claim.evidence.map(e => `> [第 ${e.pageNo} ${locationUnit}] ${e.quote}`).join('\n')}`).join('\n\n')}`).join('\n\n');
}

export function paperMarkdown(paper: Pick<PaperItem, 'id' | 'title'> & { path?: string }, annotations: AnnotationItem[], overview?: OverviewRecord | null): string {
  const unit = paper.path?.toLowerCase().endsWith('.docx') ? '段' : '页';
  return [`# ${paper.title}`, overview && `## 导读\n\n${overviewMarkdown(overview, unit)}`,
    '## 批注', ...annotations.filter(a => a.paperId === paper.id).map(a => `### 第 ${a.pageNo} ${unit} · ${a.type === 'ai_qa' ? `AI 问答（${a.qaState === 'verified' ? '已核验' : '草稿'}）` : a.type === 'highlight' ? '高亮' : '笔记'}\n\n${annotationText(a)}`)].filter(Boolean).join('\n\n');
}

export function clampPaperPage(page: number, total: number): number {
  return Math.max(1, Math.min(Math.max(1, total), Number.isFinite(page) ? Math.floor(page) : 1));
}

