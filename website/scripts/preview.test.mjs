import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { ensurePreview, healthPath, readHealth, root } from './preview.mjs';

const exec = promisify(execFile);
const launcher = resolve(root, 'scripts/preview.mjs');
const stateFile = (port) => resolve(root, '.artifacts', `preview-${port}.json`);

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function availablePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((done) => server.close(done));
  return port;
}

async function launch(port) {
  const result = await exec(process.execPath, [launcher, '--port', String(port), '--no-open'], {
    cwd: tmpdir(),
    timeout: 30000,
    windowsHide: true,
  });
  const state = JSON.parse(await readFile(stateFile(port), 'utf8'));
  assert.match(result.stdout, new RegExp(`http://127.0.0.1:${state.port}/`));
  const health = await readHealth(state.port);
  assert.ok(health, 'Server must remain alive after the launcher exits');
  return health;
}

async function stop(info) {
  if (!info || (await readHealth(info.port))?.pid !== info.pid) return;
  process.kill(info.pid);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!(await readHealth(info.port))) return;
    await delay(100);
  }
  assert.fail('Test server did not stop');
}

async function clean(port) {
  for (const suffix of ['json', 'log', 'lock'])
    await unlink(resolve(root, '.artifacts', `preview-${port}.${suffix}`)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
}

test('rejects invalid ports without starting a server', async () => {
  for (const port of [0, 80, 65536, NaN, 5188.5])
    await assert.rejects(ensurePreview({ port }), /Preview port must/);
});

test('starts from another cwd, stays alive, reuses, and restarts after shutdown', async (t) => {
  const port = await availablePort();
  let info;
  t.after(async () => {
    await stop(info);
    await clean(port);
  });
  info = await launch(port);
  for (const path of [
    '',
    'workspace.html',
    'src/main.js',
    'media/chainlab-background-poster-v2.jpg',
  ])
    assert.equal((await fetch(`${info.url}${path}`)).status, 200);
  const media = await fetch(`${info.url}media/chainlab-background-v2-1080p30.mp4`, {
    headers: { Range: 'bytes=0-1023' },
  });
  assert.equal(media.status, 206);
  assert.match(media.headers.get('content-range'), /^bytes 0-1023\//);
  await media.arrayBuffer();
  const reused = await ensurePreview({ port });
  assert.equal(reused.reused, true);
  assert.equal(reused.pid, info.pid);
  const oldPid = info.pid;
  await stop(info);
  info = await launch(port);
  assert.notEqual(info.pid, oldPid, 'Stale state must not be mistaken for a running server');
});

test('handles unrelated port occupants and reuses the fallback port', async (t) => {
  const occupant = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ app: 'some-other-site' }));
  });
  const port = await listen(occupant);
  let info;
  t.after(async () => {
    await stop(info);
    await new Promise((done) => occupant.close(done));
    await clean(port);
  });
  info = await launch(port);
  assert.notEqual(info.port, port);
  const reused = await ensurePreview({ port });
  assert.equal(reused.pid, info.pid);
  assert.equal(reused.reused, true);
  assert.equal(
    (await fetch(`http://127.0.0.1:${port}${healthPath}`).then((r) => r.json())).app,
    'some-other-site',
    'Launcher must leave an unrelated server untouched',
  );
});

test('two concurrent clicks start only one service and recover a stale lock', async (t) => {
  const port = await availablePort();
  let info;
  t.after(async () => {
    await stop(info);
    await clean(port);
  });
  await writeFile(stateFile(port), '{invalid stale state');
  const lock = resolve(root, '.artifacts', `preview-${port}.lock`);
  await writeFile(lock, 'interrupted startup');
  const oldTime = new Date(Date.now() - 120000);
  await utimes(lock, oldTime, oldTime);
  const [first, second] = await Promise.all([launch(port), launch(port)]);
  info = first;
  assert.equal(first.pid, second.pid);
  assert.equal(first.port, second.port);
});
