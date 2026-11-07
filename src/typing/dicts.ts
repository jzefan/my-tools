// Word lists are compacted from KyleBing/english-vocabulary (BSD-3-Clause). See public/dicts/LICENSE.txt.

export interface DictBook {
  id: string;
  name: string;
  group: string;
  file: string;
  count: number;
  base: number;
  version: string;
}

export const DICT_BOOKS: DictBook[] = [
  { id: 'cet4', name: 'CET-4', group: '大学英语', file: '/dicts/cet4.json', count: 4544, base: 1_000_000, version: '2' },
  { id: 'cet6', name: 'CET-6', group: '大学英语', file: '/dicts/cet6.json', count: 3991, base: 1_200_000, version: '2' },
  { id: 'tem4', name: '专四', group: '大学英语', file: '/dicts/tem4.json', count: 4340, base: 1_400_000, version: '2' },
  { id: 'tem8', name: '专八', group: '大学英语', file: '/dicts/tem8.json', count: 12410, base: 1_600_000, version: '2' },
  { id: 'ky', name: '考研', group: '考研', file: '/dicts/ky.json', count: 5046, base: 2_000_000, version: '2' },
  { id: 'junior-core', name: '初中', group: '中学', file: '/dicts/junior-core.json', count: 1987, base: 2_200_000, version: '2' },
  { id: 'senior', name: '高中', group: '中学', file: '/dicts/senior.json', count: 3743, base: 2_400_000, version: '2' },
  { id: 'pep3', name: '三年级', group: '小学', file: '/dicts/pep3.json', count: 134, base: 3_000_000, version: '2' },
  { id: 'pep4', name: '四年级', group: '小学', file: '/dicts/pep4.json', count: 186, base: 3_200_000, version: '2' },
  { id: 'pep5', name: '五年级', group: '小学', file: '/dicts/pep5.json', count: 283, base: 3_400_000, version: '2' },
  { id: 'pep6', name: '六年级', group: '小学', file: '/dicts/pep6.json', count: 233, base: 3_600_000, version: '2' },
];

export const DICT_GROUPS = ['大学英语', '考研', '中学'] as const;

export function dictById(id: string): DictBook | undefined {
  return DICT_BOOKS.find((book) => book.id === id);
}

export function dictsInGroup(group: string): DictBook[] {
  return DICT_BOOKS.filter((book) => book.group === group);
}

export function catalogSize(builtin: { primary?: number; junior?: number; sentence?: number }): number {
  const seeds = (builtin.primary ?? 0) + (builtin.junior ?? 0) + (builtin.sentence ?? 0);
  return seeds + DICT_BOOKS.reduce((sum, book) => sum + book.count, 0);
}
