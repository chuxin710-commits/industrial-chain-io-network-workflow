import { buildFilmWorld } from './film-world.js';
import { FILM_DURATION, FILM_SHOTS, FILM_VERSION } from './film-storyboard.js';

const output = document.querySelector('#film');
const exportMode = new URLSearchParams(location.search).has('export');
const backgroundMode = new URLSearchParams(location.search).has('background');
const glCanvas = document.createElement('canvas');
const world = buildFilmWorld(glCanvas);
const ctx = output.getContext('2d', { alpha: false });
const ease = (value) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

function resize() {
  output.width = exportMode ? 1920 : innerWidth;
  output.height = exportMode ? 1080 : innerHeight;
  world.resize(output.width, output.height);
}
resize();
if (!exportMode) addEventListener('resize', resize);

function drawingCoordinates() {
  const scale = Math.min(output.width / 1920, output.height / 1080);
  ctx.translate((output.width - 1920 * scale) / 2, (output.height - 1080 * scale) / 2);
  ctx.scale(scale, scale);
}

function drawTypography(shot) {
  const entry = ease(shot.local / 0.45),
    exit = ease((shot.local - 3.6) / 0.4);
  ctx.save();
  drawingCoordinates();
  ctx.fillStyle = '#e4eee8';
  ctx.font = '600 22px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.fillText('CHAINLAB', 92, 77);
  ctx.fillStyle = '#8cb9b4';
  ctx.font = '13px monospace';
  ctx.fillText('INDUSTRIAL CHAIN / RESEARCH PLATFORM', 92, 104);
  ctx.textAlign = 'right';
  ctx.fillStyle = shot.accent;
  ctx.fillText(`${String(shot.index + 1).padStart(2, '0')} / 08`, 1828, 77);
  ctx.fillStyle = '#93aaa7';
  ctx.fillText('THE CHAIN OF DISCOVERY / V2', 1828, 104);
  ctx.textAlign = 'left';
  ctx.globalAlpha = entry * (1 - exit);
  ctx.translate((1 - entry) * -50 + exit * 30, 0);
  ctx.fillStyle = 'rgba(4,10,12,.62)';
  ctx.fillRect(0, 775, 1920, 305);
  ctx.fillStyle = shot.accent;
  ctx.font = '500 16px monospace';
  ctx.fillText(`${String(shot.index + 1).padStart(2, '0')} / ${shot.name}`, 95, 817);
  ctx.fillStyle = '#f4faf5';
  ctx.font = `700 ${shot.index === 7 ? 94 : 68}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  ctx.fillText(shot.cn, 91, shot.index === 7 ? 927 : 915);
  ctx.fillStyle = '#c5e2dc';
  ctx.font = '400 26px "Segoe UI", sans-serif';
  ctx.fillText(shot.en, shot.index === 7 ? 313 : 96, shot.index === 7 ? 927 : 962);
  ctx.fillStyle = '#8caaa2';
  ctx.font = '18px "Microsoft YaHei", sans-serif';
  ctx.fillText(shot.tag, 97, 1010);
  ctx.restore();
  ctx.save();
  drawingCoordinates();
  FILM_SHOTS.forEach((item, index) => {
    ctx.fillStyle = index <= shot.index ? item.accent : '#314143';
    ctx.fillRect(95 + index * 218, 1040, 204, 3);
  });
  ctx.restore();
}

function drawTransition(shot) {
  // A short edge wipe marks phrase changes without full-screen flashes.
  const exit = ease((shot.local - 3.78) / 0.22);
  if (!exit) return;
  ctx.save();
  ctx.fillStyle = shot.accent;
  ctx.globalAlpha = 0.3;
  const width = output.width * 0.035;
  ctx.fillRect(output.width * (1 - exit) - width, 0, width, output.height);
  ctx.globalAlpha = 0.07;
  ctx.fillRect(output.width * (1 - exit), 0, output.width * exit, output.height);
  ctx.restore();
}

function drawScene(time) {
  const shot = world.render(time);
  ctx.drawImage(glCanvas, 0, 0, output.width, output.height);
  drawTransition(shot);
  window.filmCurrentShot = shot.id;
  return shot;
}
const capture = () => output.toDataURL('image/jpeg', 0.93).split(',')[1];

window.renderFilmFrame = (time, clean = backgroundMode) => {
  const shot = drawScene(time);
  if (!clean) drawTypography(shot);
  return capture();
};
window.renderFilmFrames = (time) => {
  const shot = drawScene(time);
  const background = capture();
  drawTypography(shot);
  return { background, full: capture() };
};
window.filmInfo = {
  version: FILM_VERSION,
  width: 1920,
  height: 1080,
  fps: 30,
  duration: FILM_DURATION,
  shotCount: FILM_SHOTS.length,
  shots: world.shots,
  typography: !backgroundMode,
  visualSource:
    'Original procedural Three.js multi-scene concept; no empirical values or outcomes are depicted',
};
await document.fonts.ready;
window.renderFilmFrame(2);
window.filmReady = true;
if (!exportMode) {
  const start = performance.now();
  function animate(now) {
    const shot = drawScene((now - start) / 1000);
    if (!backgroundMode) drawTypography(shot);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
