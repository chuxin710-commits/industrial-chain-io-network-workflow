import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FILM_SHOTS, shotAt } from './film-storyboard.js';

const C = { lime: 0xb9ef42, cyan: 0x27ccd6, coral: 0xff6146, silver: 0xaebdba, graphite: 0x263638 };
const lerp = THREE.MathUtils.lerp;
const ease = (value) => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const vector = (values) => new THREE.Vector3(...values);
const cube = new RoundedBoxGeometry(1, 1, 1, 1, 0.035);
const dummy = new THREE.Object3D();

function metal(color, emissive = 0) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.78,
    roughness: 0.24,
    emissive: color,
    emissiveIntensity: emissive,
  });
}

function box(parent, material, size, position = [0, 0, 0]) {
  const mesh = new THREE.Mesh(cube, material);
  mesh.scale.set(...size);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function tube(parent, points, material, radius = 0.055, curved = true) {
  const curve = curved
    ? new THREE.CatmullRomCurve3(points.map(vector))
    : new THREE.LineCurve3(vector(points[0]), vector(points.at(-1)));
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, curved ? 36 : 1, radius, 6, false),
    material,
  );
  parent.add(mesh);
  return { curve, mesh };
}

function stream(parent, curve, material, count = 9, size = 0.18) {
  const pieces = Array.from({ length: count }, () =>
    box(parent, material, [size, size, size * 2.7]),
  );
  const axis = new THREE.Vector3(0, 0, 1);
  return (time, speed = 0.24) => {
    pieces.forEach((piece, i) => {
      const p = (((time * speed + i / count) % 1) + 1) % 1;
      piece.position.copy(curve.getPointAt(p));
      piece.quaternion.setFromUnitVectors(axis, curve.getTangentAt(p).normalize());
    });
  };
}

function stage() {
  return new THREE.Group();
}

function dataAtlas(m) {
  const group = stage();
  const data = new THREE.InstancedMesh(cube, m.silver, 288);
  data.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  data.frustumCulled = false;
  group.add(data);
  const colors = new THREE.Color();
  for (let i = 0; i < 288; i++)
    data.setColorAt(
      i,
      colors.set(i % 17 === 0 ? C.coral : i % 7 === 0 ? C.lime : i % 3 === 0 ? C.cyan : C.silver),
    );
  const planes = [];
  for (let layer = 0; layer < 3; layer++) {
    const frame = new THREE.Group();
    box(frame, m.graphite, [10.1, 0.1, 6.3]);
    const grid = new THREE.GridHelper(10, 16, C.cyan, 0x355c60);
    grid.scale.z = 0.6;
    grid.position.y = 0.07;
    frame.add(grid);
    group.add(frame);
    planes.push(frame);
  }
  return {
    group,
    from: [12, 10, 17],
    to: [7, 6, 13],
    target: [0, 0.7, 0],
    update(t) {
      const build = ease(t / 0.9);
      for (let i = 0; i < 288; i++) {
        const layer = Math.floor(i / 96),
          col = i % 12,
          row = Math.floor(i / 12) % 8;
        const height =
          0.16 + (Math.sin(i * 3.71) + 1) * 0.48 + Math.max(0, Math.sin(t * 5 - col * 0.44)) * 0.3;
        dummy.position.set(
          (col - 5.5) * 0.78,
          (layer - 1) * 2.15 + height / 2 + (1 - build) * (layer + 1) * 1.8,
          (row - 3.5) * 0.72,
        );
        dummy.scale.set(0.62, height, 0.57);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        data.setMatrixAt(i, dummy.matrix);
      }
      data.instanceMatrix.needsUpdate = true;
      planes.forEach((plane, i) => {
        plane.position.y = (i - 1) * 2.15 - 0.06 + (1 - build) * (i + 1) * 1.8;
      });
      group.rotation.y = -0.2 + t * 0.07;
    },
  };
}

