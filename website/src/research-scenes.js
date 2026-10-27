import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildResilience } from './resilience-scene.js';
import { buildFoundation } from './foundation-scene.js';
import { buildBriefing } from './briefing-scene.js';
import {
  spherePositions,
  geoPosition,
  geographicArc,
  resiliencePhase,
  GLOBE_PLACES,
  globeRoutes,
} from './research-models.js';

const C = { teal: 0x397edb, lime: 0xe77932, coral: 0x6da9d9, white: 0xd7e2f2 };
const Y = new THREE.Vector3(0, 1, 0);
let landPromise;

async function loadLand() {
  landPromise ??= fetch('/media/ne-110m-land.geojson')
    .then(async (response) => {
      if (!response.ok) throw new Error(`Land geometry: HTTP ${response.status}`);
      const data = await response.json();
      if (data.type !== 'FeatureCollection' || !data.features?.length) {
        throw new Error('Invalid Natural Earth land geometry');
      }
      return data;
    })
    .catch((error) => {
      landPromise = undefined;
      throw error;
    });
  return landPromise;
}

function landTexture(data) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2265b6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#5f96d6';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += canvas.width / 12) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += canvas.height / 12) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#e1ebfa';
  ctx.strokeStyle = '#f4f8ff';
  for (const feature of data.features) {
    const geometry = feature.geometry;
    const polygons =
      geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
    for (const polygon of polygons) {
      ctx.beginPath();
      for (const ring of polygon) {
        ring.forEach(([lon, lat], i) => {
          const x = ((lon + 180) / 360) * canvas.width;
          const y = ((90 - lat) / 180) * canvas.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function label(text, color = '#69768a', width = 1.5) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = '25px "Segoe UI", sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 192, 48);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false }));
  sprite.scale.set(width, width / 4, 1);
  return sprite;
}

function tube(group, curve, color, opacity = 0.5, radius = 0.018) {
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 32, radius, 5, false),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  group.add(mesh);
  return mesh;
}

function flow(group, curve, index, color = C.lime, speed = 0.13, scale = 1) {
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.075, 0.24, 6),
    new THREE.MeshBasicMaterial({ color }),
  );
  arrow.scale.setScalar(scale);
  group.add(arrow);
  return (time) => {
    const t = (time * speed + index * 0.137) % 1;
    arrow.position.copy(curve.getPoint(t));
    arrow.quaternion.setFromUnitVectors(Y, curve.getTangent(t).normalize());
  };
}

function buildNetwork(group) {
  const positions = spherePositions();
  const geometry = new THREE.IcosahedronGeometry(0.085, 1);
  const materials = [C.teal, C.white, C.coral].map(
    (color) =>
      new THREE.MeshStandardMaterial({
        color,
        metalness: 0.38,
        roughness: 0.3,
      }),
  );
  const nodes = positions.map((position, i) => {
    const mesh = new THREE.Mesh(geometry, materials[i % 3]);
    mesh.position.copy(position);
    group.add(mesh);
    return mesh;
  });
  const edges = new Set();
  positions.forEach((p, i) => {
    positions
      .map((q, j) => ({ j, d: p.distanceToSquared(q) }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .forEach(({ j }) => edges.add(`${Math.min(i, j)}:${Math.max(i, j)}`));
  });
  const linePoints = [];
  for (const pair of edges) {
    const [i, j] = pair.split(':').map(Number);
    linePoints.push(positions[i], positions[j]);
  }
  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(linePoints),
      new THREE.LineBasicMaterial({ color: 0x6295d5, transparent: true, opacity: 0.54 }),
    ),
  );
  const runners = [];
  const hubs = [7, 24, 45];
  hubs.forEach((id, h) => {
    nodes[id].scale.setScalar(2.5);
    nodes[id].material = new THREE.MeshStandardMaterial({
      color: h === 1 ? C.coral : 0xe77932,
      metalness: 0.35,
      roughness: 0.25,
      emissive: C.lime,
      emissiveIntensity: 0.12,
    });
    const text = label(`N${String(id + 1).padStart(2, '0')}`, '#465166', 0.85);
    text.position.copy(positions[id]).add(new THREE.Vector3(0.25, 0.35, 0));
    group.add(text);
    [5, 15, 28, 40, 58, 65].forEach((j, k) => {
      const end = positions[(j + id) % 72];
      const curve = new THREE.QuadraticBezierCurve3(
        positions[id],
        positions[id].clone().lerp(end, 0.5).multiplyScalar(0.6),
        end,
      );
      tube(group, curve, h === 1 ? C.coral : C.teal, 0.62);
      runners.push(flow(group, curve, k + h * 6, h === 1 ? C.coral : 0xcf681f));
    });
  });
  const equator = new THREE.Mesh(
    new THREE.TorusGeometry(3.9, 0.012, 5, 128),
    new THREE.MeshBasicMaterial({ color: 0x397edb, transparent: true, opacity: 0.24 }),
  );
  equator.rotation.x = Math.PI / 2;
  group.add(equator);
  return {
    stats: { nodes: 72, links: edges.size + 18, conceptual: true },
    update(time) {
      group.rotation.set(0.12 + Math.sin(time * 0.17) * 0.08, time * 0.055, -0.12);
      nodes.forEach((node, i) => {
        const base = hubs.includes(i) ? 2.5 : 1;
        node.scale.setScalar(base * (1 + 0.1 * Math.sin(time * 1.8 + i)));
      });
      runners.forEach((run) => run(time));
    },
  };
}

function buildGlobe(group, land) {
  group.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(3.3, 80, 48),
      new THREE.MeshStandardMaterial({ map: landTexture(land), roughness: 0.7, metalness: 0.05 }),
    ),
  );
  const nodeGeometry = new THREE.SphereGeometry(0.055, 10, 8);
  GLOBE_PLACES.forEach((place, i) => {
    const pin = new THREE.Mesh(
      nodeGeometry,
      new THREE.MeshBasicMaterial({ color: i % 2 ? C.coral : C.lime }),
    );
    pin.position.copy(geoPosition(...place, 3.36));
    group.add(pin);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.01, 5, 24),
      new THREE.MeshBasicMaterial({ color: C.lime }),
    );
    ring.position.copy(pin.position);
    ring.lookAt(pin.position.clone().multiplyScalar(2));
    group.add(ring);
  });
  const pairs = globeRoutes();
  const runners = pairs.map(([i, j], k) => {
    const curve = geographicArc(GLOBE_PLACES[i], GLOBE_PLACES[j]);
    const primary = i === 0 || j === 0 || k % 7 === 0;
    const color = primary ? (k % 3 === 0 ? C.coral : C.lime) : 0x6b99d4;
    tube(group, curve, color, primary ? 0.8 : 0.44, primary ? 0.017 : 0.009);
    return flow(group, curve, k, color, 0.09 + (k % 4) * 0.014, primary ? 0.9 : 0.55);
  });
  return {
    stats: {
      landFeatures: land.features.length,
      locations: GLOBE_PLACES.length,
      routes: pairs.length,
      conceptual: true,
    },
    update(time) {
      group.rotation.set(0.12, 2.7 + Math.sin(time * 0.12) * 0.26, -0.08);
      runners.forEach((run) => run(time));
    },
  };
}

