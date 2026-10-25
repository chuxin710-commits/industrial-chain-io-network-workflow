import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { cpSync, mkdirSync } from 'node:fs';

const pdfAssets = resolve(import.meta.dirname, 'public/pdfjs');
mkdirSync(pdfAssets, { recursive: true });
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(
    resolve(import.meta.dirname, 'node_modules/pdfjs-dist', folder),
    resolve(pdfAssets, folder),
    { recursive: true },
  );
}
cpSync(
  resolve(import.meta.dirname, 'node_modules/pdfjs-dist/LICENSE'),
  resolve(pdfAssets, 'LICENSE'),
);

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5188,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        workspace: resolve(import.meta.dirname, 'workspace.html'),
        film: resolve(import.meta.dirname, 'film.html'),
        briefing: resolve(import.meta.dirname, 'briefing.html'),
      },
    },
  },
});