function productionEngine(m) {
  const group = stage();
  box(group, m.graphite, [13, 0.25, 9], [0, -0.45, 0]);
  const belts = [];
  for (const z of [-2.8, 0, 2.8]) {
    box(group, m.silver, [12, 0.15, 0.94], [0, 0, z]);
    for (const dz of [-0.53, 0.53]) box(group, m.cyan, [12.5, 0.1, 0.05], [0, 0.28, z + dz]);
    const path = tube(
      group,
      [
        [-6.2, 0.45, z],
        [6.2, 0.45, z],
      ],
      m.graphite,
      0.025,
      false,
    );
    belts.push(stream(group, path.curve, z === 0 ? m.lime : m.coral, 11, 0.35));
  }
  const arms = [];
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 3.0;
    for (const z of [-1.45, 1.45]) {
      box(group, m.silver, [2.15, 2.3 + (i % 2) * 0.4, 0.86], [x, 1.1, z]);
      box(group, m.cyan, [1.74, 0.32, 0.07], [x, 1.15, z + (z < 0 ? 0.45 : -0.45)]);
      box(group, m.graphite, [1.7, 0.35, 1.0], [x, 2.38 + (i % 2) * 0.4, z]);
    }
    const arm = new THREE.Group();
    arm.position.set(x, 3.2, 0);
    box(arm, m.lime, [0.2, 3.7, 0.2], [0, -1.9, -2.1]);
    box(arm, m.lime, [0.2, 3.7, 0.2], [0, -1.9, 2.1]);
    box(arm, m.silver, [0.22, 0.25, 4.8]);
    box(arm, m.coral, [0.66, 0.7, 0.6], [0, -0.4, 0]);
    group.add(arm);
    arms.push(arm);
  }
  for (let i = 0; i < 3; i++) {
    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.43, 3.8 + i * 0.4, 12),
      m.silver,
    );
    stack.position.set(4.9 - i * 1.1, 1.5, -3.8);
    group.add(stack);
    box(group, m.coral, [0.72, 0.18, 0.72], [stack.position.x, 3.25 + i * 0.2, -3.8]);
  }
  return {
    group,
    from: [15, 11, 14],
    to: [-3, 7.5, 15],
    target: [0, 1, 0],
    update(t) {
      belts.forEach((move, i) => move(t + i * 0.12, 0.34));
      arms.forEach((arm, i) => {
        arm.children.at(-1).position.z = Math.sin(t * 3.1 + i * 1.7) * 1.15;
      });
    },
  };
}

function networkFlow(m) {
  const group = stage(),
    nodes = [],
    positions = [],
    streams = [];
  for (let i = 0; i < 42; i++) {
    const layer = Math.floor(i / 14),
      k = i % 14,
      angle = (k / 14) * Math.PI * 2;
    const p = [Math.cos(angle) * 4.6, (layer - 1) * 3.05, Math.sin(angle) * 4.6];
    positions.push(p);
    nodes.push(
      box(group, i % 7 === 0 ? m.lime : i % 4 === 0 ? m.coral : m.silver, [0.46, 0.46, 0.46], p),
    );
  }
  for (let i = 0; i < 42; i++) {
    for (const offset of [1, 14]) {
      const j = (i + offset) % 42;
      if (offset === 14 && i >= 28) continue;
      const a = positions[i],
        b = positions[j];
      const rail = tube(
        group,
        [a, [(a[0] + b[0]) * 0.35, (a[1] + b[1]) / 2, (a[2] + b[2]) * 0.35], b],
        m.dimCyan,
        0.026,
      );
      if (i % 2 === 0)
        streams.push(stream(group, rail.curve, i % 5 === 0 ? m.coral : m.lime, 3, 0.12));
    }
  }
  return {
    group,
    from: [8, 5, 18],
    to: [-10, 3, 15],
    target: [0, 0, 0],
    update(t) {
      group.rotation.y = t * 0.1;
      nodes.forEach((node, i) => {
        node.rotation.set(t * 0.6 + i, i * 0.4, t * 0.3);
        node.scale.setScalar(0.43 + 0.08 * Math.max(0, Math.sin(t * 8 - i * 0.5)));
      });
      streams.forEach((move, i) => move(t + i * 0.03, 0.4));
    },
  };
}

