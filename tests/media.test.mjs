import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function moduleUrl(path, dependencies = {}) {
  let source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [name, url] of Object.entries(dependencies)) {
    source = source.replaceAll(`from '${name}'`, `from '${url}'`);
  }
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

const tauriDummy = 'data:text/javascript;base64,' + Buffer.from(
  'export const invoke = () => { throw new Error("tauri mock not available"); }; export const isTauri = () => false;'
).toString('base64');

const lucideDummy = 'data:text/javascript;base64,' + Buffer.from(`
  const dummy = () => null;
  export const Layers = dummy;
  export const Minimize2 = dummy;
  export const Sparkles = dummy;
  export const Settings = dummy;
  export const ArrowLeftRight = dummy;
  export const BookOpen = dummy;
  export const Files = dummy;
  export const Library = dummy;
  export const FileEdit = dummy;
  export const BookMarked = dummy;
  export const Trash2 = dummy;
  export const FolderTree = dummy;
  export const MessageCircle = dummy;
  export const MessageSquare = dummy;
  export const Code2 = dummy;
  export const HardDrive = dummy;
  export const Cloud = dummy;
  export const Search = dummy;
  export const Bookmark = dummy;
  export const Keyboard = dummy;
  export const Timer = dummy;
  export const BarChart3 = dummy;
  export const Share2 = dummy;
  export const Send = dummy;
  export const Users = dummy;
  export const Clock = dummy;
  export const MessageSquareText = dummy;
  export const Wrench = dummy;
`).toString('base64');

const mediaTypesUrl = moduleUrl('../src/types/media.ts');
const suitesTypesUrl = moduleUrl('../src/suites/types.ts', {
  'lucide-react': lucideDummy,
});

const mediaApiUrl = moduleUrl('../src/services/mediaApi.ts', {
  '@tauri-apps/api/core': tauriDummy,
  '../types/media': mediaTypesUrl,
});

const registryUrl = moduleUrl('../src/suites/registry.ts', {
  'lucide-react': lucideDummy,
  './types': suitesTypesUrl,
});

const { PLATFORM_METAS } = await import(mediaTypesUrl);
const {
  mediaApi,
  extractTags,
  matchKeywordRule,
  PRESET_ACCOUNTS,
  PRESET_CANNED_REPLIES,
  PRESET_KEYWORD_RULES,
} = await import(mediaApiUrl);
const { MEDIA_SUITE, ALL_SUITES, resolveLaunchTarget } = await import(registryUrl);

test('Platform presets metadata covers all platforms with labels and constraints', () => {
  const expectedPlatforms = [
    'douyin',
    'xiaohongshu',
    'bilibili',
    'wechat_channel',
    'kuaishou',
    'zhihu',
    'wechat_mp',
    'toutiao',
    'baijiahao',
    'weibo',
    'custom',
  ];

  for (const plat of expectedPlatforms) {
    const meta = PLATFORM_METAS[plat];
    assert.ok(meta, `Metadata for ${plat} should exist`);
    assert.equal(meta.id, plat);
    assert.ok(meta.label.length > 0, `Platform ${plat} label should not be empty`);
    assert.ok(meta.icon.length > 0, `Platform ${plat} icon should not be empty`);
    assert.ok(Array.isArray(meta.allowedTypes) && meta.allowedTypes.length > 0);
    assert.ok(meta.maxTitleLen > 0, `Platform ${plat} maxTitleLen should be > 0`);
    assert.ok(meta.maxContentLen > 0, `Platform ${plat} maxContentLen should be > 0`);
    assert.ok(meta.maxImages > 0, `Platform ${plat} maxImages should be > 0`);
    assert.equal(typeof meta.tagPrefix, 'string');
    if (plat !== 'custom') {
      assert.ok(meta.defaultPublishUrl.startsWith('https://'), `${plat} defaultPublishUrl should be https`);
    }
  }
});

