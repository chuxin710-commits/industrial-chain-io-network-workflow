import {
  createIcons,
  Network,
  LayoutDashboard,
  Database,
  Workflow,
  FolderOpen,
  LibraryBig,
  FileCheck2,
  Github,
  ArrowUpRight,
  ArrowLeft,
  ArrowDownRight,
  ChevronRight,
  ChevronLeft,
  X,
  Menu,
  Info,
  Download,
  CalendarRange,
  MapPinned,
  Grid2x2,
  ListFilter,
  RotateCcw,
  Search,
  FileSpreadsheet,
  GitBranch,
  Activity,
  Terminal,
  FolderPlus,
  ShieldCheck,
  ClipboardList,
  PackageCheck,
  Copy,
  MessageCircle,
} from 'lucide';
import './workspace.css';
import { createTopologyPanel, topologyIcons } from './topology.js';
import { createLibraryPanel, libraryIcons } from './library.js';
import { createKnowledgePanel, knowledgeIcons } from './knowledge.js';
import { createMethodsPanel } from './methods.js';

const icons = {
  ...knowledgeIcons,
  ...libraryIcons,
  ...topologyIcons,
  Network,
  LayoutDashboard,
  Database,
  Workflow,
  FolderOpen,
  LibraryBig,
  FileCheck2,
  Github,
  ArrowUpRight,
  ArrowLeft,
  ArrowDownRight,
  ChevronRight,
  ChevronLeft,
  X,
  Menu,
  Info,
  Download,
  CalendarRange,
  MapPinned,
  Grid2x2,
  ListFilter,
  RotateCcw,
  Search,
  FileSpreadsheet,
  GitBranch,
  Activity,
  Terminal,
  FolderPlus,
  ShieldCheck,
  ClipboardList,
  PackageCheck,
  Copy,
  MessageCircle,
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const REPO = 'https://github.com/chuxin710-commits/industrial-chain-io-network-workflow';
const STORAGE_KEY = 'chainlab.database.v1';
const DEFAULT_FILTERS = {
  year: '2023',
  view: 'z',
  row_province: 'all',
  row_sector: 'all',
  col_province: 'all',
  col_sector: 'all',
};
const PANEL_LABELS = {
  overview: '数据总览',
  database: '投入产出数据库',
  topology: '网络拓扑',
  knowledge: '产业链知识图谱',
  methods: '方法体系',
  projects: '科研项目',
  literature: '团队文献',
  verification: '研究核验',
};
const VIEW_INFO = {
  z: { symbol: 'Z', title: '中间投入矩阵', direction: ['供给部门', '使用部门'] },
  f: { symbol: 'F', title: '最终需求矩阵', direction: ['供给部门', '最终需求账户'] },
  va: { symbol: 'VA', title: '增加值账户', direction: ['增加值账户', '生产部门'] },
  x: { symbol: 'x', title: '总产出', direction: ['生产部门', '总产出账户'] },
  full: { symbol: 'IO', title: '完整投入产出表', direction: ['原始行账户', '原始列账户'] },
};
const state = {
  catalog: null,
  filters: { ...DEFAULT_FILTERS },
  data: null,
  request: null,
  rowOffset: 0,
  colOffset: 0,
  rowLimit: 20,
  colLimit: 8,
  format: '2',
  heatmap: true,
  loading: false,
  exportLoading: false,
  cellValue: null,
  pendingForm: false,
};
let toastTimer;

function refreshIcons() {
  createIcons({ icons, attrs: { 'stroke-width': 1.7 } });
}
function escapeHTML(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}
function count(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}
function sourceFile(source) {
  return typeof source === 'string'
    ? source
    : source?.file || source?.filename || source?.name || '未提供文件名';
}
function catalogYear(year = state.filters.year) {
  return state.catalog?.years?.find((item) => String(item.year) === String(year));
}
function sourceHash(source, fallback) {
  return (typeof source === 'object' && source?.sha256) || fallback?.sha256 || '未提供';
}
function unitLabel(unit) {
  return !unit || /unknown|unverified|待核实|未知|未注明/i.test(unit)
    ? '金额单位：待核实'
    : `金额单位：${unit}`;
}
function entityCode(entity) {
  return typeof entity === 'object'
    ? (entity?.code ?? entity?.id ?? entity?.label ?? '')
    : (entity ?? '');
}
function entityLabel(entity, collection) {
  const code = String(entityCode(entity));
  const found = state.catalog?.[collection]?.find((item) => String(entityCode(item)) === code);
  return (
    (typeof found === 'object' && found?.label) ||
    (typeof entity === 'object' && entity?.label) ||
    code
  );
}
function accountParts(account) {
  const province = entityLabel(account?.province, 'provinces');
  const sector = entityLabel(account?.sector, 'sectors');
  const label = String(account?.label || account?.code || '未命名账户');
  return {
    province:
      province ||
      (['va', 'value_added'].includes(account?.kind)
        ? '增加值'
        : ['x', 'output'].includes(account?.kind)
          ? '总产出'
          : '其他账户'),
    sector:
      sector ||
      (province && label.startsWith(`${province} · `) ? label.slice(province.length + 3) : label),
    code: String(account?.code || ''),
    label,
  };
}
function externalLink(path, text, className = 'text-link') {
  return `<a class="${className}" href="${REPO}/${path}" target="_blank" rel="noopener noreferrer">${text}<i data-lucide="arrow-up-right"></i></a>`;
}
function heading(id, eyebrow, title, description, extra = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1 id="${id}">${title}</h1><p class="page-description">${description}</p></div>${extra}</div>`;
}
function frameworkNote(icon, title, text) {
  return `<div class="framework-note"><i data-lucide="${icon}"></i><div><strong>${title}</strong><p>${text}</p></div></div>`;
}
function renderFramework() {
  const projects = [
    [
      '01',
      'STRUCTURE & RESILIENCE',
      '产业链网络结构视角下我国产业韧性研究',
      '完全需求网络、互惠动力学、容量级联及敏感性分析。',
      ['结构诊断', '条件动力学', '核验记录'],
      'structure_resilience',
    ],
    [
      '02',
      'CRITICAL SECTORS & SHOCK SIMULATION',
      '投入产出网络中关键行业识别与产业链韧性提升',
      '直接投入网络、结构与冲击排名比较、有约束恢复实验。',
      ['关键行业', '冲击比较', '恢复策略'],
      'critical_sectors',
    ],
  ];
  const documents = [
    [
      'file-check-2',
      '数据契约审查',
      '数据结构、方向与口径',
      'docs/reviews/data_contract_review.md',
    ],
    [
      'file-check-2',
      '科学计算内核审查',
      '公式、边界条件与实现',
      'docs/reviews/scientific_kernel_review.md',
    ],
    [
      'file-check-2',
      '研究工作流审查',
      '复现、运行记录与交付流程',
      'docs/reviews/workflow_review.md',
    ],
    ['package-check', '研究案例发布说明', '现有案例与可复现材料', 'docs/RESEARCH_CASES_V1.md'],
  ];
  $('#framework-panels').innerHTML = `
    <section class="workspace-panel" id="panel-overview" data-workspace-panel="overview" aria-labelledby="overview-title" hidden>
      ${heading('overview-title', 'DATA OBSERVATORY / 00', '数据总览', '从年度数据到可追溯研究记录', '<a class="button button-primary" href="#database"><i data-lucide="database"></i>进入数据库</a>')}
      <div class="overview-metrics"><div><span>年度覆盖</span><strong id="overview-years">待载入</strong><small id="overview-period">2000-2023</small></div><div><span>区域维度</span><strong id="overview-provinces">待载入</strong><small>省级地区</small></div><div><span>行业维度</span><strong id="overview-sectors">待载入</strong><small>S 系列原始代码</small></div><div><span>最新年度矩阵</span><strong id="overview-shape">待载入</strong><small>原始表维度</small></div></div>
      <section class="workspace-section"><div class="section-heading"><h2>年度数据覆盖</h2><button class="inline-button" type="button" data-open-provenance>来源说明<i data-lucide="arrow-up-right"></i></button></div><div class="year-coverage" id="year-coverage"><p class="muted">数据目录连接后显示年度覆盖情况。</p></div></section>
      <section class="workspace-section"><div class="section-heading"><h2>研究工具链</h2><span class="subtle-label">首期框架</span></div><div class="toolchain-list">${[
        ['01', 'database', '数据整理', '年度表查询与来源记录', 'database', '数据入口'],
        ['02', 'workflow', '方法建模', '结构诊断与条件冲击模拟', 'methods', '文档入口'],
        ['03', 'folder-open', '科研项目', '研究案例与代码说明', 'projects', '案例入口'],
        ['04', 'file-check-2', '核验与交付', '核验记录与后续协作框架', 'verification', '报告入口'],
      ]
        .map(
          ([number, icon, title, description, panel, tag]) =>
            `<a href="#${panel}"><span class="step-number">${number}</span><i data-lucide="${icon}"></i><span><strong>${title}</strong><small>${description}</small></span><b class="state-tag">${tag}</b><i data-lucide="arrow-up-right"></i></a>`,
        )
        .join('')}</div></section>
    </section>
    <section class="workspace-panel" id="panel-methods" data-workspace-panel="methods" aria-labelledby="methods-title" hidden>
    </section>
    <section class="workspace-panel" id="panel-projects" data-workspace-panel="projects" aria-labelledby="projects-title" hidden>
      ${heading('projects-title', 'RESEARCH PROJECTS / 03', '科研项目', '已发布研究案例与可复现代码入口', '<span class="state-tag">2 个现有案例</span>')}
      <div class="project-list">${projects.map(([number, eyebrow, title, description, tags, folder]) => `<article class="project-row"><span class="project-number">${number}</span><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p>${description}</p><div class="project-tags">${tags.map((tag) => `<span>${tag}</span>`).join('')}</div></div>${externalLink(`tree/main/research/${folder}`, '研究案例', 'button button-outline case-link')}</article>`).join('')}</div>
      ${frameworkNote('folder-plus', '团队项目空间', '项目成员、运行记录和版本协作属于下一阶段；当前没有创建账号或云端项目。')}
    </section>
    <section class="workspace-panel" id="panel-literature" data-workspace-panel="literature" aria-labelledby="literature-title" hidden>
      ${heading('literature-title', 'TEAM LIBRARY / 04', '团队文献', '团队共同维护的研究依据', '<span class="state-tag">框架预留</span>')}
      <div class="library-columns" aria-hidden="true"><span>文献与标识</span><span>研究主题</span><span>阅读记录</span><span>来源</span></div><div class="workspace-empty"><i data-lucide="library-big"></i><h2>文献库尚未接入</h2><p>文献条目、主题标签、阅读记录与来源字段待建立。<br />当前没有虚构文献、引用数量或团队成员。</p>${externalLink('tree/main/research', '现有研究说明', 'button button-outline')}</div>
    </section>
    <section class="workspace-panel" id="panel-verification" data-workspace-panel="verification" aria-labelledby="verification-title" hidden>
      ${heading('verification-title', 'RESEARCH VERIFICATION / 05', '研究核验', '已有检查记录与研究边界', '<span class="state-tag">历史报告入口</span>')}
      <div class="verification-banner"><i data-lucide="shield-check"></i><div><h2>核验结论应当对应具体数据与代码版本</h2><p>以下链接指向仓库已有文档，不代表当前网站已重新执行全部研究实验。</p></div></div>
      <div class="document-list">${documents.map(([icon, title, subtitle, path]) => externalLink(`blob/main/${path}`, `<i data-lucide="${icon}"></i><span><strong>${title}</strong><small>${subtitle}</small></span>`, '')).join('')}</div>
      ${frameworkNote('clipboard-list', '投稿前检查清单与核验报告生成', '自动生成与在线签核尚未接入，将在后续迭代中补充。')}
    </section>`;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#workspace-toast').textContent = message;
  $('#workspace-toast').hidden = false;
  toastTimer = setTimeout(() => {
    $('#workspace-toast').hidden = true;
  }, 3800);
}
function serviceStatus(connected) {
  const status = $('#service-status');
  status.classList.toggle('is-connected', connected);
  status.classList.toggle('is-unavailable', !connected);
  status.lastElementChild.textContent = connected ? '数据服务已连接' : '数据服务暂不可用';
}
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  });
  if (!(response.headers.get('content-type') || '').includes('application/json'))
    throw new Error('数据服务尚未就绪，请稍后重试。');
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.detail || data.error || `数据读取失败（${response.status}）。`);
  return data;
}
function storePreferences() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        filters: state.filters,
        rowLimit: state.rowLimit,
        colLimit: state.colLimit,
        format: state.format,
        heatmap: state.heatmap,
      }),
    );
  } catch {
    /* Browsing remains usable when local storage is unavailable. */
  }
}
function restorePreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.filters = { ...DEFAULT_FILTERS, ...saved.filters };
    if ([20, 40, 60].includes(Number(saved.rowLimit))) state.rowLimit = Number(saved.rowLimit);
    if ([8, 12, 20].includes(Number(saved.colLimit))) state.colLimit = Number(saved.colLimit);
    if (['2', '4', 'scientific'].includes(saved.format)) state.format = saved.format;
    state.heatmap = saved.heatmap !== false;
  } catch {
    state.filters = { ...DEFAULT_FILTERS };
  }
  const url = new URL(location.href);
  for (const key of Object.keys(DEFAULT_FILTERS))
    if (url.searchParams.has(key)) state.filters[key] = url.searchParams.get(key);
  $('#row-limit').value = String(state.rowLimit);
  $('#col-limit').value = String(state.colLimit);
  $('#number-format').value = state.format;
  $('#heatmap-toggle').checked = state.heatmap;
}
function updateURL() {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(state.filters)) {
    if (String(value) === DEFAULT_FILTERS[key]) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash || '#database'}`);
}
function setPanel(panel, focus = false) {
  panel = panel.split('/')[0];
  if (!PANEL_LABELS[panel]) panel = 'database';
  $$('[data-workspace-panel]').forEach((element) => {
    element.hidden = element.dataset.workspacePanel !== panel;
  });
  $$('.workspace-nav [data-panel]').forEach((element) => {
    const active = element.dataset.panel === panel;
    element.classList.toggle('is-active', active);
    if (active) element.setAttribute('aria-current', 'page');
    else element.removeAttribute('aria-current');
  });
  $('#breadcrumb-current').textContent = PANEL_LABELS[panel];
  document.title = `${PANEL_LABELS[panel]} | 链研 CHAINLAB`;
  closeSidebar();
  if (focus) {
    $('#workspace-content').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}
function closeSidebar() {
  document.body.classList.remove('sidebar-is-open');
  $('.sidebar-backdrop').hidden = true;
  $('.menu-button').setAttribute('aria-expanded', 'false');
  $('#workspace-sidebar').inert = window.matchMedia('(max-width: 760px)').matches;
}
function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}
function optionHTML(value, label) {
  return `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`;
}
function updateFilterAvailability() {
  const view = $('#filter-view').value;
  const unavailable =
    view === 'va'
      ? ['row_province', 'row_sector']
      : view === 'x'
        ? ['col_province', 'col_sector']
        : view === 'f'
          ? ['col_sector']
          : [];
  for (const name of ['row_province', 'row_sector', 'col_province', 'col_sector']) {
    const element = $(`#database-filters [name="${name}"]`);
    element.disabled = unavailable.includes(name);
    if (element.disabled) element.value = 'all';
  }
}
function fillCatalog() {
  const { catalog } = state;
  const years = [...catalog.years].sort((a, b) => Number(b.year) - Number(a.year));
  const views = catalog.views?.length ? catalog.views : [{ id: 'z', label: '中间投入 Z' }];
  $('#filter-year').innerHTML = years
    .map((item) => optionHTML(item.year, `${item.year} 年`))
    .join('');
  $('#filter-view').innerHTML = views
    .map((item) => optionHTML(item.id || item.code, item.label))
    .join('');
  ['row', 'col'].forEach((axis) => {
    $(`#filter-${axis}-province`).innerHTML =
      optionHTML('all', '全部地区') +
      (catalog.provinces || [])
        .map((item) => optionHTML(entityCode(item), entityLabel(item, 'provinces')))
        .join('');
    $(`#filter-${axis}-sector`).innerHTML =
      optionHTML('all', '全部行业') +
      (catalog.sectors || [])
        .map((item) => optionHTML(entityCode(item), entityLabel(item, 'sectors')))
        .join('');
  });
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    const select = $(`#database-filters [name="${key}"]`);
    if (![...select.options].some((option) => option.value === String(state.filters[key])))
      state.filters[key] =
        key === 'year'
          ? String(years[0]?.year || '2023')
          : key === 'view'
            ? String(views[0]?.id || 'z')
            : 'all';
    select.value = String(state.filters[key]);
    select.disabled = false;
  }
  $('#reset-filters').disabled = false;
  $('#query-submit').disabled = false;
  updateFilterAvailability();
  state.filters = filtersFromForm();
  $('#catalog-count').textContent = count(years.length);
  $('#province-count').textContent = count(catalog.provinces?.length);
  $('#sector-count').textContent = count(catalog.sectors?.length);
  const period = years.length ? `${years[years.length - 1].year}-${years[0].year}` : '无可用年度';
  $('#dataset-period').textContent = period;
  $('#overview-period').textContent = period;
  $('#overview-years').textContent = count(years.length);
  $('#overview-provinces').textContent = count(catalog.provinces?.length);
  $('#overview-sectors').textContent = count(catalog.sectors?.length);
  $('#overview-shape').textContent =
    years[0]?.rows && years[0]?.columns
      ? `${count(years[0].rows)} × ${count(years[0].columns)}`
      : '未提供';
  $('#year-coverage').innerHTML = [...years]
    .reverse()
    .map(
      (item) =>
        `<button type="button" class="coverage-year" data-year="${escapeHTML(item.year)}"><span class="status-dot"></span><strong>${escapeHTML(item.year)}</strong><small>${item.rows && item.columns ? `${count(item.rows)} × ${count(item.columns)}` : '已收录'}</small></button>`,
    )
    .join('');
  refreshIcons();
  renderProvenance();
}
function tableState(kind, title, description) {
  $('#io-table').hidden = true;
  $('#table-state').hidden = false;
  $('#table-state').className = `table-state state-${kind}`;
  $('#table-state').setAttribute('role', kind === 'error' ? 'alert' : 'status');
  $('#table-state').innerHTML =
    `${kind === 'loading' ? '<span class="loading-spinner" aria-hidden="true"></span>' : `<i data-lucide="${kind === 'error' ? 'database' : 'search'}"></i>`}<h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p>${kind === 'error' ? '<button class="button button-outline" type="button" id="retry-data"><i data-lucide="rotate-ccw"></i>重新连接</button>' : ''}`;
  $('#table-container').setAttribute('aria-busy', String(kind === 'loading'));
  $('#export-csv').disabled = true;
  ['row-prev', 'row-next', 'col-prev', 'col-next'].forEach((id) => {
    $(`#${id}`).disabled = true;
  });
  refreshIcons();
}
function filtersFromForm() {
  const form = new FormData($('#database-filters'));
  return Object.fromEntries(
    Object.keys(DEFAULT_FILTERS).map((key) => [key, form.get(key) || DEFAULT_FILTERS[key]]),
  );
}
function queryParameters(includePage = true) {
  const params = new URLSearchParams(state.filters);
  if (includePage) {
    params.set('row_offset', state.rowOffset);
    params.set('col_offset', state.colOffset);
    params.set('row_limit', state.rowLimit);
    params.set('col_limit', state.colLimit);
  }
  return params;
}
function updateViewContext() {
  const view = VIEW_INFO[state.filters.view] || VIEW_INFO.full;
  $('.matrix-symbol').textContent = view.symbol;
  $('#matrix-title').textContent = view.title;
  $('#matrix-direction').innerHTML =
    `<i data-lucide="arrow-down-right"></i>行：${view.direction[0]} <span class="context-divider">/</span> 列：${view.direction[1]}`;
  $('#filter-context').textContent =
    state.filters.view === 'z'
      ? '按行供给、按列使用'
      : state.filters.view === 'f'
        ? '生产部门 × 最终需求账户'
        : state.filters.view === 'va'
          ? '增加值账户 × 生产部门'
          : state.filters.view === 'x'
            ? '生产部门 × 总产出'
            : '原始账户顺序';
  refreshIcons();
}
async function loadTable() {
  if (!state.catalog) return;
  state.request?.abort();
  const request = new AbortController();
  state.request = request;
  state.loading = true;
  state.data = null;
  state.pendingForm = false;
  $('#query-submit').classList.remove('has-changes');
  updateViewContext();
  tableState('loading', `正在读取 ${state.filters.year} 年数据`, '保留原始账户顺序与数值');
  $('#matrix-subtitle').textContent = `${state.filters.year} 年 · 查询中`;
  storePreferences();
  updateURL();
  try {
    const data = await jsonRequest(`/api/table?${queryParameters()}`, { signal: request.signal });
    if (request.signal.aborted) return;
    if (!Array.isArray(data.rows) || !Array.isArray(data.columns))
      throw new Error('数据服务返回的矩阵结构不完整。');
    state.data = data;
    state.rowOffset = Number(data.row_offset ?? state.rowOffset);
    state.colOffset = Number(data.col_offset ?? state.colOffset);
    state.loading = false;
    serviceStatus(true);
    renderTable();
    renderProvenance();
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.loading = false;
    serviceStatus(false);
    tableState('error', '暂时无法读取投入产出表', error.message || '请检查数据服务后重新连接。');
    $('#matrix-subtitle').textContent = `${state.filters.year} 年 · 数据未载入`;
    $('#query-announcement').textContent = `数据读取失败：${error.message}`;
  }
}
function formatValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'NA';
  if (
    state.format !== 'scientific' &&
    value !== 0 &&
    Math.abs(value) < 0.5 * 10 ** -Number(state.format)
  ) {
    return value.toExponential(Number(state.format));
  }
  return state.format === 'scientific'
    ? value.toExponential(3)
    : value.toLocaleString('en-US', {
        minimumFractionDigits: Number(state.format),
        maximumFractionDigits: Number(state.format),
      });
}
function groupColumns(columns) {
  const groups = [];
  columns.forEach((column) => {
    const label = accountParts(column).province;
    const previous = groups[groups.length - 1];
    if (previous?.label === label) previous.span += 1;
    else groups.push({ label, span: 1 });
  });
  return groups;
}
function renderTable() {
  const data = state.data;
  if (!data) return;
  const { rows, columns } = data;
  const totalRows = Number(data.total_rows || 0),
    totalColumns = Number(data.total_columns || 0);
  const pageRows = `${count(state.rowOffset + (rows.length ? 1 : 0))}-${count(state.rowOffset + rows.length)}`;
  const pageCols = `${count(state.colOffset + (columns.length ? 1 : 0))}-${count(state.colOffset + columns.length)}`;
  $('#matrix-subtitle').textContent =
    `${data.year || state.filters.year} 年 · ${count(totalRows)} 行 × ${count(totalColumns)} 列`;
  $('#unit-label').textContent = unitLabel(data.unit || catalogYear()?.unit);
  $('#row-range').textContent = `${pageRows} / ${count(totalRows)}`;
  $('#col-range').textContent = `${pageCols} / ${count(totalColumns)}`;
  $('#query-source').textContent = sourceFile(data.source || catalogYear()?.source);
  $('#query-source').title = sourceFile(data.source || catalogYear()?.source);
  if (!rows.length || !columns.length) {
    tableState('empty', '当前条件下没有匹配账户', '请调整地区、行业或数据分块后重新查询。');
    $('#query-announcement').textContent = '查询完成，没有匹配账户。';
    return;
  }
  if (!Array.isArray(data.values)) {
    tableState('error', '未获得矩阵数值', '数据目录存在，但本次未返回数值；未使用示例值替代。');
    return;
  }
  $('#table-state').hidden = true;
  $('#io-table').hidden = false;
  $('#table-container').setAttribute('aria-busy', 'false');
  $('#table-caption').textContent =
    `${data.year || state.filters.year} 年 ${VIEW_INFO[state.filters.view]?.title || '投入产出表'}；行 ${pageRows}；列 ${pageCols}；${unitLabel(data.unit || catalogYear()?.unit)}`;
  const rowTitles =
    state.filters.view === 'va'
      ? ['账户类别', '增加值账户']
      : state.filters.view === 'full'
        ? ['地区 / 类别', '行业 / 账户']
        : ['供给地区', '供给行业 / 账户'];
  $('#table-head').innerHTML =
    `<tr class="province-header"><th class="sticky-province" rowspan="2" scope="col">${rowTitles[0]}</th><th class="sticky-sector" rowspan="2" scope="col">${rowTitles[1]}</th>${groupColumns(
      columns,
    )
      .map(
        (group) => `<th scope="colgroup" colspan="${group.span}">${escapeHTML(group.label)}</th>`,
      )
      .join('')}</tr><tr class="sector-header">${columns
      .map((column) => {
        const part = accountParts(column);
        return `<th scope="col" title="${escapeHTML(`${part.label}${part.code ? ` (${part.code})` : ''}`)}"><span>${escapeHTML(part.sector)}</span></th>`;
      })
      .join('')}</tr>`;
  const magnitudes = data.values
    .flat()
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .map((value) => Math.abs(value));
  const maxLog = Math.log1p(Math.max(0, ...magnitudes));
  let previousProvince;
  $('#table-body').innerHTML = rows
    .map((row, rowIndex) => {
      const part = accountParts(row);
      const groupStart = rowIndex > 0 && part.province !== previousProvince;
      previousProvince = part.province;
      const numericCells = columns
        .map((column, columnIndex) => {
          const value = data.values[rowIndex]?.[columnIndex];
          const valid = typeof value === 'number' && Number.isFinite(value);
          const intensity =
            valid && value !== 0 && maxLog > 0
              ? (0.035 + (0.19 * Math.log1p(Math.abs(value))) / maxLog).toFixed(3)
              : 0;
          const tint =
            value < 0 ? `rgba(185, 92, 76, ${intensity})` : `rgba(33, 122, 91, ${intensity})`;
          const account = accountParts(column);
          return `<td class="value-cell${value === 0 ? ' value-zero' : ''}${value < 0 ? ' value-negative' : ''}" style="--cell-tint:${tint}"><button type="button" data-cell="${rowIndex},${columnIndex}" tabindex="${rowIndex === 0 && columnIndex === 0 ? '0' : '-1'}" aria-label="${escapeHTML(`${part.province} ${part.sector} 至 ${account.province} ${account.sector}，${valid ? String(value) : '缺失'}`)}" title="${escapeHTML(valid ? String(value) : '缺失数值')}">${escapeHTML(formatValue(value))}</button></td>`;
        })
        .join('');
      return `<tr${groupStart ? ' class="province-start"' : ''}><th scope="row" class="sticky-province" title="${escapeHTML(part.province)}">${escapeHTML(part.province)}</th><th scope="row" class="sticky-sector" title="${escapeHTML(`${part.label}${part.code ? ` (${part.code})` : ''}`)}">${escapeHTML(part.sector)}</th>${numericCells}</tr>`;
    })
    .join('');
  $('#io-table').classList.toggle('heatmap-enabled', state.heatmap);
  $('.table-legend').classList.toggle('is-disabled', !state.heatmap);
  $('#row-prev').disabled = state.rowOffset === 0;
  $('#row-next').disabled = state.rowOffset + rows.length >= totalRows;
  $('#col-prev').disabled = state.colOffset === 0;
  $('#col-next').disabled = state.colOffset + columns.length >= totalColumns;
  $('#export-csv').disabled = state.exportLoading || state.pendingForm;
  $('#table-footnote').textContent =
    state.format === 'scientific'
      ? '科学计数为显示格式，CSV 保留服务端数值'
      : '微小非零值用科学计数显示；CSV 不受显示精度影响';
  $('#query-announcement').textContent =
    `已载入 ${data.year || state.filters.year} 年数据，当前 ${rows.length} 行、${columns.length} 列，筛选共 ${totalRows} 行、${totalColumns} 列。`;
}
function metadataRows(entries) {
  return entries
    .map(
      ([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`,
    )
    .join('');
}
function renderProvenance() {
  const yearly = catalogYear(),
    source = state.data?.source || yearly?.source;
  $('#provenance-metadata').innerHTML = metadataRows([
    ['数据集', '中国省级多区域投入产出表（2D-LQ 法）'],
    ['当前年度', yearly?.year || state.filters.year],
    ['源文件', sourceFile(source)],
    ['SHA-256', sourceHash(source, yearly)],
    [
      '原始维度',
      yearly?.rows && yearly?.columns
        ? `${count(yearly.rows)} 行 × ${count(yearly.columns)} 列`
        : '未提供',
    ],
    ['金额单位', state.data?.unit || yearly?.unit || '未确认'],
    ['行业标签', '保留原始 S01-S42 行业代码，不猜测行业名称'],
  ]);
  const warnings = [
    '2005-2007 年的数据应单独核对跨年可比性，不自动解释为真实结构突变。',
    '金额单位、价格口径和 2D-LQ 编制来源未完整确认前，不作跨年金额增长或价格变化解释。',
    '当前浏览的是上传的投入产出表，不代表官方逐年实测或已经完成平衡校准。',
    ...(state.catalog?.warnings || []),
    ...(yearly?.warnings || []),
    ...(state.data?.warnings || []),
  ];
  $('#metadata-warnings').innerHTML = [
    ...new Set(
      warnings.map((warning) =>
        typeof warning === 'object'
          ? warning.message || warning.label || JSON.stringify(warning)
          : String(warning),
      ),
    ),
  ]
    .map((warning) => `<li>${escapeHTML(warning)}</li>`)
    .join('');
}
function showCell(rowIndex, columnIndex) {
  const data = state.data;
  if (!data) return;
  const row = accountParts(data.rows[rowIndex]),
    column = accountParts(data.columns[columnIndex]);
  const value = data.values[rowIndex]?.[columnIndex];
  state.cellValue = typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
  $('#cell-exact-value').textContent = state.cellValue ?? '缺失数值';
  $('#copy-cell-value').disabled = state.cellValue === null;
  $('#cell-metadata').innerHTML = metadataRows([
    [
      '年度 / 分块',
      `${data.year || state.filters.year} / ${VIEW_INFO[state.filters.view]?.title || state.filters.view}`,
    ],
    ['行账户', `${row.province} · ${row.sector}`],
    ['行代码', row.code || String(data.rows[rowIndex]?.index ?? '未提供')],
    ['列账户', `${column.province} · ${column.sector}`],
    ['列代码', column.code || String(data.columns[columnIndex]?.index ?? '未提供')],
    ['金额单位', data.unit || catalogYear()?.unit || '未确认'],
    ['源文件', sourceFile(data.source)],
    ['SHA-256', sourceHash(data.source, catalogYear())],
  ]);
  openDialog($('#cell-dialog'));
}
async function exportCSV() {
  if (state.exportLoading || !state.data) return;
  state.exportLoading = true;
  const exportFilters = { ...state.filters };
  const button = $('#export-csv');
  button.disabled = true;
  button.querySelector('span').textContent = '正在准备导出';
  try {
    const response = await fetch(`/api/export?${new URLSearchParams(exportFilters)}`, {
      headers: { Accept: 'text/csv' },
    });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('csv')) {
      const error = (response.headers.get('content-type') || '').includes('application/json')
        ? await response.json()
        : null;
      throw new Error(error?.detail || error?.error || 'CSV 导出暂不可用。');
    }
    const blob = await response.blob(),
      url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `chainlab-io-${exportFilters.year}-${exportFilters.view}-selection.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('CSV 已导出，包含当前筛选的全部行列，不限于当前页。');
  } catch (error) {
    toast(error.message || '导出失败，请稍后重试。');
  } finally {
    state.exportLoading = false;
    button.disabled = !state.data || state.pendingForm;
    button.querySelector('span').textContent = '导出查询 CSV';
  }
}
async function initializeCatalog() {
  tableState('loading', '正在读取数据目录', '连接年度投入产出数据服务');
  try {
    const catalog = await jsonRequest('/api/catalog');
    if (!Array.isArray(catalog.years) || !catalog.years.length)
      throw new Error('数据目录尚未收录可查询年度。');
    state.catalog = catalog;
    serviceStatus(true);
    fillCatalog();
    topology.setCatalog(catalog);
    knowledge.setCatalog(catalog);
    await loadTable();
  } catch (error) {
    serviceStatus(false);
    tableState('error', '数据目录暂不可用', error.message || '请稍后重新连接。');
    $('#matrix-subtitle').textContent = '没有使用模拟或示例数值';
    renderProvenance();
  }
}

renderFramework();
const topology = createTopologyPanel({ refreshIcons, toast });
const library = createLibraryPanel({ refreshIcons, toast });
const knowledge = createKnowledgePanel({ refreshIcons, toast });
createMethodsPanel({ refreshIcons, toast });
restorePreferences();
refreshIcons();
setPanel(location.hash.slice(1) || 'database');
window.addEventListener('hashchange', () => setPanel(location.hash.slice(1), true));
$('.menu-button').addEventListener('click', () => {
  const open = !document.body.classList.contains('sidebar-is-open');
  document.body.classList.toggle('sidebar-is-open', open);
  $('.sidebar-backdrop').hidden = !open;
  $('.menu-button').setAttribute('aria-expanded', String(open));
  $('#workspace-sidebar').inert = !open;
  if (open) $('.sidebar-close').focus();
});
$('.sidebar-close').addEventListener('click', closeSidebar);
$('.sidebar-backdrop').addEventListener('click', closeSidebar);
window.matchMedia('(max-width: 760px)').addEventListener('change', closeSidebar);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSidebar();
});
$$('[data-open-provenance]').forEach((button) =>
  button.addEventListener('click', () => {
    renderProvenance();
    openDialog($('#provenance-dialog'));
  }),
);
$$('[data-close-dialog]').forEach((button) =>
  button.addEventListener('click', () => button.closest('dialog').close()),
);
$$('.workspace-dialog').forEach((dialog) =>
  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      dialog.close();
  }),
);
$('#database-filters').addEventListener('change', (event) => {
  if (event.target.id === 'filter-view') updateFilterAvailability();
  state.pendingForm = true;
  $('#query-submit').classList.add('has-changes');
  $('#export-csv').disabled = true;
});
$('#database-filters').addEventListener('submit', (event) => {
  event.preventDefault();
  state.filters = filtersFromForm();
  state.rowOffset = 0;
  state.colOffset = 0;
  loadTable();
});
$('#reset-filters').addEventListener('click', () => {
  state.filters = { ...DEFAULT_FILTERS };
  state.rowOffset = 0;
  state.colOffset = 0;
  fillCatalog();
  loadTable();
});
$('#table-state').addEventListener('click', (event) => {
  if (event.target.closest('#retry-data')) state.catalog ? loadTable() : initializeCatalog();
});
$('#year-coverage').addEventListener('click', (event) => {
  const button = event.target.closest('[data-year]');
  if (!button) return;
  state.filters = { ...DEFAULT_FILTERS, year: button.dataset.year };
  state.rowOffset = 0;
  state.colOffset = 0;
  fillCatalog();
  location.hash = 'database';
  loadTable();
});
$('#number-format').addEventListener('change', (event) => {
  state.format = event.target.value;
  storePreferences();
  renderTable();
});
$('#heatmap-toggle').addEventListener('change', (event) => {
  state.heatmap = event.target.checked;
  $('#io-table').classList.toggle('heatmap-enabled', state.heatmap);
  $('.table-legend').classList.toggle('is-disabled', !state.heatmap);
  storePreferences();
});
['row', 'col'].forEach((axis) => {
  $(`#${axis}-prev`).addEventListener('click', () => {
    state[`${axis}Offset`] = Math.max(0, state[`${axis}Offset`] - state[`${axis}Limit`]);
    loadTable();
  });
  $(`#${axis}-next`).addEventListener('click', () => {
    state[`${axis}Offset`] += state[`${axis}Limit`];
    loadTable();
  });
  $(`#${axis}-limit`).addEventListener('change', (event) => {
    state[`${axis}Limit`] = Number(event.target.value);
    state[`${axis}Offset`] = 0;
    loadTable();
  });
});
$('#table-body').addEventListener('click', (event) => {
  const button = event.target.closest('[data-cell]');
  if (!button) return;
  $$('#table-body [data-cell][tabindex="0"]').forEach((element) => {
    element.tabIndex = -1;
  });
  button.tabIndex = 0;
  showCell(...button.dataset.cell.split(',').map(Number));
});
$('#table-body').addEventListener('keydown', (event) => {
  const button = event.target.closest('[data-cell]');
  if (
    !button ||
    !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
  )
    return;
  event.preventDefault();
  let [row, column] = button.dataset.cell.split(',').map(Number);
  if (event.key === 'ArrowUp') row = Math.max(0, row - 1);
  if (event.key === 'ArrowDown') row = Math.min(state.data.rows.length - 1, row + 1);
  if (event.key === 'ArrowLeft') column = Math.max(0, column - 1);
  if (event.key === 'ArrowRight') column = Math.min(state.data.columns.length - 1, column + 1);
  if (event.key === 'Home') column = 0;
  if (event.key === 'End') column = state.data.columns.length - 1;
  const target = $(`#table-body [data-cell="${row},${column}"]`);
  button.tabIndex = -1;
  target.tabIndex = 0;
  target.focus();
});
$('#export-csv').addEventListener('click', exportCSV);
$('#copy-cell-value').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.cellValue || '');
    toast('数值已复制。');
  } catch {
    toast('浏览器未开放剪贴板，可选中数值后复制。');
  }
});
initializeCatalog();
