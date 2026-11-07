export type SourceKind = 'pansou' | 'pansearch' | 'qupansou' | 'melost' | 'qkpanso';
export interface NetdiskSource {
  id: string;
  name: string;
  kind: SourceKind;
  baseUrl: string;
  enabled: boolean;
}
export interface NetdiskItem {
  id: string;
  drive: string;
  url: string;
  title: string;
  description: string;
  password: string;
  datetime: string;
  sources: string[];
}
export interface SourceProgress {
  id: string;
  name: string;
  state: 'pending' | 'success' | 'error';
  count: number;
  cached?: boolean;
  error?: string;
}
export const DEFAULT_NETDISK_SOURCES: NetdiskSource[] = [
  { id: 'melost', name: 'Melost', kind: 'melost', baseUrl: 'https://www.melost.cn', enabled: true },
  { id: 'qkpanso', name: 'QKPAN', kind: 'qkpanso', baseUrl: 'https://qkpanso.com', enabled: true },
  { id: 'pansou', name: 'PanSou', kind: 'pansou', baseUrl: 'https://so.252035.xyz', enabled: false },
  { id: 'pansearch', name: '盘搜', kind: 'pansearch', baseUrl: 'https://www.pansearch.me', enabled: false },
  { id: 'qupansou', name: '趣盘搜', kind: 'qupansou', baseUrl: 'https://v.funletu.com', enabled: false },
];
export const NETDISK_DRIVES: Record<string, string> = {
  baidu: '百度网盘', aliyun: '阿里云盘', quark: '夸克网盘', '123': '123 云盘',
  '115': '115 网盘', xunlei: '迅雷云盘', tianyi: '天翼云盘', uc: 'UC 网盘',
  mobile: '移动云盘', lanzou: '蓝奏云', pikpak: 'PikPak', guangya: '光鸭云盘',
};
export const NETDISK_DRIVE_ORDER = ['baidu', 'aliyun', 'quark', '123', '115', 'xunlei', 'tianyi', 'uc', 'mobile', 'lanzou', 'pikpak', 'guangya'];
