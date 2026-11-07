import type { CitationMatch, CitationMention, ReferenceEntry, PaperItem } from '../types/paper';
export type PageTextItem = { pageNo: number; text: string };
type PageText = PageTextItem;
const REFERENCES_HEADING = /^\s*(?:references|bibliography|参考文献|引用文献)\s*[:：]?\s*$/imu;
const REFERENCES_END_HEADING = /^(?:(?:online\s+)?(?:appendix|appendices)(?:\s+[A-Z0-9])?(?:\s*[:：.]\s*.+)?|(?:supplementary|supplemental)\s+(?:materials?(?:\s+and\s+methods?)?|information|appendix|appendices|methods?|results?|figures?|tables?|data|notes?)(?:\s*[:：]\s*.+)?|supporting\s+information(?:\s*[:：]\s*.+)?|附录(?:\s*[A-Z0-9一二三四五六七八九十])?(?:\s*[:：.]\s*.+)?|补充(?:材料|信息)(?:\s*[:：]\s*.+)?)$/iu;
const NUMBERED_ENTRY = /^\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s+(.+)$/u;
const DOI = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/iu;
const ARXIV_IN_REFERENCE = /\barxiv\s*:\s*((?:[a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?)(?![\p{L}\d/-]|\.\d)/iu;
const HTTPS_URL = /https:\/\/[^\s<>"']+/iu;
const APPROVED_ACADEMIC_HOSTS = new Set([
  'scholar.google.com', 'doi.org', 'arxiv.org', 'www.semanticscholar.org',
  'dl.acm.org', 'ieeexplore.ieee.org', 'link.springer.com',
  'www.sciencedirect.com', 'www.nature.com', 'www.science.org',
  'onlinelibrary.wiley.com', 'www.tandfonline.com', 'www.jstor.org',
  'pubmed.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov', 'www.biorxiv.org',
  'www.medrxiv.org', 'doaj.org', 'openreview.net', 'aclanthology.org',
  'proceedings.mlr.press', 'openaccess.thecvf.com', 'www.usenix.org',
  'academic.oup.com', 'journals.plos.org', 'www.frontiersin.org', 'www.mdpi.com',
]);
const DOI_HOSTS = new Set(['doi.org', 'dx.doi.org']);
const ARXIV_IDENTIFIER = /^(?:abs\/)?((?:[a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?)$/iu;

/** Extracts only explicitly numbered entries after a references heading. */
export function extractNumberedReferences(pages: PageText[]): ReferenceEntry[] {
  const entries: ReferenceEntry[] = [];
  let inReferences = false;
  let current: { number: number; rawText: string; sourcePage: number } | null = null;

  const flush = () => {
    if (!current) return;
    entries.push(enrichEntry(current));
    current = null;
  };

  for (const page of pages) {
    for (const rawLine of page.text.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!inReferences) {
        if (REFERENCES_HEADING.test(line)) inReferences = true;
        continue;
      }
      if (!line) continue;
      // A standalone later-section heading ends the bibliography, even when
      // its numbered list appears on the same page as the last reference.
      if (line.length <= 160 && REFERENCES_END_HEADING.test(line)) {
        flush();
        return entries;
      }
      const match = NUMBERED_ENTRY.exec(line);
      if (match) {
        flush();
        current = { number: Number(match[1] ?? match[2]), rawText: match[3], sourcePage: page.pageNo };
      } else if (current && !looksLikeSectionHeading(line)) {
        current.rawText = `${current.rawText} ${line}`;
      }
    }
  }
  flush();
  return entries;
}

export function findNumericCitationMentions(page: PageText): CitationMention[] {
  const mentions: CitationMention[] = [];
  const pattern = /\[(\d{1,4}(?:\s*(?:,|–|-)\s*\d{1,4})*)\]/gu;
  for (const match of page.text.matchAll(pattern)) {
    const numbers = expandNumberList(match[1]);
    if (!numbers.length) continue;
    mentions.push({
      pageNo: page.pageNo,
      marker: match[0],
      numbers,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }
  return mentions;
}

/** Exact numbering is high confidence only when the reference number is unique. */
export function matchNumericCitation(mention: CitationMention, entries: ReferenceEntry[]): CitationMatch {
  const candidates: CitationMatch['candidates'] = [];
  const unmatchedNumbers: number[] = [];
  for (const number of mention.numbers) {
    const matches = entries.filter((entry) => entry.number === number);
    if (matches.length === 1) candidates.push({ entry: matches[0], confidence: 'high' });
    else if (matches.length > 1) candidates.push(...matches.map((entry) => ({ entry, confidence: 'low' as const })));
    else unmatchedNumbers.push(number);
  }
  return { mention, candidates, unmatchedNumbers };
}

export function buildEditableSearchQuery(entry: ReferenceEntry): string {
  return [entry.title, entry.firstAuthor, entry.year?.toString()]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim() || entry.rawText.slice(0, 240).trim();
}

export function buildSearchUrl(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('搜索词为空。');
  const url = new URL('https://scholar.google.com/scholar');
  url.searchParams.set('q', trimmed.slice(0, 500));
  return url.toString();
}

export function buildDoiUrl(doi: string): string {
  const normalized = doi.trim();
  if (!/^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/iu.test(normalized)) throw new Error('DOI 无效。');
  return `https://doi.org/${normalized}`;
}

export function isApprovedAcademicUrl(value: string): boolean {
  try { normalizeAcademicExternalUrl(value); return true; }
  catch { return false; }
}

/** Converts trusted academic link forms to a canonical HTTPS destination. */
export function normalizeAcademicExternalUrl(value: string): string {
  const raw = value.trim();
  if (!raw || raw.length > 2_048) throw new Error('链接无效。');
  if (/^doi:/iu.test(raw)) return buildDoiUrl(raw.slice(4));
  if (/^arxiv:/iu.test(raw)) return buildArxivUrl(raw.slice(6));
  if (DOI.test(raw) && !/^[a-z][a-z0-9+.-]*:/iu.test(raw)) return buildDoiUrl(raw);
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('链接无效。');
  const host = url.hostname.toLowerCase();
  if (DOI_HOSTS.has(host)) {
    const doi = decodeURIComponent(url.pathname.replace(/^\//u, ''));
    return buildDoiUrl(doi);
  }
  if (!APPROVED_ACADEMIC_HOSTS.has(host)) throw new Error('链接不受支持。');
  url.protocol = 'https:';
  return url.toString();
}

function buildArxivUrl(value: string): string {
  const match = ARXIV_IDENTIFIER.exec(value.trim());
  if (!match) throw new Error('arXiv 编号无效。');
  return `https://arxiv.org/abs/${match[1]}`;
}

function enrichEntry(base: { number: number; rawText: string; sourcePage: number }): ReferenceEntry {
  const rawText = base.rawText.replace(/\s+/gu, ' ').trim();
  const yearMatch = /(?:\(|\b)((?:18|19|20)\d{2})[a-z]?(?:\)|\b)/iu.exec(rawText);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  const firstAuthor = inferFirstAuthor(rawText);
  const title = inferTitle(rawText, yearMatch);
  const doi = DOI.exec(rawText)?.[0]?.replace(/[.,;:)]+$/u, '');
  const rawUrl = HTTPS_URL.exec(rawText)?.[0]?.replace(/[.,;:)]+$/u, '');
  const arxivId = ARXIV_IN_REFERENCE.exec(rawText)?.[1];
  const url = (rawUrl ? normalizeOrUndefined(rawUrl) : undefined) ?? (arxivId ? buildArxivUrl(arxivId) : undefined);
  return { ...base, rawText, firstAuthor, title, year, doi, url };
}

function inferFirstAuthor(rawText: string): string | undefined {
  // References often use given-name initials before the surname (for example
  // "J. Doe and R. Patel."). Splitting at the first period would leave only
  // the initial and make search queries materially less useful.
  const initialSurname = /^(?<author>(?:\p{L}\.\s+)+\p{L}[\p{L}'-]{1,})(?=\s+(?:and\b|&)|[,.;])/u.exec(rawText)?.groups?.author;
  if (initialSurname) return initialSurname.trim();
  return rawText.split(/[,.;]/u, 1)[0]?.trim() || undefined;
}

function normalizeOrUndefined(value: string): string | undefined {
  try { return normalizeAcademicExternalUrl(value); }
  catch { return undefined; }
}

function inferTitle(rawText: string, yearMatch: RegExpExecArray | null): string | undefined {
  if (!yearMatch) return undefined;
  const beforeYear = rawText.slice(0, yearMatch.index);
  const authorThenTitle = /^.*?\b[\p{L}][\p{L}'-]{1,}\.\s+(.+?)(?:\.\s+|$)/u.exec(beforeYear)?.[1]?.trim();
  if (authorThenTitle && authorThenTitle.length >= 4 && !/^(?:doi:|https?:)/iu.test(authorThenTitle)) return authorThenTitle;
  const afterYear = rawText.slice(yearMatch.index + yearMatch[0].length).replace(/^\s*[.)]\s*/u, '').trim();
  const sentence = afterYear.split(/\.\s+(?=[A-Z\p{Script=Han}])/u, 1)[0]?.trim();
  return sentence && sentence.length >= 4 && !/^(?:doi:|https?:)/iu.test(sentence) ? sentence : undefined;
}

function expandNumberList(value: string): number[] {
  const result = new Set<number>();
  for (const segment of value.split(/\s*,\s*/u)) {
    const range = /^(\d{1,4})\s*[–-]\s*(\d{1,4})$/u.exec(segment);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > 0 && end >= start && end - start <= 100) {
        for (let number = start; number <= end; number += 1) result.add(number);
      }
      continue;
    }
    const number = Number(segment);
    if (Number.isSafeInteger(number) && number > 0) result.add(number);
  }
  return [...result];
}

function looksLikeSectionHeading(line: string): boolean {
  return line.length < 80 && /^\d+(?:\.\d+)*\s+\p{Lu}/u.test(line);
}


export const matchCitationWithReferences = matchNumericCitation;
export const buildCitationSearchQuery = buildEditableSearchQuery;
export function findCitationMentionsInText(text: string, pageNo: number): CitationMention[] {
  return findNumericCitationMentions({ text, pageNo });
}
export function parseCitationNumbers(marker: string): number[] { return expandNumberList(marker.replace(/^\[|\]$/g, '')); }
export function matchReferenceToAsset(entry: ReferenceEntry, assets: PaperItem[]): PaperItem | undefined {
  const normalize = (value: string) => value.replace(/\.(pdf|docx|doc)$/iu, '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
  const title = entry.title && normalize(entry.title);
  const matches = assets.filter(asset => title && title.length >= 4 ? normalize(asset.title) === title
    : normalize(asset.title).length >= 8 && normalize(entry.rawText).includes(normalize(asset.title)));
  return matches.length === 1 ? matches[0] : undefined;
}
