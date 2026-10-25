import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createContinuousPages } from './library-pages.js';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { safe } from './library.js';

GlobalWorkerOptions.workerSrc = workerUrl;
const kinds = {
  highlight: '高亮',
  area: '区域标记',
  ink: '手绘',
  bookmark: '书签',
  note: '笔记',
  source_highlight: '原始高亮',
};
const icon = (name) => `<i data-lucide="${name}"></i>`;
const tool = (id, name, title) =>
  `<button type="button" id="${id}" class="icon-button" title="${title}" aria-label="${title}">${icon(name)}</button>`;

export function createLibraryReader({ api, getUser, refreshIcons, toast, onClose }) {
  const root = document.createElement('div');
  root.className = 'library-reader';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '文献阅读与共享笔记');
  root.innerHTML = `<header class="reader-header">${tool('reader-back', 'arrow-left', '返回文献库')}<div class="reader-document-heading"><strong id="reader-title"></strong><small id="reader-author"></small></div><span id="reader-sync" role="status">正在同步</span>${tool('reader-download-pdf', 'download', '下载原 PDF')}${tool('reader-export-notes', 'file-text', '导出本文全部共享笔记 Markdown')}${tool('reader-export-json', 'braces', '导出本文全部标记 JSON')}${tool('reader-toggle-notes', 'panel-right-open', '展开或收起共享笔记')}</header>
    <div class="reader-toolbar"><div class="reader-page-controls">${tool('reader-prev', 'chevron-left', '上一页')}<input id="reader-page-number" type="number" min="1" value="1" aria-label="文献页码" /><span id="reader-page-total"></span>${tool('reader-next', 'chevron-right', '下一页')}</div><div class="reader-modes" role="group" aria-label="阅读与标记工具"><button type="button" class="icon-button" data-reader-mode="text" aria-label="选择文字" title="选择文字" aria-pressed="true">${icon('mouse-pointer-2')}</button><button type="button" class="icon-button" data-reader-mode="highlight" aria-label="高亮文字或框选高亮" title="高亮文字或框选高亮">${icon('highlighter')}</button><button type="button" class="icon-button" data-reader-mode="area" aria-label="矩形标记" title="矩形标记">${icon('square')}</button><button type="button" class="icon-button" data-reader-mode="ink" aria-label="自由手绘" title="自由手绘">${icon('pencil')}</button>${tool('reader-bookmark', 'bookmark', '添加本页书签')}</div><fieldset class="reader-colors"><legend class="sr-only">标记颜色</legend>${[
      ['#f6d568', '黄色'],
      ['#a1cf9e', '绿色'],
      ['#83b4dd', '蓝色'],
      ['#e69b87', '珊瑚色'],
    ]
      .map(
        ([c, label], i) =>
          `<label title="${label}"><input type="radio" name="reader-color" value="${c}" ${i === 0 ? 'checked' : ''} aria-label="${label}" /><span style="background:${c}"></span></label>`,
      )
      .join(
        '',
      )}</fieldset><select id="reader-zoom" aria-label="阅读缩放"><option value="fit">适合宽度</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option></select></div>
    <div class="reader-main"><div class="reader-paper-column"><div id="reader-load-status" role="status"></div><div class="reader-paper-scroll" id="reader-paper-scroll"><div id="reader-page-host" class="reader-page-host"><canvas id="reader-pdf-canvas"></canvas><div id="reader-text-layer" class="textLayer"></div><svg id="reader-marks" class="reader-marks" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"></svg><svg id="reader-draw" class="reader-draw" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="在文献页面绘制标记"></svg></div><div id="reader-missing-pdf" class="reader-missing-pdf" hidden><i data-lucide="file-text"></i><h2>原文献库未附 PDF</h2><p id="reader-abstract"></p></div></div><div id="reader-mark-feedback" class="reader-mark-feedback" hidden><span id="reader-mark-status"></span><button type="button" class="inline-button" id="reader-retry-mark">重试保存</button><button type="button" class="inline-button" id="reader-discard-mark">放弃本次标记</button></div></div>
    <aside class="reader-notes" id="reader-notes"><div class="reader-notes-heading"><h2>共享标记与笔记</h2>${tool('reader-close-notes', 'panel-right-close', '收起共享笔记')}</div><div class="reader-record-filters"><select id="reader-record-filter" aria-label="筛选阅读记录"><option value="all">全部记录</option><option value="page">当前页</option><option value="mine">我的记录</option><option value="notes">文字笔记</option><option value="bookmarks">书签</option></select>${tool('reader-refresh-notes', 'refresh-cw', '立即同步')}</div><div id="reader-records" class="reader-records"></div><form id="reader-note-form" class="reader-note-form"><div><strong id="reader-draft-title">新笔记</strong><button type="button" id="reader-new-note" class="inline-button">${icon('plus')}新建</button></div><label class="reader-note-page"><input id="reader-note-page" type="checkbox" checked /><span id="reader-note-page-label">关联当前页</span></label><textarea id="reader-note-body" rows="5" maxlength="12000" aria-label="共享笔记正文" placeholder="写下这篇文献的研究问题、方法或你的判断"></textarea><div id="reader-conflict" class="reader-conflict" hidden></div><p id="reader-draft-status" role="status"></p><button type="submit" id="reader-save-note" class="button button-dark">${icon('save')}保存共享笔记</button></form></aside></div>`;
  document.body.append(root);
  const $ = (s) => root.querySelector(s);
  const highlightButton = $('[data-reader-mode="highlight"]');
  highlightButton.title = '划词高亮';
  highlightButton.setAttribute('aria-label', '划词高亮');
  const pagesContainer = document.createElement('div');
  pagesContainer.className = 'reader-pages';
  $('#reader-page-host').replaceWith(pagesContainer);
  const layoutControls = document.createElement('div');
  layoutControls.className = 'reader-layout-controls';
  layoutControls.setAttribute('role', 'group');
  layoutControls.setAttribute('aria-label', '连续阅读布局');
  layoutControls.innerHTML = `<button type="button" class="icon-button" data-reader-columns="1" title="单页连续阅读" aria-label="单页连续阅读" aria-pressed="true">${icon('panel-top')}</button><button type="button" class="icon-button" data-reader-columns="2" title="双页连续阅读" aria-label="双页连续阅读" aria-pressed="false">${icon('columns-2')}</button>`;
  $('#reader-zoom').before(layoutControls);
  let columns = sessionStorage.getItem('chainlab.library.columns') === '2' ? 2 : 1;
  function layoutButtons() {
    layoutControls
      .querySelectorAll('button')
      .forEach((b) =>
        b.setAttribute('aria-pressed', String(Number(b.dataset.readerColumns) === columns)),
      );
  }
  layoutButtons();
  const bylineField = document.createElement('label');
  bylineField.className = 'reader-byline';
  bylineField.innerHTML =
    '<span>阅读署名（可选，自填）</span><input id="reader-byline" maxlength="40" autocomplete="off" />';
  $('#reader-note-form').prepend(bylineField);
  $('#reader-byline').value = sessionStorage.getItem('chainlab.library.byline') || '';
  $('#reader-byline').addEventListener('input', () =>
    sessionStorage.setItem('chainlab.library.byline', $('#reader-byline').value),
  );
  const byline = () => $('#reader-byline').value.trim();
  let paper = null,
    pdf = null,
    loadingTask = null,
    page = 1,
    mode = 'text',
    color = '#f6d568',
    records = [],
    etag = null,
    timer = null,
    openVersion = 0,
    reading = false;
  let draft = { body: '' },
    dirty = false,
    stroke = null,
    pendingMark = null,
    savingMark = false,
    syncing = false,
    focused = null;
  let recordsRevision = 0;
  const markViewKeys = new Map();
  let pendingViewKey = null;
  const pageViews = createContinuousPages({
    scroll: $('#reader-paper-scroll'),
    container: pagesContainer,
    status: $('#reader-load-status'),
    onActive: activePage,
    onReady: drawMarks,
  });
  function activePage(value) {
    const changed = page !== value;
    page = value;
    $('#reader-page-number').value = String(page);
    $('#reader-page-total').textContent = `/ ${pdf?.numPages || paper?.pages || 1}`;
    $('#reader-prev').disabled = page <= 1;
    $('#reader-next').disabled = page >= (pdf?.numPages || 1);
    if (!dirty && !draft.id) {
      draft.page = $('#reader-note-page').checked ? page : null;
      $('#reader-note-page-label').textContent = draft.page ? `关联第 ${page} 页` : '整篇文献';
    }
    if (changed && paper) {
      history.replaceState(
        null,
        '',
        `${location.pathname}${location.search}#literature/read/${paper.id}/${page}`,
      );
      renderRecords();
    }
  }
  const draftKey = () => `chainlab.library.draft.${getUser()?.id}.${paper?.id}`;
  function time(value) {
    return new Date(value * 1000).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  function saveDraft() {
    if (!paper) return;
    dirty = true;
    sessionStorage.setItem(draftKey(), JSON.stringify(draft));
    $('#reader-draft-status').textContent = '草稿未保存';
  }
  function resetDraft(value = null) {
    draft = value ? { ...value } : { body: '', page: paper?.pdf ? page : null, kind: 'note' };
    $('#reader-note-body').value = draft.body || '';
    $('#reader-note-page').checked = draft.page != null;
    $('#reader-note-page').disabled = !!value || !paper?.pdf;
    $('#reader-note-page-label').textContent = draft.page ? `关联第 ${draft.page} 页` : '整篇文献';
    $('#reader-draft-title').textContent = value ? `编辑${kinds[value.kind] || '记录'}` : '新笔记';
    $('#reader-draft-status').textContent = '';
    $('#reader-conflict').hidden = true;
    dirty = false;
  }
  function setMode(value) {
    mode = value;
    root.dataset.mode = value;
    root
      .querySelectorAll('[data-reader-mode]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.readerMode === value)));
  }
  function shape(mark) {
    const selected = mark.id === focused;
    const alpha = mark.kind === 'highlight' ? 0.32 : 0.08;
    const c = mark.color || color;
    if (mark.kind === 'ink')
      return `<polyline points="${mark.anchor.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${selected ? 4 : 2.4}" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />`;
    return (mark.anchor.rects || [])
      .map(
        ([x1, y1, x2, y2]) =>
          `<rect x="${x1 * 1000}" y="${y1 * 1000}" width="${(x2 - x1) * 1000}" height="${(y2 - y1) * 1000}" fill="${c}" fill-opacity="${alpha}" stroke="${selected || mark.kind === 'area' ? c : 'none'}" stroke-width="${selected ? 2 : 1.5}" vector-effect="non-scaling-stroke" />`,
      )
      .join('');
  }
  function drawMarks() {
    pagesContainer.querySelectorAll('.reader-page-host').forEach((host) => {
      const number = Number(host.dataset.page);
      const pageMarks = records.filter(
        (r) => r.page === number && ['highlight', 'area', 'ink'].includes(r.kind),
      );
      if (pendingMark?.page === number) pageMarks.push(pendingMark);
      const layer = host.querySelector('.reader-marks');
      const keep = new Set();
      for (const mark of pageMarks) {
        const key = mark === pendingMark ? pendingViewKey : markViewKeys.get(mark.id) || mark.id;
        keep.add(key);
        let group = [...layer.children].find((node) => node.dataset.markKey === key);
        if (!group) {
          group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          group.dataset.markKey = key;
          layer.append(group);
        }
        const markup = shape(mark);
        if (group._shape !== markup) {
          group.innerHTML = markup;
          group._shape = markup;
        }
      }
      [...layer.children].forEach((node) => {
        if (!keep.has(node.dataset.markKey)) node.remove();
      });
      if (!stroke || stroke.page !== number) host.querySelector('.reader-draw').replaceChildren();
    });
  }
  function renderRecords() {
    const filter = $('#reader-record-filter').value,
      uid = getUser()?.id;
    const visible = records.filter(
      (r) =>
        filter === 'all' ||
        (filter === 'page' && r.page === page) ||
        (filter === 'mine' && r.author_id === uid) ||
        (filter === 'notes' && !!r.body) ||
        (filter === 'bookmarks' && r.kind === 'bookmark'),
    );
    $('#reader-records').innerHTML =
      visible
        .map((r) => {
          const editable =
            r.origin === 'team' && (r.author_id === uid || getUser()?.role === 'admin');
          return `<article class="reader-record ${r.id === focused ? 'is-focused' : ''}" data-record-id="${r.id}"><div class="reader-record-heading"><button type="button" data-jump-record="${r.id}">${safe(kinds[r.kind] || r.kind)}${r.page ? ` · 第 ${r.page} 页` : ''}</button><span>${safe(r.author)} · ${time(r.updated)}</span></div>${r.quote ? `<blockquote>${safe(r.quote.slice(0, 500))}</blockquote>` : ''}${r.body ? `<p>${safe(r.body)}</p>` : r.origin === 'pdf' ? '<p class="reader-original-mark">原 PDF 高亮，未附文字或作者</p>' : ''}<div class="reader-record-actions">${editable ? `<button type="button" class="inline-button" data-edit-record="${r.id}">编辑</button><button type="button" class="inline-button" data-delete-record="${r.id}">删除</button>` : '<span>共享可见 · 只读</span>'}</div></article>`;
        })
        .join('') || '<div class="reader-no-records">暂无匹配记录</div>';
  }
  async function sync(force = false) {
    if (!reading || !paper || syncing) return;
    syncing = true;
    const id = paper.id;
    const revision = recordsRevision;
    try {
      const data = await api(`/annotations?document_id=${id}`, {
        headers: !force && etag ? { 'If-None-Match': etag } : {},
      });
      if (!reading || paper?.id !== id || revision !== recordsRevision || savingMark) return;
      if (!data.unchanged) {
        records = data.annotations;
        etag = data.etag;
        renderRecords();
        drawMarks();
      }
      $('#reader-sync').textContent =
        `已同步 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } catch (e) {
      if (reading) $('#reader-sync').textContent = `同步失败：${e.message}`;
    } finally {
      syncing = false;
    }
  }
  function renderPage() {
    if (pdf && reading) pageViews.layout(columns, $('#reader-zoom').value);
  }
  async function goPage(value) {
    if (pendingMark) {
      toast('请先保存或放弃尚未提交的标记。');
      return;
    }
    const target = Math.max(
      1,
      Math.min(pdf?.numPages || paper?.pages || 1, Math.trunc(Number(value)) || 1),
    );
    history.replaceState(
      null,
      '',
      `${location.pathname}${location.search}#literature/read/${paper.id}/${target}`,
    );
    pageViews.jump(target);
  }
  async function open(document, startPage = 1) {
    if (reading && paper?.id === document.id) {
      if (page !== startPage) goPage(startPage);
      return;
    }
    if (close(false) === false) return;
    const version = ++openVersion;
    paper = document;
    reading = true;
    records = [];
    recordsRevision++;
    markViewKeys.clear();
    etag = null;
    page = Math.max(1, Math.min(document.pages || 1, startPage));
    focused = null;
    pendingMark = null;
    $('#reader-mark-feedback').hidden = true;
    root.hidden = false;
    documentBodyLock(true);
    $('#reader-title').textContent = document.title;
    $('#reader-author').textContent =
      (document.authors.join('，') || '作者未提供') + (document.year ? ` · ${document.year}` : '');
    $('#reader-page-number').max = String(document.pages || 1);
    $('#reader-missing-pdf').hidden = !!document.pdf;
    pagesContainer.hidden = !document.pdf;
    $('#reader-abstract').textContent = document.abstract || '可为此条目保存整篇笔记。';
    $('#reader-download-pdf').disabled = !document.pdf;
    root
      .querySelectorAll(
        '[data-reader-mode],[data-reader-columns],#reader-bookmark,#reader-zoom,#reader-page-number,#reader-prev,#reader-next',
      )
      .forEach((e) => {
        e.disabled = !document.pdf;
      });
    resetDraft();
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey()));
      if (saved) {
        resetDraft(saved.id ? saved : null);
        draft = saved;
        $('#reader-note-body').value = saved.body || '';
        dirty = true;
        $('#reader-draft-status').textContent = '已恢复未保存草稿';
      }
    } catch {}
    setMode('text');
    refreshIcons();
    sync(true);
    timer = setInterval(() => {
      if (!window.document.hidden) sync();
    }, 5000);
    if (!document.pdf) {
      $('#reader-load-status').textContent = '';
      $('#reader-page-total').textContent = '/ 无附件';
      return;
    }
    $('#reader-load-status').textContent = '正在加载原始 PDF';
    try {
      loadingTask = getDocument({
        url: `/api/library/documents/${document.id}/pdf`,
        withCredentials: true,
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
        iccUrl: '/pdfjs/iccs/',
        isEvalSupported: false,
        disableAutoFetch: true,
        disableStream: true,
      });
      const loaded = await loadingTask.promise;
      if (version !== openVersion) {
        loaded.destroy();
        return;
      }
      pdf = loaded;
      $('#reader-page-number').max = String(pdf.numPages);
      await pageViews.open(pdf, page, columns, $('#reader-zoom').value);
      drawMarks();
    } catch (e) {
      if (version === openVersion)
        $('#reader-load-status').textContent = `PDF 读取失败：${e.message}`;
    }
  }
  function documentBodyLock(value) {
    window.document.body.classList.toggle('library-reading', value);
  }
  function close(notify = true) {
    if (!reading) return true;
    if (pendingMark && getUser()) {
      toast('请先保存或放弃尚未提交的标记。');
      return false;
    }
    reading = false;
    recordsRevision++;
    openVersion++;
    clearInterval(timer);
    clearTimeout(resizeTimer);
    pageViews.close();
    loadingTask?.destroy();
    pdf = null;
    root.hidden = true;
    documentBodyLock(false);
    $('#reader-records').replaceChildren();
    stroke = null;
    for (const id of ['#reader-title', '#reader-author', '#reader-abstract', '#reader-conflict'])
      $(id).textContent = '';
    $('#reader-note-body').value = '';
    records = [];
    draft = { body: '' };
    dirty = false;
    paper = null;
    if (notify) onClose();
    return true;
  }
  async function persistMark() {
    if (!pendingMark || savingMark) return;
    const mark = pendingMark,
      id = paper.id;
    savingMark = true;
    $('#reader-mark-feedback').hidden = false;
    $('#reader-mark-status').textContent = '正在保存标记';
    $('#reader-retry-mark').disabled = true;
    try {
      const saved = await api('/annotations', {
        method: 'POST',
        body: JSON.stringify({ ...mark, byline: byline(), document_id: id }),
      });
      if (paper?.id !== id || pendingMark !== mark) return;
      recordsRevision++;
      etag = null;
      markViewKeys.set(saved.id, pendingViewKey);
      records = [...records.filter((item) => item.id !== saved.id), saved];
      pendingMark = null;
      pendingViewKey = null;
      drawMarks();
      renderRecords();
      $('#reader-mark-feedback').hidden = true;
    } catch (e) {
      if (paper?.id === id) $('#reader-mark-status').textContent = `未保存：${e.message}`;
    } finally {
      savingMark = false;
      $('#reader-retry-mark').disabled = false;
      drawMarks();
    }
  }
  function newMark(value) {
    if (pendingMark || savingMark) {
      toast('上一个标记尚未保存，请先处理。');
      return false;
    }
    pendingMark = { body: '', quote: '', color, anchor: {}, page, ...value };
    pendingViewKey = `pending-${crypto.randomUUID()}`;
    drawMarks();
    persistMark();
    return true;
  }
  function selectionMark() {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0),
      node = range.commonAncestorContainer,
      host = (node.nodeType === 1 ? node : node.parentElement)?.closest('.reader-page-host');
    if (!host || !pagesContainer.contains(host)) return false;
    pageViews.activate(Number(host.dataset.page));
    const b = host.getBoundingClientRect();
    const rects = [...range.getClientRects()]
      .map((r) => [
        Math.max(0, (r.left - b.left) / b.width),
        Math.max(0, (r.top - b.top) / b.height),
        Math.min(1, (r.right - b.left) / b.width),
        Math.min(1, (r.bottom - b.top) / b.height),
      ])
      .filter(([x, y, x2, y2]) => x2 > x && y2 > y)
      .slice(0, 100);
    if (!rects.length) return false;
    if (
      !newMark({ kind: 'highlight', quote: selection.toString().slice(0, 6000), anchor: { rects } })
    )
      return false;
    selection.removeAllRanges();
    return true;
  }
  root.querySelectorAll('[data-reader-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.readerMode === 'highlight' && selectionMark()) return;
      setMode(b.dataset.readerMode);
    }),
  );
  highlightButton.addEventListener('pointerdown', (e) => e.preventDefault());
  pagesContainer.addEventListener('pointerup', () => {
    if (mode === 'highlight')
      setTimeout(() => {
        if (reading && mode === 'highlight') selectionMark();
      }, 0);
  });
  root.querySelectorAll('[name="reader-color"]').forEach((i) =>
    i.addEventListener('change', () => {
      color = i.value;
    }),
  );
  $('#reader-back').addEventListener('click', () => close());
  $('#reader-prev').addEventListener('click', () => goPage(page - 1));
  $('#reader-next').addEventListener('click', () => goPage(page + 1));
  $('#reader-page-number').addEventListener('change', (e) => goPage(e.target.value));
  $('#reader-zoom').addEventListener('change', renderPage);
  layoutControls.addEventListener('click', (e) => {
    const button = e.target.closest('[data-reader-columns]');
    if (!button || button.disabled) return;
    columns = Number(button.dataset.readerColumns);
    sessionStorage.setItem('chainlab.library.columns', String(columns));
    layoutButtons();
    renderPage();
  });
  $('#reader-bookmark').addEventListener('click', () =>
    newMark({ kind: 'bookmark', body: `第 ${page} 页书签` }),
  );
  const position = (e) => {
    const b = (stroke?.surface || e.target.closest('.reader-draw')).getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
      Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
    ];
  };
  pagesContainer.addEventListener('pointerdown', (e) => {
    const host = e.target.closest('.reader-page-host');
    if (!host) return;
    pageViews.activate(Number(host.dataset.page));
    const surface = e.target.closest('.reader-draw');
    if (!surface || !host.dataset.ready) return;
    if (e.button !== 0 || mode === 'text' || pendingMark || savingMark) return;
    stroke = { start: position(e), points: [position(e)], page, surface };
    surface.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  pagesContainer.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    const point = position(e);
    if (mode === 'ink') {
      if (stroke.points.length < 2000) stroke.points.push(point);
      stroke.surface.innerHTML = shape({
        kind: 'ink',
        color,
        anchor: { points: stroke.points },
      });
    } else {
      stroke.surface.innerHTML = shape({
        kind: mode,
        color,
        anchor: {
          rects: [
            [
              Math.min(stroke.start[0], point[0]),
              Math.min(stroke.start[1], point[1]),
              Math.max(stroke.start[0], point[0]),
              Math.max(stroke.start[1], point[1]),
            ],
          ],
        },
      });
    }
  });
  pagesContainer.addEventListener('pointerup', (e) => {
    if (!stroke) return;
    const point = position(e);
    const before = stroke;
    stroke = null;
    if (mode === 'ink') {
      if (before.points.length >= 2)
        newMark({ page: before.page, kind: 'ink', anchor: { points: before.points } });
    } else {
      const rect = [
        Math.min(before.start[0], point[0]),
        Math.min(before.start[1], point[1]),
        Math.max(before.start[0], point[0]),
        Math.max(before.start[1], point[1]),
      ];
      if (rect[2] - rect[0] > 0.002 && rect[3] - rect[1] > 0.002)
        newMark({ page: before.page, kind: mode, anchor: { rects: [rect] } });
    }
    if (before.surface.hasPointerCapture(e.pointerId))
      before.surface.releasePointerCapture(e.pointerId);
    drawMarks();
  });
  pagesContainer.addEventListener('pointercancel', () => {
    stroke = null;
    drawMarks();
  });
  $('#reader-retry-mark').addEventListener('click', persistMark);
  $('#reader-discard-mark').addEventListener('click', () => {
    if (savingMark) return;
    pendingMark = null;
    $('#reader-mark-feedback').hidden = true;
    drawMarks();
  });
  $('#reader-note-body').addEventListener('input', () => {
    draft.body = $('#reader-note-body').value;
    saveDraft();
  });
  $('#reader-note-page').addEventListener('change', () => {
    draft.page = $('#reader-note-page').checked && paper.pdf ? page : null;
    $('#reader-note-page-label').textContent = draft.page ? `关联第 ${draft.page} 页` : '整篇文献';
    saveDraft();
  });
  $('#reader-new-note').addEventListener('click', () => {
    if (!$('#reader-conflict').hidden) {
      const body = draft.body;
      resetDraft();
      draft.body = body;
      $('#reader-note-body').value = body;
      saveDraft();
      return;
    }
    if (dirty && !confirm('放弃当前未保存草稿并开始新笔记？')) return;
    sessionStorage.removeItem(draftKey());
    resetDraft();
    $('#reader-note-body').focus();
  });
  $('#reader-note-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!draft.body.trim()) {
      toast('请先填写笔记正文。');
      return;
    }
    $('#reader-save-note').disabled = true;
    $('#reader-draft-status').textContent = '正在保存';
    const savedDraft = JSON.stringify(draft),
      id = paper.id,
      key = draftKey();
    try {
      await api(draft.id ? `/annotations/${draft.id}` : '/annotations', {
        method: draft.id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...draft,
          kind: draft.kind || 'note',
          anchor: draft.anchor || {},
          quote: draft.quote || '',
          color: draft.color || color,
          byline: byline(),
          document_id: id,
        }),
      });
      if (paper?.id !== id || JSON.stringify(draft) !== savedDraft) return;
      sessionStorage.removeItem(key);
      resetDraft();
      $('#reader-draft-status').textContent = '已保存到团队文献库';
      await sync(true);
    } catch (error) {
      if (paper?.id !== id) return;
      $('#reader-draft-status').textContent = `未保存：${error.message}`;
      if (error.status === 409) {
        $('#reader-conflict').textContent =
          `服务器最新内容：${error.details.current?.body || '（无文字）'}。你的草稿仍保留，可新建笔记另存。`;
        $('#reader-conflict').hidden = false;
      }
    } finally {
      $('#reader-save-note').disabled = false;
    }
  });
  $('#reader-record-filter').addEventListener('change', renderRecords);
  $('#reader-refresh-notes').addEventListener('click', () => sync(true));
  $('#reader-records').addEventListener('click', async (e) => {
    const jump = e.target.closest('[data-jump-record]'),
      edit = e.target.closest('[data-edit-record]'),
      remove = e.target.closest('[data-delete-record]');
    const id = jump?.dataset.jumpRecord || edit?.dataset.editRecord || remove?.dataset.deleteRecord;
    if (!id) return;
    const r = records.find((item) => item.id === id);
    if (jump) {
      focused = r.id;
      if (r.page) goPage(r.page);
      renderRecords();
      drawMarks();
    }
    if (edit) {
      if (dirty && !confirm('放弃当前未保存草稿并编辑这条记录？')) return;
      resetDraft(r);
      $('#reader-note-body').focus();
    }
    if (remove && confirm('删除这条共享记录？')) {
      try {
        await api(`/annotations/${r.id}`, {
          method: 'DELETE',
          body: JSON.stringify({ document_id: paper.id, version: r.version, byline: byline() }),
        });
        await sync(true);
      } catch (error) {
        toast(error.message);
      }
    }
  });
  function notesOpen(value) {
    root.classList.toggle('reader-notes-open', value);
    $('#reader-toggle-notes').setAttribute('aria-pressed', String(value));
  }
  $('#reader-toggle-notes').addEventListener('click', () =>
    notesOpen(!root.classList.contains('reader-notes-open')),
  );
  $('#reader-close-notes').addEventListener('click', () => notesOpen(false));
  notesOpen(innerWidth >= 1100);
  function download(blob, name) {
    const a = document.createElement('a'),
      url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $('#reader-download-pdf').addEventListener('click', async () => {
    try {
      const response = await fetch(`/api/library/documents/${paper.id}/pdf`);
      if (!response.ok) throw new Error('原 PDF 下载失败');
      download(await response.blob(), `chainlab-${paper.id}.pdf`);
    } catch (e) {
      toast(e.message);
    }
  });
  $('#reader-export-json').addEventListener('click', async () => {
    try {
      const data = await api(`/export?document_id=${paper.id}`);
      delete data.etag;
      download(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        `chainlab-notes-${paper.id}.json`,
      );
    } catch (e) {
      toast(e.message);
    }
  });
  $('#reader-export-notes').addEventListener('click', async () => {
    try {
      const data = await api(`/export?document_id=${paper.id}`);
      const md = [
        `# ${paper.title}`,
        paper.authors.join('，'),
        `原 PDF SHA-256: ${paper.pdf || '无附件'}`,
        ...data.annotations.map(
          (r) =>
            `\n## ${kinds[r.kind] || r.kind}${r.page ? ` · 第 ${r.page} 页` : ''}\n${r.author} · ${new Date(r.updated * 1000).toISOString()}\n${r.quote ? `> ${r.quote.replaceAll('\n', '\n> ')}\n` : ''}${r.body || '（原始标记，无文字）'}`,
        ),
      ].join('\n');
      download(
        new Blob([md], { type: 'text/markdown;charset=utf-8' }),
        `chainlab-notes-${paper.id}.md`,
      );
    } catch (e) {
      toast(e.message);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && reading) sync();
  });
  window.addEventListener('focus', () => {
    if (reading) sync();
  });
  window.addEventListener('beforeunload', (e) => {
    if (reading && (dirty || pendingMark)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  let resizeTimer,
    observedWidth = null;
  new ResizeObserver(([entry]) => {
    // Fit-width depends only on width; status/feedback height must not start another render.
    const width = entry.target.clientWidth;
    if (width === observedWidth) return;
    observedWidth = width;
    clearTimeout(resizeTimer);
    if (width > 0 && reading && pdf && $('#reader-zoom').value === 'fit')
      resizeTimer = setTimeout(renderPage, 180);
  }).observe($('#reader-paper-scroll'));
  return { open, close };
}
