export type OnlineModule =
  | {
      id: string;
      name: string;
      kind: 'wechat';
      searchName: string;
      qrSrc?: string;
    }
  | {
      id: string;
      name: string;
      kind: 'link';
      url: string;
    };

export const ONLINE_MODULES: OnlineModule[] = [
  {
    id: 'page-scan',
    name: '纸页快扫',
    kind: 'wechat',
    searchName: '纸页快扫',
    qrSrc: '/online/page-scan-qr.jpg',
  },
  {
    id: 'math-variation',
    name: '小学数学举一反三',
    kind: 'link',
    url: 'https://www.math314159.com',
  },
];
