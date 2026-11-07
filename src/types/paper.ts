export type ReadStatus = 'unread' | 'reading' | 'completed' | 'archived';

export interface PaperItem {
  id: string;
  path: string;
  name: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
  arxivId?: string;
  pageCount: number;
  fileSize: number;
  readStatus: ReadStatus;
  lastReadAt: number;
  lastPage: number;
  lastZoom: number;
  lastViewMode: 'continuous' | 'single';
  tags: string[];
  sha256?: string;
  sourcePath?: string;
  importedAt?: number;
  lastRotation?: number;
  lastPositionUnit?: 'page' | 'paragraph';
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AnnotationType = 'highlight' | 'note' | 'ai_qa' | 'area';
export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'purple' | 'red';

export interface AnnotationEvidence {
  pageNo: number;
  quote: string;
  rect?: PdfRect;
  kind?: 'text' | 'area';
}

export interface SelectionSegment {
  pageNo: number;
  rects: PdfRect[];
  selectedText: string;
}

export interface PaperSelection {
  text: string;
  pageNo: number;
  rects: PdfRect[];
  screenshot?: string;
  segments?: SelectionSegment[];
}

export interface AnnotationItem {
  id: string;
  paperId: string;
  type: AnnotationType;
  color: AnnotationColor;
  pageNo: number;
  rects: PdfRect[];
  selectedText: string;
  noteText: string;
  question?: string;
  answer?: string;
  evidence?: AnnotationEvidence[];
  screenshotDataUrl?: string;
  createdAt: number;
  updatedAt: number;
  segments?: SelectionSegment[];
  model?: string;
  qaState?: 'verified' | 'draft' | 'legacy';
  answerEdited?: boolean;
  locationUnit?: 'page' | 'paragraph';
  orphaned?: boolean;
}

export type OverviewSectionKey =
  | 'researchQuestion'
  | 'method'
  | 'experimentalDesign'
  | 'keyFindings'
  | 'limitations'
  | 'takeaways';

export interface OverviewSection {
  key: OverviewSectionKey;
  label: string;
  content: string;
  category: 'author_claim' | 'model_synthesis' | 'model_critique';
  evidence: AnnotationEvidence[];
  claims?: Array<{ content: string; category: OverviewSection['category']; evidence: AnnotationEvidence[] }>;
}

export interface OverviewRecord {
  paperId: string;
  title: string;
  sections: OverviewSection[];
  model: string;
  createdAt: number;
  rejectedCount?: number;
}

export interface CitationMention {
  pageNo: number;
  marker: string;
  numbers: number[];
  startOffset: number;
  endOffset: number;
}

export interface ReferenceEntry {
  number: number;
  rawText: string;
  firstAuthor?: string;
  title?: string;
  year?: number;
  doi?: string;
  url?: string;
  sourcePage: number;
}

export interface CitationMatch {
  mention: CitationMention;
  candidates: Array<{ entry: ReferenceEntry; confidence: 'high' | 'low' }>;
  unmatchedNumbers: number[];
}

export interface PaperDraftEdit {
  paperId: string;
  title: string;
  abstract: string;
  content: string;
  references: ReferenceEntry[];
  lastModified: number;
}

export interface AiProviderConfig {
  provider: 'openai' | 'deepseek' | 'qwen' | 'siliconflow' | 'custom';
  apiKey: string;
  endpoint: string;
  model: string;
  temperature: number;
  keyPersistence?: 'system' | 'session' | 'none';
}

export interface OutlineItem {
  title: string;
  pageNo: number | null;
  level: number;
  children?: OutlineItem[];
}
