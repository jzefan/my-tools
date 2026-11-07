import { dictById } from './dicts';
import type { ArticleRow, BookId, PracticeItem, PracticeRun, WordMode, WordRow } from './types';

export function wordRun(
  words: WordRow[],
  mode: WordMode,
  title: string,
  source: PracticeRun['source'],
): PracticeRun {
  const conceal = mode !== 'follow';
  return {
    title,
    allowBackspace: true,
    assist: mode === 'follow',
    speakOnShow: mode === 'dictation',
    showExample: mode === 'follow',
    mono: false,
    passAccuracy: null,
    timedMs: null,
    items: words.map((word) => wordItem(word, conceal, mode)),
    source,
  };
}

export function articleRun(article: ArticleRow, conceal: boolean): PracticeRun {
  const items: PracticeItem[] = article.sentences.map((sentence, index) => ({
    id: `article-${article.id}-${index}`,
    prompt: sentence.en,
    meaning: sentence.zh,
    speak: sentence.en,
    conceal,
  }));
  return {
    title: article.book && article.book !== '入门' ? `${article.book} · ${article.title}` : article.title,
    allowBackspace: true,
    assist: !conceal,
    speakOnShow: conceal,
    showExample: false,
    mono: false,
    passAccuracy: null,
    timedMs: null,
    items,
    source: { type: 'article', articleId: article.id },
  };
}

function wordItem(word: WordRow, conceal: boolean, mode: WordMode): PracticeItem {
  return {
    id: `word-${word.id}-${mode}`,
    prompt: word.word,
    meaning: word.translation,
    phonetic: word.phonetic,
    example: word.example,
    exampleZh: word.exampleZh,
    examples: word.examples.length > 0 ? word.examples : word.example ? [{ en: word.example, zh: word.exampleZh }] : [],
    phrases: word.phrases,
    speak: word.word,
    wordId: word.id,
    conceal,
  };
}

export function bookLabel(book: BookId): string {
  if (book === 'primary') return '常用';
  if (book === 'junior') return '初中起步';
  if (book === 'sentence') return '句子';
  return dictById(book)?.name ?? book;
}
