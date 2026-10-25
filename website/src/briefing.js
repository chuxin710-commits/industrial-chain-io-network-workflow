import { createIcons, ArrowUpRight, ArrowLeft, ArrowRight, RefreshCw, Search, Newspaper, Bookmark, Check, X, Download, Copy, AlignJustify, RotateCcw } from 'lucide';
import { topics, normalizeItems, filterItems, cleanPersonal, toMarkdown } from './briefing-model.js';
import './briefing.css';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name) => `<i data-lucide="${name}"></i>`;
const icons = () => createIcons({ icons: { ArrowUpRight, ArrowLeft, ArrowRight, RefreshCw, Search, Newspaper, Bookmark, Check, X, Download, Copy, AlignJustify, RotateCcw } });
const date = (v, full = false) => Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', ...(full ? { year: 'numeric' } : {}), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '未记录';
const KEY = 'chainlab.briefing.personal.v2';
let storageOk = true;
function readPersonal() { try { return cleanPersonal(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { storageOk = false; return cleanPersonal({}); } }
let personal = readPersonal(), data = null, loadedAt = 0, generation = 0, controller, active = null, visibleCount = 30;
const filters = { view: 'feed', topic: 'all', query: '', source: '', hours: '72', read: 'all', sort: 'newest', edition: '' };
const params = new URLSearchParams(location.search);
if (topics[params.get('topic')]) filters.topic = params.get('topic');
filters.query = (params.get('q') || '').slice(0, 200);
if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '')) filters.edition = params.get('date');
document.querySelector('#app').innerHTML = `
<header class="site-header"><a class="brand" href="/">链研 <span>CHAINLAB</span></a><nav aria-label="网站导航"><a href="/">${icon('arrow-left')}首页</a><a href="/workspace.html">科研工作台${icon('arrow-up-right')}</a></nav></header>
<main><section class="masthead"><div><p class="eyebrow">THE CHAINLAB BRIEFING</p><h1>产业与 AI 早报</h1><p class="subtitle">产业链 · 供应链 · 人工智能前沿</p></div><div class="edition-box"><label for="edition">期刊档案 · 北京时间</label><select id="edition"><option value="">最新一期</option>${filters.edition ? `<option selected value="${filters.edition}">${filters.edition}</option>` : ''}</select><small>每日 07:00 自动采集</small></div></section>
<div class="status-line"><p id="status" role="status">正在读取早报…</p><button id="refresh" class="icon-button" title="重新读取已采集的早报" aria-label="重新读取早报">${icon('refresh-cw')}</button></div>
<section class="digest" aria-label="主题速览"><div class="section-label"><h2>三条速览</h2><span>各主题最新消息 · 非热度排行</span></div><div id="highlights" class="highlights"></div></section>
<section class="news-desk" aria-label="新闻阅读台"><div class="desk-heading"><div class="view-tabs" role="group" aria-label="阅读视图"><button data-view="feed" aria-pressed="true">${icon('newspaper')}信息流</button><button data-view="saved" aria-pressed="false">${icon('bookmark')}收藏夹 <span id="saved-count">0</span></button></div><span class="local-note">收藏、已读与笔记仅存本机浏览器</span></div>
<div class="toolbar"><div class="tabs" role="group" aria-label="新闻分类">${Object.entries({ all: '全部', ...topics }).map(([id, label]) => `<button data-category="${id}" aria-pressed="${filters.topic === id}">${label}</button>`).join('')}</div><label class="search">${icon('search')}<input type="search" id="search" maxlength="200" value="${esc(filters.query)}" placeholder="搜索标题、来源或主题" aria-label="搜索标题、来源或主题"></label></div>
<div class="filterbar"><label>时间窗<select id="hours"><option value="72">最近 72 小时</option><option value="48">最近 48 小时</option><option value="24">最近 24 小时</option></select></label><label>来源<select id="source"><option value="">全部来源</option></select></label><label>阅读状态<select id="read"><option value="all">全部状态</option><option value="unread">未读</option><option value="read">已读</option></select></label><label>排序<select id="sort"><option value="newest">最新优先</option><option value="oldest">最早优先</option></select></label><div class="filter-tools"><button id="reset" class="icon-button" title="重置筛选" aria-label="重置筛选">${icon('rotate-ccw')}</button><button id="density" class="icon-button" title="紧凑列表" aria-label="紧凑列表" aria-pressed="${personal.compact}">${icon('align-justify')}</button><button id="export" class="icon-button" title="导出筛选结果与个人笔记" aria-label="导出筛选结果">${icon('download')}</button></div></div>
<div class="columns"><section class="news-list" aria-label="新闻列表"><div class="list-heading"><h2 id="list-title">最近三天</h2><span id="count">0 条</span></div><div id="stories"></div><button id="more" class="load-more" hidden>再看 30 条${icon('arrow-right')}</button></section>
<aside><section><p class="eyebrow">EDITION OVERVIEW</p><h2>本期分布</h2><div id="overview"></div><p class="muted">主题可重叠，条数不代表事件数或热度。</p></section><section><h2>来源覆盖</h2><div id="coverage-stats"></div><p class="muted" id="coverage"></p><details><summary>检索源状态 <span id="feed-health"></span></summary><div id="sources"></div></details></section><a class="research-link" href="/workspace.html#knowledge"><img src="/media/research-briefing.jpg" alt="科研信息流概念图" loading="lazy"><span>从消息到研究${icon('arrow-up-right')}</span></a><p class="muted">收录标题与出处，不转载全文。消息未经独立核实；研究发布不等于技术突破。检索版本不代表事件发生地。</p></aside></div></section>
<footer><span>CHAINLAB / NEWS DESK</span><span>原始语言 · 公开消息 · 可追溯出处</span></footer></main>
<dialog id="reader" aria-labelledby="reader-title"><header class="reader-header"><span class="eyebrow">READING DESK / 阅读卡片</span><button id="reader-close" class="icon-button" aria-label="关闭阅读卡片" title="关闭">${icon('x')}</button></header><div id="reader-content"></div></dialog><div id="toast" role="status" aria-live="polite"></div>`;
const $ = (s) => document.querySelector(s);
let toastTimer;
function toast(message) { $('#toast').textContent = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 3000); }
function savePersonal() {
  personal = cleanPersonal(personal);
  try { localStorage.setItem(KEY, JSON.stringify(personal)); storageOk = true; } catch { storageOk = false; toast('浏览器存储不可用，本次变更仅在当前页面保留'); }
}
function reference() { return data?.window_end ? Date.parse(data.window_end) + (data.edition ? 0 : Date.now() - loadedAt) : Date.now(); }
function editionItems() { const now = reference(); return normalizeItems(data?.items).filter((a) => { const age = now - Date.parse(a.published_at); return age >= 0 && age <= 72 * 3600000; }); }
function baseItems() { return filters.view === 'saved' ? Object.values(personal.saved) : editionItems(); }
function rows() { return filterItems(baseItems(), filters, personal, reference()); }
function find(id) { return baseItems().find((a) => a.id === id) || normalizeItems(data?.items).find((a) => a.id === id) || personal.saved[id]; }
function syncUrl() {
  const p = new URLSearchParams();
  if (filters.topic !== 'all') p.set('topic', filters.topic);
  if (filters.query) p.set('q', filters.query);
  if (filters.edition) p.set('date', filters.edition);
  history.replaceState(null, '', location.pathname + (p.size ? '?' + p : ''));
}
function actions(a) {
  return `<div class="story-actions"><button class="icon-button ${personal.saved[a.id] ? 'selected' : ''}" data-save="${a.id}" aria-pressed="${!!personal.saved[a.id]}" title="${personal.saved[a.id] ? '取消收藏' : '收藏消息'}" aria-label="${personal.saved[a.id] ? '取消收藏' : '收藏消息'}">${icon('bookmark')}</button><button class="icon-button ${personal.read[a.id] ? 'selected' : ''}" data-read="${a.id}" aria-pressed="${!!personal.read[a.id]}" title="${personal.read[a.id] ? '标为未读' : '标为已读'}" aria-label="${personal.read[a.id] ? '标为未读' : '标为已读'}">${icon('check')}</button><a class="icon-button" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" title="打开原始报道（新窗口）" aria-label="打开原始报道">${icon('arrow-up-right')}</a></div>`;
}
function render() {
  const all = baseItems(), selected = rows();
  $('#stories').classList.toggle('compact', personal.compact);
  $('#saved-count').textContent = Object.keys(personal.saved).length;
  $('#count').textContent = `${selected.length} 条 · 显示 ${Math.min(selected.length, visibleCount)} 条`;
  $('#list-title').textContent = filters.view === 'saved' ? '我的收藏 · 不限发布时间' : data?.edition ? `${data.edition} 历史快照` : `最近 ${filters.hours} 小时`;
  $('#stories').innerHTML = selected.slice(0, visibleCount).map((a, i) => `<article class="story ${personal.read[a.id] ? 'is-read' : ''}" data-story="${a.id}"><span class="number">${String(i + 1).padStart(2, '0')}</span><div class="story-body"><div class="meta"><span class="topic ${a.topics[0] || ''}">${a.topics.map((t) => topics[t]).join(' · ')}</span><time datetime="${esc(a.published_at)}">${date(a.published_at)}</time>${personal.read[a.id] ? '<span>已读</span>' : ''}${personal.notes[a.id] ? '<span class="note-mark">有笔记</span>' : ''}</div><h3><button data-open="${a.id}">${esc(a.title)}</button></h3><div class="story-bottom"><button class="source-link" data-source="${esc(a.source)}">${esc(a.source)}</button>${actions(a)}</div></div></article>`).join('') || `<div class="empty">${icon('search')}<h3>${filters.view === 'saved' && !all.length ? '收藏夹还是空的' : '没有符合条件的消息'}</h3><p>${filters.view === 'saved' ? '收藏的消息可在三天窗口过后继续查看。' : '尝试放宽时间、主题或来源条件。'}</p><button class="text-button" data-reset>重置筛选</button></div>`;
  $('#more').hidden = selected.length <= visibleCount;
  $('#export').disabled = !selected.length;
  $('#hours').disabled = filters.view === 'saved';
  $('#hours').title = filters.view === 'saved' ? '收藏夹保留全部已保存时间的消息' : '历史期刊相对于该期采集时刻';
  $('#density').setAttribute('aria-pressed', String(personal.compact));
  document.querySelectorAll('[data-category]').forEach((b) => b.setAttribute('aria-pressed', String(filters.topic === b.dataset.category)));
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(filters.view === b.dataset.view)));
  icons(); syncUrl();
}
function sourceOptions() {
  const values = [...new Set(baseItems().map((a) => a.source))].sort((a, b) => a.localeCompare(b));
  if (filters.source && !values.includes(filters.source)) values.push(filters.source);
  $('#source').innerHTML = '<option value="">全部来源</option>' + values.map((s) => `<option ${s === filters.source ? 'selected' : ''} value="${esc(s)}">${esc(s)}</option>`).join('');
}
function renderEdition() {
  const items = editionItems(), used = new Set();
  $('#highlights').innerHTML = Object.entries(topics).map(([id, label], i) => {
    const a = [...items].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).find((a) => a.topics.includes(id) && !used.has(a.id));
    if (a) used.add(a.id);
    return `<article class="highlight ${id}"><div><span>0${i + 1} / ${label}</span>${icon('arrow-up-right')}</div>${a ? `<button data-open="${a.id}">${esc(a.title)}</button><p>${esc(a.source)} · ${date(a.published_at)}</p>` : '<p>本期暂无独立条目</p>'}</article>`;
  }).join('');
  $('#overview').innerHTML = Object.entries(topics).map(([id, label]) => {
    const count = items.filter((a) => a.topics.includes(id)).length;
    return `<button class="summary-row ${id}" data-category="${id}"><span>${label}</span><strong>${count}</strong><i style="--coverage:${items.length ? count / items.length * 100 : 0}%"></i></button>`;
  }).join('');
  $('#coverage-stats').innerHTML = `<strong>${new Set(items.map((a) => a.source)).size}</strong><span>个发布来源 · ${items.length} 条标题</span>`;
  $('#coverage').textContent = data?.coverage || '公开订阅检索；不代表全球全量覆盖。';
  const feeds = data?.last_attempt?.feeds || [];
  $('#feed-health').textContent = `${feeds.filter((f) => f.ok).length} / ${feeds.length}`;
  $('#sources').innerHTML = feeds.map((f) => `<p><span>${esc(f.edition)} · ${topics[f.topic] || esc(f.topic)}</span><b class="${f.ok ? 'ok' : 'warning'}">${f.ok ? '正常' : '失败'}</b></p>`).join('') || '<p>暂无采集记录</p>';
  sourceOptions(); render();
}
async function load() {
  const token = ++generation, requested = filters.edition;
  controller?.abort(); controller = new AbortController();
  const currentController = controller;
  const timeout = setTimeout(() => currentController.abort(), 20000);
  $('#refresh').disabled = true; $('#status').textContent = '正在读取早报…';
  try {
    const response = await fetch('/api/briefing' + (requested ? '?date=' + requested : ''), { signal: controller.signal });
    if (!response.ok) throw new Error(response.status === 404 ? '该期早报不存在' : '早报暂时无法读取');
    const value = await response.json();
    if (token !== generation) return;
    data = value; loadedAt = Date.now(); visibleCount = 30;
    const states = { ready: '已更新', partial: '部分检索源不可用', stale: '采集延迟，仅保留有效窗口内消息', pending: '首期早报正在采集', archive: '历史快照 · 非当前消息' };
    $('#status').textContent = `${states[data.status] || '已读取'}${data.generated_at ? ' · 采集于 ' + date(data.generated_at, true) : ''} · 北京时间`;
    renderEdition();
  } catch (error) {
    if (token !== generation) return;
    if (data) { filters.edition = data.edition || ''; $('#edition').value = filters.edition; }
    $('#status').textContent = `${error.name === 'AbortError' ? '读取超时' : error.message}，${data ? '保留上次成功读取的内容' : '请重试'}。`;
    render();
  } finally { clearTimeout(timeout); if (token === generation) { $('#refresh').disabled = false; icons(); } }
}
async function loadEditions() {
  try {
    const response = await fetch('/api/briefing/editions', { signal: AbortSignal.timeout(12000) }); if (!response.ok) throw Error();
    const { editions } = await response.json();
    const dates = (editions || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (filters.edition && !dates.includes(filters.edition)) dates.unshift(filters.edition);
    $('#edition').innerHTML = '<option value="">最新一期</option>' + dates.map((d) => `<option value="${d}">${d}</option>`).join('');
    $('#edition').value = filters.edition;
  } catch { $('#edition').title = '期刊目录暂不可用，可继续阅读当前消息'; }
}
function reset() {
  Object.assign(filters, { topic: 'all', query: '', source: '', hours: '72', read: 'all', sort: 'newest' });
  for (const id of ['search', 'source']) $('#' + id).value = '';
  for (const id of ['hours', 'read', 'sort']) $('#' + id).value = filters[id];
  visibleCount = 30; render();
}
function openReader(id) {
  active = find(id); if (!active) return;
  const a = active;
  $('#reader-content').innerHTML = `<p class="topic ${a.topics[0]}">${a.topics.map((t) => topics[t]).join(' · ')}</p><h2 id="reader-title">${esc(a.title)}</h2><dl class="reader-meta"><div><dt>发布来源</dt><dd>${esc(a.source)}</dd></div><div><dt>发布时间</dt><dd>${date(a.published_at, true)} · 北京时间</dd></div><div><dt>检索版本</dt><dd>${esc(a.editions.join(' / ') || '未记录')}（非事件发生地）</dd></div></dl><div class="reader-actions"><a class="primary-button" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">阅读原始报道${icon('arrow-up-right')}</a>${actions(a)}<button id="copy-link" class="icon-button" title="复制原文链接" aria-label="复制原文链接">${icon('copy')}</button></div><p class="reader-disclaimer">本站仅收录标题与出处。全文需前往来源网站阅读，部分来源可能要求订阅；收录不代表已独立核实。</p><section class="note-editor"><label for="note">个人笔记 <span>仅本机保存</span></label><textarea id="note" rows="5" maxlength="2000" placeholder="记录与你的研究有关的问题、判断或待核实事项。">${esc(personal.notes[a.id] || '')}</textarea><div><span id="note-status" role="status">${personal.notes[a.id] ? '已有本机笔记' : '尚无笔记'}</span><button id="save-note" class="primary-button">保存笔记</button></div></section>`;
  $('#note').addEventListener('input', () => { $('#note-status').textContent = '有未保存修改'; });
  $('#save-note').onclick = saveNote;
  $('#copy-link').onclick = async () => { try { await navigator.clipboard.writeText(a.url); toast('原文链接已复制'); } catch { toast('浏览器未开放剪贴板，请使用原文链接'); } };
  if (!$('#reader').open) $('#reader').showModal(); icons();
}
function saveNote() {
  if (!active) return;
  const note = $('#note').value.trim();
  if (note) {
    if (!personal.saved[active.id] && Object.keys(personal.saved).length >= 500) return toast('请先整理收藏，为这条笔记留出空间');
    personal.notes[active.id] = note; personal.saved[active.id] = active;
  } else delete personal.notes[active.id];
  savePersonal(); sourceOptions(); render(); refreshReaderActions();
  $('#note-status').textContent = storageOk ? (note ? '已保存，并加入收藏' : '笔记已清空') : '仅保留于当前页面';
}
function refreshReaderActions() { if (active && $('#reader').open) { $('#reader .story-actions').outerHTML = actions(active); icons(); } }
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]'); if (open) return openReader(open.dataset.open);
  const save = e.target.closest('[data-save]');
  if (save) {
    const a = find(save.dataset.save) || (active?.id === save.dataset.save ? active : null); if (!a) return;
    if (personal.saved[a.id]) {
      if (personal.notes[a.id]) return toast('这条消息已有笔记，请先在阅读卡片中清空笔记再取消收藏');
      delete personal.saved[a.id]; toast('已取消收藏');
    }
    else { if (Object.keys(personal.saved).length >= 500) return toast('已达到 500 条收藏上限，请先整理或导出'); personal.saved[a.id] = a; }
    savePersonal(); sourceOptions(); render(); refreshReaderActions(); return;
  }
  const read = e.target.closest('[data-read]');
  if (read) { const id = read.dataset.read; if (personal.read[id]) delete personal.read[id]; else personal.read[id] = Date.now(); savePersonal(); render(); refreshReaderActions(); return; }
  const cat = e.target.closest('[data-category]'); if (cat) filters.topic = cat.dataset.category;
  const view = e.target.closest('[data-view]'); if (view) { filters.view = view.dataset.view; filters.source = ''; sourceOptions(); }
  const source = e.target.closest('[data-source]'); if (source) { filters.source = source.dataset.source; $('#source').value = filters.source; }
  if (cat || view || source) { visibleCount = 30; render(); }
  if (e.target.closest('[data-reset]')) reset();
});
function mayClose() { return !active || $('#note').value.trim() === (personal.notes[active.id] || '') || confirm('笔记尚未保存，放弃本次修改？'); }
$('#reader').addEventListener('cancel', (e) => { if (!mayClose()) e.preventDefault(); });
$('#reader-close').onclick = () => { if (mayClose()) $('#reader').close(); };
$('#reader').addEventListener('close', () => { active = null; });
$('#search').oninput = (e) => { filters.query = e.target.value; visibleCount = 30; render(); };
for (const id of ['hours', 'source', 'read', 'sort']) $('#' + id).onchange = (e) => { filters[id] = e.target.value; visibleCount = 30; render(); };
$('#edition').onchange = (e) => { filters.edition = e.target.value; filters.view = 'feed'; load(); };
$('#refresh').onclick = () => { load(); loadEditions(); };
$('#reset').onclick = reset;
$('#density').onclick = () => { personal.compact = !personal.compact; savePersonal(); render(); };
$('#more').onclick = () => { visibleCount += 30; render(); };
$('#export').onclick = () => {
  const selected = rows(); if (!selected.length) return;
  const url = URL.createObjectURL(new Blob([toMarkdown(selected, personal, `链研早报 · ${filters.view === 'saved' ? '个人收藏' : data?.edition || '当前时间窗'}`)], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `CHAINLAB-briefing-${filters.edition || 'latest'}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已导出 ${selected.length} 条消息及对应个人笔记`);
};
window.addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) { personal = readPersonal(); sourceOptions(); render(); refreshReaderActions(); } });
icons(); render(); load(); loadEditions();
if (!storageOk) toast('浏览器存储不可用，收藏和笔记暂不持久保存');