function criticalHubs(m) {
  const group = stage(),
    tiles = [],
    moves = [];
  box(group, m.graphite, [11.6, 0.22, 11.6], [0, -2.1, 0]);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.5, 6), m.lime);
  core.position.y = 1.3;
  group.add(core);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.21, 1.21, 0.13, 6), m.silver);
  cap.position.y = 2.08;
  group.add(cap);
  for (let i = 0; i < 30; i++) {
    const angle = (i / 30) * Math.PI * 2,
      r = i % 2 ? 5.1 : 3.7;
    const height = 0.6 + (i % 5) * 0.4;
    const p = [Math.cos(angle) * r, -1.8 + height / 2, Math.sin(angle) * r];
    tiles.push(box(group, i % 5 === 0 ? m.coral : m.silver, [0.53, height, 0.53], p));
    const rail = tube(
      group,
      [
        [0, 1.35, 0],
        [p[0] * 0.45, 2.7, p[2] * 0.45],
        [p[0], p[1] + height / 2, p[2]],
      ],
      i % 5 === 0 ? m.coral : m.dimCyan,
      0.035,
    );
    moves.push(stream(group, rail.curve, m.lime, 3, 0.12));
  }
  const scanning = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.055, 6, 80), m.cyan);
  scanning.rotation.x = Math.PI / 2;
  group.add(scanning);
  return {
    group,
    from: [11, 13, 15],
    to: [4, 7, 11],
    target: [0, 0.5, 0],
    update(t) {
      core.rotation.y = t * 0.3;
      cap.rotation.y = core.rotation.y;
      scanning.position.y = 0.4 + Math.sin(t * 2) * 1.4;
      scanning.scale.setScalar(1 + (t % 1) * 0.18);
      moves.forEach((move, i) => move(t + i * 0.037, 0.38));
      tiles.forEach((tile, i) => {
        tile.rotation.y = t * 0.045 * (i % 2 ? 1 : -1);
      });
    },
  };
}

function shockCascade(m) {
  const group = stage(),
    dominoes = [];
  box(group, m.graphite, [14.8, 0.2, 9], [0, -0.2, 0]);
  for (let lane = 0; lane < 5; lane++) {
    for (let i = 0; i < 14; i++) {
      const pivot = new THREE.Group();
      pivot.position.set((i - 6.5) * 0.93, 0, (lane - 2) * 1.55);
      box(pivot, i % 4 === 0 ? m.coral : m.silver, [0.2, 2.0, 0.9], [0, 1, 0]);
      box(pivot, m.coral, [0.24, 0.08, 0.95], [0, 1.45, 0]);
      group.add(pivot);
      dominoes.push({ pivot, delay: i * 0.145 + Math.abs(lane - 2) * 0.16 });
    }
  }
  const fracture = box(group, m.coral, [0.1, 0.04, 9.0], [-6.3, 0.03, 0]);
  return {
    group,
    from: [-13, 7, 15],
    to: [5, 8, 15],
    target: [0, 0.8, 0],
    update(t) {
      dominoes.forEach(({ pivot, delay }) => {
        pivot.rotation.z = -ease((t - 0.4 - delay) / 0.42) * 1.3;
      });
      fracture.position.x = lerp(-6.3, 6.3, ease((t - 0.35) / 2.6));
      fracture.scale.x = 0.12 + Math.exp(-((t % 0.5) * 12)) * 0.12;
    },
  };
}

