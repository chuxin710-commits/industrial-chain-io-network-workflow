import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { foundationNetwork } from './research-models.js';

const C = { teal: 0x66b7b8, lime: 0xc8f36b, coral: 0xe9a58c, silver: 0xd6e4de };
const Y = new THREE.Vector3(0, 1, 0);

function matrixTexture(seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 352;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#102b2d';
  ctx.fillRect(0, 0, 512, 352);
  for (let row = 0; row < 8; row++)
    for (let column = 0; column < 12; column++) {
      const value = (Math.sin(row * 7.12 + column * 3.31 + seed * 1.4) + 1) / 2;
      ctx.fillStyle =
        value > 0.92 ? '#e9a58c' : value > 0.75 ? '#c8f36b' : value > 0.4 ? '#67aaa4' : '#294f51';
      ctx.fillRect(16 + column * 40, 16 + row * 40, 31, 31);
    }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function connection(group, start, end, primary = false) {
  const curve = new THREE.CubicBezierCurve3(
    start,
    start
      .clone()
      .lerp(end, 0.33)
      .add(new THREE.Vector3(0, 0.06, 0.12)),
    start
      .clone()
      .lerp(end, 0.67)
      .add(new THREE.Vector3(0, 0.06, 0.12)),
    end,
  );
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 16, primary ? 0.014 : 0.008, 5, false),
    new THREE.MeshBasicMaterial({
      color: primary ? 0x88b9a7 : 0x488a8b,
      transparent: true,
      opacity: primary ? 0.7 : 0.24,
      depthWrite: false,
    }),
  );
  group.add(mesh);
  return curve;
}

export function buildFoundation(group) {
  const { positions, edges, hubs } = foundationNetwork();
  const geometry = new RoundedBoxGeometry(0.25, 0.25, 0.25, 2, 0.038);
  const nodes = positions.map((position, i) => {
    const hub = hubs.indexOf(i);
    const color = hub === 1 ? C.coral : hub >= 0 ? C.lime : i % 4 === 0 ? C.silver : C.teal;
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.27,
        metalness: 0.48,
        emissive: color,
        emissiveIntensity: 0.04,
      }),
    );
    mesh.position.copy(position);
    group.add(mesh);
    return mesh;
  });
  const runners = [];
  const arrowGeometry = new THREE.ConeGeometry(0.045, 0.15, 6);
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: C.lime });
  function addRunner(curve, offset) {
    const mesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
    group.add(mesh);
    runners.push({ mesh, curve, offset });
  }
  edges.forEach(([from, to], i) => {
    const primary =
      (from % 14) % 2 === 0 &&
      [2, 6, 10].includes(from % 14) &&
      Math.floor(from / 14) !== Math.floor(to / 14);
    const curve = connection(group, positions[from], positions[to], primary);
    if (primary) addRunner(curve, (i * 0.137) % 1);
  });
  const plateGeometry = new THREE.BoxGeometry(2.18, 1.52, 0.07);
  const frameGeometry = new THREE.EdgesGeometry(plateGeometry);
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: 0x386a6b,
    metalness: 0.42,
    roughness: 0.36,
  });
  const frameMaterial = new THREE.LineBasicMaterial({
    color: 0x77a6a0,
    transparent: true,
    opacity: 0.75,
  });
  const scanMaterial = new THREE.MeshBasicMaterial({
    color: C.lime,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const plates = [];
  for (let i = 0; i < 3; i++) {
    const plate = new THREE.Group();
    plate.position.set(-3.1 + (i - 1) * 0.12, (1 - i) * 2.05, -0.32);
    plate.rotation.set(0.08, 0.23, -0.12);
    plate.add(
      new THREE.Mesh(plateGeometry, plateMaterial),
      new THREE.LineSegments(frameGeometry, frameMaterial),
    );
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(2.12, 1.46),
      new THREE.MeshBasicMaterial({ map: matrixTexture(i) }),
    );
    face.position.z = 0.041;
    plate.add(face);
    const scanner = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 0.02), scanMaterial);
    scanner.position.z = 0.05;
    plate.add(scanner);
    group.add(plate);
    plates.push({ plate, scanner });
    const source = plate.position.clone().add(new THREE.Vector3(1.1, 0, 0.2));
    for (let lane = 0; lane < 2; lane++) {
      const curve = connection(group, source, positions[(i * 2 + 1) * 2 + lane], lane === 0);
      if (lane === 0) addRunner(curve, i / 3);
    }
  }
  let activeLayer = 0;
  return {
    stats: {
      visual: 'layered-matrix-and-network',
      nodes: nodes.length,
      links: edges.length + 6,
      matrices: 3,
      hubs: hubs.length,
      textLabels: 0,
      conceptual: true,
    },
    getState: () => ({ nodes: nodes.length, matrices: plates.length, activeLayer, textLabels: 0 }),
    update(time) {
      const cycle = ((time % 9) + 9) % 9;
      activeLayer = Math.floor(cycle / 3);
      group.rotation.set(0.12, -0.12 + Math.sin(time * 0.22) * 0.07, -0.045);
      group.position.set(0.3, 0.28, 0);
      nodes.forEach((node, i) => {
        const hub = hubs.includes(i),
          column = Math.floor(i / 14);
        const pulse = Math.max(0, Math.sin(time * 1.9 - column * 1.15 - (i % 14) * 0.13));
        node.rotation.set(
          0.15 + Math.sin(time * 0.5 + i) * 0.08,
          0.3 + Math.cos(time * 0.35 + i) * 0.12,
          0.08,
        );
        node.scale.setScalar((hub ? 1.45 : 1) * (1 + pulse * 0.07));
        node.material.emissiveIntensity = (hub ? 0.15 : 0.025) + pulse * 0.13;
      });
      plates.forEach(({ plate, scanner }, i) => {
        plate.position.z = -0.32 + Math.sin(time * 0.5 + i * 0.8) * 0.06;
        scanner.position.y = 0.66 - ((time * 0.2 + i / 3) % 1) * 1.32;
      });
      runners.forEach(({ mesh, curve, offset }) => {
        const t = (time * 0.2 + offset) % 1;
        mesh.position.copy(curve.getPoint(t));
        mesh.quaternion.setFromUnitVectors(Y, curve.getTangent(t).normalize());
      });
    },
  };
}
