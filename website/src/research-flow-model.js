import dagre from '@dagrejs/dagre';

export const flowPalette = {
  root: ['#174f44', '#174f44', '#ffffff'],
  stage: ['#e5efec', '#81a79c', '#244e42'],
  option: ['#ffffff', '#559b8c', '#244e42'],
  input: ['#e7f1f6', '#7da4b6', '#284f63'],
  step: ['#ffffff', '#a3b4ad', '#344d43'],
  check: ['#fbf1dd', '#c2a361', '#705626'],
  missing: ['#faeae7', '#c88c80', '#864f43'],
};
const short = (text, limit = 76) => {
  const chars = Array.from(String(text || ''));
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : chars.join('');
};
export function wrapLabel(text, columns = 14) {
  const lines = [];
  let line = '', width = 0;
  for (const char of Array.from(text)) {
    const size = /[\x20-\x7e]/.test(char) ? 0.55 : 1;
    if (char === '\n' || width + size > columns) {
      lines.push(line);
      line = ''; width = 0;
      if (char === '\n') continue;
    }
    line += char; width += size;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

// Relationships organize selected research plans; they do not infer causal dependencies.
export function buildFlow(result, selectedIds, { stage = 'all', details = false, direction = 'LR' } = {}) {
  const selected = new Set(selectedIds);
  const nodes = [], edges = [];
  const add = (id, kind, label, text, metadata = {}) => {
    const wrapped = wrapLabel(label);
    nodes.push({ id, kind, label: wrapped, text, width: 248,
      height: Math.max(68, wrapped.split('\n').length * 20 + 30), ...metadata });
  };
  const link = (source, target) => edges.push({ id: `edge-${source}-${target}`, source, target });
  add('research', 'root', short(result.title, 85), result.question);
  result.stages.forEach((phase, index) => {
    if (stage !== 'all' && Number(stage) !== index) return;
    const phaseId = `phase-${index}`;
    add(phaseId, 'stage', `阶段 ${String(index + 1).padStart(2, '0')}\n${short(phase.title.replace(/^阶段[一二三四1234]+[：:]?\s*/, ''), 55)}`, phase.title, { stage: index });
    link('research', phaseId);
    const chosen = phase.options.filter((option) => selected.has(option.id));
    if (!chosen.length) {
      const id = `missing-${index}`;
      add(id, 'missing', '尚未选择方案', '该阶段尚未选择方案，研究路径不完整。', { stage: index });
      link(phaseId, id);
    }
    chosen.forEach((option) => {
      const method = `method-${option.id}`;
      const metadata = { stage: index, optionId: option.id };
      add(method, 'option', short(option.title, 95), option.theory, metadata);
      link(phaseId, method);
      if (!details) return;
      const input = `input-${option.id}`;
      add(input, 'input', `数据准备\n${short(option.data, 65)}`, option.data, metadata);
      link(method, input);
      let previous = input;
      option.steps.forEach((step, i) => {
        const id = `step-${option.id}-${i}`;
        add(id, 'step', `${String(i + 1).padStart(2, '0')} / ${short(step, 85)}`, step, metadata);
        link(previous, id); previous = id;
      });
      const check = `check-${option.id}`;
      add(check, 'check', `研究核验\n${short(option.validation, 65)}`, option.validation, metadata);
      link(previous, check);
    });
  });
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: direction, ranksep: 70, nodesep: 32, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((node) => graph.setNode(node.id, { width: node.width, height: node.height }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  const anchors = nodes.filter((n) => n.kind === 'stage');
  const order = anchors.length > 1 ? anchors : nodes.filter((n) => n.kind === 'option');
  const crossAxis = direction === 'LR' ? 'y' : 'x';
  const mirror = order.length > 1 && graph.node(order[0].id)[crossAxis] > graph.node(order.at(-1).id)[crossAxis];
  const bounds = nodes.map((n) => graph.node(n.id)[crossAxis]);
  const crossSum = Math.min(...bounds) + Math.max(...bounds);
  nodes.forEach((node) => {
    const position = graph.node(node.id);
    if (mirror) position[crossAxis] = crossSum - position[crossAxis];
    node.x = Math.round(position.x / 10) * 10;
    node.y = Math.round(position.y / 10) * 10;
  });
  return { nodes, edges, direction };
}

export function optionFor(result, id) {
  return result?.stages.flatMap((stage) => stage.options).find((option) => option.id === id);
}

export function drawioXml(currentModel, result, selectedIds, origin, xmlDocument = document) {
  const xml = xmlDocument.implementation.createDocument('', 'mxfile', null);
  const element = (tag, attrs = {}, parent) => {
    const node = xml.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    parent?.append(node);
    return node;
  };
  const file = xml.documentElement;
  file.setAttribute('host', 'ChainLab');
  file.setAttribute('version', '26.0.0');
  const detailText = (node) => {
    const option = optionFor(result, node.optionId);
    if (!option) return node.text;
    return [option.title, `来源类型：${option.basis === 'ai' ? 'AI 补充建议，待核验' : '本库文献方法参考'}`,
      ...['theory', 'data', 'formula', 'parameters', 'assumptions', 'validation', 'limitations'].map((key) => `${key}: ${option[key] || ''}`),
      ...option.steps, ...option.requires, ...option.citations.map((ref) => {
        const source = result.sources.find((s) => s.id === ref.document_id);
        return `${source?.title || ref.document_id} / PDF ${ref.page}: ${origin}#literature/read/${ref.document_id}/${ref.page}`;
      }), '研究草案；阶段与步骤来自所选框架，未验证方案兼容性或执行实证。'].join('\n');
  };
  const page = (id, title, model) => {
    const diagram = element('diagram', { id, name: title }, file);
    const graph = element('mxGraphModel', { grid: 1, gridSize: 10, page: 0, background: '#f7faf9' }, diagram);
    const root = element('root', {}, graph);
    element('mxCell', { id: '0' }, root);
    element('mxCell', { id: '1', parent: '0' }, root);
    for (const node of model.nodes) {
      const [fill, stroke, color] = flowPalette[node.kind];
      const option = optionFor(result, node.optionId);
      const source = option?.citations[0];
      // Plain-text labels avoid interpreting model output as HTML in a diagram editor.
      const object = element('UserObject', { id: node.id, label: node.label, tooltip: detailText(node),
        'data-model-id': node.id, 'data-source': 'selected-framework',
        ...(source ? { link: `${origin}#literature/read/${source.document_id}/${source.page}` } : {}) }, root);
      const cell = element('mxCell', { vertex: 1, parent: '1',
        style: `rounded=1;arcSize=8;whiteSpace=wrap;html=0;fontSize=14;fontFamily=Arial;spacing=10;fillColor=${fill};strokeColor=${stroke};fontColor=${color};` }, object);
      element('mxGeometry', { x: node.x - node.width / 2, y: node.y - node.height / 2, width: node.width, height: node.height, as: 'geometry' }, cell);
    }
    for (const edge of model.edges) {
      const cell = element('mxCell', { id: edge.id, source: edge.source, target: edge.target, edge: 1, parent: '1',
        style: 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=0;endArrow=blockThin;endFill=1;strokeColor=#89a69b;strokeWidth=1.5;' }, root);
      element('mxGeometry', { relative: 1, as: 'geometry' }, cell);
    }
  };
  page('overview', '当前视图', currentModel);
  for (const id of selectedIds) {
    const option = optionFor(result, id);
    if (!option) continue;
    const stage = result.stages.findIndex((s) => s.options.some((o) => o.id === id));
    page(`detail-${id}`, short(option.title, 45), buildFlow(result, [id], { stage, details: true, direction: 'TB' }));
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(xml);
}