test('Suite registration exposes MEDIA_SUITE and integrates into ALL_SUITES', () => {
  assert.equal(MEDIA_SUITE.id, 'media');
  assert.equal(MEDIA_SUITE.name, '自媒体分发');
  assert.equal(MEDIA_SUITE.shortName, '分发');
  assert.equal(MEDIA_SUITE.defaultTab, 'media_publish');

  const subTabIds = MEDIA_SUITE.subItems.map((s) => s.id);
  assert.deepEqual(subTabIds, [
    'media_publish',
    'media_accounts',
    'media_tasks',
    'media_replies',
    'media_tools',
  ]);

  const found = ALL_SUITES.find((s) => s.id === 'media');
  assert.ok(found, 'ALL_SUITES must include MEDIA_SUITE');

  const resolved = resolveLaunchTarget('media_accounts');
  assert.equal(resolved.suiteId, 'media');
  assert.equal(resolved.tab, 'media_accounts');
});

test('MediaAccount CRUD operations and status updates', async () => {
  const initialAccounts = await mediaApi.getAccounts();
  assert.ok(initialAccounts.length >= 5, 'Should have initial preset accounts');
  assert.ok(initialAccounts.some((a) => a.platform === 'douyin'));
  assert.ok(initialAccounts.some((a) => a.platform === 'xiaohongshu'));
  assert.ok(initialAccounts.some((a) => a.platform === 'bilibili'));

  // 1. Create new account
  const newAccount = await mediaApi.saveAccount({
    id: 'acc_weibo_test',
    platform: 'weibo',
    name: '微博测试号',
    status: 'active',
    group: '测试分组',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  assert.equal(newAccount.id, 'acc_weibo_test');
  assert.equal(newAccount.name, '微博测试号');

  let list = await mediaApi.getAccounts();
  assert.ok(list.some((a) => a.id === 'acc_weibo_test'));

  // 2. Update existing account
  newAccount.name = '微博更新名';
  await mediaApi.saveAccount(newAccount);
  list = await mediaApi.getAccounts();
  const updatedItem = list.find((a) => a.id === 'acc_weibo_test');
  assert.equal(updatedItem?.name, '微博更新名');

  // 3. Check account status
  const checked = await mediaApi.checkAccountStatus('acc_weibo_test');
  assert.ok(checked.lastCheckedAt && checked.lastCheckedAt > 0);

  // 4. Batch check accounts
  const batchChecked = await mediaApi.batchCheckAccounts();
  assert.ok(batchChecked.every((a) => typeof a.lastCheckedAt === 'number'));

  // 5. Delete account
  await mediaApi.deleteAccount('acc_weibo_test');
  list = await mediaApi.getAccounts();
  assert.ok(!list.some((a) => a.id === 'acc_weibo_test'));

  // 6. Check non-existent account throws
  await assert.rejects(mediaApi.checkAccountStatus('acc_non_existent'), /Account not found/);
});

test('Task creation, validation, cancellation, and retry logic', async () => {
  const accounts = await mediaApi.getAccounts();
  const selectedAccountIds = [accounts[0].id, accounts[1].id];

  // 1. Validation: cannot create with empty accounts
  await assert.rejects(
    mediaApi.createPublishTask({
      accountIds: [],
      content: {
        type: 'post',
        title: '测试标题',
        content: '测试内容',
        tags: ['科技'],
      },
      mode: 'silent',
    }),
    /至少一个发布账号/
  );

  // 2. Creation
  const task = await mediaApi.createPublishTask({
    accountIds: selectedAccountIds,
    content: {
      type: 'post',
      title: '自动化分发测试标题',
      content: '这是一段用于测试的多平台同步正文',
      tags: ['生产力', '测试'],
    },
    mode: 'silent',
  });

  assert.ok(task.id.startsWith('task_'));
  assert.equal(task.status, 'pending');
  assert.equal(task.accounts.length, 2);
  assert.equal(task.accounts[0].stage, 'queued');
  assert.equal(task.accounts[0].status, 'pending');
  assert.equal(task.summary?.total, 2);
  assert.equal(task.summary?.failed, 0);
  assert.ok(task.logs.length > 0);

  // 3. Cancel task
  const cancelled = await mediaApi.cancelTask(task.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.accounts.every((a) => a.status === 'failed'));
  assert.equal(cancelled.summary?.failed, 2);
  assert.ok(cancelled.logs.some((l) => l.level === 'warn'));

  // 4. Retry task
  const retried = await mediaApi.retryTask(task.id);
  assert.equal(retried.status, 'pending');
  assert.ok(retried.accounts.every((a) => a.status === 'pending' && a.stage === 'queued'));
  assert.equal(retried.summary?.failed, 0);

  // 5. Clear completed/cancelled tasks
  await mediaApi.cancelTask(task.id);
  await mediaApi.clearCompletedTasks();
  const remaining = await mediaApi.getTasks();
  assert.ok(!remaining.some((t) => t.id === task.id));
});

test('Canned replies and keyword rule management and matching', async () => {
  const replies = await mediaApi.getCannedReplies();
  assert.ok(replies.length >= 5);

  const categories = new Set(replies.map((r) => r.category));
  assert.ok(categories.has('intro'));
  assert.ok(categories.has('outro'));
  assert.ok(categories.has('copyright'));
  assert.ok(categories.has('comment'));
  assert.ok(categories.has('general'));

  // Save reply
  const savedReply = await mediaApi.saveCannedReply({
    id: 'cr_test_custom',
    title: '自定义快捷回复',
    content: '这是自定义测试内容',
    category: 'comment',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  assert.equal(savedReply.id, 'cr_test_custom');

  let allReplies = await mediaApi.getCannedReplies();
  assert.ok(allReplies.some((r) => r.id === 'cr_test_custom'));

  await mediaApi.deleteCannedReply('cr_test_custom');
  allReplies = await mediaApi.getCannedReplies();
  assert.ok(!allReplies.some((r) => r.id === 'cr_test_custom'));

  // Keyword rules & matching
  const rules = await mediaApi.getKeywordRules();
  assert.ok(rules.length >= 2);

  // Test keyword matching: contains match
  const matchedRule1 = matchKeywordRule('你好，求资料和源码！', rules);
  assert.ok(matchedRule1);
  assert.equal(matchedRule1.name, '资料与源码咨询');

  // Test non-matching
  const unmatched = matchKeywordRule('今天天气真好', rules);
  assert.equal(unmatched, null);

  // Test exact match
  const exactRule = {
    id: 'kr_exact',
    name: '精准匹配',
    keywords: ['退订'],
    matchType: 'exact',
    replyContent: '已为您退订',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  assert.ok(matchKeywordRule('退订', [exactRule]));
  assert.equal(matchKeywordRule('我要退订请帮我', [exactRule]), null);

  // Test regex match
  const regexRule = {
    id: 'kr_regex',
    name: '正则匹配电话',
    keywords: ['1[3-9]\\d{9}'],
    matchType: 'regex',
    replyContent: '已记录您的电话',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  assert.ok(matchKeywordRule('联系方式 13812345678', [regexRule]));

  // Test disabled rule
  const disabledRule = { ...exactRule, enabled: false };
  assert.equal(matchKeywordRule('退订', [disabledRule]), null);
});

test('Tag extraction, video inspection, and AI copy polisher fallback', async () => {
  // 1. Tag extraction
  const sampleText = '今天分享一款超级好用的 #生产力工具# ，专为 #自媒体# 创作者设计的黑科技！';
  const tags = extractTags(sampleText);
  assert.ok(tags.includes('生产力工具'));
  assert.ok(tags.includes('自媒体'));
  assert.ok(tags.includes('工具'));

  // 2. Video inspection
  const verticalVideo = await mediaApi.inspectVideo('/path/to/my_vertical_reel.mp4');
  assert.equal(verticalVideo.aspectRatio, '9:16');
  assert.equal(verticalVideo.width, 1080);
  assert.equal(verticalVideo.height, 1920);
  assert.ok(verticalVideo.suggestedPlatforms.includes('douyin'));
  assert.ok(verticalVideo.suggestedPlatforms.includes('xiaohongshu'));

  const horizontalVideo = await mediaApi.inspectVideo('/path/to/landscape_intro.mov');
  assert.equal(horizontalVideo.aspectRatio, '16:9');
  assert.equal(horizontalVideo.width, 1920);
  assert.equal(horizontalVideo.height, 1080);
  assert.ok(horizontalVideo.suggestedPlatforms.includes('bilibili'));

  // 3. AI Polish Copy fallback
  const inputCopy = `#超好用的效率神器
每天省下2小时的高效办公工具合集，新手也能轻松搞定自媒体多平台分发。
1. 一键账号授权
2. 批量图文视频同步
3. 智能文案润色与合规检查`;

  // Xiaohongshu polish
  const xhsResult = await mediaApi.aiPolishCopy(inputCopy, 'xiaohongshu');
  assert.ok(xhsResult.polishedTitle.startsWith('✨'));
  assert.ok(xhsResult.polishedTitle.length <= 20);
  assert.ok(xhsResult.suggestedTags.length >= 3);
  assert.ok(xhsResult.platformTips && xhsResult.platformTips.length > 0);
  assert.ok(xhsResult.platformTips.some((tip) => tip.includes('高质感图片') || tip.includes('首图')));

  // Douyin polish
  const dyResult = await mediaApi.aiPolishCopy(inputCopy, 'douyin');
  assert.ok(dyResult.polishedTitle.startsWith('🔥'));
  assert.ok(dyResult.polishedTitle.length <= 30);
  assert.ok(dyResult.platformTips.some((tip) => tip.includes('3 秒')));

  // Bilibili polish
  const biliResult = await mediaApi.aiPolishCopy(inputCopy, 'bilibili');
  assert.ok(biliResult.polishedTitle.startsWith('【干货】'));
  assert.ok(biliResult.platformTips.some((tip) => tip.includes('16:9')));
});

test('Media UI suite files and component integrations exist and compile cleanly', () => {
  const componentFiles = [
    'src/components/media/MediaView.tsx',
    'src/components/media/MediaPublisher.tsx',
    'src/components/media/MediaAccounts.tsx',
    'src/components/media/MediaTaskCenter.tsx',
    'src/components/media/MediaRepliesHub.tsx',
    'src/components/media/MediaTools.tsx',
    'src/components/media/PlatformIcon.tsx',
  ];

  for (const relPath of componentFiles) {
    const fullPath = new URL(`../${relPath}`, import.meta.url);
    assert.ok(fs.existsSync(fullPath), `File ${relPath} should exist`);
    const source = fs.readFileSync(fullPath, 'utf8');
    assert.ok(source.length > 0, `File ${relPath} should not be empty`);

    // Verify TS transpilation succeeds
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    assert.ok(transpiled.outputText.length > 0, `Transpiled output for ${relPath} should not be empty`);
  }

  // Verify App.tsx and HomeView.tsx contain media suite references
  const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(appSource.includes("import('./components/media/MediaView')"));
  assert.ok(appSource.includes("isOpen('media')"));

  const homeSource = fs.readFileSync(new URL('../src/components/home/HomeView.tsx', import.meta.url), 'utf8');
  assert.ok(homeSource.includes("suite.id === 'media'"));
  assert.ok(homeSource.includes('多平台短视频与图文一键分发、账号矩阵与互动管理'));

  const sidebarSource = fs.readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
  assert.ok(sidebarSource.includes("enabledSuites[0].id === 'media'"));
});
