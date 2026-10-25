import { createIcons, ArrowUpRight, ArrowLeft, RefreshCw, Search, Newspaper } from 'lucide';
import './briefing.css';
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const labels = { all: '全部', industry: '产业链', supply: '供应链', ai: 'AI 前沿' };
const date = (v) =>
  new Date(v).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
let data,
  visibleCount = 30,
  category = 'all',
  query = '';
document.querySelector('#app').innerHTML =
  `<header><a class="brand" href="/">链研 <span>CHAINLAB</span></a><nav><a href="/"><i data-lucide="arrow-left"></i>首页</a><a href="/workspace.html">科研工作台<i data-lucide="arrow-up-right"></i></a></nav></header><main><div class="edition"><span>THE CHAINLAB BRIEFING</span><span>每日 07:00 · 北京时间</span></div><section class="masthead"><div><h1>产业与 AI 早报<span>读懂变化的连接。</span></h1><p>产业链 / 供应链 / 人工智能前沿</p></div><div class="stamp"><i data-lucide="newspaper"></i><strong>72<span>HOURS</span></strong><span>全球议题 · 公开消息</span></div></section><p id="status" role="status">正在读取早报…</p><div class="toolbar"><div class="tabs" role="group" aria-label="新闻分类">${Object.entries(
    labels,
  )
    .map(([k, v]) => `<button data-category="${k}" aria-pressed="${k === 'all'}">${v}</button>`)
    .join(
      '',
    )}</div><label class="search"><i data-lucide="search"></i><input type="search" id="search" aria-label="搜索标题或来源" placeholder="搜索标题或来源"/></label><button id="refresh" title="重新读取早报" aria-label="重新读取早报"><i data-lucide="refresh-cw"></i></button></div><div class="columns"><section aria-label="早报新闻"><div class="list-heading"><h2>最近三天</h2><span id="count"></span></div><div id="stories"></div></section><aside><h2>本期观察</h2><div id="overview"></div><h2>采集口径</h2><p id="coverage">公开新闻订阅源，多地区版本检索。</p><p>时间按来源发布时间计算。收录不代表事实已被独立核实，研究发布也不等同于技术突破。</p><details><summary>来源与更新状态</summary><div id="sources"></div></details><a class="research-link" href="/workspace.html#knowledge">继续探索产业关联<i data-lucide="arrow-up-right"></i></a></aside></div><footer>CHAINLAB / NEWS DESK<span>标题索引 · 原始语言 · 不转载新闻全文</span></footer></main>`;
function icons() {
  createIcons({ icons: { ArrowUpRight, ArrowLeft, RefreshCw, Search, Newspaper } });
}
function render() {
  const rows = (data?.items || []).filter(
    (a) =>
      (category === 'all' || a.topics.includes(category)) &&
      `${a.title} ${a.source}`.toLowerCase().includes(query.toLowerCase()),
  );
  document.querySelector('#count').textContent = `${rows.length} 条`;
  document.querySelector('#stories').innerHTML =
    rows
      .slice(0, visibleCount)
      .map(
        (a, i) =>
          `<article><span class="number">${String(i + 1).padStart(2, '0')}</span><div><div class="meta"><span class="topic ${a.topics[0]}">${a.topics.map((t) => labels[t]).join(' · ')}</span><time datetime="${esc(a.published_at)}">${date(a.published_at)}</time></div><h3><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}<i data-lucide="arrow-up-right"></i></a></h3><p class="source">${esc(a.source)}<span>原文 / Google News 跳转</span></p></div></article>`,
      )
      .join('') || '<p class="empty">当前条件下没有最近 72 小时的消息。</p>';
  document
    .querySelectorAll('[data-category]')
    .forEach((b) => b.setAttribute('aria-pressed', b.dataset.category === category));
  icons();
  document.querySelector('#more').hidden = visibleCount >= rows.length;
}
async function load() {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  try {
    const r = await fetch('/api/briefing');
    if (!r.ok) throw Error('HTTP ' + r.status);
    data = await r.json();
    const states = {
      ready: '已更新',
      partial: '部分来源暂时不可用',
      stale: '更新延迟，以下仅保留有效时间窗内消息',
      pending: '首期早报正在采集',
    };
    document.querySelector('#status').textContent =
      `${states[data.status] || '已读取'}${data.generated_at ? ' · 最近采集 ' + date(data.generated_at) : ''} · 每日 07:00 自动采集`;
    document.querySelector('#overview').innerHTML =
      Object.entries(labels)
        .filter(([k]) => k !== 'all')
        .map(
          ([k, v]) =>
            `<button class="summary-row" data-category="${k}"><span>${v}</span><strong>${(data.items || []).filter((a) => a.topics.includes(k)).length}</strong></button>`,
        )
        .join('') + `<p>按发布时间排序，非热度排行榜。同一消息可能归入多个主题。</p>`;
    document.querySelector('#coverage').textContent = data.coverage || '首期数据尚未就绪。';
    document.querySelector('#sources').innerHTML = (data.last_attempt?.feeds || [])
      .map(
        (f) =>
          `<p>${esc(f.edition)} · ${labels[f.topic]}<br>${f.ok ? '采集成功 · ' + f.count + ' 条时间窗内记录' : '采集失败，等待下次更新'}</p>`,
      )
      .join('');
    render();
  } catch {
    document.querySelector('#status').textContent = '早报暂时无法读取，请稍后重试。';
    if (!data) document.querySelector('#stories').innerHTML = '<p class="empty">服务暂不可用</p>';
  } finally {
    button.disabled = false;
    icons();
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-category]');
  if (b) {
    category = b.dataset.category;
    visibleCount = 30;
    render();
  }
});
document.querySelector('#search').addEventListener('input', (e) => {
  query = e.target.value.trim();
  visibleCount = 30;
  render();
});
document.querySelector('#refresh').addEventListener('click', load);
document
  .querySelector('#stories')
  .insertAdjacentHTML(
    'afterend',
    '<button id="more" class="load-more" hidden>查看更多消息</button>',
  );
document.querySelector('#more').addEventListener('click', () => {
  visibleCount += 30;
  render();
});
icons();
load();
