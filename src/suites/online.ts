export type OnlineModule =
  | {
      id: string;
      name: string;
      kind: 'wechat';
      searchName: string;
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
  },
  {
    id: 'math-variation',
    name: '小学数学举一反三',
    kind: 'link',
    url: 'https://www.math314159.com',
  },
];