function documentFace(text, accent) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 320);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 256, 12);
  ctx.font = 'bold 32px "Segoe UI", sans-serif';
  ctx.fillStyle = '#20242b';
  ctx.fillText(text, 22, 64);
  ctx.fillStyle = '#bfd1f2';
  for (let i = 0; i < 5; i++) ctx.fillRect(22, 100 + i * 29, i % 2 ? 145 : 205, 7);
  ctx.fillStyle = accent;
  ctx.fillRect(22, 271, 55, 22);
  ctx.fillStyle = '#465166';
  ctx.font = '18px monospace';
  ctx.fillText('v01', 165, 287);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildEvidence(group) {
  const columns = [
    { x: -4.1, ys: [0], tag: 'DATA', color: '#397edb' },
    { x: -2, ys: [-2.35, 0, 2.35], tag: 'M', color: '#7aace6' },
    { x: 0.25, ys: [-3, -1.8, -0.6, 0.6, 1.8, 3], tag: 'R', color: '#e77932' },
    { x: 2.6, ys: [-2.35, 0, 2.35], tag: 'CHECK', color: '#92b4df' },
    { x: 4.6, ys: [0], tag: 'END', color: '#205ecf' },
  ];
  const documents = [],
    byColumn = [];
  const geometry = new RoundedBoxGeometry(0.78, 0.96, 0.16, 2, 0.035);
  columns.forEach(({ x, ys, tag, color }, c) => {
    const items = ys.map((y, i) => {
      const node = new THREE.Group();
      const body = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color,
          metalness: 0.2,
          roughness: 0.35,
        }),
      );
      node.add(body);
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.88),
        new THREE.MeshBasicMaterial({
          map: documentFace(ys.length > 1 && tag !== 'CHECK' ? `${tag}0${i + 1}` : tag, color),
        }),
      );
      face.position.z = 0.09;
      node.add(face);
      node.position.set(x, y, Math.sin(i * 1.4 + c) * 0.35);
      group.add(node);
      documents.push({ node, c });
      return node;
    });
    byColumn.push(items);
  });
  const runners = [];
  for (let c = 0; c < byColumn.length - 1; c++) {
    const next = byColumn[c + 1];
    const current = byColumn[c];
    const count = Math.max(current.length, next.length);
    for (let i = 0; i < count; i++) {
      const a = current[Math.floor((i * current.length) / count)].position;
      const b = next[Math.floor((i * next.length) / count)].position;
      const curve = new THREE.CubicBezierCurve3(
        a,
        new THREE.Vector3(a.x + 0.8, a.y, a.z),
        new THREE.Vector3(b.x - 0.8, b.y, b.z),
        b,
      );
      tube(group, curve, c < 2 ? C.teal : C.lime, 0.52, 0.014);
      runners.push(flow(group, curve, i + c * 3, c < 2 ? C.teal : C.lime, 0.18));
    }
  }
  return {
    stats: { records: documents.length, stages: columns.length, conceptual: true },
    update(time) {
      group.rotation.set(0.08, -0.15 + Math.sin(time * 0.17) * 0.08, -0.02);
      documents.forEach(({ node, c }, i) => {
        node.rotation.y = Math.sin(time * 0.6 + i * 0.4) * 0.12;
        const pulse = 1 + Math.max(0, Math.sin(time * 1.7 - c * 1.1)) * 0.065;
        node.scale.setScalar(pulse);
      });
      runners.forEach((run) => run(time));
    },
  };
}

