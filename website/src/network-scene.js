import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const COLORS = { lime: 0xc8f36b, teal: 0x5cb6bd, silver: 0xd4e7e1, coral: 0xed8a6b };
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, t) => {
  const x = THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

function matrixTexture(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const c = canvas.getContext('2d');
  c.fillStyle = '#14272d';
  c.fillRect(0, 0, 512, 320);
  c.strokeStyle = '#3e686a';
  c.lineWidth = 1;
  for (let x = 16; x < 512; x += 24) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, 320);
    c.stroke();
  }
  for (let y = 10; y < 320; y += 24) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(512, y);
    c.stroke();
  }
  for (let row = 0; row < 12; row++)
    for (let col = 0; col < 20; col++) {
      const v = (Math.sin(row * 7.12 + col * 3.31 + seed * 1.4) + 1) / 2;
      c.fillStyle = v > 0.8 ? '#c8f36b' : v > 0.4 ? '#427e85' : '#1c383d';
      c.fillRect(18 + col * 24, 12 + row * 24, 18, 18);
    }
  c.fillStyle = '#e3eee8';
  c.font = '13px monospace';
  c.fillText(`CHAINLAB / MATRIX ${String(seed + 1).padStart(2, '0')}`, 20, 308);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildResearchWorld(canvas, { exportMode = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: exportMode,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(exportMode ? 1 : Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d1110');
  scene.fog = new THREE.FogExp2('#0d1110', 0.014);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  const target = pmrem.fromScene(environment, 0.04);
  scene.environment = target.texture;
  environment.dispose();
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(43, 16 / 9, 0.1, 100);
  camera.position.set(11, 3, 17);
  scene.add(new THREE.HemisphereLight(0xd5f4ee, 0x142f3d, 1.3));
  const light = new THREE.DirectionalLight(0xf4fff0, 4.0);
  light.position.set(-5, 8, 5);
  scene.add(light);
  const rim = new THREE.PointLight(COLORS.teal, 65, 25, 1.5);
  rim.position.set(-6, -1, 5);
  scene.add(rim);
  const warm = new THREE.PointLight(COLORS.coral, 45, 25, 1.5);
  warm.position.set(6, 3, -3);
  scene.add(warm);
  const world = new THREE.Group();
  scene.add(world);
  const chain = new THREE.Group();
  world.add(chain);
  const linkGeometry = new THREE.TorusGeometry(0.63, 0.105, 12, 40);
  const linkMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xd9e2d6, metalness: 0.96, roughness: 0.15 }),
    new THREE.MeshStandardMaterial({ color: COLORS.lime, metalness: 0.76, roughness: 0.2 }),
    new THREE.MeshStandardMaterial({ color: COLORS.coral, metalness: 0.83, roughness: 0.2 }),
  ];
  for (let i = 0; i < 7; i++) {
    const link = new THREE.Mesh(linkGeometry, linkMaterials[i % 3]);
    link.position.set(0, (i - 3) * 0.96, 0);
    link.scale.set(1, 1.35, 1);
    link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    chain.add(link);
  }
  chain.position.set(5.2, 0, 1.7);
  chain.rotation.z = -0.3;
  const nodes = [],
    positions = [];
  const cube = new RoundedBoxGeometry(0.31, 0.31, 0.31, 2, 0.055);
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: 0x639ca3,
    metalness: 0.72,
    roughness: 0.3,
    transparent: true,
    opacity: 0.62,
  });
  for (let i = 0; i < 42; i++) {
    const angle = i * 0.66;
    const y = (i / 41 - 0.5) * 8.3;
    const r = 2.6 + 0.32 * Math.sin(i * 0.46);
    const p = new THREE.Vector3(Math.cos(angle) * r + y * 0.23, y, Math.sin(angle) * r);
    positions.push(p);
    const color =
      i % 9 === 0
        ? COLORS.coral
        : i % 5 === 0
          ? COLORS.lime
          : i % 3 === 0
            ? COLORS.silver
            : COLORS.teal;
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.65,
      roughness: 0.24,
      emissive: color,
      emissiveIntensity: i % 5 === 0 ? 0.24 : 0.035,
    });
    const mesh = new THREE.Mesh(cube, material);
    mesh.position.copy(p);
    mesh.rotation.set(i * 0.35, i * 0.27, 0.4);
    world.add(mesh);
    nodes.push(mesh);
  }
  const edges = [],
    flows = [];
  const pairs = [];
  for (let i = 0; i < 42; i++) {
    if (i < 41) pairs.push([i, i + 1]);
    if (i < 36) pairs.push([i, i + 6]);
    if (i % 4 === 0 && i < 30) pairs.push([i, i + 12]);
  }
  const flowGeometry = new THREE.BoxGeometry(0.065, 0.065, 0.17);
  const flowMaterial = new THREE.MeshBasicMaterial({ color: COLORS.lime });
  for (const [i, j] of pairs) {
    const a = positions[i],
      b = positions[j];
    const mid = a.clone().lerp(b, 0.5).multiplyScalar(1.05);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const geometry = new THREE.TubeGeometry(curve, 12, 0.018, 5, false);
    const tube = new THREE.Mesh(geometry, edgeMaterial);
    world.add(tube);
    edges.push(tube);
    const flow = new THREE.Mesh(flowGeometry, flowMaterial);
    world.add(flow);
    flows.push({ mesh: flow, curve, offset: (i * 0.173 + j * 0.081) % 1 });
  }
  const sheets = new THREE.Group();
  world.add(sheets);
  const plateGeometry = new THREE.BoxGeometry(3.2, 2, 0.055);
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: 0x367477,
    metalness: 0.72,
    roughness: 0.28,
    transparent: true,
    opacity: 0.6,
  });
  const borderMaterial = new THREE.LineBasicMaterial({
    color: 0x729d9c,
    transparent: true,
    opacity: 0.65,
  });
  const plates = [];
  for (let i = 0; i < 5; i++) {
    const plate = new THREE.Group();
    plate.add(new THREE.Mesh(plateGeometry, plateMaterial));
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(3.13, 1.94),
      new THREE.MeshBasicMaterial({
        map: matrixTexture(i),
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
      }),
    );
    face.position.z = 0.033;
    plate.add(face);
    plate.add(new THREE.LineSegments(new THREE.EdgesGeometry(plateGeometry), borderMaterial));
    plate.position.set(-4.6 + (i % 2) * 0.5, (i - 2) * 1.23, -0.4 + (i % 2) * 0.35);
    plate.rotation.set(-0.15, 0.6, -0.1);
    sheets.add(plate);
    plates.push(plate);
  }
  const orbit = new THREE.Group();
  world.add(orbit);
  const orbitMaterial = new THREE.LineBasicMaterial({
    color: 0x527d78,
    transparent: true,
    opacity: 0.5,
  });
  for (let r = 0; r < 3; r++) {
    const points = [];
    for (let j = 0; j <= 128; j++) {
      const t = (j / 128) * Math.PI * 2;
      points.push(
        new THREE.Vector3(Math.cos(t) * (4.7 + r * 0.22), 0, Math.sin(t) * (4.7 + r * 0.22)),
      );
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), orbitMaterial);
    line.rotation.set(0.65 + r * 0.4, 0, 0.35 + r * 0.4);
    orbit.add(line);
  }
  const pointer = new THREE.Vector2();
  const aim = new THREE.Vector3(0, 0, 0);
  function resize(width, height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  function render(time, { film = false, chapter = 0 } = {}) {
    const cycle = (time / 32) * Math.PI * 2;
    world.rotation.y = Math.sin(cycle) * 0.24 + Math.cos(cycle) * 0.14;
    world.rotation.z = 0.08 * Math.sin(cycle + 0.5);
    world.rotation.x = pointer.y * 0.09;
    world.rotation.y += pointer.x * 0.14;
    world.position.y = Math.sin(cycle) * 0.18;
    nodes.forEach((mesh, i) => {
      const wave = 1 + 0.09 * Math.sin(cycle * 6 - i * 0.37);
      const shock = film ? smooth(16, 18, time) * (1 - smooth(21, 24, time)) : 0;
      const pulse = Math.max(0, Math.sin(i * 0.23 - time * 1.1)) * shock;
      mesh.scale.setScalar(wave + pulse * 0.24);
      mesh.material.emissiveIntensity = (i % 5 === 0 ? 0.22 : 0.045) + pulse * 0.62;
      mesh.rotation.y = i * 0.27 + cycle;
    });
    flows.forEach(({ mesh, curve, offset }, i) => {
      const p = (time * 0.125 + offset) % 1;
      mesh.position.copy(curve.getPoint(p));
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        curve.getTangent(p).normalize(),
      );
      mesh.visible = !film || chapter !== 2 || i % 4 !== 0;
    });
    plates.forEach((p, i) => {
      p.position.x = -4.4 + Math.sin(cycle + i * 0.3) * 0.2 + (i % 2) * 0.5;
      p.rotation.y = 0.5 + Math.sin(cycle + i * 0.5) * 0.13;
    });
    sheets.position.x = film ? mix(0, -0.8, smooth(7, 10, time)) : 0;
    orbit.rotation.y = Math.sin(cycle) * 0.15;
    chain.visible = film;
    chain.rotation.y = Math.sin(cycle) * 0.4;
    const amplitude = film ? 1 : 0;
    const distance = film ? 19.1 - 1.1 * Math.sin(cycle) : 18;
    if (film) {
      const keys = [
        [0, 13, 7, 22],
        [4, 10, 4, 19],
        [8, 9, 3, 18],
        [12, 5, 1, 14],
        [16, 11, 5, 17],
        [20, 7, -1, 12],
        [24, 10, 3, 18],
        [28, 12, 4, 20],
        [32, 13, 7, 22],
      ];
      const k = Math.min(7, Math.floor(time / 4));
      const f = smooth(keys[k][0], keys[k + 1][0], time);
      camera.position.set(
        mix(keys[k][1], keys[k + 1][1], f),
        mix(keys[k][2], keys[k + 1][2], f),
        mix(keys[k][3], keys[k + 1][3], f),
      );
    } else camera.position.set(9, 2.5, distance);
    if (camera.aspect < 0.8) camera.position.z += 7;
    aim.set(film ? -2.2 : 0, 0, 0);
    camera.lookAt(aim);
    renderer.render(scene, camera);
  }
  function dispose() {
    renderer.dispose();
    target.dispose();
    scene.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) {
        const all = Array.isArray(object.material) ? object.material : [object.material];
        all.forEach((m) => {
          m.map?.dispose();
          m.dispose();
        });
      }
    });
  }
  return {
    renderer,
    scene,
    camera,
    render,
    resize,
    pointer,
    dispose,
    nodes: 42,
    edges: pairs.length,
  };
}

export function createNetworkScene(canvas, { interactive = true, reduced = false } = {}) {
  const world = buildResearchWorld(canvas);
  const parent = canvas.parentElement;
  let active = true;
  const resize = () => world.resize(parent.clientWidth, parent.clientHeight);
  const observer = new ResizeObserver(resize);
  observer.observe(parent);
  resize();
  const intersection = new IntersectionObserver(
    (entries) => {
      active = entries[0].isIntersecting;
    },
    { rootMargin: '150px' },
  );
  intersection.observe(parent);
  if (interactive)
    parent.addEventListener('pointermove', (event) => {
      const r = parent.getBoundingClientRect();
      world.pointer.set(
        ((event.clientX - r.left) / r.width) * 2 - 1,
        ((event.clientY - r.top) / r.height) * 2 - 1,
      );
    });
  parent.addEventListener('pointerleave', () => world.pointer.set(0, 0));
  let start = performance.now();
  function animate(now) {
    if (active && !document.hidden) world.render(reduced ? 4 : (now - start) / 1000);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  return {
    ...world,
    renderAt: (time) => world.render(time),
    getFrame: () => world.renderer.domElement.toDataURL('image/png'),
  };
}
