import { safe } from './library.js';
import { buildFlow, drawioXml, flowPalette, optionFor } from './research-flow-model.js';
import './research-flow.css';

const iconButton = (id, icon, title) => `<button type="button" id="${id}" class="icon-button" title="${title}" aria-label="${title}"><i data-lucide="${icon}"></i></button>`;
export function createResearchFlow(root, { refreshIcons, toast, onEdit }) {
  const $ = (s) => root.querySelector(s);
  let result = null, selected = [], cy = null, model = null, revision = 0, dirty = true;
  let modulePromise;
  root.innerHTML = `<div class="flow-heading"><div><p class="eyebrow">RESEARCH WORKFLOW</p><h2>研究流程导图</h2><p id="flow-summary" role="status">尚未生成研究框架</p></div><button class="button button-quiet" id="flow-edit" type="button"><i data-lucide="git-fork"></i>调整方案</button></div>
    <div id="flow-empty" class="flow-empty"><i data-lucide="git-fork"></i><h3>尚无所选研究路径</h3><button class="inline-button" id="flow-start" type="button">选择主题与方案 <i data-lucide="arrow-up-right"></i></button></div>
    <div id="flow-content" hidden>
      <div class="flow-toolbar"><div class="flow-controls"><label>阶段<select id="flow-stage"><option value="all">全部阶段</option></select></label><div class="flow-segments" role="group" aria-label="导图层级"><button id="flow-overview" type="button" aria-pressed="true">方案总览</button><button id="flow-steps" type="button" aria-pressed="false">实施步骤</button></div><select id="flow-direction" aria-label="导图方向"><option value="LR">横向</option><option value="TB">纵向</option></select></div>
      <div class="flow-actions">${iconButton('flow-fit', 'maximize', '适应画布')}${iconButton('flow-plus', 'plus', '放大')}${iconButton('flow-minus', 'minus', '缩小')}${iconButton('flow-reset', 'rotate-ccw', '重新布局')}${iconButton('flow-png', 'image', '导出当前导图 PNG')}${iconButton('flow-drawio', 'file-down', '导出可编辑 draw.io 文件')}</div></div>
      <div class="flow-layout"><div class="flow-surface"><div class="flow-legend"><span><b style="background:#69768a"></b>研究阶段</span><span><b style="background:#205ecf"></b>所选方案</span><span><b style="background:#7da4b6"></b>数据准备</span><span><b style="background:#e77932"></b>研究核验</span></div><div id="flow-canvas" role="img" aria-label="所选方案的研究流程思维导图"></div><div class="flow-foot"><span id="flow-count"></span><span id="flow-zoom"></span></div></div>
      <aside class="flow-inspector"><label for="flow-node">节点详情</label><select id="flow-node" aria-label="选择导图节点"></select><div id="flow-detail"></div></aside></div>
      <p class="flow-boundary">研究草案 · 阶段顺序见编号；同阶段分支为所选候选方案，组合条件仍需核验。步骤来自当前框架，未执行实证计算。</p>
    </div>`;
  let details = false;
  const isVisible = () => root.getClientRects().length > 0;
  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  function clearCanvas() {
    cy?.destroy(); cy = null; model = null;
    $('#flow-node').replaceChildren(); $('#flow-detail').replaceChildren();
    $('#flow-count').textContent = ''; $('#flow-zoom').textContent = '';
  }
  function selectNode(id) {
    const node = model?.nodes.find((n) => n.id === id);
    if (!node || !result) return;
    cy.nodes().unselect(); cy.getElementById(id).select();
    $('#flow-node').value = id;
    const option = optionFor(result, node.optionId);
    let content = `<p class="eyebrow">${node.stage === undefined ? 'RESEARCH QUESTION' : `STAGE ${String(node.stage + 1).padStart(2, '0')}`}</p><h3>${safe(node.label)}</h3><p>${safe(node.text)}</p>`;
    if (option) {
      content += `<span class="flow-basis">${option.basis === 'ai' ? 'AI 补充建议 · 待核验' : '本库文献方法参考'}</span>
        <dl>${[['data', '数据要求'], ['formula', '公式'], ['parameters', '变量与参数'], ['assumptions', '前提假设'], ['validation', '核验方法'], ['limitations', '局限']].map(([key, title]) => `<dt>${title}</dt><dd${key === 'formula' ? ' class="flow-formula"' : ''}>${safe(option[key] || '未明确')}</dd>`).join('')}</dl>
        <h4>实施步骤</h4><ol>${option.steps.map((step) => `<li>${safe(step)}</li>`).join('')}</ol>
        <h4>搭配条件</h4>${option.requires.map((text) => `<p>${safe(text)}</p>`).join('')}
        <h4>文献依据</h4>${option.citations.map((ref) => `<a class="flow-citation" href="#literature/read/${safe(ref.document_id)}/${ref.page}"><i data-lucide="book-open"></i>${safe(result.sources.find((s) => s.id === ref.document_id)?.title || '文献')} · PDF 第 ${ref.page} 页</a>`).join('')}`;
    } else if (node.kind === 'root') {
      content += `<h4>研究边界</h4><ul>${result.cautions.map((text) => `<li>${safe(text)}</li>`).join('')}</ul>`;
    }
    $('#flow-detail').innerHTML = content;
    refreshIcons();
  }
  function fit() { cy?.resize(); cy?.fit(undefined, 28); }
  async function render() {
    if (!result || !selected.length || !isVisible()) return;
    const token = revision;
    try {
      modulePromise ||= import('cytoscape');
      const { default: cytoscape } = await modulePromise;
      if (token !== revision || !result || !isVisible()) return;
      const previous = $('#flow-node').value;
      clearCanvas();
      model = buildFlow(result, selected, { stage: $('#flow-stage').value, details, direction: $('#flow-direction').value });
      cy = cytoscape({ container: $('#flow-canvas'), minZoom: 0.08, maxZoom: 2.5, wheelSensitivity: 0.18,
        elements: [...model.nodes.map((node) => ({ data: node, position: { x: node.x, y: node.y } })), ...model.edges.map((edge) => ({ data: edge }))],
        layout: { name: 'preset' },
        style: [
          { selector: 'node', style: { shape: 'round-rectangle', width: 'data(width)', height: 'data(height)', label: 'data(label)', 'font-family': 'Arial, sans-serif', 'font-size': 14, 'text-wrap': 'wrap', 'text-overflow-wrap': 'anywhere', 'text-max-width': 220, 'text-valign': 'center', 'text-halign': 'center', 'border-width': 1.5, 'line-height': 1.4 } },
          ...Object.entries(flowPalette).map(([kind, [fill, stroke, color]]) => ({ selector: `node[kind="${kind}"]`, style: { 'background-color': fill, 'border-color': stroke, color } })),
          { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#205ecf', 'overlay-opacity': 0.06, 'overlay-color': '#205ecf', 'overlay-padding': 5 } },
          { selector: 'edge', style: { width: 1.7, 'line-color': '#69768a', 'target-arrow-color': '#69768a', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, 'curve-style': 'taxi', 'taxi-direction': model.direction === 'LR' ? 'rightward' : 'downward', 'taxi-turn': '50%', 'taxi-turn-min-distance': 25 } },
        ],
      });
      cy.on('tap', 'node', (event) => selectNode(event.target.id()));
      cy.on('zoom', () => { $('#flow-zoom').textContent = `${Math.round(cy.zoom() * 100)}%`; });
      $('#flow-node').innerHTML = model.nodes.map((node) => `<option value="${safe(node.id)}">${safe(node.label.replace(/\n/g, ' '))}</option>`).join('');
      $('#flow-count').textContent = `${model.nodes.length} 个节点 · ${model.edges.length} 条连接`;
      dirty = false;
      fit();
      selectNode(model.nodes.some((n) => n.id === previous) ? previous : 'research');
    } catch (error) {
      if (token !== revision) return;
      dirty = true;
      $('#flow-summary').textContent = '导图加载失败，请重新布局后重试';
      toast('导图暂不可用，请重试');
    }
  }
  function update() { revision++; dirty = true; render(); }
  $('#flow-edit').addEventListener('click', onEdit);
  $('#flow-start').addEventListener('click', onEdit);
  $('#flow-stage').addEventListener('change', update);
  $('#flow-direction').addEventListener('change', update);
  for (const [id, value] of [['flow-overview', false], ['flow-steps', true]]) {
    $(`#${id}`).addEventListener('click', () => {
      details = value;
      $('#flow-overview').setAttribute('aria-pressed', String(!details));
      $('#flow-steps').setAttribute('aria-pressed', String(details));
      update();
    });
  }
  $('#flow-fit').addEventListener('click', fit);
  $('#flow-reset').addEventListener('click', update);
  for (const [id, factor] of [['flow-plus', 1.25], ['flow-minus', 0.8]]) {
    $(`#${id}`).addEventListener('click', () => cy?.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }));
  }
  $('#flow-node').addEventListener('change', () => {
    selectNode($('#flow-node').value);
    if (cy) cy.center(cy.getElementById($('#flow-node').value));
  });
  $('#flow-png').addEventListener('click', () => {
    if (!cy || !result) return;
    download(cy.png({ output: 'blob', bg: '#ffffff', full: true, maxWidth: 4000, maxHeight: 4000 }), `chainlab-${result.theme}-flow.png`);
  });
  $('#flow-drawio').addEventListener('click', () => {
    if (!model || !result) return;
    const current = { ...model, nodes: model.nodes.map((node) => ({ ...node, ...cy.getElementById(node.id).position() })) };
    const xml = drawioXml(current, result, selected, `${location.origin}${location.pathname}`);
    download(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `chainlab-${result.theme}-flow.drawio`);
    toast('已导出当前视图及各方案的完整步骤页');
  });
  new ResizeObserver(() => { if (cy && isVisible()) cy.resize(); }).observe($('#flow-canvas'));
  return {
    setSelection(next, ids) {
      const changed = result !== next;
      result = next;
      selected = ids.filter((id) => optionFor(result, id));
      revision++; dirty = true;
      clearCanvas();
      $('#flow-empty').hidden = Boolean(result && selected.length);
      $('#flow-content').hidden = !result || !selected.length;
      $('#flow-summary').textContent = result ? `已选 ${selected.length} 个方案 · ${result.stages.filter((s) => s.options.some((o) => selected.includes(o.id))).length} / ${result.stages.length} 个阶段` : '尚未生成研究框架';
      if (changed) {
        $('#flow-stage').innerHTML = '<option value="all">全部阶段</option>' + (result?.stages.map((stage, index) => `<option value="${index}">${safe(stage.title)}</option>`).join('') || '');
        if (result && matchMedia('(max-width: 650px)').matches) {
          const first = result.stages.findIndex((stage) => stage.options.some((option) => selected.includes(option.id)));
          if (first >= 0) $('#flow-stage').value = String(first);
          $('#flow-direction').value = 'TB';
        }
      }
      render();
    },
    activate() {
      if (dirty) render(); else requestAnimationFrame(() => cy?.resize());
    },
  };
}