function adaptiveRecovery(m) {
  const group = stage(),
    moves = [],
    bridges = [];
  for (const x of [-5.7, 5.7]) {
    box(group, m.silver, [1.5, 2.5, 4.5], [x, -0.4, 0]);
    box(group, m.cyan, [1.6, 0.15, 4.7], [x, 0.9, 0]);
  }
  const direct = tube(
    group,
    [
      [-5.7, 1, 0],
      [-2.2, 1, 0],
    ],
    m.coral,
    0.15,
    false,
  );
  tube(
    group,
    [
      [2.2, 1, 0],
      [5.7, 1, 0],
    ],
    m.coral,
    0.15,
    false,
  );
  const blocked = new THREE.Group();
  for (const sign of [-1, 1]) {
    const beam = box(blocked, m.coral, [2.2, 0.23, 0.24]);
    beam.rotation.z = (sign * Math.PI) / 4;
  }
  blocked.position.set(0, 1, 0);
  group.add(blocked);
  moves.push(stream(group, direct.curve, m.coral, 4, 0.21));
  for (let lane = 0; lane < 3; lane++) {
    const height = 2.1 + lane * 1.1,
      z = (lane - 1) * 2.5;
    const route = tube(
      group,
      [
        [-5.7, 1, 0],
        [-3.4, height, z],
        [0, height + 0.3, z],
        [3.4, height, z],
        [5.7, 1, 0],
      ],
      lane === 1 ? m.lime : m.cyan,
      0.09,
    );
    bridges.push(route.mesh);
    moves.push(stream(group, route.curve, lane === 1 ? m.lime : m.silver, 13, 0.23));
    for (const x of [-3.4, 3.4])
      box(group, m.graphite, [0.3, height + 1.0, 0.3], [x, (height - 1.0) / 2, z]);
  }
  return {
    group,
    from: [12, 8, 17],
    to: [-5, 6, 15],
    target: [0, 1.2, 0],
    update(t) {
      bridges.forEach((bridge, i) => {
        bridge.scale.y = 0.03 + ease((t - i * 0.13) / 0.65) * 0.97;
      });
      moves.forEach((move, i) => move(t + i * 0.03, i === 0 ? 0.08 : 0.3));
      blocked.rotation.y = Math.sin(t * 2.3) * 0.2;
    },
  };
}

function evidencePipeline(m) {
  const group = stage(),
    files = [],
    checks = [];
  box(group, m.graphite, [14, 0.17, 4.5], [0, -1.2, 0]);
  tube(
    group,
    [
      [-6.8, -0.5, 0],
      [6.8, -0.5, 0],
    ],
    m.cyan,
    0.1,
    false,
  );
  for (let station = 0; station < 4; station++) {
    const x = (station - 1.5) * 3.5;
    for (const z of [-1.1, 1.1]) box(group, m.silver, [0.16, 4.2, 0.16], [x, 0.95, z]);
    box(group, station % 2 ? m.lime : m.cyan, [0.2, 0.2, 2.5], [x, 3.0, 0]);
    const check = new THREE.Group();
    tube(
      check,
      [
        [-0.48, 0.06, 0],
        [-0.1, -0.28, 0],
      ],
      m.lime,
      0.1,
      false,
    );
    tube(
      check,
      [
        [-0.1, -0.28, 0],
        [0.54, 0.47, 0],
      ],
      m.lime,
      0.1,
      false,
    );
    check.position.set(x, 3.9, 0);
    group.add(check);
    checks.push(check);
  }
  for (let i = 0; i < 15; i++) {
    const file = new THREE.Group();
    box(file, m.silver, [0.78, 1.13, 0.08]);
    for (let line = 0; line < 4; line++)
      box(
        file,
        line === 0 ? m.lime : m.graphite,
        [line === 0 ? 0.5 : 0.55 - line * 0.045, 0.07, 0.03],
        [-0.04, 0.28 - line * 0.16, 0.059],
      );
    group.add(file);
    files.push(file);
  }
  return {
    group,
    from: [13, 6, 16],
    to: [2, 6.2, 16],
    target: [0, 1.25, 0],
    update(t) {
      files.forEach((file, i) => {
        file.position.set(
          (((i / 15 + t * 0.2) % 1) - 0.5) * 13,
          0.5 + Math.sin(t * 3 + i) * 0.12,
          ((i % 3) - 1) * 0.43,
        );
        file.rotation.y = -0.18 + Math.sin(t * 2 + i) * 0.12;
      });
      checks.forEach((check, i) => {
        check.scale.setScalar(0.75 + ease((t - i * 0.3) / 0.5) * 0.25);
        check.rotation.y = Math.sin(t * 2 + i) * 0.18;
      });
    },
  };
}