export async function createResearchScene(canvas, { type, reduced = false } = {}) {
  const land = type === 'globe' ? await loadLand() : null;
  const parent = canvas.parentElement;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(getComputedStyle(parent).getPropertyValue('--band-bg').trim());
  let environmentTarget;
  if (type === 'resilience') {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    environmentTarget = pmrem.fromScene(room, 0.04);
    scene.environment = environmentTarget.texture;
    room.dispose();
    pmrem.dispose();
  }
  scene.add(new THREE.HemisphereLight(0xf0f5ff, 0x526580, type === 'globe' ? 1.5 : 3));
  const key = new THREE.DirectionalLight(0xffffff, type === 'globe' ? 2.4 : 3);
  key.position.set(-3, 6, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(C.coral, 1.5);
  rim.position.set(4, 1, -3);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  const world = new THREE.Group(),
    modelGroup = new THREE.Group();
  scene.add(world);
  world.add(modelGroup);
  const builders = {
    mechanism: buildFoundation,
    network: buildNetwork,
    globe: buildGlobe,
    resilience: buildResilience,
    evidence: buildEvidence,
    briefing: buildBriefing,
  };
  const model = builders[type](modelGroup, land);
  const pointer = new THREE.Vector2(),
    eased = new THREE.Vector2();
  let active = false,
    paused = reduced,
    disposed = false,
    raf = 0,
    time = 0,
    last = 0,
    cameraDistance = 14;
  const phaseLabel = parent.querySelector('.scene-phase');
  const phaseButtons = [...parent.querySelectorAll('[data-scene-time]')];
  let currentPhase;
  function render(at, snap = false) {
    if (disposed) return;
    if (snap) eased.copy(pointer);
    else eased.lerp(pointer, 0.075);
    world.rotation.set(
      eased.y * (type === 'mechanism' ? 0.16 : 0.22),
      eased.x * (type === 'mechanism' ? 0.32 : type === 'globe' ? 0.7 : 0.35),
      0,
    );
    model.update(at);
    camera.position.z = cameraDistance * (model.cameraScale?.() ?? 1);
    const phase = model.phase?.(at) ?? resiliencePhase(at);
    if (phase !== currentPhase) {
      currentPhase = phase;
      if (phaseLabel) phaseLabel.textContent = phase;
      phaseButtons.forEach((button, i) =>
        button.setAttribute('aria-pressed', String(Number(phase.slice(0, 2)) === i + 1)),
      );
    }
    renderer.render(scene, camera);
  }
  function resize() {
    const w = parent.clientWidth,
      h = parent.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const halfHeight = type === 'evidence' || type === 'resilience' ? 5 : 4.8;
    const halfWidth =
      type === 'evidence' ? 5.7 : type === 'resilience' || type === 'mechanism' ? 5.4 : 4.8;
    cameraDistance =
      Math.max(halfHeight, halfWidth / camera.aspect) / Math.tan(THREE.MathUtils.degToRad(19));
    camera.updateProjectionMatrix();
    render(time);
  }
  function frame(now) {
    raf = 0;
    if (disposed || !active || document.hidden || paused) return;
    if (last) time += Math.min((now - last) / 1000, 0.05);
    last = now;
    render(time);
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (active && !document.hidden && !disposed) {
      render(time);
      if (!paused) raf = requestAnimationFrame(frame);
    }
  }
  function pointerMove(event) {
    if (event.pointerType === 'touch') return;
    const bounds = parent.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      ((event.clientY - bounds.top) / bounds.height) * 2 - 1,
    );
    if (paused && active && !document.hidden) render(time, true);
  }
  function pointerLeave() {
    pointer.set(0, 0);
    if (paused && active && !document.hidden) render(time, true);
  }
  const resizer = new ResizeObserver(resize);
  resizer.observe(parent);
  const visibility = new IntersectionObserver(([entry]) => {
    active = entry.isIntersecting;
    sync();
  });
  visibility.observe(parent);
  parent.addEventListener('pointermove', pointerMove);
  parent.addEventListener('pointerleave', pointerLeave);
  document.addEventListener('visibilitychange', sync);
  resize();
  if (reduced) {
    time = type === 'resilience' ? 8 : 3;
    render(time);
  }
  return {
    pointer,
    stats: model.stats,
    getState() {
      world.updateWorldMatrix(true, true);
      const state = model.getState?.();
      if (!state) return null;
      const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      world.traverseVisible((object) => {
        if (!object.isMesh || object.material.opacity < 0.03) return;
        object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox;
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) {
              const p = new THREE.Vector3(x, y, z).applyMatrix4(object.matrixWorld).project(camera);
              bounds.minX = Math.min(bounds.minX, p.x);
              bounds.maxX = Math.max(bounds.maxX, p.x);
              bounds.minY = Math.min(bounds.minY, p.y);
              bounds.maxY = Math.max(bounds.maxY, p.y);
            }
      });
      return { ...state, bounds };
    },
    renderAt: (at) => render(at, true),
    seek(at) {
      time = at;
      render(time, true);
    },
    setPaused(value) {
      paused = Boolean(value);
      sync();
    },
    isPaused: () => paused,
    isRunning: () => Boolean(raf),
    getFrame: () => {
      render(time, true);
      return canvas.toDataURL('image/jpeg', 0.9);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      resizer.disconnect();
      visibility.disconnect();
      parent.removeEventListener('pointermove', pointerMove);
      parent.removeEventListener('pointerleave', pointerLeave);
      document.removeEventListener('visibilitychange', sync);
      const resources = new Set();
      scene.traverse((object) => {
        if (object.geometry) resources.add(object.geometry);
        for (const material of object.material ? [object.material].flat() : []) {
          if (material.map) resources.add(material.map);
          resources.add(material);
        }
      });
      resources.forEach((resource) => resource.dispose());
      environmentTarget?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
