import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  spherePositions,
  foundationNetwork,
  geoPosition,
  geographicArc,
  resiliencePhase,
  GLOBE_PLACES,
  globeRoutes,
  CASCADE_NODES,
  CASCADE_EDGES,
  cascadePose,
} from '../src/research-models.js';

test('Fibonacci network has distinct nodes on the stated sphere', () => {
  const points = spherePositions();
  assert.equal(points.length, 72);
  points.forEach((p, i) => {
    assert.ok(Math.abs(p.length() - 3.65) < 1e-8);
    points.slice(i + 1).forEach((q) => assert.ok(p.distanceTo(q) > 0.01));
  });
});

test('Foundation preserves 42 nodes with a connected, restrained layered layout', () => {
  const { positions, edges, hubs } = foundationNetwork();
  assert.equal(positions.length, 42);
  assert.equal(hubs.length, 3);
  assert.ok(edges.length < 60, 'Avoid dense cross-layer spaghetti');
  const keys = new Set(),
    adjacent = positions.map(() => []);
  positions.forEach((p, i) =>
    positions.slice(i + 1).forEach((q) => assert.ok(p.distanceTo(q) > 0.35)),
  );
  for (const [from, to] of edges) {
    assert.ok(positions[from] && positions[to] && from !== to);
    const key = `${from}:${to}`;
    assert.equal(keys.has(key), false);
    keys.add(key);
    assert.ok(
      Math.floor(from / 14) <= Math.floor(to / 14),
      'Cross-layer arrows must keep their direction',
    );
    adjacent[from].push(to);
    adjacent[to].push(from);
  }
  const visited = new Set([0]),
    pending = [0];
  while (pending.length)
    for (const to of adjacent[pending.pop()])
      if (!visited.has(to)) {
        visited.add(to);
        pending.push(to);
      }
  assert.equal(visited.size, positions.length);
});

test('Geography matches SphereGeometry UVs and route arrows follow the endpoints', () => {
  assert.ok(geoPosition(0, 0, 1).distanceTo({ x: 1, y: 0, z: 0 }) < 1e-8);
  assert.ok(geoPosition(90, 0, 1).y > 0.999);
  assert.ok(geoPosition(0, 90, 1).z < -0.999);
  for (const [a, b] of [
    [
      [31, 121],
      [34, -118],
    ],
    [
      [0, 0],
      [0, 180],
    ],
    [
      [0, 0],
      [0, 0],
    ],
  ]) {
    const curve = geographicArc(a, b);
    assert.ok(curve.getPoint(0).distanceTo(geoPosition(...a, 3.35)) < 1e-6);
    assert.ok(curve.getPoint(1).distanceTo(geoPosition(...b, 3.35)) < 1e-6);
    for (let i = 0; i <= 100; i++) {
      const p = curve.getPoint(i / 100);
      assert.ok(p.toArray().every(Number.isFinite));
      assert.ok(p.length() >= 3.3, 'Transmission arc must remain outside the globe');
    }
  }
});

test('Storyboard separates local fracture, delayed cascade, rerouting and staged rebuilding', () => {
  assert.equal(resiliencePhase(1), '01 / CONNECTED');
  assert.equal(resiliencePhase(3.3), '02 / FRACTURE');
  assert.equal(resiliencePhase(5), '03 / CASCADE');
  assert.equal(resiliencePhase(8), '04 / REROUTE');
  assert.equal(resiliencePhase(12), '05 / REBUILD');
  assert.equal(resiliencePhase(17), '06 / RECOVERED');
  assert.equal(resiliencePhase(21), resiliencePhase(1));
  assert.deepEqual(cascadePose(3.3).brokenEdges, ['ab']);
  assert.deepEqual(cascadePose(4.6).brokenEdges, ['ab', 'bc']);
  assert.deepEqual(cascadePose(5.4).brokenEdges, ['ab', 'bc', 'bd']);
  assert.deepEqual(cascadePose(6.5).brokenEdges, ['ab', 'bc', 'bd', 'ce']);
  assert.equal(cascadePose(4.6).outputReachable, false);
  assert.equal(
    cascadePose(8).outputReachable,
    true,
    'Reserve route must actually connect source to output',
  );
  assert.equal(cascadePose(8).brokenEdges.length, 4, 'Rerouting must precede full repair');
  assert.ok(cascadePose(11).rebuildingEdges.includes('ab'));
  assert.equal(cascadePose(11).edges.find((e) => e.id === 'ce').repair, 0);
  assert.equal(cascadePose(17).brokenEdges.length, 0);
  assert.equal(cascadePose(17).outputReachable, true);
  assert.deepEqual(cascadePose(20), cascadePose(0));
});

