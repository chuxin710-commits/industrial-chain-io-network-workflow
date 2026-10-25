import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const base = 'http://127.0.0.1:8787';

async function health() {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data.database === 'read-only' && data.year_count === 24 && data.complete_year_coverage
      ? data
      : null;
  } catch {
    return null;
  }
}

export async function ensureApi() {
  const existing = await health();
  if (existing) return { ...existing, url: base, reused: true };
  const database = resolve(root, 'var/mrio.sqlite3');
  await access(database);
  const artifacts = resolve(root, '.artifacts');
  await mkdir(artifacts, { recursive: true });
  const logPath = resolve(artifacts, 'api-preview.log');
  const log = await open(logPath, 'a');
  let child;
  const python =
    process.env.PYTHON ||
    [resolve(root, '../.venv/Scripts/python.exe'), resolve(root, '../.venv/bin/python')].find(
      existsSync,
    ) ||
    (process.platform === 'win32' ? 'python' : 'python3');
  try {
    child = spawn(
      python,
      [
        '-u',
        resolve(root, 'server/app.py'),
        '--db',
        database,
        '--host',
        '127.0.0.1',
        '--port',
        '8787',
      ],
      {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log.fd, log.fd],
      },
    );
    await once(child, 'spawn');
    child.unref();
  } finally {
    await log.close();
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await health();
    if (result) return { ...result, url: base, reused: false };
    await delay(200);
  }
  child.kill();
  throw new Error(
    `Database API did not become ready: ${(await readFile(logPath, 'utf8')).slice(-1500)}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureApi()
    .then((info) => console.log(JSON.stringify(info)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
