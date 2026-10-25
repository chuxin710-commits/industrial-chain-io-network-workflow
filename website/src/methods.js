import { methods, stages, sources } from './method-catalog.js';
import demo from './method-demo.json' with { type: 'json' };
import './methods.css';
import { createMethodTutor } from './method-tutor.js';

const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s],
  );
const icon = (name) => `<i data-lucide="${name}"></i>`;
const format = (n) => Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 5 });
const REPO = 'https://github.com/chuxin710-commits/industrial-chain-io-network-workflow';
const repository = (path) => `${REPO}/blob/${sources.repositoryCommit}/${path}`;
export function handbookMarkdown() {
  return [
    '# 链研方法体系',
    '\n数据口径 → 网络构建 → 结构诊断 → 冲击与恢复 → 结果核验',
    '\n网站数据：2000–2023；两篇离线案例：2009–2023。示例为合成数据，不是实证结果。',
    ...methods.map(
      (m) =>
        `\n## ${m.title}\n\n状态：${m.status}\n\n${m.purpose}\n\n输入：${m.input}\n\n输出：${m.output}\n` +
        m.formulas.map((f) => `\n### ${f.label}\n\n$$\n${f.tex}\n$$\n\n${f.note}\n`).join('') +
        '\n### 符号\n\n' +
        m.symbols.map(([s, d]) => `- $${s}$：${d}`).join('\n') +
        '\n\n### 参数\n\n' +
        m.parameters.map(([k, v]) => `- ${k}：${v}`).join('\n') +
        (m.steps
          ? '\n\n### 计算顺序\n\n' + m.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
          : '') +
        '\n\n### 使用边界\n\n' +
        m.boundaries.map((v) => `- ${v}`).join('\n') +
        '\n\n### 来源\n\n' +
        m.source
          .map((p) => `- ${p}；SHA-256：${sources.files.find((s) => s.path === p).sha256}`)
          .join('\n') +
        '\n' +
        (m.refs || []).map(([t, u]) => `- [${t}](${u})`).join('\n'),
    ),
    '\n## 来源清单\n\n```json\n' + JSON.stringify(sources, null, 2) + '\n```',
  ].join('\n');
}

