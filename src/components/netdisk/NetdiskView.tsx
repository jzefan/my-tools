import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, ChevronLeft, ChevronRight, Cloud, Copy, ExternalLink, History, Loader2, Search, Settings2, Square, Trash2, X } from 'lucide-react';
import { DEFAULT_NETDISK_SOURCES, NETDISK_DRIVES, NETDISK_DRIVE_ORDER } from '../../types/netdisk';
import type { NetdiskItem, NetdiskSource, SourceProgress } from '../../types/netdisk';
import { fetchNetdiskSource, openNetdiskItem } from '../../services/netdiskApi';
import { rankNetdiskItems, shareText, validateSourceUrl } from '../../utils/netdisk';
import { searchNetdisk } from '../../utils/netdiskSearch';
import { loadNetdiskHistory, loadNetdiskSaved, loadNetdiskSources, saveNetdiskState } from '../../utils/netdiskStorage';
import './netdisk.css';

const PAGE_SIZE = 40;
export function NetdiskView({ activeSubTab = 'netdisk', onSubTabChange }: { activeSubTab?: string; onSubTabChange: (tab: string) => void }) {
  const [sources, setSources] = useState(loadNetdiskSources);
  const [saved, setSaved] = useState(loadNetdiskSaved);
  const [history, setHistory] = useState(loadNetdiskHistory);
  const [query, setQuery] = useState('');
  const [savedQuery, setSavedQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [items, setItems] = useState<NetdiskItem[]>([]);
  const [progress, setProgress] = useState<SourceProgress[]>([]);
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [drive, setDrive] = useState('all');
  const [newest, setNewest] = useState(false);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState('');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isSaved = activeSubTab === 'netdisk_saved';
  const isSettings = activeSubTab === 'netdisk_sources';

  useEffect(() => () => { controller.current?.abort(); clearTimeout(feedbackTimer.current); }, []);
  useEffect(() => { setDrive('all'); setPage(0); }, [activeSubTab]);
  const notify = (text: string) => { setMessage(text); };
  const persist = (key: 'saved' | 'history' | 'sources', value: unknown) => {
    try { saveNetdiskState(key, value); return true; } catch (error) { notify(String(error instanceof Error ? error.message : error)); return false; }
  };
  const changeSources = (next: NetdiskSource[]) => {
    controller.current?.abort(); setBusy(false); if (busy) setStopped(true);
    if (persist('sources', next)) setSources(next);
  };
  const run = async (value = query, refresh = false) => {
    const keyword = value.trim();
    if (!keyword) { input.current?.focus(); return; }
    if ([...keyword].length > 120) { notify('关键词最多 120 个字'); return; }
    if (!sources.some(s => s.enabled)) { notify('请先启用搜索源'); onSubTabChange('netdisk_sources'); return; }
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setQuery(keyword); setSearched(keyword); setItems([]); setProgress([]); setBusy(true); setStopped(false); setMessage(''); setDrive('all'); setPage(0);
    onSubTabChange('netdisk');
    const nextHistory = [keyword, ...history.filter(q => q !== keyword)].slice(0, 20);
    if (persist('history', nextHistory)) setHistory(nextHistory);
    try {
      await searchNetdisk(sources, keyword, current.signal, refresh,
        (source, kw, signal, force, partial) => fetchNetdiskSource(source, kw, signal, force, tokens[source.id] || '', partial),
        (next, status) => { if (controller.current === current && !current.signal.aborted) { setItems(next); setProgress(status); } });
    } catch (error) { if (!current.signal.aborted) notify(String(error instanceof Error ? error.message : error)); }
    finally { if (controller.current === current) setBusy(false); }
  };
  const stop = () => { controller.current?.abort(); setBusy(false); setStopped(true); };
  const toggleSaved = (item: NetdiskItem) => {
    const exists = saved.some(s => s.id === item.id);
    if (!exists && saved.length >= 200) { notify('收藏已达 200 条，请先移除部分收藏'); return; }
    const next = exists ? saved.filter(s => s.id !== item.id) : [item, ...saved];
    if (persist('saved', next)) setSaved(next);
  };
  const copy = async (item: NetdiskItem, codeOnly = false) => {
    try {
      await navigator.clipboard.writeText(codeOnly ? item.password : shareText(item));
      setCopied(`${item.id}${codeOnly ? ':code' : ''}`);
      clearTimeout(feedbackTimer.current); feedbackTimer.current = setTimeout(() => setCopied(''), 1800);
    } catch { notify('复制失败，请选中链接手动复制'); }
  };
  const addSource = (event: React.FormEvent) => {
    event.preventDefault(); setMessage('');
    try {
      const baseUrl = validateSourceUrl(endpoint);
      if (!name.trim()) throw new Error('请输入搜索源名称');
      if (sources.length >= 12) throw new Error('最多添加 12 个搜索源');
      if (sources.some(s => validateSourceUrl(s.baseUrl) === baseUrl)) throw new Error('该服务地址已添加');
      const next = [...sources, { id: crypto.randomUUID(), name: name.trim().slice(0, 30), kind: 'pansou' as const, baseUrl, enabled: true }];
      if (persist('sources', next)) { controller.current?.abort(); setBusy(false); if (busy) setStopped(true); setSources(next); setName(''); setEndpoint(''); }
    } catch (error) { notify(String(error instanceof Error ? error.message : error)); }
  };
  const baseItems = isSaved ? saved : items;
  const filtered = useMemo(() => rankNetdiskItems(baseItems.filter(item => (drive === 'all' || item.drive === drive) && (!isSaved || `${item.title} ${item.description}`.toLowerCase().includes(savedQuery.toLowerCase().trim()))), isSaved ? savedQuery : searched, newest), [baseItems, drive, isSaved, savedQuery, searched, newest]);
  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, maxPage);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const counts = useMemo(() => baseItems.reduce<Record<string, number>>((out, item) => { out[item.drive] = (out[item.drive] || 0) + 1; return out; }, {}), [baseItems]);
  const savedIds = useMemo(() => new Set(saved.map(item => item.id)), [saved]);
  const successes = progress.filter(p => p.state === 'success').length;
  const failures = progress.filter(p => p.state === 'error');

  return <section className="netdisk-view">
    <header className="netdisk-header titlebar-drag">
      <Cloud size={20} aria-hidden="true" />
      <h1>{isSettings ? '搜索源' : isSaved ? '我的收藏' : '网盘搜索'}</h1>
      <div className="netdisk-header-actions titlebar-nodrag">
        {!isSettings && <button className="nd-icon" aria-label="搜索源设置" title="搜索源设置" onClick={() => { setMessage(''); onSubTabChange('netdisk_sources'); }}><Settings2 size={16} /></button>}
      </div>
    </header>
    {message && <div className="nd-message" role="alert"><span>{message}</span><button className="nd-icon" aria-label="关闭提示" onClick={() => setMessage('')}><X size={14} /></button></div>}
    {isSettings ? <div className="nd-settings">
      <div className="nd-section-heading"><h2>已添加 {sources.length}</h2><button className="nd-text-button" onClick={() => { changeSources(DEFAULT_NETDISK_SOURCES.map(s => ({ ...s }))); setTokens({}); }}>恢复默认</button></div>
      <div className="nd-source-list">
        {sources.map(source => <div className="nd-source-row" key={source.id}>
          <label className="nd-source-label"><input type="checkbox" checked={source.enabled} onChange={() => changeSources(sources.map(s => s.id === source.id ? { ...s, enabled: !s.enabled } : s))} /><span><strong>{source.name}</strong><small>{source.baseUrl}</small></span></label>
          {source.kind === 'pansou' && <input className="nd-token" type="password" aria-label={`${source.name} 访问令牌`} placeholder="访问令牌（可选，仅本次）" autoComplete="off" value={tokens[source.id] || ''} onChange={e => setTokens({ ...tokens, [source.id]: e.target.value })} />}
          <button className="nd-icon" aria-label={`移除 ${source.name}`} title="移除搜索源" onClick={() => changeSources(sources.filter(s => s.id !== source.id))}><Trash2 size={15} /></button>
        </div>)}
      </div>
      <form className="nd-add-source" onSubmit={addSource}>
        <h2>添加 PanSou 服务</h2>
        <label>名称<input value={name} maxLength={30} required placeholder="自建搜索服务" onChange={e => setName(e.target.value)} /></label>
        <label>服务地址<input type="url" value={endpoint} required placeholder="http://localhost:8888" onChange={e => setEndpoint(e.target.value)} /></label>
        <button className="nd-button nd-primary" type="submit">添加</button>
      </form>
    </div> : <>
      <div className="nd-search-area">
        <form className="nd-search-form" onSubmit={e => { e.preventDefault(); if (!isSaved) void run(); }}>
          <Search size={17} aria-hidden="true" />
          <input ref={input} aria-label={isSaved ? '筛选收藏' : '搜索网盘资源'} value={isSaved ? savedQuery : query} maxLength={120} placeholder={isSaved ? '筛选收藏…' : '搜索书籍、课程、影视、软件…'} onChange={e => { if (isSaved) { setSavedQuery(e.target.value); setPage(0); } else setQuery(e.target.value); }} />
          {(isSaved ? savedQuery : query) && <button className="nd-icon" type="button" aria-label="清空关键词" onClick={() => { if (isSaved) setSavedQuery(''); else setQuery(''); input.current?.focus(); }}><X size={14} /></button>}
          {!isSaved && <button className="nd-button nd-primary" type="submit" disabled={!query.trim()}>搜索</button>}
        </form>
        {!isSaved && !!history.length && <div className="nd-history"><History size={13} aria-label="搜索历史" />{history.slice(0, 6).map(q => <button key={q} title={q} onClick={() => void run(q)}>{q}</button>)}<button className="nd-icon" aria-label="清空搜索历史" title="清空历史" onClick={() => { if (persist('history', [])) setHistory([]); }}><Trash2 size={12} /></button></div>}
      </div>
      <nav className="nd-drive-filters" aria-label="网盘类型">
        <button aria-pressed={drive === 'all'} onClick={() => { setDrive('all'); setPage(0); }}>全部{baseItems.length > 0 && <span>{baseItems.length}</span>}</button>
        {NETDISK_DRIVE_ORDER.filter(key => !baseItems.length || counts[key]).map(key => <button key={key} aria-pressed={drive === key} onClick={() => { setDrive(key); setPage(0); }}>{NETDISK_DRIVES[key]}{counts[key] > 0 && <span>{counts[key]}</span>}</button>)}
      </nav>
      <div className="nd-results-toolbar">
        <span role="status" aria-live="polite">{busy ? <><Loader2 size={13} className="nd-spin" />正在搜索 · {items.length} 条 · {successes}/{progress.length} 源</> : isSaved ? `${filtered.length} 条收藏` : searched ? `${stopped ? '已停止 · ' : ''}${filtered.length} 条结果${successes ? ` · ${successes} 个源完成` : ''}` : `${sources.filter(s => s.enabled).length} 个搜索源已启用`}</span>
        <div>
          {busy && <button className="nd-text-button" onClick={stop}><Square size={12} />停止</button>}
          {!busy && searched && !isSaved && <button className="nd-text-button" onClick={() => void run(searched, true)}>重新搜索</button>}
          <select aria-label="结果排序" value={newest ? 'newest' : 'relevance'} onChange={e => { setNewest(e.target.value === 'newest'); setPage(0); }}><option value="relevance">相关度</option><option value="newest">最新发布</option></select>
        </div>
      </div>
      {!isSaved && progress.length > 0 && <div className="nd-source-status" aria-label="搜索源状态">{progress.map(p => <span key={p.id} title={p.error || (p.cached ? '来自缓存' : undefined)} className={`nd-status-${stopped && p.state === 'pending' ? 'stopped' : p.state}`}>
        {p.state === 'pending' && busy ? <Loader2 size={11} className="nd-spin" /> : <i />}{p.name} {p.state === 'success' ? `${p.count}${p.cached ? ' · 缓存' : ''}` : p.state === 'error' ? '连接失败' : stopped ? '已停止' : p.count ? `${p.count} · 补充中` : '等待中'}
      </span>)}</div>}
      {!isSaved && failures.length > 0 && <details className="nd-errors"><summary>{failures.length} 个搜索源暂不可用</summary>{failures.map(p => <p key={p.id}>{p.name}：{p.error}</p>)}</details>}
      <div className="nd-results" aria-busy={busy}>
        {visible.length ? visible.map(item => <article className="nd-result" key={item.id}>
          <div className="nd-result-main">
            <div className="nd-result-title"><span className={`nd-drive nd-drive-${item.drive}`}>{NETDISK_DRIVES[item.drive] || item.drive}</span><button onClick={() => void openNetdiskItem(item).catch(error => notify(String(error)))} title={item.title}>{item.title}</button></div>
            {item.description && item.description !== item.title && <p className="nd-description">{item.description}</p>}
            <div className="nd-result-meta"><a href={item.url} onClick={e => { e.preventDefault(); void openNetdiskItem(item).catch(error => notify(String(error))); }} title={item.url}>{item.url}</a>
              {item.password && <button className="nd-code" title="复制提取码" onClick={() => void copy(item, true)}>{copied === `${item.id}:code` ? '已复制' : `提取码 ${item.password}`}</button>}
              {item.datetime && <time dateTime={item.datetime}>{item.datetime.slice(0, 10)}</time>}
              <span className="nd-source-names" title={item.sources.join('、')}>{item.sources.join(' · ')}</span>
            </div>
          </div>
          <div className="nd-result-actions"><button className={`nd-icon ${savedIds.has(item.id) ? 'nd-bookmarked' : ''}`} title={savedIds.has(item.id) ? '取消收藏' : '收藏'} aria-label={`${savedIds.has(item.id) ? '取消收藏' : '收藏'} ${item.title}`} aria-pressed={savedIds.has(item.id)} onClick={() => toggleSaved(item)}><Bookmark size={15} fill={savedIds.has(item.id) ? 'currentColor' : 'none'} /></button>
            <button className="nd-icon" title={copied === item.id ? '已复制' : '复制链接与提取码'} aria-label={`复制 ${item.title}`} onClick={() => void copy(item)}>{copied === item.id ? <Check size={15} /> : <Copy size={15} />}</button>
            <button className="nd-icon" title="打开网盘" aria-label={`打开 ${item.title}`} onClick={() => void openNetdiskItem(item).catch(error => notify(String(error)))}><ExternalLink size={15} /></button>
          </div>
        </article>) : <div className="nd-empty">
          {busy ? <Loader2 size={26} className="nd-spin" /> : isSaved ? <Bookmark size={26} /> : <Search size={26} />}
          <h2>{busy ? '正在查找资源' : isSaved ? (saved.length ? '没有匹配的收藏' : '暂无收藏') : searched ? (failures.length === progress.length && !stopped ? '搜索源暂不可用' : stopped ? '搜索已停止' : baseItems.length ? '该网盘暂无结果' : '未找到相关资源') : '搜索网盘资源'}</h2>
          {!busy && !isSaved && <p>{searched ? (failures.length ? '可重试或在设置中更换搜索源' : '试试其他关键词') : '百度 · 阿里 · 夸克 · 123 · 115 · 迅雷'}</p>}
          {!busy && !isSaved && searched && <button className="nd-button" onClick={() => void run(searched, true)}>重试</button>}
        </div>}
      </div>
      {filtered.length > PAGE_SIZE && <footer className="nd-pagination"><span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length}</span><button className="nd-icon" aria-label="上一页" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage + 1} / {maxPage + 1}</span><button className="nd-icon" aria-label="下一页" disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></footer>}
      <span className="nd-sr-only" role="status">{copied ? '已复制' : ''}</span>
    </>}
  </section>;
}
