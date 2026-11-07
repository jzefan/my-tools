// Synonyms and etymology extracted from zyronon/TypeWords
// public/dicts/en/word/CET4_T.json (GPL-3.0). See public/dicts/word-meta-license.txt.

export interface WordSense {
  pos: string;
  cn: string;
  words: string;
}

export interface WordOrigin {
  title: string;
  text: string;
}

export interface WordExtra {
  synos: WordSense[];
  etymology: WordOrigin[];
}

interface RawMeta {
  words?: Record<string, { s?: string[][]; e?: string[][] }>;
}

let pending: Promise<Map<string, WordExtra>> | null = null;

export function loadWordMeta(): Promise<Map<string, WordExtra>> {
  if (!pending) {
    pending = fetch('/dicts/word-meta.json')
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<RawMeta>;
      })
      .then((data) => {
        const map = new Map<string, WordExtra>();
        for (const [word, row] of Object.entries(data.words ?? {})) {
          map.set(word, {
            synos: (row.s ?? []).map(([pos, cn, words]) => ({
              pos: pos ?? '',
              cn: cn ?? '',
              words: words ?? '',
            })),
            etymology: (row.e ?? []).map(([title, text]) => ({
              title: title ?? '',
              text: text ?? '',
            })),
          });
        }
        return map;
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

export function lookupWordExtra(map: Map<string, WordExtra> | null, word: string): WordExtra | null {
  if (!map) return null;
  return map.get(word.trim().toLowerCase()) ?? null;
}
