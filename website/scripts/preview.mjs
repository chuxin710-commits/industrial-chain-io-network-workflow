import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { access, mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const scriptPath = fileURLToPath(import.meta.url);
export const root = resolve(scriptPath, '../..');
export const healthPath = '/__chainlab/health';
const rootId = createHash('sha256').update(root).digest('hex');
const artifacts = resolve(root, '.artifacts');
const statePath = (port) => resolve(artifacts, `preview-${port}.json`);

function validatePort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Preview port must be an integer between 1024 and 65535.');
}

export async function readHealth(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${healthPath}`, {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return null;
    const info = await response.json();
    return info.app === 'chainlab-preview' && info.rootId === rootId && info.port === port
      ? info
      : null;
  } catch {
    return null;
  }
}

async function findRunning(port) {
  const preferred = await readHealth(port);
  if (preferred) return preferred;
  try {
    const state = JSON.parse(await readFile(statePath(port), 'utf8'));
    if (state.rootId === rootId) return await readHealth(state.port);
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return null;
}

async function lockStartup(port) {
  const path = resolve(artifacts, `preview-${port}.lock`);
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const handle = await open(path, 'wx');
      return async () => {
        await handle.close();
        await unlink(path).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await stat(path).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 60000) await unlink(path).catch(() => {});
      await delay(150);
    }
  }
  throw new Error('Another preview startup is still running. Try again in a minute.');
}

export async function ensurePreview({ port = 5188 } = {}) {
  validatePort(port);
  const existing = await findRunning(port);
  if (existing) return { ...existing, reused: true };
  try {
    await access(resolve(root, 'node_modules/vite/package.json'));
  } catch {
    throw new Error(`Dependencies are missing. In ${root}, run: npm ci --cache .npm-cache`);
  }
  await mkdir(artifacts, { recursive: true });
  const unlock = await lockStartup(port);
  try {
    const running = await findRunning(port);
    if (running) return { ...running, reused: true };
    const logPath = resolve(artifacts, `preview-${port}.log`);
    const log = await open(logPath, 'w');
    let child;
    let exited = false;
    try {
      child = spawn(process.execPath, [scriptPath, '--serve', '--port', String(port)], {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log.fd, log.fd],
      });
      child.once('exit', () => {
        exited = true;
      });
      await once(child, 'spawn');
      child.unref();
    } finally {
      await log.close();
    }
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !exited) {
      const info = await findRunning(port);
      if (info?.pid === child.pid) return { ...info, reused: false };
      await delay(150);
    }
    if (!exited) child.kill();
    const logText = await readFile(logPath, 'utf8');
    throw new Error(`Preview failed to start. Log: ${logPath}\n${logText.slice(-4000)}`);
  } finally {
    await unlock();
  }
}

async function serve(port) {
  const { createServer } = await import('vite');
  for (const file of [
    'index.html',
    'workspace.html',
    'public/media/chainlab-background-v2-1080p30.mp4',
    'public/media/chainlab-concept-v2-1080p30.mp4',
  ])
    await access(resolve(root, file));
  let info;
  const server = await createServer({
    root,
    logLevel: 'info',
    server: { host: '127.0.0.1', port, strictPort: false, open: false },
    plugins: [
      {
        name: 'chainlab-preview-health',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url?.split('?')[0] !== healthPath) return next();
            response.setHeader('Content-Type', 'application/json');
            response.setHeader('Cache-Control', 'no-store');
            response.end(JSON.stringify(info));
          });
        },
      },
    ],
  });
  await server.listen();
  const actualPort = server.httpServer.address().port;
  info = {
    app: 'chainlab-preview',
    rootId,
    pid: process.pid,
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}/`,
    startedAt: new Date().toISOString(),
  };
  await writeFile(statePath(port), JSON.stringify(info, null, 2));
  console.log(`CHAINLAB ready: ${info.url}`);
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

async function openBrowser(url) {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/d', '/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`Browser could not open automatically. Open ${url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const index = process.argv.indexOf('--port');
    const port = index < 0 ? 5188 : Number(process.argv[index + 1]);
    validatePort(port);
    if (process.argv.includes('--serve')) await serve(port);
    else {
      if (await stat(resolve(root, 'var/mrio.sqlite3')).catch(() => null)) {
        const { ensureApi } = await import('./api-preview.mjs');
        await ensureApi();
      }
      const info = await ensurePreview({ port });
      console.log(`${info.reused ? 'Reusing' : 'Started'} CHAINLAB: ${info.url}`);
      console.log(`Background service PID: ${info.pid}. Closing this window will not stop it.`);
      if (!process.argv.includes('--no-open')) await openBrowser(info.url);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
