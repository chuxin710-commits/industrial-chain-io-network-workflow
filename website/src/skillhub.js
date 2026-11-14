import { Blocks, Star, Upload, FileCode2, ExternalLink, Heart, RefreshCw } from 'lucide';
import { safe } from './library.js';
import './skillhub.css';

export const skillhubIcons = { Blocks, Star, Upload, FileCode2, ExternalLink, Heart, RefreshCw };
const template = '---\nname: research-checklist\ndescription: 核查研究的数据来源、方法假设与复现记录。\n---\n\n# 研究核验\n\n1. 确认数据来源与版本。\n2. 核对方法假设和参数。\n3. 检查结果与复现记录。\n';

export function createSkillHub({ refreshIcons, toast }) {
  const root = document.createElement('section');
  root.className = 'workspace-panel skillhub';
  root.id = 'panel-skills';
  root.dataset.workspacePanel = 'skills';
  root.hidden = true;
  root.setAttribute('aria-labelledby', 'skillhub-title');
  document.querySelector('#framework-panels').append(root);
  const $ = (s) => root.querySelector(s);
  let items = [], user = null, tab = 'all', loaded = false, generation = 0, current = null;
  root.innerHTML = `<div class="page-heading"><div><p class="eyebrow">SKILLHUB / RESEARCH TOOLKIT</p><h1 id="skillhub-title">技能广场</h1><p class="page-description">开发、验证与研究工作流</p></div><button class="button button-primary" id="skill-upload"><i data-lucide="upload"></i>上传专属技能</button></div>
    <div class="sh-overview"><div><i data-lucide="blocks"></i><strong id="sh-total">—</strong><span>精选技能</span></div><div><i data-lucide="github"></i><strong id="sh-repos">—</strong><span>开源仓库</span></div><div class="sh-account"><span id="sh-user">尚未登录</span><button class="inline-button" id="sh-auth">登录</button></div></div>
    <div class="sh-toolbar"><div class="sh-tabs" role="tablist" aria-label="技能范围"><button role="tab" aria-selected="true" data-tab="all">精选技能</button><button role="tab" aria-selected="false" data-tab="favorites">我的收藏</button><button role="tab" aria-selected="false" data-tab="personal">专属技能</button></div><div class="sh-filters"><label class="sh-search"><i data-lucide="search"></i><input type="search" id="sh-search" aria-label="搜索技能" placeholder="搜索技能、用途或仓库" /></label><select id="sh-category" aria-label="技能分类"><option value="all">全部分类</option><option>研究规划</option><option>设计开发</option><option>质量验证</option><option>工具集成</option></select><select id="sh-sort" aria-label="技能排序"><option value="stars">仓库 Star 优先</option><option value="name">名称排序</option></select><button id="sh-refresh" class="icon-button" title="刷新技能列表" aria-label="刷新技能列表"><i data-lucide="refresh-cw"></i></button></div></div>
    <div class="sh-caption"><span id="sh-count"></span><span id="sh-date"></span></div><p class="sh-status" id="sh-status" role="status"></p><div id="sh-grid" class="sh-grid"></div>
    <p class="sh-footnote">Star 为来源仓库累计星标，非单个技能下载量或质量评分。专属技能属于当前账号；共用账号的成员共享可见。上传不自动安装或执行。</p>
    <dialog class="workspace-dialog sh-detail" id="sh-detail"><div class="dialog-heading"><div><p class="eyebrow" id="sh-detail-kind"></p><h2 id="sh-detail-title"></h2></div><button class="icon-button" data-sh-close aria-label="关闭技能详情" title="关闭"><i data-lucide="x"></i></button></div><p id="sh-detail-summary"></p><div id="sh-detail-links" class="sh-actions"></div><dl id="sh-detail-meta" class="sh-meta"></dl><pre id="sh-content" tabindex="0" aria-label="技能原文"></pre><div id="sh-detail-footer" class="sh-actions"></div></dialog>
    <dialog class="workspace-dialog sh-upload-dialog" id="sh-upload-dialog"><div class="dialog-heading"><div><p class="eyebrow">PERSONAL SKILL</p><h2>上传专属技能</h2></div><button class="icon-button" data-sh-close aria-label="关闭上传" title="关闭"><i data-lucide="x"></i></button></div><form id="sh-upload-form"><label class="sh-drop" id="sh-drop"><i data-lucide="upload"></i><strong>选择或拖入 SKILL.md</strong><span>UTF-8 · 最大 40 KB</span><input id="sh-file" type="file" accept=".md,text/markdown" aria-label="选择 SKILL.md" /></label><div class="sh-caption"><span id="sh-filename">尚未选择文件</span><button type="button" class="inline-button" id="sh-template">使用模板</button></div><label class="field"><span>技能原文</span><textarea id="sh-upload-content" spellcheck="false" required rows="12" aria-label="上传技能原文"></textarea></label><p id="sh-upload-status" role="status"></p><button class="button button-primary" id="sh-save" type="submit"><i data-lucide="upload"></i>保存技能</button></form></dialog>
    <dialog class="workspace-dialog sh-login" id="sh-login"><div class="dialog-heading"><h2>课题组账号登录</h2><button class="icon-button" data-sh-close aria-label="关闭登录" title="关闭"><i data-lucide="x"></i></button></div><form id="sh-login-form"><label class="field"><span>账号</span><input id="sh-username" autocomplete="username" required /></label><label class="field"><span>密码</span><input id="sh-password" type="password" autocomplete="current-password" required /></label><p id="sh-login-status" role="status"></p><button class="button button-primary" type="submit">登录</button></form></dialog>`;

  async function api(path, options = {}) {
    const response = await fetch(`/api/library${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': user?.csrf || '' } : {}), ...options.headers } });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) { user = null; items = items.filter(i => i.kind === 'curated'); render(); }
      throw new Error(data.error || '请求失败，请重试');
    }
    return data;
  }
  function needsLogin() {
    if (user) return false;
    $('#sh-login-status').textContent = '';
    $('#sh-login').showModal();
    return true;
  }
  function render() {
    const q = $('#sh-search').value.trim().toLowerCase(), category = $('#sh-category').value;
    const filtered = items.filter(i => (tab === 'all' ? i.kind === 'curated' : tab === 'favorites' ? i.favorite : i.kind === 'personal') && (category === 'all' || i.category === category) && (!q || [i.title, i.name, i.summary, i.repo].join(' ').toLowerCase().includes(q)));
    filtered.sort((a, b) => $('#sh-sort').value === 'stars' ? (b.stars || 0) - (a.stars || 0) || a.title.localeCompare(b.title, 'zh') : a.title.localeCompare(b.title, 'zh'));
    $('#sh-count').textContent = `${filtered.length} 个技能`;
    $('#sh-user').textContent = user ? `${user.display_name} · 账号空间` : '尚未登录';
    $('#sh-auth').textContent = user ? '退出' : '登录';
    $('#sh-total').textContent = items.filter(i => i.kind === 'curated').length;
    $('#sh-repos').textContent = new Set(items.filter(i => i.repo).map(i => i.repo)).size;
    $('#sh-grid').innerHTML = filtered.length ? filtered.map(i => `<article class="sh-card"><div class="sh-card-top"><span class="sh-skill-icon"><i data-lucide="${i.kind === 'personal' ? 'file-code-2' : 'blocks'}"></i></span><span class="sh-tag">${safe(i.category)}</span><button class="icon-button sh-favorite ${i.favorite ? 'is-on' : ''}" data-favorite="${safe(i.id)}" aria-pressed="${!!i.favorite}" title="${i.favorite ? '取消收藏' : '收藏技能'}" aria-label="${i.favorite ? '取消收藏' : '收藏技能'} ${safe(i.title)}"><i data-lucide="heart"></i></button></div><h2><button data-detail="${safe(i.id)}">${safe(i.title)}</button></h2><p class="sh-slug">${safe(i.name)}</p><p class="sh-description">${safe(i.summary)}</p><div class="sh-source"><span>${safe(i.repo || '账号专属')}</span>${i.stars != null ? `<span title="来源仓库星标"><i data-lucide="star"></i>${i.stars.toLocaleString()}</span>` : ''}</div><div class="sh-card-bottom"><button class="inline-button" data-detail="${safe(i.id)}">查看技能<i data-lucide="arrow-up-right"></i></button><button class="icon-button" data-download="${safe(i.id)}" title="下载 SKILL.md" aria-label="下载 ${safe(i.title)}"><i data-lucide="download"></i></button></div></article>`).join('') : `<div class="sh-empty"><i data-lucide="blocks"></i><h2>${!user && tab !== 'all' ? '登录后查看账号技能' : '暂时没有匹配的技能'}</h2>${tab === 'personal' ? '<button class="button button-outline" data-start-upload>上传 SKILL.md</button>' : ''}</div>`;
    refreshIcons();
  }
  async function load() {
    const revision = ++generation;
    $('#sh-status').textContent = '正在读取技能目录…';
    try {
      const session = await api('/session');
      const result = await api('/skills');
      if (revision !== generation) return;
      user = session.user; items = result.items; loaded = true;
      $('#sh-date').textContent = `Star 快照 · ${new Date(result.checked_at).toLocaleString('zh-CN', { hour12: false })}`;
      $('#sh-status').textContent = ''; render();
    } catch (error) { if (revision === generation) $('#sh-status').textContent = error.message; }
  }
  async function download(id) {
    const response = await fetch(`/api/library/skills/${encodeURIComponent(id)}/download`);
    if (!response.ok) throw new Error((await response.json()).error || '下载失败');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = 'SKILL.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function detail(id) {
    const revision = generation;
    const item = await api(`/skills/${encodeURIComponent(id)}`);
    if (revision !== generation) return;
    current = item;
    $('#sh-detail-title').textContent = item.title || item.name;
    $('#sh-detail-summary').textContent = item.summary;
    $('#sh-detail-kind').textContent = item.kind === 'curated' ? 'OPEN SOURCE SKILL' : 'PERSONAL SKILL';
    $('#sh-content').textContent = item.content;
    $('#sh-detail-meta').innerHTML = `<dt>SHA-256</dt><dd>${safe(item.sha256)}</dd>` + (item.repo ? `<dt>仓库</dt><dd>${safe(item.repo)}</dd><dt>版本</dt><dd>${safe(item.commit)}</dd><dt>许可</dt><dd>${safe(item.license)} · 以原仓库及技能目录许可为准</dd>` : '<dt>可见范围</dt><dd>当前账号（共享账号成员共同可见）</dd>');
    $('#sh-detail-links').innerHTML = item.source ? `<a class="text-link" href="${safe(item.source)}" target="_blank" rel="noopener noreferrer">GitHub 原文<i data-lucide="external-link"></i></a><a class="text-link" href="${safe(item.archive)}" target="_blank" rel="noopener noreferrer">完整仓库 ZIP<i data-lucide="download"></i></a><details class="sh-license"><summary>开源许可</summary><pre>${safe(item.license_text)}</pre></details>` : '';
    $('#sh-detail-footer').innerHTML = `<button class="button button-primary" data-download="${safe(id)}"><i data-lucide="download"></i>下载 SKILL.md</button>${item.kind === 'personal' ? '<button class="button button-outline" id="sh-delete"><i data-lucide="trash-2"></i>删除技能</button>' : '<span class="sh-dependency-note">脚本、引用文件与许可见完整仓库。</span>'}`;
    $('#sh-detail').showModal(); refreshIcons();
  }
  function upload() {
    if (needsLogin()) return;
    $('#sh-upload-status').textContent = '';
    $('#sh-upload-dialog').showModal();
  }
  async function readFile(file) {
    if (!file) return;
    if (file.name.toLowerCase() !== 'skill.md' || file.size > 40000) throw new Error('请选择不超过 40 KB 的 SKILL.md');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    $('#sh-upload-content').value = content;
    $('#sh-filename').textContent = `${file.name} · ${file.size.toLocaleString()} bytes`;
    $('#sh-upload-status').textContent = '';
  }
  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    try {
      if (button.hasAttribute('data-sh-close')) button.closest('dialog').close();
      if (button.dataset.tab) {
        tab = button.dataset.tab; $('#sh-category').value = 'all';
        root.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b === button))); render();
      }
      if (button.dataset.detail) await detail(button.dataset.detail);
      if (button.dataset.download) await download(button.dataset.download);
      if (button.dataset.favorite && !needsLogin()) {
        const item = items.find(i => i.id === button.dataset.favorite);
        button.disabled = true;
        await api(`/skills/${item.id}/favorite`, { method: 'POST', body: JSON.stringify({ enabled: !item.favorite }) });
        item.favorite = !item.favorite; render();
      }
      if (button.id === 'skill-upload' || button.hasAttribute('data-start-upload')) upload();
      if (button.id === 'sh-refresh') await load();
      if (button.id === 'sh-auth') {
        if (!needsLogin()) { await api('/auth/logout', { method: 'POST', body: '{}' }); document.dispatchEvent(new CustomEvent('library-session-change')); await load(); }
      }
      if (button.id === 'sh-template') { $('#sh-upload-content').value = template; $('#sh-filename').textContent = 'SKILL.md · 新建模板'; }
      if (button.id === 'sh-delete' && current && confirm(`删除技能「${current.name}」？此操作不可撤销。`)) {
        await api(`/skills/${current.id}`, { method: 'DELETE', body: '{}' }); $('#sh-detail').close(); await load(); toast('技能已删除');
      }
    } catch (error) { toast(error.message); } finally { button.disabled = false; }
  });
  $('#sh-search').addEventListener('input', render);
  $('#sh-category').addEventListener('change', render);
  $('#sh-sort').addEventListener('change', render);
  $('#sh-file').addEventListener('change', async event => { try { await readFile(event.target.files[0]); } catch (e) { $('#sh-upload-status').textContent = e.message; } });
  $('#sh-drop').addEventListener('dragover', e => e.preventDefault());
  $('#sh-drop').addEventListener('drop', async e => { e.preventDefault(); try { await readFile(e.dataTransfer.files[0]); } catch (error) { $('#sh-upload-status').textContent = error.message; } });
  $('#sh-upload-form').addEventListener('submit', async e => {
    e.preventDefault(); $('#sh-save').disabled = true;
    try {
      await api('/skills', { method: 'POST', body: JSON.stringify({ filename: 'SKILL.md', content: $('#sh-upload-content').value }) });
      $('#sh-upload-dialog').close(); $('#sh-upload-form').reset(); $('#sh-filename').textContent = '尚未选择文件';
      root.querySelector('[data-tab="personal"]').click(); await load(); toast('技能已保存');
    } catch (error) { $('#sh-upload-status').textContent = error.message; } finally { $('#sh-save').disabled = false; }
  });
  $('#sh-login-form').addEventListener('submit', async e => {
    e.preventDefault(); const submit = e.submitter; submit.disabled = true;
    try {
      const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#sh-username').value, password: $('#sh-password').value }) });
      user = result.user; $('#sh-password').value = ''; $('#sh-login').close();
      document.dispatchEvent(new CustomEvent('library-session-change')); await load();
    } catch (error) { $('#sh-login-status').textContent = error.message; } finally { submit.disabled = false; }
  });
  function route() { if (location.hash.split('/')[0] === '#skills' && !loaded) load(); }
  document.addEventListener('library-session-change', () => {
    generation++; loaded = false; user = null; current = null; items = [];
    $('#sh-detail').close(); $('#sh-upload-dialog').close();
    for (const id of ['sh-content', 'sh-detail-title', 'sh-detail-summary', 'sh-detail-meta', 'sh-detail-links', 'sh-detail-footer']) $(`#${id}`).textContent = '';
    $('#sh-upload-form').reset(); $('#sh-filename').textContent = '尚未选择文件'; render(); route();
  });
  window.addEventListener('hashchange', route);
  route();
}
