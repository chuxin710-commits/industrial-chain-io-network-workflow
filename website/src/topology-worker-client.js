import { layoutRadius } from './topology-layout.js';

export function layoutInWorker(frames, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const worker = new Worker(new URL('./topology-worker.js', import.meta.url), { type: 'module' });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else
        resolve({
          ...data.layout,
          radius: (value) => layoutRadius(frames[0].nodes.length, data.layout.maximum, value),
        });
    };
    worker.onerror = () => {
      finish();
      reject(new Error('网络布局计算失败，请重试。'));
    };
    worker.postMessage(frames);
  });
}
