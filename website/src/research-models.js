import * as THREE from 'three';

// Illustrative positions only; no observed or estimated trade data is used.
export const GLOBE_PLACES = [
  [31, 121],
  [35, 139],
  [1, 104],
  [19, 73],
  [51, 0],
  [25, 55],
  [34, -118],
  [-34, 151],
  [-24, -47],
  [40, 116],
  [22, 114],
  [37, 127],
  [25, 121],
  [14, 101],
  [21, 106],
  [-6, 106],
  [22, 88],
  [13, 80],
  [50, 9],
  [41, 29],
  [42, 12],
  [40, -74],
  [20, -99],
  [-34, -58],
  [30, 31],
  [-26, 28],
  [-37, 145],
  [24, 46],
  [14, 121],
  [3, 102],
];

export function globeRoutes() {
  const positions = GLOBE_PLACES.map((place) => geoPosition(...place, 1));
  const pairs = new Map();
  const add = (i, j) => {
    const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
    if (i !== j && !pairs.has(key)) pairs.set(key, [i, j]);
  };
  positions.forEach((p, i) => {
    positions
      .map((q, j) => ({ j, distance: p.distanceToSquared(q) }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .forEach(({ j }) => add(i, j));
  });
  [
    [0, 4],
    [0, 6],
    [0, 7],
    [0, 5],
    [0, 21],
    [0, 24],
    [0, 25],
    [2, 4],
    [2, 7],
    [2, 25],
    [2, 8],
    [1, 6],
    [1, 21],
    [4, 21],
    [18, 1],
    [7, 22],
    [8, 24],
    [5, 18],
    [3, 26],
    [11, 19],
  ].forEach(([i, j]) => add(i, j));
  return [...pairs.values()];
}

export function spherePositions(count = 72, radius = 3.65) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / count;
    const ring = Math.sqrt(1 - y * y);
    return new THREE.Vector3(
      Math.cos(i * goldenAngle) * ring,
      y,
      Math.sin(i * goldenAngle) * ring,
    ).multiplyScalar(radius);
  });
}

// The original visual motif, arranged deterministically; not an observed IO network.
export function foundationNetwork() {
  const positions = [];
  const index = (column, row, lane) => column * 14 + row * 2 + lane;
  for (let column = 0; column < 3; column++)
    for (let row = 0; row < 7; row++)
      for (let lane = 0; lane < 2; lane++) {
        positions.push(
          new THREE.Vector3(
            -0.65 + column * 1.62 + lane * 0.42 + Math.sin(row * 0.43) * 0.08,
            (3 - row) * 0.84 + (lane ? -0.08 : 0.08),
            (lane ? -0.48 : 0.48) + Math.sin(row * 0.52) * 0.13,
          ),
        );
      }
  const edges = [];
  for (let column = 0; column < 2; column++)
    for (let row = 0; row < 7; row++)
      for (let lane = 0; lane < 2; lane++)
        edges.push([index(column, row, lane), index(column + 1, row, lane)]);
  for (let row = 0; row < 6; row++)
    for (let lane = 0; lane < 2; lane++) edges.push([index(1, row, lane), index(1, row + 1, lane)]);
  for (const row of [1, 3, 5]) edges.push([index(1, row, 0), index(1, row, 1)]);
  for (const [column, row, lane, nextRow] of [
    [0, 1, 0, 2],
    [0, 4, 1, 5],
    [1, 2, 0, 3],
    [1, 4, 1, 3],
  ])
    edges.push([index(column, row, lane), index(column + 1, nextRow, 1 - lane)]);
  return { positions, edges, hubs: [index(1, 1, 0), index(1, 3, 1), index(1, 5, 0)] };
}

// Match SphereGeometry's U axis and the equirectangular Natural Earth texture.
export function geoPosition(latitude, longitude, radius = 3.3) {
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);
  return new THREE.Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.sin(lon),
  ).multiplyScalar(radius);
}

