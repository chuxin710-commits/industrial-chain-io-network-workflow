import { TextLayer, AnnotationMode } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Keep page geometry in the document, but rasterize only the visible neighborhood.
export function createContinuousPages({ scroll, container, status, onActive, onReady }) {
  let pages = [],
    active = 1,
    columns = 1,
    zoom = 'fit';
  let generation = 0,
    frame = 0,
    pumping = false,
    wanted = [],
    waiting = null;
  const aliases = {
    'reader-page-host': null,
    'reader-pdf-canvas': 'canvas',
    'reader-text-layer': '.textLayer',
    'reader-marks': '.reader-marks',
    'reader-draw': '.reader-draw',
  };
  function activate(number) {
    const item = pages[number - 1];
    if (!item) return;
    active = number;
    for (const [id, selector] of Object.entries(aliases)) {
      container.querySelector(`#${id}`)?.removeAttribute('id');
      const element = selector ? item.host.querySelector(selector) : item.host;
      if (element) element.id = id;
    }
    onActive(number);
  }
  function dispose(item) {
    item.token++;
    item.task?.cancel();
    item.text?.cancel();
    item.task = item.text = null;
    item.key = null;
    delete item.host.dataset.ready;
    const canvas = item.host.querySelector('canvas');
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    }
    item.host.querySelector('.textLayer')?.remove();
  }
  function close() {
    generation++;
    cancelAnimationFrame(frame);
    pages.forEach(dispose);
    pages = [];
    wanted = [];
    waiting = null;
    container.replaceChildren();
  }
  function geometry() {
    const available = (scroll.clientWidth - 36 - (columns - 1) * 18) / columns;
    const widest = Math.max(...pages.map((item) => item.base.width));
    const scale = zoom === 'fit' ? Math.max(0.05, Math.min(1.5, available / widest)) : Number(zoom);
    container.style.gridTemplateColumns = `repeat(${columns}, ${widest * scale}px)`;
    for (const item of pages) {
      item.viewport = item.page.getViewport({ scale });
      const { width, height } = item.viewport;
      item.host.style.width = `${width}px`;
      item.host.style.height = `${height}px`;
      item.host.style.setProperty('--total-scale-factor', scale);
      item.host.style.setProperty('--scale-factor', scale);
      item.host.style.setProperty('--user-unit', item.page.userUnit || 1);
      if (item.key !== scale) dispose(item);
    }
  }
  function jump(number) {
    const item = pages[number - 1];
    if (!item) return;
    activate(number);
    scroll.scrollTop +=
      item.host.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 18;
    scroll.scrollLeft = Math.max(0, item.host.offsetLeft - 18);
    waiting = number;
    schedule();
  }
  function layout(nextColumns = columns, nextZoom = zoom) {
    if (!pages.length) return;
    const host = pages[active - 1].host;
    const fraction =
      (scroll.getBoundingClientRect().top + 18 - host.getBoundingClientRect().top) /
      host.offsetHeight;
    columns = nextColumns;
    zoom = nextZoom;
    geometry();
    jump(active);
    scroll.scrollTop += fraction * host.offsetHeight;
    schedule();
  }
  async function open(document, start, nextColumns, nextZoom) {
    close();
    columns = nextColumns;
    zoom = nextZoom;
    const version = generation;
    const loaded = [];
    // Read page boxes in small batches, never allocate a canvas for the entire PDF.
    for (let i = 1; i <= document.numPages; i += 8) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(8, document.numPages - i + 1) }, (_, j) =>
          document.getPage(i + j),
        ),
      );
      if (version !== generation) return;
      loaded.push(...batch);
    }
    pages = loaded.map((p, i) => {
      const host = window.document.createElement('div');
      host.className = 'reader-page-host';
      host.dataset.page = String(i + 1);
      host.setAttribute('aria-label', `第 ${i + 1} 页`);
      host.innerHTML =
        '<svg class="reader-marks" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"></svg><svg class="reader-draw" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="在文献页面绘制标记"></svg>';
      container.append(host);
      return { page: p, host, base: p.getViewport({ scale: 1 }), token: 0, key: null };
    });
    geometry();
    jump(Math.max(1, Math.min(start, pages.length)));
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  }
  function update() {
    if (!pages.length) return;
    const box = scroll.getBoundingClientRect();
    const visible = pages.filter(({ host }) => {
      const r = host.getBoundingClientRect();
      return r.bottom > box.top && r.top < box.bottom;
    });
    const nearest = visible.reduce((best, item) => {
      const distance = Math.abs(item.host.getBoundingClientRect().top - box.top - 18);
      return !best || distance < best.distance ? { item, distance } : best;
    }, null)?.item;
    if (nearest) {
      const sameRow = Math.abs(nearest.host.offsetTop - pages[active - 1].host.offsetTop) < 2;
      if (!sameRow) activate(Number(nearest.host.dataset.page));
    }
    const needed = new Set(visible);
    for (const item of visible) {
      const index = Number(item.host.dataset.page) - 1;
      for (let d = -columns; d <= columns; d++) if (pages[index + d]) needed.add(pages[index + d]);
    }
    needed.add(pages[active - 1]);
    wanted = [...needed].sort(
      (a, b) =>
        Math.abs(Number(a.host.dataset.page) - active) -
        Math.abs(Number(b.host.dataset.page) - active),
    );
    for (const item of pages) {
      const selection = window.getSelection();
      const selected =
        selection?.rangeCount &&
        !selection.isCollapsed &&
        selection.getRangeAt(0).intersectsNode(item.host);
      if (!needed.has(item) && !selected && (item.key || item.task)) dispose(item);
    }
    pump();
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      let item;
      while ((item = wanted.find((p) => p.key !== p.viewport.scale && !p.failed))) {
        const version = generation,
          token = ++item.token;
        const viewport = item.viewport;
        const number = Number(item.host.dataset.page);
        const canvas = document.createElement('canvas');
        // Bound high-zoom/mobile backing-store memory as well as the number of live pages.
        const dpr = Math.min(
          devicePixelRatio || 1,
          2,
          Math.sqrt(6000000 / (viewport.width * viewport.height)),
        );
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const text = document.createElement('div');
        text.className = 'textLayer';
        try {
          item.task = item.page.render({
            canvasContext: canvas.getContext('2d'),
            viewport,
            transform: [dpr, 0, 0, dpr, 0, 0],
            annotationMode: AnnotationMode.ENABLE,
          });
          await item.task.promise;
          if (generation !== version || item.token !== token) continue;
          item.text = new TextLayer({
            textContentSource: item.page.streamTextContent(),
            container: text,
            viewport,
          });
          await item.text.render();
          if (generation !== version || item.token !== token) continue;
          item.host.querySelector('canvas')?.remove();
          item.host.querySelector('.textLayer')?.remove();
          item.host.prepend(canvas, text);
          item.key = viewport.scale;
          item.host.dataset.ready = String(number);
          if (active === number) activate(number);
          if (waiting === number) {
            status.textContent = '';
            waiting = null;
          }
          onReady();
        } catch (e) {
          if (
            generation === version &&
            item.token === token &&
            e.name !== 'RenderingCancelledException' &&
            e.name !== 'AbortException'
          ) {
            item.failed = true;
            status.textContent = `第 ${number} 页读取失败：${e.message}`;
          }
        } finally {
          if (item.token === token) item.task = item.text = null;
        }
      }
      if (waiting && pages[waiting - 1]?.key) {
        status.textContent = '';
        waiting = null;
      }
    } finally {
      pumping = false;
    }
  }
  scroll.addEventListener('scroll', schedule, { passive: true });
  return { open, close, layout, jump, activate, schedule };
}