export function createMethodsPanel({ refreshIcons, toast }) {
  const panel = document.querySelector('#panel-methods');
  const tutor = createMethodTutor({ refreshIcons });
  panel.innerHTML = `<div class="page-heading"><div><p class="eyebrow">METHODS / FROM DATA TO EVIDENCE</p><h1 id="methods-title">方法体系</h1><p class="page-description">统一口径，明确机制，让结果可以复核。</p></div><button id="method-export" class="button button-outline" type="button">${icon('download')}方法手册</button></div>
    <nav class="method-route" aria-label="研究步骤">${stages.map((s, i) => `<button type="button" data-stage="${s.id}" style="--stage-color:${s.color}"><span>${String(i + 1).padStart(2, '0')}</span><strong>${s.title}</strong>${i < stages.length - 1 ? icon('chevron-right') : ''}</button>`).join('')}</nav>
    <div class="method-heading-line"><span id="method-question"></span><span>网站 2000–2023 <b>·</b> 离线案例 2009–2023</span></div>
    <div class="method-layout"><aside class="method-index-nav"><label class="method-search">${icon('search')}<input id="method-search" type="search" placeholder="搜索公式或方法" aria-label="搜索公式或方法" /></label><div id="method-topics"></div><a class="method-all-symbols" href="#methods/audit">${icon('file-check-2')}核验与复现记录</a></aside><div id="method-content" aria-live="polite"><p class="method-loading">正在准备方法说明…</p></div></div>`;
  const $ = (s) => panel.querySelector(s);
  const state = {
    id: 'contract',
    stage: 'data',
    search: '',
    token: 0,
    demoCell: [0, 1],
    math: null,
  };
  let mathPromise;
  function route() {
    if (location.hash.split('/')[0] !== '#methods') return;
    const requested = location.hash.split('/')[1] || 'contract';
    state.id = methods.some((m) => m.id === requested) ? requested : 'contract';
    state.stage = methods.find((m) => m.id === state.id).stage;
    render();
  }
  function topicNav() {
    const query = state.search.toLowerCase();
    const items = methods.filter((m) =>
      query
        ? [m.title, m.purpose, ...m.formulas.map((f) => f.label), ...m.symbols.map((s) => s[1])]
            .join(' ')
            .toLowerCase()
            .includes(query)
        : m.stage === state.stage,
    );
    $('#method-topics').innerHTML =
      items
        .map(
          (m) =>
            `<a href="#methods/${m.id}" ${state.id === m.id ? 'aria-current="page"' : ''}><span>${esc(m.title)}</span><small>${query ? esc(stages.find((s) => s.id === m.stage).title) + ' · ' : ''}${m.status}</small></a>`,
        )
        .join('') || '<p class="method-no-match">没有匹配的方法</p>';
    panel
      .querySelectorAll('[data-stage]')
      .forEach((b) =>
        b.setAttribute('aria-current', b.dataset.stage === state.stage ? 'step' : 'false'),
      );
  }
  async function render() {
    const token = ++state.token,
      method = methods.find((m) => m.id === state.id);
    topicNav();
    $('#method-question').textContent = stages.find((s) => s.id === state.stage).question;
    try {
      mathPromise ||= import('./method-math.js');
      state.math = (await mathPromise).math;
      if (token !== state.token) return;
      const math = state.math;
      $('#method-content').innerHTML = `<article class="method-article" data-method="${method.id}">
        <header class="method-article-header"><div><p class="eyebrow">${stages.find((s) => s.id === state.stage).title}</p><h2>${method.title}</h2></div><span class="method-state ${method.status.includes('已接入') ? 'online' : ''}">${method.status}</span></header>
        <p class="method-purpose">${method.purpose}</p>
        <button type="button" class="button button-outline method-explain" data-explain-method>AI 解释这个方法${icon('message-circle')}</button>
        <div class="method-io"><div><span>输入</span><p>${method.input}</p></div><span class="method-io-arrow">→</span><div><span>输出</span><p>${method.output}</p></div></div>
        <section class="method-formulas" aria-label="公式与解释">${method.formulas.map((f, i) => `<div class="method-formula-row"><div class="method-formula-title"><h3>${f.label}</h3><div class="method-formula-actions"><button type="button" class="button button-outline method-explain" data-explain-formula="${i}" aria-label="AI 解释 ${esc(f.label)}">${icon('message-circle')}AI 解释</button><button type="button" class="icon-button" data-copy-formula="${i}" title="复制 LaTeX 公式" aria-label="复制 ${esc(f.label)} LaTeX 公式">${icon('copy')}</button></div></div><div class="method-math" tabindex="0" role="region" aria-label="${esc(f.label)}">${math(f.tex)}</div><p>${f.note}</p></div>`).join('')}</section>
        <details class="method-symbols" open><summary>符号定义 <span>${method.symbols.length}</span></summary><dl>${method.symbols.map(([s, d]) => `<div><dt>${math(s, false)}</dt><dd>${d}</dd></div>`).join('')}</dl></details>
        ${method.demo ? `<section class="method-example" aria-labelledby="method-example-title"><div class="method-example-head"><h3 id="method-example-title">三部门演算</h3><span>合成数据 · 非实证结果</span></div><div id="method-demo"></div></section>` : ''}
        <section class="method-parameters"><h3>参数与实现约定</h3><dl>${method.parameters.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>
        ${method.steps ? `<section class="method-steps"><h3>计算顺序</h3><ol>${method.steps.map((s) => `<li>${s}</li>`).join('')}</ol></section>` : ''}
        <section class="method-limits"><h3>${icon('info')}适用边界</h3>${method.boundaries.map((b) => `<p>${b}</p>`).join('')}</section>
        <footer class="method-evidence"><div><h3>实现与来源</h3><div class="method-links">${method.source.map((path) => (path.startsWith('website/') ? `<span class="method-code-path">${esc(path)} · 网站适配器</span>` : `<a href="${repository(path)}" target="_blank" rel="noopener">${esc(path)}${icon('arrow-up-right')}</a>`)).join('')}${(method.refs || []).map(([title, url]) => `<a href="${url}" target="_blank" rel="noopener">${title}${icon('arrow-up-right')}</a>`).join('')}</div></div><div class="method-app-links">${(method.links || []).map(([title, url]) => `<a class="button button-outline" href="${url}">${title}${icon('arrow-up-right')}</a>`).join('')}</div></footer>
        <details class="method-version"><summary>来源版本与文件校验</summary><p>仓库来源基线：<code>${sources.repositoryCommit}</code></p><p>下列哈希对应本页制作时的本地源码；不意味着页面执行了实证计算。</p>${method.source.map((path) => `<dl><dt>${esc(path)}</dt><dd>${sources.files.find((f) => f.path === path).sha256}</dd></dl>`).join('')}</details>
        <div class="method-pager">${methods.indexOf(method) > 0 ? `<a href="#methods/${methods[methods.indexOf(method) - 1].id}">${icon('chevron-left')}上一方法</a>` : '<span></span>'}${methods.indexOf(method) < methods.length - 1 ? `<a href="#methods/${methods[methods.indexOf(method) + 1].id}">下一方法${icon('chevron-right')}</a>` : '<a href="#methods/contract">返回数据口径</a>'}</div>
      </article>`;
      if (method.demo) renderDemo(method.demo);
      refreshIcons();
      panel.dataset.ready = method.id;
    } catch (error) {
      if (token !== state.token) return;
      $('#method-content').innerHTML = '<p role="alert">公式模块暂时不可用，请刷新重试。</p>';
      console.error(error);
    }
  }
  function renderDemo(kind) {
    const host = $('#method-demo');
    const matrixMode = kind === 'matrix';
    host.innerHTML = `<div class="method-example-grid">${matrixMode ? `<div class="method-matrix-wrap"><p class="method-mini-label">Z · 行供给 / 列使用</p><div class="method-matrix">${['', ...demo.labels].map((s) => `<span>${s}</span>`).join('')}${demo.Z.map((row, i) => `<span>${demo.labels[i]}</span>${row.map((v, j) => `<button type="button" data-demo-cell="${i},${j}" aria-label="${demo.labels[i]} 到 ${demo.labels[j]}，Z=${v}">${v}</button>`).join('')}`).join('')}</div><p class="method-demo-output">x = [${demo.x.join(', ')}]</p><div id="method-demo-equation" class="method-demo-equation"></div></div>` : `<div class="method-demo-controls"><label>阈值 τ <output id="method-tau-label"></output><input id="method-tau" type="range" min="0" max="4" step="1" value="1" /></label>${kind === 'recovery' ? '<label>V 关联交易削减 <output id="method-shock-label"></output><input id="method-shock" type="range" min="0" max="4" step="1" value="2" /></label><label>恢复预算 / 受损交易 <output id="method-budget-label"></output><input id="method-budget" type="range" min="0" max="4" step="1" value="2" /></label>' : ''}<div id="method-demo-values"></div></div>`}<div><svg id="method-demo-graph" viewBox="0 0 360 235" role="img" aria-label="三部门计算示例的有向关系"></svg><div id="method-demo-caption"></div></div></div>`;
    function update() {
      const tau = matrixMode ? 0 : [0, 0.04, 0.08, 0.12, 0.16][Number($('#method-tau').value)];
      const fraction =
        kind === 'recovery' ? [0, 0.25, 0.5, 0.75, 1][Number($('#method-shock').value)] : 0;
      const share =
        kind === 'recovery' ? [0, 0.1, 0.2, 0.5, 1][Number($('#method-budget').value)] : 0;
      const frame = demo.frames.find(
        (f) => f.threshold === tau && f.fraction === fraction && f.share === share,
      );
      const weights = kind === 'recovery' ? frame.recovered : frame.base;
      const [i, j] = state.demoCell;
      if (matrixMode) {
        host
          .querySelectorAll('[data-demo-cell]')
          .forEach((b) =>
            b.setAttribute('aria-pressed', String(b.dataset.demoCell === `${i},${j}`)),
          );
        $('#method-demo-equation').innerHTML = state.math(
          `a_{${demo.labels[i]}${demo.labels[j]}}=\\frac{${demo.Z[i][j]}}{${demo.x[j]}}\\approx ${format(demo.A[i][j])}`,
        );
      } else {
        $('#method-tau-label').textContent = tau.toFixed(2);
        if (kind === 'recovery') {
          $('#method-shock-label').textContent = `${fraction * 100}%`;
          $('#method-budget-label').textContent = `${share * 100}%`;
          const maximum = Math.max(...frame.efficiency, 1e-12);
          $('#method-demo-values').innerHTML =
            `<p>受损交易 ${format(frame.loss)} · 恢复预算 ${format(frame.budget)}</p><div class="method-e-bars">${frame.efficiency.map((v, n) => `<div><span>${['基准 C', '受损 C', '恢复 C'][n]}</span><i style="--bar:${(100 * v) / maximum}%;--bar-color:${['#538d80', '#bd8370', '#627da6'][n]}"></i><b>${format(v)}</b></div>`).join('')}</div>`;
        } else
          $('#method-demo-values').innerHTML =
            `<p>保留 ${weights.flat().filter((v) => v > 0).length} 条非自环边</p><p>加权效率 C = ${format(frame.efficiency[0])}</p>`;
      }
      const pos = [
        [65, 65],
        [295, 65],
        [180, 195],
      ];
      let svg =
        '<defs><marker id="method-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>';
      for (let u = 0; u < 3; u++)
        for (let v = 0; v < 3; v++) {
          if (u === v || weights[u][v] <= 0) continue;
          const [ax, ay] = pos[u],
            [bx, by] = pos[v],
            dx = bx - ax,
            dy = by - ay,
            d = Math.hypot(dx, dy),
            nx = -dy / d,
            ny = dx / d;
          const sx = ax + (dx / d) * 24 + nx * 5,
            sy = ay + (dy / d) * 24 + ny * 5,
            tx = bx - (dx / d) * 26 + nx * 5,
            ty = by - (dy / d) * 26 + ny * 5;
          const cx = (sx + tx) / 2 + nx * 16,
            cy = (sy + ty) / 2 + ny * 16;
          const selected = matrixMode && u === i && v === j;
          svg += `<path d="M${sx},${sy} Q${cx},${cy} ${tx},${ty}" fill="none" stroke="${selected ? '#bb7643' : '#8ab3a8'}" stroke-width="${selected ? 3 : 1.5}" marker-end="url(#method-arrow)"/><text x="${cx + nx * 10}" y="${cy + ny * 10}" text-anchor="middle" font-size="11" fill="#47685c">${weights[u][v].toFixed(3)}</text>`;
        }
      svg += pos
        .map(
          ([x, y], n) =>
            `<circle cx="${x}" cy="${y}" r="21" fill="${n === 1 && kind === 'recovery' ? '#bd8370' : '#2e7b6a'}"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" fill="white">${demo.labels[n]}</text>`,
        )
        .join('');
      $('#method-demo-graph').innerHTML = svg;
      $('#method-demo-caption').textContent = matrixMode
        ? i === j
          ? '完整 A 保留自身投入；图中不绘制自环。'
          : `${demo.labels[i]} → ${demo.labels[j]}；分母取使用方 ${demo.labels[j]} 的 x。`
        : kind === 'recovery'
          ? '同一基准支持集 · x 固定 · 按损失比例恢复'
          : 'A ≥ τ 且为正；不含自环。';
      host.dataset.frame = JSON.stringify({ tau, fraction, share, efficiency: frame.efficiency });
    }
    host.addEventListener('input', update);
    host.addEventListener('click', (e) => {
      const b = e.target.closest('[data-demo-cell]');
      if (b) {
        state.demoCell = b.dataset.demoCell.split(',').map(Number);
        update();
      }
    });
    update();
  }
  panel.addEventListener('click', async (e) => {
    const explain = e.target.closest('[data-explain-method], [data-explain-formula]');
    if (explain) tutor.open(methods.find((m) => m.id === state.id), explain.hasAttribute('data-explain-formula') ? Number(explain.dataset.explainFormula) : null, state.math);
    const stage = e.target.closest('[data-stage]');
    if (stage) {
      state.search = '';
      $('#method-search').value = '';
      const next = `#methods/${methods.find((m) => m.stage === stage.dataset.stage).id}`;
      if (location.hash === next) topicNav();
      else location.hash = next;
    }
    const copy = e.target.closest('[data-copy-formula]');
    if (copy) {
      const tex = methods.find((m) => m.id === state.id).formulas[Number(copy.dataset.copyFormula)]
        .tex;
      try {
        await navigator.clipboard.writeText(tex);
        toast('LaTeX 公式已复制');
      } catch {
        toast('浏览器未开放剪贴板，可从方法手册获取公式');
      }
    }
  });
  $('#method-search').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    topicNav();
  });
  $('#method-export').addEventListener('click', () => {
    const url = URL.createObjectURL(
      new Blob([handbookMarkdown()], { type: 'text/markdown;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CHAINLAB-methods-handbook.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  window.addEventListener('hashchange', route);
  route();
  return { refresh: route };
}
