import {
  Highlighter,
  Pencil,
  Square,
  Bookmark,
  StickyNote,
  MousePointer2,
  Save,
  Users,
  LogIn,
  LogOut,
  KeyRound,
  Lock,
  FileText,
  RefreshCw,
  BookOpen,
  Plus,
  Trash2,
  PanelRightClose,
  PanelRightOpen,
  PanelTop,
  Columns2,
} from 'lucide';
import './library.css';

export const libraryIcons = {
  Highlighter,
  Pencil,
  Square,
  Bookmark,
  StickyNote,
  MousePointer2,
  Save,
  Users,
  LogIn,
  LogOut,
  KeyRound,
  Lock,
  FileText,
  RefreshCw,
  BookOpen,
  Plus,
  Trash2,
  PanelRightClose,
  PanelRightOpen,
  PanelTop,
  Columns2,
};
export const safe = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s],
  );

export function createLibraryPanel({ refreshIcons, toast }) {
  const root = document.querySelector('#panel-literature'),
    $ = (s) => root.querySelector(s);
  let user = null,
    documents = [],
    page = 0,
    reader = null,
    initializing = false;
  root.innerHTML = `<div class="page-heading"><div><p class="eyebrow">TEAM LIBRARY <span>04</span></p><h1 id="literature-title">团队文献</h1><p class="page-description">产业链 · 投入产出 · 复杂网络</p></div><div class="library-user-tools" id="library-user-tools" hidden><span id="library-user-name"></span><button type="button" class="button button-quiet" id="library-members" hidden><i data-lucide="users"></i>成员管理</button><button type="button" class="icon-button" id="library-logout" title="退出登录" aria-label="退出登录"><i data-lucide="log-out"></i></button></div></div>
    <div id="library-login-view" class="library-login-view"><div class="library-login-brand"><i data-lucide="lock"></i><h2 id="library-auth-title">课题组文献库</h2><p id="library-auth-context">成员登录</p></div><form id="library-auth-form"><label class="field" id="library-invite-field" hidden><span>邀请口令</span><input id="library-invitation" autocomplete="off" /></label><label class="field"><span>账号</span><input id="library-username" autocomplete="username" minlength="3" maxlength="32" required /></label><label class="field" id="library-display-field" hidden><span>姓名 / 显示名称</span><input id="library-display-name" maxlength="40" autocomplete="name" /></label><label class="field"><span>密码</span><input id="library-password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required /></label><button class="button button-dark" type="submit" id="library-login-submit"><i data-lucide="log-in"></i><span>登录文献库</span></button><p id="library-auth-message" role="status"></p><button class="inline-button" id="library-switch-auth" type="button">使用成员邀请</button></form></div>
    <div id="library-content" hidden><div class="library-summary" id="library-summary"></div><div class="library-filters"><label class="library-search"><i data-lucide="search"></i><input id="library-search" type="search" placeholder="题名、作者、关键词" aria-label="检索文献" /></label><select id="library-collection" aria-label="文献分类"><option value="all">全部分类</option></select><select id="library-availability" aria-label="附件状态"><option value="all">全部条目</option><option value="pdf">有 PDF 附件</option><option value="missing">待补 PDF</option></select><button class="icon-button" id="library-refresh" type="button" title="刷新文献库" aria-label="刷新文献库"><i data-lucide="refresh-cw"></i></button></div><p id="library-status" class="library-status" role="status"></p><div class="library-table-wrap"><table class="library-table"><thead><tr><th>文献与作者</th><th>年份</th><th>分类</th><th>记录</th><th><span class="sr-only">打开文献</span></th></tr></thead><tbody id="library-list"></tbody></table></div><div class="library-pagination"><span id="library-result-count"></span><div><button type="button" id="library-prev" class="icon-button" title="上一页" aria-label="上一页"><i data-lucide="chevron-left"></i></button><span id="library-page"></span><button type="button" id="library-next" class="icon-button" title="下一页" aria-label="下一页"><i data-lucide="chevron-right"></i></button></div></div></div>
    <dialog class="workspace-dialog" id="library-members-dialog"><div class="dialog-heading"><div><p class="eyebrow">TEAM ACCESS</p><h2>课题组成员</h2></div><button class="icon-button" data-close-dialog type="button" aria-label="关闭"><i data-lucide="x"></i></button></div><div class="library-invite-controls"><select id="library-invite-role" aria-label="新成员角色"><option value="member">课题组成员</option><option value="admin">管理员</option></select><button id="library-create-invite" class="button button-dark" type="button"><i data-lucide="plus"></i>生成成员邀请</button></div><p id="library-invite-status" role="status"></p><div class="library-invite-output" id="library-invite-output" hidden><input id="library-invite-link" readonly aria-label="一次性成员邀请链接" /><button type="button" id="library-copy-invite" class="icon-button" title="复制邀请链接" aria-label="复制邀请链接"><i data-lucide="copy"></i></button></div><p class="library-invite-expiry" id="library-invite-expiry" hidden>邀请有效期 7 天，仅可使用一次。</p><div id="library-member-list"></div></dialog>`;

  async function api(path, options = {}) {
    const headers = {
      ...(options.body
        ? { 'Content-Type': 'application/json', 'X-CSRF-Token': user?.csrf || '' }
        : {}),
      ...options.headers,
    };
    const response = await fetch(`/api/library${path}`, { ...options, headers });
    if (response.status === 304) return { unchanged: true };
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || '请求失败');
      error.status = response.status;
      error.details = data;
      if (response.status === 401 && user) {
        user = null;
        reader?.close();
        setSession();
      }
      throw error;
    }
    return { ...data, etag: response.headers.get('ETag') };
  }
  function authMode(register) {
    root.dataset.register = String(register);
    $('#library-display-field').hidden = !register;
    $('#library-invite-field').hidden = !register;
    $('#library-display-name').required = register;
    $('#library-invitation').required = register;
    $('#library-invitation').value = '';
    $('#library-auth-title').textContent = register ? '加入课题组' : '课题组文献库';
    $('#library-auth-context').textContent = '课题组共享账号登录';
    $('#library-login-submit span').textContent = register ? '建立账号并登录' : '登录文献库';
    $('#library-switch-auth').textContent = register ? '已有账号，返回登录' : '使用成员邀请';
    $('#library-password').autocomplete = register ? 'new-password' : 'current-password';
    $('#library-password').minLength = 8;
    $('#library-switch-auth').hidden = true;
  }
  function setSession() {
    document.dispatchEvent(new CustomEvent('library-session-change'));
    $('#library-login-view').hidden = !!user;
    $('#library-content').hidden = !user;
    $('#library-user-tools').hidden = !user;
    if (user) {
      $('#library-user-name').textContent = user.display_name;
      $('#library-members').hidden = true;
    } else {
      documents = [];
      $('#library-list').innerHTML = '';
      $('#library-summary').textContent = '';
    }
  }
  async function loadCatalog() {
    $('#library-status').textContent = '正在读取团队文献';
    try {
      const data = await api('/documents');
      documents = data.documents;
      $('#library-summary').innerHTML =
        `<span><strong>${documents.length}</strong> 文献条目</span><span><strong>${data.pdf_count}</strong> PDF 附件</span><span><strong>${data.ai_status?.ready || 0}</strong> AI 概述</span><span class="library-private"><i data-lucide="lock"></i>课题组共享</span>`;
      const old = $('#library-collection').value;
      $('#library-collection').innerHTML =
        '<option value="all">全部分类</option>' +
        [...new Set(documents.map((d) => d.collection))]
          .map((c) => `<option value="${safe(c)}">${safe(c)}</option>`)
          .join('');
      if ([...$('#library-collection').options].some((o) => o.value === old))
        $('#library-collection').value = old;
      renderList();
      route();
      refreshIcons();
    } catch (e) {
      $('#library-status').textContent = e.message;
    }
  }
  function filtered() {
    const q = $('#library-search').value.trim().toLowerCase(),
      collection = $('#library-collection').value,
      availability = $('#library-availability').value;
    return documents.filter(
      (d) =>
        (collection === 'all' || d.collection === collection) &&
        (availability === 'all' ||
          (availability === 'pdf' && d.pdf) ||
          (availability === 'missing' && !d.pdf)) &&
        (!q ||
          [
            d.title,
            ...d.authors,
            ...d.tags,
            ...(d.ai?.tags || []),
            d.ai?.summary || '',
            d.journal,
            d.year,
          ]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    );
  }
  function renderList() {
    const result = filtered();
    page = Math.max(0, Math.min(page, Math.ceil(result.length / 20) - 1));
    $('#library-list').innerHTML =
      result
        .slice(page * 20, page * 20 + 20)
        .map(
          (d) =>
            `<tr><td><button type="button" class="library-paper" data-open-paper="${d.id}">${d.pdf ? `<img src="/api/library/documents/${d.id}/cover" loading="lazy" alt="" width="42" height="58" />` : '<span class="library-missing-cover"><i data-lucide="file-text"></i></span>'}<span><strong>${safe(d.title)}</strong><small>${safe(d.authors.length ? d.authors.join('，') : '作者未提供')}</small><small>${safe(d.journal || d.item_type)}${d.pdf ? ` · ${d.pages} 页` : ' · 原始库未附 PDF'}</small></span></button></td><td>${d.year || '—'}</td><td><span class="library-collection-label">${safe(d.collection)}</span></td><td>${d.annotation_count}</td><td><button class="icon-button" data-open-paper="${d.id}" type="button" title="${d.pdf ? '在线阅读' : '书目信息与笔记'}" aria-label="${d.pdf ? '在线阅读' : '书目信息与笔记'}"><i data-lucide="${d.pdf ? 'book-open' : 'sticky-note'}"></i></button></td></tr>`,
        )
        .join('') || '<tr><td colspan="5" class="library-no-results">没有匹配的文献</td></tr>';
    $('#library-status').textContent = result.length
      ? `${result.length} 条匹配文献`
      : '没有匹配的文献';
    $('#library-result-count').textContent =
      `${result.length ? page * 20 + 1 : 0}–${Math.min(result.length, (page + 1) * 20)} / ${result.length}`;
    $('#library-page').textContent = `${page + 1} / ${Math.max(1, Math.ceil(result.length / 20))}`;
    $('#library-prev').disabled = page === 0;
    $('#library-next').disabled = (page + 1) * 20 >= result.length;
    refreshIcons();
    $('#library-list')
      .querySelectorAll('tr')
      .forEach((row, index) => {
        const d = result[page * 20 + index];
        if (!d) return;
        const ai = d.ai;
        if (ai?.status === 'ready') {
          row.cells[0].insertAdjacentHTML(
            'beforeend',
            `<div class="library-ai"><div class="library-ai-tags"><span class="library-ai-label">AI 概述</span>${ai.tags.map((tag) => `<button type="button" class="library-ai-tag" data-ai-tag="${safe(tag)}">${safe(tag)}</button>`).join('')}</div><p>${safe(ai.summary)}</p><small>${safe(ai.model)} · ${ai.coverage?.ocr_pages ? '含 OCR 文本 · ' : ''}${ai.coverage?.sampled ? '节选文本分析' : '全文文本分析'} · 需结合原文核验</small></div>`,
          );
        } else if (d.pdf) {
          row.cells[0].insertAdjacentHTML(
            'beforeend',
            `<p class="library-ai-pending">${safe(ai?.status === 'needs_ocr' ? '待 OCR：文本层不足' : ai?.status === 'failed' ? 'AI 概述未完成，可正常阅读原文' : 'AI 概述待生成')}</p>`,
          );
        }
      });
  }
  $('#library-list').addEventListener('click', (event) => {
    const tag = event.target.closest('[data-ai-tag]');
    if (tag) {
      $('#library-search').value = tag.dataset.aiTag;
      page = 0;
      renderList();
    }
  });
  async function openPaper(id, pageNumber = 1) {
    const paper = documents.find((d) => d.id === id);
    if (!paper) return;
    if (!reader) {
      const { createLibraryReader } = await import('./library-reader.js');
      reader = createLibraryReader({
        api,
        getUser: () => user,
        refreshIcons,
        toast,
        onClose: () => {
          history.replaceState(null, '', `${location.pathname}${location.search}#literature`);
          if (user) loadCatalog();
        },
      });
    }
    await reader.open(paper, pageNumber);
  }
  function route() {
    if (!user || root.hidden) return;
    const match = location.hash.match(/^#literature\/read\/([a-f0-9]{32})(?:\/(\d+))?$/);
    if (match) openPaper(match[1], Number(match[2] || 1));
  }
  async function init() {
    if (initializing) return;
    initializing = true;
    try {
      const data = await api('/session');
      user = data.user;
      setSession();
      if (user) await loadCatalog();
      else authMode(false);
    } catch (e) {
      $('#library-auth-message').textContent = e.message;
    } finally {
      initializing = false;
    }
  }
  $('#library-auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const register = root.dataset.register === 'true';
    $('#library-login-submit').disabled = true;
    $('#library-auth-message').textContent = register ? '正在建立成员账号' : '正在登录';
    try {
      const data = await api(register ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: $('#library-username').value,
          password: $('#library-password').value,
          display_name: $('#library-display-name').value,
          invitation: $('#library-invitation').value,
        }),
      });
      user = data.user;
      $('#library-password').value = '';
      $('#library-invitation').value = '';
      $('#library-auth-message').textContent = '';
      setSession();
      await loadCatalog();
    } catch (error) {
      $('#library-auth-message').textContent = error.message;
    } finally {
      $('#library-login-submit').disabled = false;
    }
  });
  $('#library-switch-auth').addEventListener('click', () =>
    authMode(root.dataset.register !== 'true'),
  );
  $('#library-logout').addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: '{}' });
    } catch {}
    user = null;
    reader?.close(false);
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith('chainlab.library.draft.')) sessionStorage.removeItem(key);
    user = null;
    setSession();
  });
  for (const id of ['#library-search', '#library-collection', '#library-availability'])
    $(id).addEventListener(id === '#library-search' ? 'input' : 'change', () => {
      page = 0;
      renderList();
    });
  $('#library-prev').addEventListener('click', () => {
    page--;
    renderList();
  });
  $('#library-next').addEventListener('click', () => {
    page++;
    renderList();
  });
  $('#library-refresh').addEventListener('click', loadCatalog);
  $('#library-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-paper]');
    if (b) {
      location.hash = `literature/read/${b.dataset.openPaper}/1`;
    }
  });
  async function members() {
    try {
      const data = await api('/members');
      $('#library-member-list').innerHTML = data.members
        .map(
          (m) =>
            `<div class="library-member"><span><strong>${safe(m.display_name)}</strong><small>${safe(m.username)} · ${m.role === 'admin' ? '管理员' : '成员'}${m.disabled ? ' · 已停用' : ''}</small></span>${m.id !== user.id ? `<button class="button button-quiet" type="button" data-member="${m.id}" data-disabled="${!m.disabled}">${m.disabled ? '恢复' : '停用'}</button>` : ''}</div>`,
        )
        .join('');
    } catch (e) {
      $('#library-invite-status').textContent = e.message;
    }
  }
  $('#library-members').addEventListener('click', () => {
    members();
    $('#library-members-dialog').showModal();
  });
  $('#library-create-invite').addEventListener('click', async () => {
    try {
      const d = await api('/invitations', {
        method: 'POST',
        body: JSON.stringify({ role: $('#library-invite-role').value }),
      });
      $('#library-invite-link').value =
        `${location.origin}${location.pathname}#literature/invite/${d.invitation}`;
      $('#library-invite-output').hidden = false;
      $('#library-invite-expiry').hidden = false;
      $('#library-invite-status').textContent = '邀请已生成';
    } catch (e) {
      $('#library-invite-status').textContent = e.message;
    }
  });
  $('#library-copy-invite').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#library-invite-link').value);
      toast('邀请链接已复制。');
    } catch {
      $('#library-invite-link').select();
      toast('可直接复制选中的链接。');
    }
  });
  $('#library-member-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-member]');
    if (!b) return;
    try {
      await api('/members', {
        method: 'PATCH',
        body: JSON.stringify({
          user_id: b.dataset.member,
          disabled: b.dataset.disabled === 'true',
        }),
      });
      members();
    } catch (error) {
      $('#library-invite-status').textContent = error.message;
    }
  });
  window.addEventListener('hashchange', route);
  new MutationObserver(() => {
    if (!root.hidden) init();
    else reader?.close(false);
  }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  authMode(false);
  return { init };
}
