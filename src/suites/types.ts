import { LucideIcon } from 'lucide-react';

export type SuiteId = 'docs' | 'paper' | 'cleaner' | 'netdisk' | 'typing' | 'media' | string;

export type DocSubTab = 'merge' | 'convert' | 'compress' | 'watermark' | 'system';
export type PaperSubTab = 'paper' | 'paper_library' | 'paper_reader' | 'paper_editor';
export type CleanerSubTab =
  | 'cleaner_usage'
  | 'cleaner'
  | 'cleaner_wechat'
  | 'cleaner_qq'
  | 'cleaner_developer'
  | 'cleaner_system';
export type NetdiskSubTab = 'netdisk' | 'netdisk_saved' | 'netdisk_sources';
export type TypingSubTab = 'typing' | 'typing_lesson' | 'typing_words' | 'typing_read' | 'typing_stats';
export type MediaSubTab =
  | 'media_publish'
  | 'media_accounts'
  | 'media_tasks'
  | 'media_replies'
  | 'media_tools';

export type ActiveTabId =
  | DocSubTab
  | PaperSubTab
  | CleanerSubTab
  | NetdiskSubTab
  | TypingSubTab
  | MediaSubTab
  | string;

export interface SuiteSubItem {
  id: string;
  label: string;
  sublabel: string;
  icon: LucideIcon;
  color: string;
  activeBg: string;
}

export interface SuiteConfig {
  id: SuiteId;
  name: string;
  shortName: string;
  icon: LucideIcon;
  defaultTab: ActiveTabId;
  subItems?: SuiteSubItem[];
  badge?: string;
}
