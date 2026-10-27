import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ImageDown,
  Braces,
  LoaderCircle,
  Sparkles,
} from 'lucide';
import { layoutInWorker } from './topology-worker-client.js';
import { createTopologyAI } from './topology-ai.js';
import './topology.css';

export const topologyIcons = {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ImageDown,
  Braces,
  LoaderCircle,
  Sparkles,
};
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s],
  );
const number = (value) => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const exact = (value) =>
  value === 0 ? '0' : Math.abs(value) < 0.001 ? value.toExponential(4) : number(value);
const button = (id, icon, label) =>
  `<button id="${id}" type="button" class="icon-button" title="${label}" aria-label="${label}"><i data-lucide="${icon}"></i></button>`;

export function createTopologyPanel({ refreshIcons, toast }) {
  const section = document.createElement('section');
  section.className = 'workspace-panel topology-panel';
  section.dataset.workspacePanel = 'topology';
  section.id = 'panel-topology';
  section.hidden = true;
  section.setAttribute('aria-labelledby', 'topology-title');
  section.innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">NETWORK ATLAS <span>02</span></p><h1 id="topology-title">网络拓扑</h1><p class="page-description">中国省级多区域投入产出网络 <span class="heading-separator">/</span> 2000–2023</p></div><button type="button" id="topo-method" class="button button-quiet"><i data-lucide="info"></i>构网口径与来源</button></div>
    <form id="topo-form" class="topo-parameters">
      <div class="topo-year-heading"><strong>数据年份</strong><span id="topo-selection-count">等待数据目录</span><div><button type="button" class="inline-button" data-years="all">全选</button><button type="button" class="inline-button" data-years="recent">近五年</button><button type="button" class="inline-button" data-years="clear">清空</button></div></div>
      <fieldset id="topo-years" class="topo-years" disabled><legend class="sr-only">选择一个或多个年份</legend></fieldset>
      <div class="topo-options">
        <label class="field"><span>节点层级</span><select id="topo-level"><option value="sector">全国行业 · 42 节点</option><option value="province">省际关联 · 31 节点</option><option value="node">省份 × 行业 · 1302 节点</option></select></label>
        <label class="field"><span>边权口径</span><select id="topo-weight"><option value="A">直接投入系数 A</option><option value="Z">中间投入交易 Z</option></select></label>
        <label class="field"><span>绝对阈值 ≥</span><input id="topo-threshold" type="number" min="0" max="1000000000000000" step="any" value="0.005" required /></label>
        <label class="field"><span>最多展示边</span><select id="topo-max-edges"><option value="100">100</option><option value="250" selected>250</option><option value="600">600</option><option value="1500">1500</option><option value="3000">3000</option></select></label>
        <button id="topo-generate" class="button button-dark" type="submit" disabled><i data-lucide="network"></i><span>生成网络</span></button>
        <button id="topo-cancel" class="button button-quiet" type="button" hidden><i data-lucide="x"></i>取消</button>
      </div>
    </form>
    <div id="topo-status" class="topo-status" role="status" aria-live="polite">正在连接年度数据目录</div>
    <div id="topo-result" hidden>
      <div class="topo-metrics" id="topo-metrics"></div>
      <div class="topo-toolbar"><div><h2>有向加权拓扑</h2><span id="topo-graph-scope"></span></div><div class="topo-tools"><label class="sr-only" for="topo-find">定位节点</label><input id="topo-find" placeholder="定位节点" list="topo-node-list" /><datalist id="topo-node-list"></datalist>${button('topo-zoom-in', 'zoom-in', '放大')}${button('topo-zoom-out', 'zoom-out', '缩小')}${button('topo-fit', 'maximize-2', '适应画布')}${button('topo-reset-layout', 'rotate-ccw', '恢复初始节点布局')}${button('topo-png', 'image-down', '导出当前年 PNG')}${button('topo-json', 'braces', '导出全部年份 JSON')}</div></div>
      <div class="topo-stage" id="topo-stage"><canvas id="topo-canvas" tabindex="0" aria-label="年度投入产出有向网络；精确节点和指标见下方表格"></canvas><div id="topo-tooltip" class="topo-tooltip" hidden></div><div class="topo-canvas-legend"><span><b class="topo-dot"></b>总强度</span><span><b class="topo-dot important"></b>当年前三节点</span><span>供应 → 使用</span><span>多年共用坐标与尺度</span></div></div>
      <div class="topo-player"><div class="topo-player-controls">${button('topo-prev', 'skip-back', '上一年度')}<button type="button" id="topo-play" class="icon-button" aria-label="播放年度演化" title="播放年度演化" disabled><i data-lucide="play"></i></button>${button('topo-next', 'skip-forward', '下一年度')}<strong id="topo-current-year"></strong></div><input id="topo-scrubber" type="range" min="0" max="0" step="1" value="0" aria-label="切换所选数据年份" /><select id="topo-speed" aria-label="年度播放间隔"><option value="2400">2.4 秒 / 年</option><option value="1400">1.4 秒 / 年</option><option value="4000">4 秒 / 年</option></select></div>
      <div id="topo-year-tabs" class="topo-year-tabs" aria-label="已生成年度"></div>
      <section id="topo-inspector" class="topo-inspector" hidden aria-labelledby="topo-selected-label"><div class="topo-inspector-heading"><div><h2 id="topo-selected-label"></h2><p id="topo-neighbor-status" role="status"></p></div>${button('topo-clear-selection', 'x', '取消节点选择')}</div><div class="topo-neighbor-grid"><div><h3>上游供应 → 所选节点</h3><div class="topo-table-scroll"><table class="topo-table"><thead><tr><th>节点</th><th>边权</th></tr></thead><tbody id="topo-incoming"></tbody></table></div></div><div><h3>所选节点 → 下游使用</h3><div class="topo-table-scroll"><table class="topo-table"><thead><tr><th>节点</th><th>边权</th></tr></thead><tbody id="topo-outgoing"></tbody></table></div></div></div></section>
      <p class="topo-boundary" id="topo-boundary"></p>
      <div class="topo-evidence"><section><h2>年度结构变化</h2><div class="topo-table-scroll"><table class="topo-table"><thead><tr><th>年份</th><th>节点</th><th>全网边数</th><th>密度</th><th>孤立节点</th></tr></thead><tbody id="topo-annual"></tbody></table></div></section><section><h2>节点关联强度</h2><p id="topo-node-scope">阈值全网 · 不受展示边数影响</p><div class="topo-table-scroll"><table class="topo-table"><thead><tr><th>节点</th><th>入强度</th><th>出强度</th><th>总度</th></tr></thead><tbody id="topo-nodes"></tbody></table></div></section></div>
      <div class="topo-source"><span id="topo-source"></span><button type="button" class="inline-button" id="topo-method-result">来源与复现参数 <i data-lucide="arrow-up-right"></i></button></div>
    </div>
    <dialog id="topo-method-dialog" class="workspace-dialog topo-method-dialog"><div class="dialog-heading"><div><p class="eyebrow">METHOD &amp; PROVENANCE</p><h2>构网口径与来源</h2></div><button type="button" class="icon-button" data-close-dialog aria-label="关闭"><i data-lucide="x"></i></button></div><div id="topo-method-body"></div></dialog>`;
  const content = document.querySelector('#workspace-content');
  content.insertBefore(section, content.querySelector('.workspace-footer'));
  const $ = (selector) => section.querySelector(selector);
  const displayField = document.createElement('label');
  displayField.className = 'field';
  displayField.innerHTML =
    '<span>展示骨架</span><select id="topo-display"><option value="local">局部重要连接</option><option value="topk">全局最强边 · 原版</option></select>';
  $('#topo-max-edges').closest('label').before(displayField);
  $('#topo-level').addEventListener('change', () => {
    if ($('#topo-level').value === 'node' && $('#topo-max-edges').value === '250')
      $('#topo-max-edges').value = '1500';
  });
  let catalog,
    frames = [],
    frameIndex = 0,
    layout,
    controller,
    timer,
    playback = false;
  let view = { k: 1, x: 0, y: 0 },
    selected = null,
    hovered = null,
    drag = null,
    animation = 0;
  let width = 0,
    height = 0,
    dpr = 1,
    nodePositions = [],
    previousFrame,
    transitionStart = 0;
  let neighborController,
    neighborData = null,
    neighborLoading = false,
    initialPositions = new Map();
  const movedNodes = new Set();
  const canvas = $('#topo-canvas'),
    context = canvas.getContext('2d');
  const ai = createTopologyAI({ section, refreshIcons, stopPlayback: stop,
    getContext: () => ({ frames, frameIndex, selected }) });

  function selections() {
    return [...$('#topo-years').querySelectorAll('input:checked')]
      .map((input) => Number(input.value))
      .sort((a, b) => a - b);
  }
  function selectionCount() {
    $('#topo-selection-count').textContent = `已选 ${selections().length} 年`;
  }
  function status(message, error = false) {
    $('#topo-status').textContent = message;
    $('#topo-status').classList.toggle('is-error', error);
  }
  function stop() {
    clearTimeout(timer);
    playback = false;
    $('#topo-play').innerHTML = '<i data-lucide="play"></i>';
    $('#topo-play').setAttribute('aria-label', '播放年度演化');
    $('#topo-play').title = '播放年度演化';
    refreshIcons();
  }
  function setIndex(index, animated = true) {
    if (!frames.length) return;
    previousFrame = frames[frameIndex];
    frameIndex = Math.max(0, Math.min(frames.length - 1, index));
    transitionStart =
      animated && !matchMedia('(prefers-reduced-motion: reduce)').matches ? performance.now() : 0;
    $('#topo-scrubber').value = String(frameIndex);
    renderResult();
    if (selected) loadNeighbors();
    draw();
  }
  function schedule() {
    timer = setTimeout(
      () => {
        if (!playback) return;
        if (frameIndex === frames.length - 1) {
          stop();
          return;
        }
        setIndex(frameIndex + 1);
        schedule();
      },
      Number($('#topo-speed').value),
    );
  }
  function renderResult() {
    ai.update();
    const frame = frames[frameIndex],
      m = frame.metrics;
    $('#topo-current-year').textContent = `${frame.year} 年`;
    $('#topo-metrics').innerHTML = [
      ['节点', m.nodes],
      ['阈值全网边数', number(m.edges)],
      ['有向密度', `${(m.density * 100).toFixed(2)}%`],
      ['展示边 / 全网边', `${m.displayed_edges} / ${number(m.edges)}`],
      ['连线节点覆盖', `${(frame.coverage.node_coverage * 100).toFixed(1)}%`],
      ['真实孤立 / 展示遗漏', `${m.isolates} / ${frame.coverage.hidden_connected_nodes}`],
    ]
      .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
      .join('');
    $('#topo-graph-scope').textContent =
      `${{ sector: '全国行业', province: '省际关联', node: '省份 × 行业' }[frame.config.level]} · ${frame.config.weight} ≥ ${exact(frame.config.threshold)}`;
    $('#topo-year-tabs').innerHTML = frames
      .map(
        (f, i) =>
          `<button type="button" data-frame="${i}" aria-pressed="${i === frameIndex}">${f.year}</button>`,
      )
      .join('');
    $('#topo-annual').innerHTML = frames
      .map(
        (f, i) =>
          `<tr class="${i === frameIndex ? 'is-current' : ''}"><th><button type="button" data-frame="${i}">${f.year}</button></th><td>${f.metrics.nodes}</td><td>${number(f.metrics.edges)}</td><td>${(f.metrics.density * 100).toFixed(2)}%</td><td>${f.metrics.isolates}</td></tr>`,
      )
      .join('');
    const ranked = [...frame.nodes].sort(
      (a, b) => b.strength - a.strength || a.id.localeCompare(b.id),
    );
    const ordered = selected
      ? [frame.nodes.find((n) => n.id === selected), ...ranked.filter((n) => n.id !== selected)]
      : ranked;
    $('#topo-nodes').innerHTML = ordered
      .slice(0, 12)
      .map(
        (node) =>
          `<tr class="${node.id === selected ? 'is-current' : ''}"><th><button type="button" data-node="${escape(node.id)}">${escape(node.label)}</button></th><td>${exact(node.in_strength)}</td><td>${exact(node.out_strength)}</td><td>${node.in_degree + node.out_degree}</td></tr>`,
      )
      .join('');
    $('#topo-boundary').textContent =
      `${frame.config.display === 'local' ? '局部重要连接' : '全局最强边'} · 上限 ${frame.config.max_edges} 条 · 覆盖 ${(m.displayed_weight_share * 100).toFixed(1)}% 阈值边权。${frame.coverage.visible_connected_nodes} / ${frame.coverage.connected_nodes} 个非孤立节点显示连线；${frame.coverage.hidden_connected_nodes} 个有连接节点的连线因展示预算被省略。节点大小与指标来自阈值全网，所有节点均保留。${frames.some((f) => f.year >= 2005 && f.year <= 2007) ? '2005–2007 年跨年可比性待核实。' : ''}${frame.config.weight === 'Z' ? '金额单位与价格口径待核实，Z 跨年不代表实际增长。' : 'A 系数权重占比不等于交易额或 GDP 占比。'}`;
    $('#topo-source').textContent = frame.source.file;
    $('#topo-prev').disabled = frameIndex === 0;
    $('#topo-next').disabled = frameIndex === frames.length - 1;
    $('#topo-play').disabled = frames.length < 2;
  }
  function renderMethod() {
    const frame = frames[frameIndex];
    const definitions = [
      ['方向', '供应部门（行）→ 使用部门（列）。A 使用买方总产出作分母。'],
      ['聚合次序', '先按所选层级求和 Z 与 x，再计算 A。自环仅从网络视图中排除。'],
      [
        '阈值与指标',
        '保留正权且 ≥ 绝对阈值的边。密度为 E / [N(N−1)]；总强度为入强度 + 出强度。指标与完整邻居查询基于阈值全网，不是展示子图。',
      ],
      [
        '展示骨架',
        '原版按权重取最强 K 条。局部重要连接先提名各节点最强入边与出边，依次优先覆盖未显示节点及未显示入/出方向，同优先级按局部边权份额、原始边权、矩阵顺序排序，剩余预算补全局强边。严格遵守边数上限，不保证任意小预算都能覆盖全部节点；这是展示启发式，不是经济风险模型。',
      ],
      [
        '布局与跨年',
        'Web Worker 内对所选年份的展示边并集运行一次 D3 力导向布局（固定初始化、180 次迭代），随后各年共用坐标与尺度。节点距离不等同于经济或地理距离，动画不估算年份间数据。',
      ],
      [
        '数据边界',
        '图形结构不等于经济韧性或冲击结果。行业名称、金额单位与价格口径未核实；2005–2007 年跨年可比性待核实。原始零产出节点的交易行列均须全零，保留孤立节点。',
      ],
    ];
    $('#topo-method-body').innerHTML =
      `<dl class="topo-definitions">${definitions.map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join('')}</dl>${frame ? `<h3>本次参数</h3><pre>${escape(JSON.stringify(frame.config, null, 2))}</pre><h3>来源校验</h3>${frames.map((f) => `<p><strong>${f.year}</strong> · ${escape(f.source.file)}<code class="topo-hash">${f.source.sha256}</code></p>`).join('')}<h3>计算代码</h3><p><a href="${frame.method.repository}/blob/${frame.method.commit}/src/ionet/network/build.py" target="_blank" rel="noopener noreferrer">ionet.network.build.build_network ↗</a><code class="topo-hash">SHA-256 ${frame.method.kernel_sha256}</code></p>` : '<p>数据来源：已入库的原始年度合并表；运行后可查看逐年来源哈希及复现参数。</p>'}`;
    $('#topo-method-dialog').showModal();
  }
  function selectNode(id) {
    if (!frames.length) return;
    if (id && selected === id && (neighborData || neighborLoading)) return;
    selected = id;
    hovered = null;
    neighborData = null;
    neighborController?.abort();
    $('#topo-inspector').hidden = !id;
    renderResult();
    draw();
    if (id) loadNeighbors();
  }
  async function loadNeighbors() {
    neighborController?.abort();
    neighborController = new AbortController();
    const signal = neighborController.signal;
    neighborData = null;
    const frame = frames[frameIndex],
      id = selected;
    if (!id) return;
    neighborLoading = true;
    const node = frame.nodes.find((item) => item.id === id);
    $('#topo-selected-label').textContent = `${node.label} · ${frame.year}`;
    $('#topo-neighbor-status').textContent = '正在读取阈值全网中的全部上下游连接';
    $('#topo-incoming').innerHTML = $('#topo-outgoing').innerHTML = '';
    draw();
    try {
      const response = await fetch(
        `/api/topology/neighbors?${new URLSearchParams({ ...frame.config, node: id })}`,
        { signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '关联查询失败');
      if (signal.aborted || selected !== id || frames[frameIndex] !== frame) return;
      neighborData = data;
      const labels = new Map(frame.nodes.map((n) => [n.id, n.label]));
      for (const [direction, selector] of [
        ['incoming', '#topo-incoming'],
        ['outgoing', '#topo-outgoing'],
      ]) {
        const edges = data.edges.filter((edge) => edge.direction === direction);
        $(selector).innerHTML = edges.length
          ? edges
              .map((edge) => {
                const other = direction === 'incoming' ? edge.source : edge.target;
                return `<tr><th><button type="button" data-node="${escape(other)}">${escape(labels.get(other))}</button></th><td>${exact(edge.weight)}</td></tr>`;
              })
              .join('')
          : '<tr><td colspan="2">该阈值下无连接</td></tr>';
      }
      $('#topo-neighbor-status').textContent =
        `阈值全网：${node.in_degree} 个上游 · ${node.out_degree} 个下游；已补充所有关联边，不限于前 ${frame.config.max_edges} 条展示边。`;
      draw();
    } catch (error) {
      if (!signal.aborted)
        $('#topo-neighbor-status').textContent =
          `关联读取失败：${error.message}。重新点选节点可重试。`;
    } finally {
      if (!signal.aborted) neighborLoading = false;
    }
  }
  function resize() {
    const bounds = $('#topo-stage').getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    width = bounds.width;
    height = bounds.height;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
  }
  function position(node) {
    const p = layout.positions.get(node.id),
      scale = Math.min(width - 55, height - 120) * 0.45 * view.k;
    return {
      x: width / 2 + p.x * scale + view.x,
      y: height / 2 + p.y * scale + view.y,
      r: layout.radius(node.strength) * Math.sqrt(view.k),
    };
  }
  function draw() {
    cancelAnimationFrame(animation);
    if (!frames.length || !layout || !width) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    const frame = frames[frameIndex],
      focus = selected || hovered;
    const t = transitionStart ? Math.min(1, (performance.now() - transitionStart) / 450) : 1;
    const nodes = new Map(frame.nodes.map((node) => [node.id, node]));
    const previous = new Map((previousFrame?.nodes || []).map((node) => [node.id, node]));
    nodePositions = frame.nodes.map((node) => ({
      ...node,
      ...position({
        ...node,
        strength: (previous.get(node.id)?.strength ?? node.strength) * (1 - t) + node.strength * t,
      }),
    }));
    const points = new Map(nodePositions.map((node) => [node.id, node]));
    const neighbors = new Set([focus]);
    const incident =
      selected && neighborData?.year === frame.year && neighborData.node.id === selected
        ? neighborData.edges
        : null;
    if (focus)
      (incident || frame.edges).forEach((e) => {
        if (e.source === focus) neighbors.add(e.target);
        if (e.target === focus) neighbors.add(e.source);
      });
    const paintEdges = (edges, alpha) => {
      for (const edge of edges) {
        const a = points.get(edge.source),
          b = points.get(edge.target);
        if (!a || !b) continue;
        const active = !focus || edge.source === focus || edge.target === focus;
        const dx = b.x - a.x,
          dy = b.y - a.y,
          length = Math.hypot(dx, dy);
        if (length < 10) continue;
        const ux = dx / length,
          uy = dy / length,
          offset = 3 * Math.sqrt(view.k);
        const sx = a.x + ux * (a.r + 2) - uy * offset,
          sy = a.y + uy * (a.r + 2) + ux * offset;
        const ex = b.x - ux * (b.r + 5) - uy * offset,
          ey = b.y - uy * (b.r + 5) + ux * offset;
        const weight = Math.log1p((99 * edge.weight) / layout.maxEdge) / Math.log(100);
        context.globalAlpha = alpha * (active ? 0.2 + 0.55 * weight : 0.035);
        context.strokeStyle = focus && edge.source === focus ? '#a64b17' : '#205ecf';
        context.lineWidth = (0.5 + weight * 1.8) * Math.sqrt(view.k);
        context.beginPath();
        context.moveTo(sx, sy);
        context.lineTo(ex, ey);
        context.stroke();
        const arrow = 3.5 + weight * 2.5;
        context.fillStyle = context.strokeStyle;
        context.beginPath();
        context.moveTo(ex, ey);
        context.lineTo(ex - ux * arrow - uy * arrow * 0.55, ey - uy * arrow + ux * arrow * 0.55);
        context.lineTo(ex - ux * arrow + uy * arrow * 0.55, ey - uy * arrow - ux * arrow * 0.55);
        context.closePath();
        context.fill();
      }
    };
    if (t < 1 && previousFrame) paintEdges(previousFrame.edges, 1 - t);
    paintEdges(frame.edges, t);
    if (incident) paintEdges(incident, 1);
    const strongest = new Set(
      [...nodes.values()]
        .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
        .slice(0, 3)
        .filter((n) => n.strength > 0)
        .map((n) => n.id),
    );
    const labels = new Set(
      [...nodes.values()]
        .sort((a, b) => b.strength - a.strength)
        .slice(0, frame.nodes.length > 100 ? 5 : width < 500 ? 7 : 14)
        .map((n) => n.id),
    );
    for (const node of [...nodePositions].sort(
      (a, b) => Number(a.id === focus) - Number(b.id === focus),
    )) {
      context.globalAlpha = focus && !neighbors.has(node.id) ? 0.15 : 1;
      context.fillStyle =
        node.id === focus
          ? '#bfd1f2'
          : node.strength === 0
            ? '#c6d0df'
            : strongest.has(node.id)
              ? '#e77932'
              : '#205ecf';
      context.beginPath();
      context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#fff';
      context.lineWidth = frame.nodes.length > 100 ? 0.5 : 1.5;
      context.stroke();
    }
    const placed = [];
    // Place important labels first; hide collisions until zooming opens enough space.
    for (const node of [...nodePositions]
      .filter((n) => labels.has(n.id) || n.id === focus)
      .sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || b.strength - a.strength)) {
      context.font = `${node.id === focus ? 600 : 400} 12px "Microsoft YaHei",sans-serif`;
      const half = context.measureText(node.label).width / 2;
      const candidates = [
        [node.x, node.y + node.r + 16],
        [node.x, node.y - node.r - 7],
        [node.x + node.r + half + 7, node.y + 4],
        [node.x - node.r - half - 7, node.y + 4],
      ];
      const match = candidates.find(([x, y]) => {
        const box = { left: x - half - 3, right: x + half + 3, top: y - 13, bottom: y + 3 };
        if (box.left < 5 || box.right > width - 5 || box.top < 78 || box.bottom > height - 38)
          return false;
        if (
          placed.some(
            (r) =>
              r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top,
          )
        )
          return false;
        if (
          nodePositions.some(
            (other) =>
              other.id !== node.id &&
              Math.hypot(
                other.x - Math.max(box.left, Math.min(other.x, box.right)),
                other.y - Math.max(box.top, Math.min(other.y, box.bottom)),
              ) <
                other.r + 1,
          )
        )
          return false;
        return true;
      });
      if (!match) continue;
      const [x, y] = match;
      placed.push({ left: x - half - 3, right: x + half + 3, top: y - 13, bottom: y + 3 });
      context.globalAlpha = focus && !neighbors.has(node.id) ? 0.2 : 1;
      context.textAlign = 'center';
      context.lineWidth = 4;
      context.strokeStyle = '#ffffff';
      context.strokeText(node.label, x, y);
      context.fillStyle = '#465166';
      context.fillText(node.label, x, y);
    }
    context.globalAlpha = 1;
    context.textAlign = 'left';
    context.fillStyle = '#20242b';
    context.font = '600 36px "Segoe UI",sans-serif';
    context.fillText(String(frame.year), 22, 45);
    context.font = '11px "Microsoft YaHei",sans-serif';
    context.fillStyle = '#69768a';
    context.fillText(
      `${frame.config.weight} · ${frame.metrics.nodes} 节点 · ${frame.edges.length} 展示边`,
      24,
      65,
    );
    if (t < 1) animation = requestAnimationFrame(draw);
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function generate(event) {
    event.preventDefault();
    const years = selections();
    if (!years.length) {
      status('请至少选择一个年份。', true);
      return;
    }
    ai.reset();
    controller?.abort();
    stop();
    controller = new AbortController();
    const signal = controller.signal;
    $('#topo-generate').disabled = true;
    $('#topo-cancel').hidden = false;
    $('#topo-form').setAttribute('aria-busy', 'true');
    const config = {
      level: $('#topo-level').value,
      weight: $('#topo-weight').value,
      threshold: $('#topo-threshold').value,
      max_edges: $('#topo-max-edges').value,
      display: $('#topo-display').value,
    };
    try {
      const results = [];
      for (let i = 0; i < years.length; i++) {
        status(`正在计算 ${years[i]} 年 · ${i + 1} / ${years.length}`);
        const response = await fetch(
          `/api/topology?${new URLSearchParams({ ...config, year: years[i] })}`,
          { signal },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '网络计算失败');
        results.push(result);
      }
      status('正在统一多年布局与显示尺度');
      const nextLayout = await layoutInWorker(results, signal);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      frames = results;
      layout = nextLayout;
      frameIndex = 0;
      selected = null;
      neighborController?.abort();
      neighborData = null;
      $('#topo-inspector').hidden = true;
      initialPositions = new Map([...layout.positions].map(([id, p]) => [id, { ...p }]));
      movedNodes.clear();
      hovered = null;
      view = { k: 1, x: 0, y: 0 };
      previousFrame = null;
      $('#topo-result').hidden = false;
      $('#topo-scrubber').max = String(frames.length - 1);
      $('#topo-scrubber').disabled = frames.length < 2;
      $('#topo-node-list').innerHTML = frames[0].nodes
        .map((n) => `<option value="${escape(n.label)}">${escape(n.id)}</option>`)
        .join('');
      renderResult();
      resize();
      status(`已完成 ${frames.length} 个年度 · 同一构网口径 · ${frames[0].method.kernel}`);
      window.chainlabTopology = {
        get frames() {
          return frames;
        },
        get frameIndex() {
          return frameIndex;
        },
        get positions() {
          return [...layout.positions];
        },
        get scale() {
          return layout.maximum;
        },
        get view() {
          return { ...view };
        },
        get selected() {
          return selected;
        },
        get neighbors() {
          return neighborData;
        },
        get screenNodes() {
          return nodePositions.map(({ id, x, y, r }) => ({ id, x, y, r }));
        },
      };
    } catch (error) {
      if (signal.aborted) status('已取消本次计算；已有结果保持不变。');
      else status(`生成失败：${error.message}。已有结果未被替换。`, true);
    } finally {
      $('#topo-generate').disabled = !catalog;
      $('#topo-cancel').hidden = true;
      $('#topo-form').removeAttribute('aria-busy');
    }
  }
  $('#topo-form').addEventListener('submit', generate);
  $('#topo-cancel').addEventListener('click', () => controller?.abort());
  $('#topo-years').addEventListener('change', selectionCount);
  section.querySelectorAll('[data-years]').forEach((b) =>
    b.addEventListener('click', () => {
      $('#topo-years')
        .querySelectorAll('input')
        .forEach((input) => {
          input.checked =
            b.dataset.years === 'all' ||
            (b.dataset.years === 'recent' && Number(input.value) >= 2019);
        });
      selectionCount();
    }),
  );
  $('#topo-weight').addEventListener('change', () => {
    $('#topo-threshold').value = $('#topo-weight').value === 'A' ? '0.005' : '0';
  });
  $('#topo-level').addEventListener('change', () => {
    if ($('#topo-level').value === 'node') $('#topo-max-edges').value = '1500';
  });
  ['#topo-method', '#topo-method-result'].forEach((id) =>
    $(id).addEventListener('click', renderMethod),
  );
  $('#topo-play').addEventListener('click', () => {
    if (playback) {
      stop();
      return;
    }
    if (frameIndex === frames.length - 1) setIndex(0, false);
    playback = true;
    $('#topo-play').innerHTML = '<i data-lucide="pause"></i>';
    $('#topo-play').setAttribute('aria-label', '暂停年度演化');
    $('#topo-play').title = '暂停年度演化';
    refreshIcons();
    schedule();
  });
  $('#topo-prev').addEventListener('click', () => {
    stop();
    setIndex(frameIndex - 1);
  });
  $('#topo-next').addEventListener('click', () => {
    stop();
    setIndex(frameIndex + 1);
  });
  $('#topo-speed').addEventListener('change', () => {
    if (playback) {
      clearTimeout(timer);
      schedule();
    }
  });
  $('#topo-scrubber').addEventListener('input', (e) => {
    stop();
    setIndex(Number(e.target.value));
  });
  section.addEventListener('click', (e) => {
    const year = e.target.closest('[data-frame]'),
      node = e.target.closest('[data-node]');
    if (year) {
      stop();
      setIndex(Number(year.dataset.frame));
    }
    if (node) {
      selectNode(node.dataset.node);
    }
  });
  function zoom(k) {
    view.k = Math.max(0.35, Math.min(7, k));
    draw();
  }
  $('#topo-zoom-in').addEventListener('click', () => zoom(view.k * 1.25));
  $('#topo-zoom-out').addEventListener('click', () => zoom(view.k / 1.25));
  $('#topo-fit').addEventListener('click', () => {
    view = { k: 1, x: 0, y: 0 };
    selectNode(null);
  });
  $('#topo-reset-layout').addEventListener('click', () => {
    layout.positions = new Map([...initialPositions].map(([id, p]) => [id, { ...p }]));
    movedNodes.clear();
    view = { k: 1, x: 0, y: 0 };
    draw();
  });
  $('#topo-clear-selection').addEventListener('click', () => selectNode(null));
  $('#topo-find').addEventListener('change', (e) => {
    const node = frames[frameIndex]?.nodes.find(
      (n) => n.id === e.target.value || n.label === e.target.value,
    );
    if (!node) {
      toast('没有匹配的节点。');
      return;
    }
    const p = layout.positions.get(node.id),
      scale = Math.min(width - 55, height - 120) * 0.45 * view.k;
    view.x = -p.x * scale;
    view.y = -p.y * scale;
    selectNode(node.id);
  });
  $('#topo-json').addEventListener('click', () =>
    download(
      new Blob(
        [
          JSON.stringify(
            {
              frames,
              layout: {
                engine: 'd3-force',
                execution: 'web-worker',
                version: 'shared-layout-v1',
                iterations: 180,
                scope: 'union_of_selected_year_display_edges',
                positions: [...layout.positions],
                initial_positions: [...initialPositions],
                manually_moved_nodes: [...movedNodes],
                strength_max: layout.maximum,
                edge_max: layout.maxEdge,
              },
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      `chainlab-topology-${frames[0].year}-${frames.at(-1).year}.json`,
    ),
  );
  $('#topo-png').addEventListener('click', () => {
    transitionStart = 0;
    const screenDpr = dpr;
    dpr = Math.max(dpr, 1600 / width);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
    const frame = frames[frameIndex],
      out = document.createElement('canvas');
    out.width = canvas.width;
    const ctx = out.getContext('2d');
    ctx.font = '11px "Microsoft YaHei",sans-serif';
    const lines = [
      `CHAINLAB · ${frame.year} · ${frame.config.level} · ${frame.config.weight} >= ${frame.config.threshold}`,
      `Nodes ${frame.metrics.nodes} | threshold edges ${frame.metrics.edges} | display ${frame.edges.length} | size: full strength`,
      `Display ${frame.config.display} | connected coverage ${frame.coverage.visible_connected_nodes}/${frame.coverage.connected_nodes} | true isolates ${frame.metrics.isolates} | hidden connections ${frame.coverage.hidden_connected_nodes}`,
      `Source SHA256: ${frame.source.sha256}`,
      selected
        ? `Selected ${selected}: all incident threshold edges overlaid`
        : 'No selected-node overlay',
      frame.config.weight === 'Z'
        ? 'Z units and price basis unverified'
        : 'A = Z / buyer output; not a resilience score',
    ];
    const wrapped = [];
    for (const line of lines) {
      let row = '';
      for (const character of line) {
        if (ctx.measureText(row + character).width > width - 30) {
          wrapped.push(row);
          row = '';
        }
        row += character;
      }
      if (row) wrapped.push(row);
    }
    out.height = canvas.height + (wrapped.length * 18 + 28) * dpr;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#465166';
    ctx.font = '11px "Microsoft YaHei",sans-serif';
    wrapped.forEach((line, i) => ctx.fillText(line, 15, height + 22 + i * 18));
    dpr = screenDpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
    out.toBlob((blob) => {
      if (blob) download(blob, `chainlab-topology-${frame.year}.png`);
    });
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom(view.k * Math.exp(-e.deltaY * 0.001));
    },
    { passive: false },
  );
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stop();
    const node = hitNode(e.clientX, e.clientY);
    if (node) selectNode(node.id);
    drag = {
      x: e.clientX,
      y: e.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
      node: node?.id,
      origin: node ? { ...layout.positions.get(node.id) } : null,
    };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      drag.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
      if (drag.node) {
        const scale = Math.min(width - 55, height - 120) * 0.45 * view.k;
        layout.positions.set(drag.node, {
          x: drag.origin.x + dx / scale,
          y: drag.origin.y + dy / scale,
        });
        if (drag.moved) movedNodes.add(drag.node);
      } else {
        view.x = drag.originX + dx;
        view.y = drag.originY + dy;
      }
      $('#topo-tooltip').hidden = true;
      draw();
      return;
    }
    const rect = canvas.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    const node = hitNode(e.clientX, e.clientY);
    hovered = node?.id || null;
    draw();
    const tip = $('#topo-tooltip');
    tip.hidden = !node;
    if (node) {
      tip.innerHTML = `<strong>${escape(node.label)}</strong><span>入强度 ${exact(node.in_strength)}</span><span>出强度 ${exact(node.out_strength)}</span><span>总度 ${node.in_degree + node.out_degree}</span>`;
      tip.style.left = `${Math.max(4, Math.min(width - 180, x + 14))}px`;
      tip.style.top = `${Math.max(5, Math.min(height - 130, y + 12))}px`;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved && !drag.node) selectNode(null);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    drag = null;
  });
  function hitNode(clientX, clientY) {
    const rect = canvas.getBoundingClientRect(),
      x = clientX - rect.left,
      y = clientY - rect.top;
    return nodePositions
      .map((node) => ({ node, d: Math.hypot(node.x - x, node.y - y) }))
      .filter(({ node, d }) => d < Math.max(node.r + 4, 8))
      .sort((a, b) => a.d - b.d)[0]?.node;
  }
  canvas.addEventListener('pointercancel', () => {
    drag = null;
  });
  canvas.addEventListener('pointerleave', () => {
    hovered = null;
    $('#topo-tooltip').hidden = true;
    if (frames.length) draw();
  });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      view = { k: 1, x: 0, y: 0 };
      selectNode(null);
    }
    if (e.key === '+' || e.key === '=') zoom(view.k * 1.2);
    if (e.key === '-') zoom(view.k / 1.2);
  });
  new ResizeObserver(resize).observe($('#topo-stage'));
  new MutationObserver(() => {
    if (section.hidden) {
      stop();
      cancelAnimationFrame(animation);
    } else resize();
  }).observe(section, { attributes: true, attributeFilter: ['hidden'] });
  return {
    setCatalog(value) {
      catalog = value;
      $('#topo-years').innerHTML =
        '<legend class="sr-only">选择一个或多个年份</legend>' +
        value.years
          .map(
            ({ year }) =>
              `<label><input type="checkbox" value="${year}" ${year >= 2021 ? 'checked' : ''} /><span>${year}</span></label>`,
          )
          .join('');
      $('#topo-years').disabled = false;
      $('#topo-generate').disabled = false;
      selectionCount();
      status('已连接原始年度表 · 等待生成');
    },
  };
}
