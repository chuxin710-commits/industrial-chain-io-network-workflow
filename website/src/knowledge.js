import { Share2, GitFork, CheckCheck, Maximize, Minus, Plus, Image, RotateCcw, FileDown } from 'lucide';
import { createFrameworkPanel } from './framework.js';
import { createResearchFlow } from './research-flow.js';

export const knowledgeIcons = { Share2, GitFork, CheckCheck, Maximize, Minus, Plus, Image, RotateCcw, FileDown };

export function createKnowledgePanel({ refreshIcons, toast }) {
  const panel = document.createElement('section');
  panel.id = 'panel-knowledge';
  panel.className = 'workspace-panel';
  panel.dataset.workspacePanel = 'knowledge';
  panel.setAttribute('aria-labelledby', 'knowledge-title');
  panel.hidden = true;
  panel.innerHTML = `<div class="page-heading"><div><p class="eyebrow">KNOWLEDGE ATLAS / 01</p><h1 id="knowledge-title">产业链知识图谱</h1><p class="page-description">文献证据 · 方法选择 · 实施路径</p></div><span class="state-tag">研究框架与流程</span></div>
    <div class="knowledge-mode-tabs" role="tablist" aria-label="知识图谱模块"><button id="kg-method-tab" role="tab" aria-controls="kg-framework-view" aria-selected="true">文献方法框架</button><button id="kg-flow-tab" role="tab" aria-controls="kg-flow-view" aria-selected="false" tabindex="-1">研究流程导图</button></div>
    <div id="kg-framework-view" role="tabpanel" aria-labelledby="kg-method-tab"></div>
    <div id="kg-flow-view" role="tabpanel" aria-labelledby="kg-flow-tab" hidden></div>`;
  const content = document.querySelector('#workspace-content');
  const footer = content.querySelector('.workspace-footer');
  if (footer) footer.before(panel); else content.append(panel);
  const $ = (s) => panel.querySelector(s);
  const flow = createResearchFlow($('#kg-flow-view'), { refreshIcons, toast, onEdit: () => show('method') });
  const framework = createFrameworkPanel($('#kg-framework-view'), {
    refreshIcons, toast,
    onSelectionChange: (result, selected) => flow.setSelection(result, selected),
    onOpenFlow: () => show('flow'),
  });
  function show(mode) {
    for (const name of ['method', 'flow']) {
      const active = mode === name;
      $(`#kg-${name}-tab`).setAttribute('aria-selected', String(active));
      $(`#kg-${name}-tab`).tabIndex = active ? 0 : -1;
    }
    $('#kg-framework-view').hidden = mode !== 'method';
    $('#kg-flow-view').hidden = mode !== 'flow';
    framework.activate();
    if (mode === 'flow') flow.activate();
  }
  for (const mode of ['method', 'flow']) {
    $(`#kg-${mode}-tab`).addEventListener('click', () => show(mode));
    $(`#kg-${mode}-tab`).addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'method' : event.key === 'End' ? 'flow' : mode === 'method' ? 'flow' : 'method';
      show(next);
      $(`#kg-${next}-tab`).focus();
    });
  }
  window.addEventListener('hashchange', () => {
    if (location.hash.split('/')[0] === '#knowledge' && !$('#kg-flow-view').hidden) flow.activate();
  });
  if (location.hash.startsWith('#knowledge')) framework.activate();
  refreshIcons();
  return { setCatalog() {} };
}
