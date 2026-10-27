import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CASCADE_NODES, CASCADE_EDGES, cascadePose } from './research-models.js';

const X = new THREE.Vector3(1, 0, 0);
const steel = new THREE.Color(0x91a1a6),
  teal = new THREE.Color(0x397edb);
const damage = new THREE.Color(0xd96b57),
  lime = new THREE.Color(0x168d98);
const ease = (a, b, t) => THREE.MathUtils.smoothstep(t, a, b);

function arc(start = 0, span = Math.PI * 2, closed = true) {
  const points = Array.from({ length: 33 }, (_, i) => {
    const angle = start + (span * i) / 32;
    return new THREE.Vector3(Math.cos(angle) * 0.255, Math.sin(angle) * 0.165, 0);
  });
  const curve = new THREE.CatmullRomCurve3(points);
  const tube = new THREE.TubeGeometry(curve, 32, 0.059, 8, closed);
  if (closed) return tube;
  const caps = [0, 1].map((t) => {
    const cap = new THREE.CircleGeometry(0.059, 8);
    const vertices = cap.attributes.position;
    for (let i = 1; i < vertices.count; i++) {
      const ragged = 0.8 + (i % 3) * 0.14;
      vertices.setXYZ(
        i,
        vertices.getX(i) * ragged,
        vertices.getY(i) * ragged,
        i % 2 ? 0.01 : -0.008,
      );
    }
    cap.computeVertexNormals();
    cap.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        curve.getTangent(t).multiplyScalar(t ? 1 : -1),
      ),
    );
    const point = curve.getPoint(t);
    cap.translate(point.x, point.y, point.z);
    return cap;
  });
  const geometry = mergeGeometries([tube, ...caps]);
  tube.dispose();
  caps.forEach((cap) => cap.dispose());
  return geometry;
}

function metal(color) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.78,
    roughness: 0.27,
    envMapIntensity: 1.2,
    emissive: damage,
    emissiveIntensity: 0,
  });
}

