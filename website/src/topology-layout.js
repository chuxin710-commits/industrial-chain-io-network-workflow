import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';

export const layoutRadius = (count, maximum, value) =>
  (count > 100 ? 0.8 : 2.5) +
  (count > 100 ? 3.6 : 12) * Math.sqrt(Math.log1p((value / maximum) * 100) / Math.log(101));

export async function sharedLayout(frames) {
  const ids = frames[0].nodes.map((node) => node.id);
  const reference = new Set(ids);
  if (
    frames.some(
      (frame) =>
        frame.nodes.length !== ids.length || frame.nodes.some((node) => !reference.has(node.id)),
    )
  )
    throw new Error('所选年份的节点集合不一致，不能共用演化布局。');
  const maxima = new Map(ids.map((id) => [id, 0]));
  const links = new Map();
  for (const frame of frames) {
    for (const node of frame.nodes)
      maxima.set(node.id, Math.max(maxima.get(node.id), node.strength));
    for (const edge of frame.edges) {
      const key = `${edge.source}\0${edge.target}`;
      if (!links.has(key)) links.set(key, { source: edge.source, target: edge.target });
    }
  }
  const maximum = Math.max(1e-30, ...maxima.values());
  const radius = (value) => layoutRadius(ids.length, maximum, value);
  const nodes = ids.map((id, i) => ({
    id,
    x: Math.cos(i * 2.399963) * Math.sqrt(i + 1) * 10,
    y: Math.sin(i * 2.399963) * Math.sqrt(i + 1) * 10,
  }));
  const simulation = forceSimulation(nodes)
    .force(
      'link',
      forceLink([...links.values()])
        .id((node) => node.id)
        .distance(ids.length > 100 ? 28 : 90)
        .strength(0.12),
    )
    .force('charge', forceManyBody().strength(ids.length > 100 ? -28 : -240))
    .force('collide', forceCollide((node) => radius(maxima.get(node.id)) + 6).iterations(2))
    .force('x', forceX(0).strength(0.035))
    .force('y', forceY(0).strength(0.035))
    .stop();
  for (let i = 0; i < 180; i += 15) {
    simulation.tick(15);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const minX = Math.min(...nodes.map((node) => node.x)),
    maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y)),
    maxY = Math.max(...nodes.map((node) => node.y));
  const span = Math.max(maxX - minX, maxY - minY, 1) / 2;
  const positions = new Map(
    nodes.map((node) => [
      node.id,
      {
        x: (node.x - (minX + maxX) / 2) / span,
        y: (node.y - (minY + maxY) / 2) / span,
      },
    ]),
  );
  return {
    positions,
    maximum,
    radius,
    maxEdge: frames.reduce(
      (max, frame) => frame.edges.reduce((m, edge) => Math.max(m, edge.weight), max),
      1e-30,
    ),
  };
}
