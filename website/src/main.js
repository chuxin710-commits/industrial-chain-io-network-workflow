import { createIcons, icons } from './icons.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { shotAt } from './film-storyboard.js';
import './styles.css';
import './home-visual.css';

createIcons({ icons });
gsap.registerPlugin(ScrollTrigger);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const video = document.querySelector('#hero-video');
const sound = document.querySelector('#sound-toggle');
const motion = document.querySelector('#motion-toggle');
const dialog = document.querySelector('#film-dialog');
const player = document.querySelector('#film-player');
let manuallyPaused = reduced;
let lenis;
if (reduced) {
  video.autoplay = false;
  video.pause();
}

function updateControl(button, icon, label) {
  button.innerHTML = `<i data-lucide="${icon}"></i>`;
  button.setAttribute('aria-label', label);
  button.title = label;
  createIcons({ icons });
}
function syncMotion() {
  updateControl(
    motion,
    video.paused ? 'play' : 'pause',
    video.paused ? '播放背景影片' : '暂停背景影片',
  );
}
video.addEventListener('pause', syncMotion);
video.addEventListener('play', syncMotion);
let activeChapter = -1;
video.addEventListener('timeupdate', () => {
  const chapter = shotAt(video.currentTime);
  const { index } = chapter;
  if (index === activeChapter) return;
  activeChapter = index;
  document.querySelector('#chapter-index').textContent =
    `${String(index + 1).padStart(2, '0')} / ${chapter.name}`;
  document.querySelector('#chapter-cn').textContent = chapter.cn;
  document.querySelector('#chapter-en').textContent = chapter.en;
  if (!reduced)
    gsap.fromTo(
      '.hero-chapter',
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' },
    );
});
motion.addEventListener('click', async () => {
  manuallyPaused = !video.paused;
  if (video.paused) {
    try {
      await video.play();
    } catch {
      manuallyPaused = true;
    }
  } else video.pause();
  syncMotion();
});
sound.addEventListener('click', async () => {
  video.muted = !video.muted;
  video.volume = 0.55;
  if (!video.muted && video.paused) {
    try {
      await video.play();
      manuallyPaused = false;
    } catch {
      video.muted = true;
    }
  }
  updateControl(
    sound,
    video.muted ? 'volume-x' : 'volume-2',
    video.muted ? '开启原创音乐' : '关闭原创音乐',
  );
});

let backgroundWasPlaying = false;
document.querySelector('#watch-film').addEventListener('click', async () => {
  backgroundWasPlaying = !video.paused;
  video.pause();
  lenis?.stop();
  dialog.showModal();
  document.body.style.overflow = 'hidden';
  player.currentTime = 0;
  player.muted = false;
  player.volume = 0.7;
  try {
    await player.play();
  } catch {
    /* Native controls remain available. */
  }
});
const closeFilm = () => dialog.close();
document.querySelector('#close-film').addEventListener('click', closeFilm);
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      closeFilm();
  }
});
dialog.addEventListener('close', () => {
  player.pause();
  document.body.style.overflow = '';
  lenis?.start();
  if (backgroundWasPlaying && !manuallyPaused) video.play().catch(() => {});
});

if (!reduced) {
  lenis = new Lenis({ duration: 1.15, smoothWheel: true, syncTouch: false, anchors: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  const heroCenter = document.querySelector('.hero-center');
  heroCenter.classList.add('is-entering');
  gsap.from('.hero-center > *', {
    y: 20,
    opacity: 0,
    duration: 1.1,
    stagger: 0.13,
    delay: 0.2,
    ease: 'power3.out',
    clearProps: 'transform,opacity',
    onComplete: () => heroCenter.classList.remove('is-entering'),
  });
  gsap.to('.hero-media', {
    scale: 1.09,
    y: 90,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 1 },
  });
  gsap.to('.hero-center', {
    yPercent: -18,
    opacity: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: '35% top', end: 'bottom top', scrub: 1 },
  });
  gsap.utils
    .toArray('.section-heading, .feature, .foundation-content, .band-content, .closing-section h2')
    .forEach((element) => {
      gsap.from(element, {
        y: 36,
        opacity: 0,
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: { trigger: element, start: 'top 90%', once: true },
      });
    });
}

const heroObserver = new IntersectionObserver(
  (entries) => {
    if (entries[0].isIntersecting && !manuallyPaused && !dialog.open && !document.hidden)
      video.play().catch(() => {});
    else video.pause();
  },
  { threshold: 0.05 },
);
heroObserver.observe(document.querySelector('.hero'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    video.pause();
    player.pause();
  } else if (
    !manuallyPaused &&
    !dialog.open &&
    document.querySelector('.hero').getBoundingClientRect().bottom > 0
  )
    video.play().catch(() => {});
});

window.chainlabModules = {};
const moduleObserver = new IntersectionObserver(
  async (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const art = entry.target;
      moduleObserver.unobserve(art);
      const type = art.dataset.scene;
      const button = art.querySelector('.scene-motion');
      try {
        const { createResearchScene } = await import('./research-scenes.js');
        const scene = await createResearchScene(art.querySelector('canvas'), { type, reduced });
        window.chainlabModules[type] = scene;
        if (type === 'mechanism') window.chainlabScene = scene;
        const syncButton = () => {
          const paused = scene.isPaused();
          updateControl(
            button,
            paused ? 'play' : 'pause',
            `${paused ? '播放' : '暂停'}${button.dataset.name}动画`,
          );
        };
        button.addEventListener('click', () => {
          scene.setPaused(!scene.isPaused());
          syncButton();
        });
        art.querySelectorAll('[data-scene-time]').forEach((phase) =>
          phase.addEventListener('click', () => {
            scene.seek(Number(phase.dataset.sceneTime));
            scene.setPaused(true);
            syncButton();
          }),
        );
        syncButton();
      } catch (error) {
        art.classList.add('webgl-unavailable');
        art.style.backgroundImage = `url(/media/research-${type}.jpg)`;
        art.querySelector('.scene-fallback').hidden = false;
        const phase = art.querySelector('.scene-phase');
        if (phase) phase.textContent = 'STATIC / CONCEPT';
        button.hidden = true;
        const timeline = art.querySelector('.resilience-timeline');
        if (timeline) timeline.hidden = true;
        console.warn(`Concept scene ${type} unavailable:`, error.message);
      }
    }
  },
  { rootMargin: '250px' },
);
document.querySelectorAll('[data-scene]').forEach((art) => moduleObserver.observe(art));
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) Object.values(window.chainlabModules).forEach((scene) => scene.dispose());
});
syncMotion();
window.chainlabReady = true;