function researchConnected(m) {
  const group = stage(),
    links = [],
    chips = [];
  const linkGeometry = new THREE.TorusGeometry(1.6, 0.27, 12, 64);
  for (let i = 0; i < 5; i++) {
    const link = new THREE.Mesh(linkGeometry, [m.silver, m.lime, m.cyan, m.silver, m.coral][i]);
    link.scale.y = 1.28;
    link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    group.add(link);
    links.push(link);
  }
  for (let i = 0; i < 30; i++)
    chips.push(box(group, i % 3 ? m.graphite : m.cyan, [0.16, 0.16, 0.7]));
  return {
    group,
    from: [15, 7, 21],
    to: [13, 6, 23],
    target: [0, 0, 0],
    update(t) {
      const assembly = ease(t / 1.15);
      links.forEach((link, i) => {
        link.position.set((1 - assembly) * (i - 2) * 1.6, (i - 2) * lerp(3.8, 2.7, assembly), 0);
        link.rotation.z = lerp((i - 2) * 0.6, -0.2, assembly);
      });
      group.rotation.z = -0.45;
      group.rotation.y = -0.2 + t * 0.15;
      chips.forEach((chip, i) => {
        const angle = (i / 30) * Math.PI * 2 + t * 0.2;
        chip.position.set(Math.cos(angle) * 7, Math.sin(angle) * 7, -3);
        chip.rotation.z = angle;
      });
    },
  };
}

export function buildFilmWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a1012');
  const camera = new THREE.PerspectiveCamera(43, 16 / 9, 0.1, 100);
  const pmrem = new THREE.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.05);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xeafff8, 0x233138, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(-7, 12, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, {
    left: -12,
    right: 12,
    top: 12,
    bottom: -12,
    near: 0.5,
    far: 45,
  });
  key.shadow.bias = -0.001;
  scene.add(key);
  const rim = new THREE.DirectionalLight(C.cyan, 2.8);
  rim.position.set(8, 2, -5);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(C.coral, 1.3);
  fill.position.set(-6, 2, -2);
  scene.add(fill);
  const m = {
    silver: metal(C.silver),
    graphite: metal(C.graphite),
    cyan: metal(C.cyan, 0.3),
    lime: metal(C.lime, 0.28),
    coral: metal(C.coral, 0.35),
    dimCyan: metal(0x2e717b, 0.15),
  };
  const shots = [
    dataAtlas(m),
    productionEngine(m),
    networkFlow(m),
    criticalHubs(m),
    shockCascade(m),
    adaptiveRecovery(m),
    evidencePipeline(m),
    researchConnected(m),
  ];
  shots.forEach((shot) => {
    shot.group.visible = false;
    scene.add(shot.group);
  });
  scene.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  const target = new THREE.Vector3();
  function render(time) {
    const shot = shotAt(time),
      active = shots[shot.index];
    shots.forEach((item, i) => {
      item.group.visible = i === shot.index;
    });
    active.update(shot.local);
    // Camera travel follows two-bar phrases; small beat pushes add pace without strobing.
    const progress = ease(shot.local / 4),
      beat = Math.exp(-(shot.local % 0.5) * 12);
    camera.position.copy(vector(active.from)).lerp(vector(active.to), progress);
    camera.position.multiplyScalar(1 - beat * 0.012);
    if (camera.aspect < 0.8) camera.position.multiplyScalar(1.4);
    target.set(...active.target);
    target.y -= 0.6;
    camera.lookAt(target);
    camera.rotation.z = Math.sin(shot.local * 0.6) * (shot.index === 4 ? 0.025 : 0.012);
    rim.color.setHex(shot.index === 4 ? C.coral : C.cyan);
    renderer.render(scene, camera);
    return shot;
  }
  function resize(width, height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  function dispose() {
    const geometries = new Set(),
      materials = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    environment.dispose();
    renderer.dispose();
  }
  return {
    renderer,
    resize,
    render,
    dispose,
    shots: FILM_SHOTS.map(({ id, name }, index) => ({
      id,
      name,
      start: index * 4,
      end: (index + 1) * 4,
    })),
  };
}