export function buildResilience(group) {
  const whole = arc(),
    chipGeometry = new THREE.IcosahedronGeometry(0.065, 0);
  const shards = Array.from({ length: 6 }, (_, i) =>
    arc((i * Math.PI) / 3 + 0.035, Math.PI / 3 - 0.12, false),
  );
  const quarters = Array.from({ length: 4 }, (_, i) => arc((i * Math.PI) / 2, Math.PI / 2, false));
  const junctions = CASCADE_NODES.map((position, i) => {
    const node = new THREE.Mesh(
      new THREE.TorusGeometry(0.25, 0.08, 10, 28),
      metal(i === 7 ? lime : steel),
    );
    node.position.fromArray(position);
    group.add(node);
    return node;
  });
  const edgeModels = CASCADE_EDGES.map((edge, index) => {
    const root = new THREE.Group();
    const a = new THREE.Vector3(...CASCADE_NODES[edge.from]),
      b = new THREE.Vector3(...CASCADE_NODES[edge.to]);
    const length = a.distanceTo(b);
    root.position.copy(a.clone().lerp(b, 0.5));
    root.quaternion.setFromUnitVectors(X, b.clone().sub(a).normalize());
    group.add(root);
    const count = Math.max(5, Math.ceil((length - 0.4) / 0.37) | 1),
      middle = Math.floor(count / 2);
    const spacing = (length - 0.42) / (count - 1);
    const links = Array.from({ length: count }, (_, i) => {
      const mesh = new THREE.Mesh(whole, metal(edge.reserve ? steel : i % 2 ? steel : teal));
      mesh.position.x = (i - middle) * spacing;
      mesh.rotation.x = i % 2 ? 0.95 : -0.18;
      root.add(mesh);
      return mesh;
    });
    const fracture = new THREE.Group(),
      rebuilding = new THREE.Group();
    fracture.rotation.x = rebuilding.rotation.x = links[middle].rotation.x;
    root.add(fracture, rebuilding);
    const debris = [];
    if (edge.failAt !== undefined) {
      const fragmentMaterial = metal(damage);
      const cutMaterial = new THREE.MeshStandardMaterial({
        color: 0xf2b2a0,
        metalness: 0.18,
        roughness: 0.8,
      });
      for (let k = 0; k < 14; k++) {
        const mesh = new THREE.Mesh(
          k < 6 ? shards[k] : chipGeometry,
          k < 6 ? fragmentMaterial : cutMaterial,
        );
        fracture.add(mesh);
        debris.push(mesh);
      }
    }
    const repairMaterial = edge.failAt === undefined ? null : metal(lime);
    const pieces =
      edge.failAt === undefined
        ? []
        : quarters.map((geometry) => {
            const mesh = new THREE.Mesh(geometry, repairMaterial);
            rebuilding.add(mesh);
            return mesh;
          });
    const signal = new THREE.Mesh(
      new THREE.ConeGeometry(0.066, 0.2, 7),
      new THREE.MeshBasicMaterial({ color: teal }),
    );
    signal.rotation.z = -Math.PI / 2;
    root.add(signal);
    return {
      edge,
      index,
      root,
      length,
      links,
      middle,
      spacing,
      fracture,
      debris,
      pieces,
      rebuilding,
      repairMaterial,
      signal,
    };
  });
  let state = cascadePose(0),
    visibleFragments = 0;
  return {
    stats: {
      visual: 'branched-cascade-and-adaptive-recovery',
      nodes: 8,
      branches: 9,
      links: edgeModels.reduce((n, e) => n + e.links.length, 0),
      fracturePieces: 56,
      alternateRoute: ['ah', 'hd', 'df', 'fg'],
      duration: 20,
      conceptual: true,
    },
    getState: () => ({
      cycle: state.cycle,
      brokenEdges: state.brokenEdges,
      rebuildingEdges: state.rebuildingEdges,
      bypass: state.bypass,
      outputReachable: state.outputReachable,
      recovered: state.recovered,
      visibleFragments,
      maxGap: Math.max(...state.edges.map((e) => e.gap)),
      repairProgress: state.edges
        .filter((e) => e.repairAt !== undefined)
        .map((e) => ({ id: e.id, progress: e.repair })),
    }),
    update(time) {
      state = cascadePose(time);
      visibleFragments = 0;
      group.rotation.set(0.15, -0.13, 0.08);
      group.position.y = 0.5;
      edgeModels.forEach((model, index) => {
        const pose = state.edges[index],
          { cycle, bypass } = state;
        const { links, middle, spacing, fracture, debris, rebuilding, pieces, signal } = model;
        const age = pose.age;
        links.forEach((link, i) => {
          const sign = Math.sign(i - middle);
          const recoil =
            pose.gap *
            (0.16 + Math.sin(Math.max(0, age) * 12) * Math.exp(-Math.max(0, age) * 2) * 0.12);
          link.position.set(
            (i - middle) * spacing + sign * recoil,
            -Math.sin((i / (links.length - 1)) * Math.PI) * pose.gap * 0.16,
            0,
          );
          link.rotation.set(
            (i % 2 ? 0.95 : -0.18) + Math.sin(cycle * 2.3 + i) * pose.gap * 0.13,
            0,
            sign * pose.gap * 0.12 + Math.sin(cycle * 15 + i) * pose.stress * 0.045,
          );
          link.visible = i !== middle || !pose.broken;
          const original = model.edge.reserve ? steel : i % 2 ? steel : teal;
          const travelling = pose.propagating
            ? Math.exp(-(((i / (links.length - 1) - pose.front * 0.5) * 5) ** 2))
            : 0;
          const wave = Math.max(
            travelling,
            pose.stress * ease(0, 1, 1 - Math.abs(i - middle) / links.length),
          );
          link.scale.set(
            1 + wave * 0.12 + (model.edge.reserve ? bypass * 0.025 : 0),
            1 - wave * 0.05,
            1,
          );
          link.material.color.copy(original).lerp(damage, pose.broken ? 0.36 : wave);
          if (model.edge.reserve) link.material.color.lerp(lime, bypass * 0.9);
          if (pose.repair > 0)
            link.material.color.lerp(lime, (1 - ease(16, 19.8, cycle)) * pose.repair * 0.35);
          link.material.emissiveIntensity = wave * 0.22;
        });
        fracture.visible = pose.broken && age < 2.25;
        if (fracture.visible) {
          visibleFragments += debris.length;
          debris.forEach((fragment, k) => {
            const angle = k * 2.399 + index * 0.7,
              burst = 1 - Math.exp(-age * 4.8);
            const travel = burst * (0.26 + (k % 4) * 0.09);
            fragment.position.set(
              Math.cos(angle) * travel,
              Math.sin(angle) * travel - Math.min(age, 1.8) ** 2 * 0.19,
              Math.sin(k * 3.1) * travel * 0.7,
            );
            fragment.rotation.set(age * (k % 2 ? 1.3 : -1.9), age * 1.1, age * ((k % 3) - 1) * 1.5);
            if (k < 6) fragment.scale.setScalar(1 - ease(1.1, 2.25, age));
            else {
              const fade = 1 - ease(0.9, 1.9, age);
              fragment.scale.set(
                (0.9 + (k % 3) * 0.25) * fade,
                (0.4 + (k % 4) * 0.13) * fade,
                (0.6 + (k % 2) * 0.3) * fade,
              );
            }
          });
        }
        rebuilding.visible = pose.repair > 0 && pose.repair < 0.995;
        pieces.forEach((piece, k) => {
          const p = ease(k * 0.08, 0.74 + k * 0.08, pose.repair);
          const remainder = 1 - p;
          const spring = Math.sin(p * Math.PI * 3) * (1 - p) ** 2 * 0.12;
          const angle = (k * Math.PI) / 2 + Math.PI / 4;
          piece.position.set(
            Math.cos(angle) * (remainder * 0.58 + spring),
            Math.sin(angle) * remainder * 0.5,
            remainder * 0.48,
          );
          piece.rotation.set(
            remainder * 0.32,
            remainder * 0.42,
            remainder * (k % 2 ? 0.55 : -0.55),
          );
          piece.scale.setScalar(0.7 + p * 0.3);
        });
        model.repairMaterial?.color
          .copy(lime)
          .lerp(links[middle].material.color, ease(0.65, 1, pose.repair));
        const reserve = model.edge.reserve;
        signal.visible = reserve
          ? bypass > 0.1
          : (!pose.broken && state.reachableNodes.includes(pose.from)) ||
            pose.propagating ||
            pose.stress > 0;
        signal.material.color.copy(
          reserve ? lime : pose.propagating || pose.stress > 0.1 ? damage : teal,
        );
        const speed = reserve ? 0.35 : 0.25;
        signal.position.set(
          (((cycle * speed + index * 0.29) % 1) - 0.5) * (model.length - 0.35),
          0,
          0.28,
        );
        if (pose.propagating) signal.position.x = (pose.front * 0.5 - 0.5) * (model.length - 0.35);
      });
      junctions.forEach((node, i) => {
        const incoming = state.edges.filter((e) => e.to === i);
        const damaged = incoming.some((e) => e.broken);
        const rescued = [3, 5, 6, 7].includes(i) && state.bypass > 0.5;
        node.material.color.copy(i === 7 ? lime : steel).lerp(damage, damaged ? 0.7 : 0);
        if (rescued) node.material.color.lerp(lime, state.bypass);
        node.position.fromArray(CASCADE_NODES[i]);
        node.position.y += damaged ? Math.sin(state.cycle * 2.6 + i) * 0.055 : 0;
      });
    },
  };
}
