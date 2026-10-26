import './method-tutor.css';
import { evidenceHTML } from './research-evidence.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (s) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[s]);
const questions = [
  ['通俗理解', '请用初学者能理解的语言解释它的含义和用途。'],
  ['逐步推导', '请逐一解释符号、分母或归一化约定，再按步骤说明公式如何得到或计算。'],
  ['举例计算', '请用一个很小的合成教学示例，逐步代入计算，并说明结果意味着什么。'],
  ['常见误区', '使用这个方法或公式时最容易弄错什么？哪些结论不能据此推出？'],
];

export function createMethodTutor({ refreshIcons }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'method-tutor';
  dialog.setAttribute('aria-labelledby', 'tutor-title');
  dialog.innerHTML = `<header class="tutor-heading"><div><p class="eyebrow">DEEPSEEK / METHOD TUTOR</p><h2 id="tutor-title">方法助教</h2></div><button class="icon-button" id="tutor-close" title="关闭解释" aria-label="关闭解释"><i data-lucide="x"></i></button></header>
    <div class="tutor-body"><section class="tutor-context"><h3 id="tutor-context-title"></h3><div id="tutor-formula"></div></section>
    <p class="tutor-note">AI 教学解释 · 以手册定义为准，计算示例与补充知识仍需复核。</p>
    <div id="tutor-access" role="status"></div>
    <div class="tutor-prompts" role="group" aria-label="解释方向">${questions.map(([label], i) => `<button type="button" class="button button-outline" data-tutor-prompt="${i}">${label}</button>`).join('')}</div>
    <div id="tutor-conversation" aria-label="助教问答"></div>
    <p id="tutor-status" role="status" aria-live="polite"></p></div>
    <form id="tutor-form"><label for="tutor-question">关于这个方法，我想问</label><textarea id="tutor-question" rows="2" maxlength="1000" placeholder="例如：为什么这里除以使用方的总产出？" required></textarea><div class="tutor-submit-row"><button type="button" id="tutor-clear" class="icon-button" title="清空本次对话" aria-label="清空本次对话"><i data-lucide="rotate-ccw"></i></button><span id="tutor-count">0 / 1000</span><button type="submit" id="tutor-send" class="button button-primary"><i data-lucide="arrow-up-right"></i>提问</button></div></form>`;
  document.body.append(dialog);
  const $ = (s) => dialog.querySelector(s);
  let user = null, method, formulaIndex, generation = 0, busy = false, history = [], abort;

  function controls() {
    $('#tutor-send').disabled = busy || !user;
    dialog.querySelectorAll('[data-tutor-prompt]').forEach((b) => { b.disabled = busy || !user; });
    $('#tutor-question').disabled = busy || !user;
    $('#tutor-conversation').setAttribute('aria-busy', String(busy));
  }
  function clear() {
    generation++;
    abort?.abort();
    abort = null;
    history = [];
    busy = false;
    $('#tutor-conversation').replaceChildren();
    $('#tutor-question').value = '';
    $('#tutor-count').textContent = '0 / 1000';
    $('#tutor-status').textContent = '';
    controls();
  }
  async function request(path, body, signal) {
    const response = await fetch(`/api/library${path}`, {
      signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': user?.csrf || '' }, body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || '助教暂时不可用，请稍后重试');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async function session(token) {
    try {
      const data = await request('/session', null, abort?.signal);
      if (token !== generation) return;
      user = data.user;
      $('#tutor-access').innerHTML = user ? '' : '<a href="#literature">登录课题组账号</a>后使用 AI 助教。';
      controls();
    } catch (error) {
      if (token !== generation) return;
      $('#tutor-access').textContent = '登录状态暂不可用，请关闭后重新打开。';
    }
  }
  async function ask(question) {
    if (busy || !user || !question.trim()) return;
    question = question.trim();
    const token = ++generation;
    abort = new AbortController();
    busy = true;
    controls();
    $('#tutor-status').textContent = '正在检索文献并结合当前方法与公式解释…';
    try {
      let job = await request('/ai/explain', { method_id: method.id, formula_index: formulaIndex, question, history: history.slice(-4) }, abort.signal);
      const deadline = Date.now() + 420000;
      while (job.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        if (token !== generation) return;
        if (Date.now() > deadline) throw new Error('等待时间较长，请稍后再次提交相同问题查看结果');
        job = await request(`/ai/explain/${job.id}`, null, abort.signal);
      }
      if (token !== generation) return;
      if (job.status !== 'ready') throw new Error(job.error || '解释未完成，请重试');
      const result = job.result;
      if (result.method_id !== method.id || result.formula_index !== formulaIndex) throw new Error('解释上下文不一致，请重新提问');
      const article = document.createElement('article');
      article.className = 'tutor-answer';
      article.innerHTML = `<h3>${esc(question)}</h3><p>${esc(result.answer)}</p><h4>直观理解</h4><p>${esc(result.intuition)}</p><h4>逐步拆解</h4><ol>${result.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><h4>教学示例</h4><p>${esc(result.example)}</p><h4>误区与边界</h4><ul>${result.pitfalls.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><details><summary>理解自检</summary><p>${esc(result.check)}</p></details><small>${esc(result.model)} · 手册版本 ${esc(result.version.slice(0, 10))}</small>`;
      $('#tutor-conversation').append(article);
      article.insertAdjacentHTML('beforeend', evidenceHTML(result.retrieval, result.citations));
      const dialogue = Object.fromEntries(['answer', 'intuition', 'steps', 'example', 'pitfalls', 'check'].map((key) => [key, result[key]]));
      history.push({ role: 'user', content: question }, { role: 'assistant', content: JSON.stringify(dialogue).slice(0, 10000) });
      history = history.slice(-4);
      while ($('#tutor-conversation').children.length > 6) $('#tutor-conversation').firstElementChild.remove();
      $('#tutor-question').value = '';
      $('#tutor-count').textContent = '0 / 1000';
      $('#tutor-status').textContent = '解释已生成，可继续追问。';
      article.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (error) {
      if (token !== generation) return;
      if (error.status === 401 || error.status === 403) {
        clear(); user = null;
        $('#tutor-access').innerHTML = '<a href="#literature">重新登录课题组账号</a>后提问。';
        controls();
      }
      $('#tutor-status').textContent = error.message;
      // Preserve failed quick questions for retry, just like typed questions.
      $('#tutor-question').value = question;
      $('#tutor-count').textContent = `${question.length} / 1000`;
    } finally {
      if (token === generation) { busy = false; controls(); }
    }
  }
  $('#tutor-close').onclick = () => dialog.close();
  dialog.addEventListener('close', clear);
  $('#tutor-access').addEventListener('click', (event) => { if (event.target.closest('a')) dialog.close(); });
  $('#tutor-clear').onclick = clear;
  $('#tutor-form').onsubmit = (event) => { event.preventDefault(); ask($('#tutor-question').value); };
  $('#tutor-question').oninput = () => { $('#tutor-count').textContent = `${$('#tutor-question').value.length} / 1000`; };
  dialog.querySelectorAll('[data-tutor-prompt]').forEach((button) => {
    button.onclick = () => ask(questions[Number(button.dataset.tutorPrompt)][1]);
  });
  window.addEventListener('hashchange', () => { if (dialog.open) dialog.close(); });
  document.addEventListener('library-session-change', () => {
    clear(); user = null;
    controls();
    if (dialog.open) session(generation);
  });
  return {
    open(selected, index, math) {
      clear(); user = null; method = selected; formulaIndex = index;
      $('#tutor-context-title').textContent = index === null ? selected.title : `${selected.title} · ${selected.formulas[index].label}`;
      $('#tutor-formula').innerHTML = index === null ? `<p>${esc(selected.purpose)}</p>` : `${math(selected.formulas[index].tex)}<p>${esc(selected.formulas[index].note)}</p>`;
      $('#tutor-access').textContent = '正在确认登录状态…';
      controls(); refreshIcons(); dialog.showModal(); session(generation);
    },
  };
}