test('Cascade timing and graph are internally consistent without simulating empirical outcomes', () => {
  assert.equal(CASCADE_NODES.length, 8);
  assert.ok(
    CASCADE_EDGES.filter((e) => e.from === 1).length >= 2,
    'Network needs downstream branching',
  );
  for (const edge of CASCADE_EDGES) {
    assert.ok(edge.from !== edge.to && CASCADE_NODES[edge.from] && CASCADE_NODES[edge.to]);
    if (edge.failAt !== undefined) {
      assert.ok(edge.repairAt > edge.failAt);
      if (edge.from !== 0)
        assert.ok(CASCADE_EDGES.some((e) => e.to === edge.from && e.failAt < edge.failAt));
    }
  }
  for (let t = 0; t < 20; t += 0.025) {
    const state = cascadePose(t);
    assert.ok(state.bypass >= 0 && state.bypass <= 1);
    state.edges.forEach((e) =>
      [e.gap, e.stress, e.repair].forEach((value) =>
        assert.ok(Number.isFinite(value) && value >= 0 && value <= 1),
      ),
    );
  }
  for (const edge of CASCADE_EDGES.filter((e) => e.repairAt !== undefined)) {
    const values = [0, 0.01, 1.2, 2.39, 2.4].map(
      (dt) => cascadePose(edge.repairAt + dt).edges.find((e) => e.id === edge.id).repair,
    );
    assert.ok(Math.abs(values[0]) < 1e-12);
    assert.ok(Math.abs(values.at(-1) - 1) < 1e-12);
    assert.ok(
      values[1] < 0.001 && values.at(-2) > 0.999,
      'Repair must ease into and out of assembly',
    );
  }
});

test('Denser globe paths are unique, connected and remain above the globe surface', () => {
  const routes = globeRoutes();
  assert.equal(GLOBE_PLACES.length, 30);
  assert.ok(routes.length >= 60 && routes.length < 100);
  const seen = new Set(),
    adjacent = GLOBE_PLACES.map(() => []);
  for (const [i, j] of routes) {
    assert.notEqual(i, j);
    const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
    assert.equal(seen.has(key), false);
    seen.add(key);
    adjacent[i].push(j);
    adjacent[j].push(i);
    const curve = geographicArc(GLOBE_PLACES[i], GLOBE_PLACES[j]);
    for (let t = 0; t <= 20; t++) assert.ok(curve.getPoint(t / 20).length() >= 3.3);
  }
  const visited = new Set([0]),
    pending = [0];
  while (pending.length)
    for (const j of adjacent[pending.pop()]) {
      if (!visited.has(j)) {
        visited.add(j);
        pending.push(j);
      }
    }
  assert.equal(visited.size, GLOBE_PLACES.length);
  adjacent.forEach((neighbors) => assert.ok(neighbors.length >= 3));
});

test('Bundled geography has inspectable real land polygons, not decorative blobs', async () => {
  const data = JSON.parse(await readFile('public/media/ne-110m-land.geojson', 'utf8'));
  assert.equal(data.type, 'FeatureCollection');
  assert.ok(data.features.length > 100);
  for (const feature of data.features) {
    assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry.type));
    assert.ok(feature.geometry.coordinates.length > 0);
  }
});