export function geographicArc(a, b, radius = 3.3) {
  const start = geoPosition(...a, 1);
  const end = geoPosition(...b, 1);
  const rotation = new THREE.Quaternion().setFromUnitVectors(start, end);
  const height = THREE.MathUtils.clamp(start.angleTo(end) * 0.55, 0.14, 0.88);
  const points = Array.from({ length: 49 }, (_, i) => {
    const t = i / 48;
    const p = start.clone().applyQuaternion(new THREE.Quaternion().slerp(rotation, t));
    return p.normalize().multiplyScalar(radius + 0.05 + Math.sin(Math.PI * t) * height);
  });
  return new THREE.CatmullRomCurve3(points);
}

// A storyboard graph, not a fitted economic or physical model.
export const CASCADE_NODES = [
  [-3.8, 0, 0],
  [-1.7, 0, 0],
  [0.35, 1.75, 0.1],
  [0.35, -1.65, 0],
  [2.45, 1.75, 0.1],
  [2.45, -1.65, 0],
  [4.05, 0, 0],
  [-2.2, -2.65, -0.1],
];

export const CASCADE_EDGES = [
  { id: 'ab', from: 0, to: 1, failAt: 3, repairAt: 9.6 },
  { id: 'bc', from: 1, to: 2, failAt: 4.25, repairAt: 12 },
  { id: 'bd', from: 1, to: 3, failAt: 4.95, repairAt: 10.8 },
  { id: 'ce', from: 2, to: 4, failAt: 6.1, repairAt: 13.2 },
  { id: 'df', from: 3, to: 5 },
  { id: 'eg', from: 4, to: 6 },
  { id: 'fg', from: 5, to: 6 },
  { id: 'ah', from: 0, to: 7, reserve: true },
  { id: 'hd', from: 7, to: 3, reserve: true },
];

export function cascadePose(time) {
  const cycle = ((time % 20) + 20) % 20;
  const ease = (a, b) => THREE.MathUtils.smoothstep(cycle, a, b);
  const bypass = ease(5.8, 7.2) * (1 - ease(18.7, 20));
  const edges = CASCADE_EDGES.map((edge) => {
    const age = cycle - (edge.failAt ?? Infinity);
    const repair = edge.repairAt === undefined ? 0 : ease(edge.repairAt, edge.repairAt + 2.4);
    const gap =
      edge.failAt === undefined ? 0 : ease(edge.failAt, edge.failAt + 0.65) * (1 - repair);
    const stress =
      edge.failAt === undefined
        ? 0
        : ease(edge.failAt - 0.65, edge.failAt) * (1 - ease(edge.failAt, edge.failAt + 0.55));
    const pulseAt =
      edge.from === 0
        ? 2
        : (CASCADE_EDGES.find((e) => e.to === edge.from && e.failAt !== undefined)?.failAt ??
            Infinity) + 0.22;
    const front =
      edge.failAt === undefined
        ? 0
        : THREE.MathUtils.clamp((cycle - pulseAt) / (edge.failAt - pulseAt), 0, 1);
    return {
      ...edge,
      age,
      gap,
      stress,
      repair,
      front,
      propagating: edge.failAt !== undefined && cycle >= pulseAt && cycle < edge.failAt,
      broken: age >= 0 && repair < 0.995,
    };
  });
  const visited = new Set([0]),
    pending = [0];
  while (pending.length) {
    const from = pending.pop();
    for (const edge of edges) {
      if (
        edge.from !== from ||
        edge.broken ||
        (edge.reserve && bypass < 0.9) ||
        visited.has(edge.to)
      )
        continue;
      visited.add(edge.to);
      pending.push(edge.to);
    }
  }
  return {
    cycle,
    bypass,
    edges,
    brokenEdges: edges.filter((e) => e.broken).map((e) => e.id),
    rebuildingEdges: edges.filter((e) => e.repair > 0 && e.repair < 0.995).map((e) => e.id),
    outputReachable: visited.has(6),
    reachableNodes: [...visited],
    recovered: cycle >= 15.6,
  };
}

export function resiliencePhase(time) {
  const phase = ((time % 20) + 20) % 20;
  return phase < 2
    ? '01 / CONNECTED'
    : phase < 3.8
      ? '02 / FRACTURE'
      : phase < 6.8
        ? '03 / CASCADE'
        : phase < 9.6
          ? '04 / REROUTE'
          : phase < 15.6
            ? '05 / REBUILD'
            : '06 / RECOVERED';
}
