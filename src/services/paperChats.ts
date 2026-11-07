import type { AnnotationEvidence, PaperSelection } from '../types/paper';
export interface PaperChatTurn {
  question: string; answer: string; reasoning?: string; evidence: AnnotationEvidence[];
  status: 'verified' | 'invalid' | 'missing'; selection: PaperSelection; saved?: boolean; error?: string; running?: boolean;
}
class PaperChats {
  private turns = new Map<string, PaperChatTurn[]>();
  private listeners = new Map<string, Set<() => void>>();
  private selections = new Map<string, PaperSelection>();
  private drafts = new Map<string, string>();
  list(id: string): PaperChatTurn[] {
    if (!this.turns.has(id)) {
      let saved: PaperChatTurn[] = [];
      try { const value = JSON.parse(localStorage.getItem(`doc_tools_paper_chat_${id}`) || '[]'); if (Array.isArray(value)) saved = value.map((turn: PaperChatTurn) => turn.running ? { ...turn, running: false, error: '上次问答已中断' } : turn); } catch {}
      this.turns.set(id, saved);
    }
    return this.turns.get(id)!;
  }
  update(id: string, updater: (turns: PaperChatTurn[]) => PaperChatTurn[]) {
    const next = updater(this.list(id)).slice(-50); this.turns.set(id, next);
    try { localStorage.setItem(`doc_tools_paper_chat_${id}`, JSON.stringify(next)); } catch {}
    this.listeners.get(id)?.forEach(listener => listener());
  }
  subscribe(id: string, listener: () => void) {
    const set = this.listeners.get(id) || new Set<() => void>(); set.add(listener); this.listeners.set(id, set);
    return () => { set.delete(listener); };
  }
  selection(id: string) { return this.selections.get(id) || null; }
  setSelection(id: string, selection: PaperSelection) { this.selections.set(id, selection); }
  draft(id: string) { return this.drafts.get(id) || ''; }
  setDraft(id: string, text: string) { this.drafts.set(id, text); }
  remove(id: string) { this.turns.delete(id); this.drafts.delete(id); this.selections.delete(id); try { localStorage.removeItem(`doc_tools_paper_chat_${id}`); } catch {} }
}
export const paperChats = new PaperChats();
