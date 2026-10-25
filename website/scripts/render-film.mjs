import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, readFile, rename, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { launchBrowser } from './browser.mjs';
import { FILM_DURATION, FILM_SHOTS, FILM_VERSION, SHOT_DURATION } from '../src/film-storyboard.js';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const qaOnly = process.argv.includes('--qa');
const both = process.argv.includes('--both');
const modes = both
  ? ['full', 'background']
  : [process.argv.includes('--background') ? 'background' : 'full'];
const frameCount = FILM_DURATION * 30;
const artifacts = '.artifacts/film/v2';
await mkdir(artifacts, { recursive: true });
await mkdir('public/media', { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
let browser;
const encoders = [];

function createEncoder(mode) {
  const stem = `chainlab-${mode === 'full' ? 'concept' : 'background'}-v${FILM_VERSION}-1080p30`;
  const temporary = `public/media/${stem}.rendering.mp4`;
  const final = `public/media/${stem}.mp4`;
  const process = spawn(
    ffmpeg,
    [
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      '30',
      '-vcodec',
      'mjpeg',
      '-i',
      'pipe:0',
      '-i',
      'public/media/chainlab-original-score.wav',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      mode === 'background' ? '23' : '19',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '256k',
      '-t',
      String(FILM_DURATION),
      '-movflags',
      '+faststart',
      '-metadata',
      'title=The Chain of Discovery V2 - CHAINLAB',
      '-metadata',
      'comment=Original eight-scene Three.js concept and original electronic instrumental; no empirical observations depicted.',
      temporary,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true },
  );
  const encoder = { mode, process, temporary, final, log: '', stopped: false };
  process.stderr.on('data', (chunk) => {
    encoder.log += chunk;
  });
  process.stdin.on('error', () => {});
  encoder.completed = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('close', (code) => {
      encoder.stopped = true;
      resolve(code);
    });
  });
  encoder.completed.catch(() => {});
  return encoder;
}

try {
  browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/film.html?export=1`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => window.filmReady, { timeout: 60000 });
  const info = await page.evaluate(() => window.filmInfo);
  console.log('Film:', info);
  const samples = [];
  const signatures = [];
  for (let index = 0; index < FILM_SHOTS.length; index++) {
    const time = index * SHOT_DURATION + 2;
    const pixels = await page.evaluate((t) => {
      const canvas = document.querySelector('#film'),
        context = canvas.getContext('2d');
      window.renderFilmFrame(t, true);
      const a = context.getImageData(0, 0, 1920, 1080).data;
      const signature = [];
      for (let y = 0; y < 18; y++)
        for (let x = 0; x < 32; x++) {
          const i = ((y * 60 + 30) * 1920 + x * 60 + 30) * 4;
          signature.push(a[i], a[i + 1], a[i + 2]);
        }
      window.renderFilmFrame(t + 0.35, true);
      const b = context.getImageData(0, 0, 1920, 1080).data;
      let bright = 0,
        changed = 0,
        sum = 0;
      for (let i = 0; i < a.length; i += 16) {
        const value = (a[i] + a[i + 1] + a[i + 2]) / 3;
        sum += value;
        if (value > 35) bright++;
        if (
          Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) >
          15
        )
          changed++;
      }
      return {
        mean: sum / (a.length / 16),
        brightPixels: bright,
        changedPixels: changed,
        signature,
      };
    }, time);
    signatures.push(pixels.signature);
    delete pixels.signature;
    if (pixels.brightPixels < 10000 || pixels.changedPixels < 500)
      throw new Error(`Scene is blank, underexposed, or static: ${FILM_SHOTS[index].id}`);
    await page.evaluate((t) => window.renderFilmFrame(t, true), time);
    await page.screenshot({
      path: `${artifacts}/background-${index + 1}.jpg`,
      type: 'jpeg',
      quality: 90,
    });
    await page.evaluate((t) => window.renderFilmFrame(t, false), time);
    await page.screenshot({
      path: `${artifacts}/shot-${index + 1}.jpg`,
      type: 'jpeg',
      quality: 90,
    });
    samples.push({ time, scene: FILM_SHOTS[index].id, ...pixels });
    console.log('Scene check:', samples.at(-1));
  }
  const distinctness = signatures.slice(1).map((signature, index) => {
    const meanDifference =
      signature.reduce((sum, value, i) => sum + Math.abs(value - signatures[index][i]), 0) /
      signature.length;
    if (meanDifference < 6) throw new Error(`Scenes ${index + 1} and ${index + 2} are too similar`);
    return { from: index + 1, to: index + 2, meanDifference };
  });
  for (const time of [0, 3.99, 4, 7.99, 16, 20, 28, 31.99, 32]) {
    await page.evaluate((t) => window.renderFilmFrame(t, true), time);
    const mean = await page.evaluate(() => {
      const data = document
        .querySelector('#film')
        .getContext('2d')
        .getImageData(0, 0, 1920, 1080).data;
      let total = 0;
      for (let i = 0; i < data.length; i += 32) total += data[i] + data[i + 1] + data[i + 2];
      return total / (data.length / 32) / 3;
    });
    if (mean < 8) throw new Error(`Blank transition at ${time}s`);
  }
  await writeFile(
    `${artifacts}/scene-verification.json`,
    JSON.stringify({ ...info, samples, distinctness, errors }, null, 2),
  );
  if (errors.length) throw new Error(errors.join('\n'));
  if (!qaOnly) {
    encoders.push(...modes.map(createEncoder));
    for (let frame = 0; frame < frameCount; frame++) {
      const data = await page.evaluate((time) => window.renderFilmFrames(time), frame / 30);
      for (const encoder of encoders) {
        if (encoder.stopped) throw new Error('Encoder stopped: ' + encoder.log.slice(-1800));
        if (!encoder.process.stdin.write(Buffer.from(data[encoder.mode], 'base64')))
          await once(encoder.process.stdin, 'drain');
      }
      if (frame % 60 === 0)
        console.log(`Rendered ${frame}/${frameCount} / ${(frame / 30).toFixed(1)}s`);
    }
    for (const encoder of encoders) encoder.process.stdin.end();
    for (const encoder of encoders) {
      const code = await encoder.completed;
      await writeFile(`${artifacts}/${encoder.mode}-encoding.log`, encoder.log);
      if (code !== 0) throw new Error('FFmpeg failed: ' + encoder.log.slice(-1800));
    }
    for (const encoder of encoders) {
      await rename(encoder.temporary, encoder.final);
      const bytes = await readFile(encoder.final);
      const manifest = {
        ...info,
        typography: encoder.mode === 'full',
        videoCodec: 'H.264',
        audioCodec: 'AAC',
        audioSampleRate: 48000,
        renderedFrames: frameCount,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        frameChecks: samples,
        distinctness,
        sourceFiles: [
          'src/film-world.js',
          'src/film-storyboard.js',
          'src/film.js',
          'scripts/compose.mjs',
        ],
      };
      await writeFile(
        `public/media/${encoder.mode === 'full' ? 'film' : 'background'}-v2-manifest.json`,
        JSON.stringify(manifest, null, 2),
      );
      await copyFile(
        `${artifacts}/${encoder.mode === 'full' ? 'shot' : 'background'}-1.jpg`,
        `public/media/chainlab-${encoder.mode === 'full' ? 'poster' : 'background-poster'}-v2.jpg`,
      );
      console.log(`Completed: ${encoder.final} / ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);
    }
  }
} finally {
  for (const encoder of encoders)
    if (!encoder.stopped) {
      encoder.process.kill();
      await encoder.completed.catch(() => {});
    }
  await browser?.close();
  await server.close();
}
