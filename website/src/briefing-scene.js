import * as THREE from 'three';

function newspaperTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 960;
  const c = canvas.getContext('2d');
  c.fillStyle = '#f7faf4';
  c.fillRect(0, 0, 768, 960);
  c.fillStyle = '#214f43';
  c.font = 'bold 64px sans-serif';
  c.fillText('CHAINLAB', 60, 110);
  c.font = '22px sans-serif';
  c.fillText('THE MORNING BRIEF', 64, 160);
  c.fillRect(60, 190, 648, 4);
  c.font = 'bold 180px sans-serif';
  c.fillText('72', 54, 385);
  c.font = '24px sans-serif';
  c.fillText('HOURS', 320, 315);
  c.fillStyle = '#7a9386';
  c.font = '20px sans-serif';
  c.fillText('GLOBAL SIGNALS', 320, 355);
  ['#3b9287', '#bc9660', '#9184ae'].forEach((color, i) => {
    const y = 460 + i * 148;
    c.fillStyle = color;
    c.fillRect(60, y, 72, 72);
    c.fillStyle = '#456557';
    c.font = 'bold 22px sans-serif';
    c.fillText(['INDUSTRY', 'SUPPLY CHAIN', 'AI FRONTIER'][i], 160, y + 22);
    c.fillStyle = '#cad6cb';
    c.fillRect(160, y + 44, 520, 8);
    c.fillRect(160, y + 64, 400 - i * 50, 8);
  });
  c.fillStyle = '#9baa9f';
  c.font = '16px sans-serif';
  c.fillText('SOURCE / TIME / CONTEXT', 60, 920);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

export function buildBriefing(group) {
  const globe = new THREE.Group();
  globe.position.set(-1.25, 0.45, -0.8);
  group.add(globe);
  const radius = 2.7;
  const wire = new THREE.LineBasicMaterial({ color: 0x8cb9a9, transparent: true, opacity: 0.38 });
  for (let k = 0; k < 12; k++) {
    const points = [];
    for (let j = 0; j <= 96; j++) {
      const a = (j / 96) * Math.PI * 2,
        lon = (k / 12) * Math.PI;
      points.push(
        new THREE.Vector3(
          radius * Math.sin(a) * Math.cos(lon),
          radius * Math.cos(a),
          radius * Math.sin(a) * Math.sin(lon),
        ),
      );
    }
    globe.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), wire));
  }
  for (let k = -2; k <= 2; k++) {
    const y = k * 0.85,
      r = Math.sqrt(radius * radius - y * y),
      points = [];
    for (let j = 0; j <= 96; j++) {
      const a = (j / 96) * Math.PI * 2;
      points.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
    }
    globe.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), wire));
  }
  const dots = [];
  for (let i = 0; i < 24; i++) {
    const y = 1 - (2 * (i + 0.5)) / 24,
      a = i * 2.39996,
      r = Math.sqrt(1 - y * y);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 12, 8),
      new THREE.MeshStandardMaterial({
        color: [0x328e7f, 0xc19b68, 0x9586af][i % 3],
        roughness: 0.4,
      }),
    );
    dot.position.set(r * Math.cos(a) * radius, y * radius, r * Math.sin(a) * radius);
    globe.add(dot);
    dots.push(dot);
  }
  const paper = new THREE.Group();
  paper.position.set(1.35, -0.2, 1.4);
  paper.rotation.set(-0.06, -0.28, -0.12);
  group.add(paper);
  for (let i = 2; i >= 0; i--) {
    const sheet = new THREE.Mesh(
      new THREE.BoxGeometry(2.9, 3.65, 0.035),
      new THREE.MeshStandardMaterial({ color: i ? '#d7e1d6' : '#f7faf4', roughness: 0.8 }),
    );
    sheet.position.set(-i * 0.09, -i * 0.07, -i * 0.09);
    sheet.rotation.z = i * 0.025;
    paper.add(sheet);
  }
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(2.88, 3.63),
    new THREE.MeshBasicMaterial({ map: newspaperTexture() }),
  );
  face.position.z = 0.025;
  paper.add(face);
  const signals = [];
  const origins = [
    [-3.25, 1.7, 1],
    [-2.8, -1.7, 0.9],
    [0.1, 3.2, 0.4],
  ];
  origins.forEach((p, i) => {
    const start = new THREE.Vector3(...p),
      end = new THREE.Vector3(0.3, 1.1 - i * 0.8, 1.6);
    const curve = new THREE.CubicBezierCurve3(
      start,
      start.clone().add(new THREE.Vector3(1.5, 1.2, 1)),
      end.clone().add(new THREE.Vector3(-1, 0.8, 0.8)),
      end,
    );
    const color = [0x328e7f, 0xbf9960, 0x9683af][i];
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 48, 0.012, 6, false),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }),
      ),
    );
    const source = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.85, 0.08),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45 }),
    );
    source.position.copy(start);
    source.rotation.set(-0.15, -0.25, 0.2 - i * 0.2);
    group.add(source);
    for (let n = 0; n < 3; n++) {
      const packet = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.1, 0.1),
        new THREE.MeshStandardMaterial({ color }),
      );
      group.add(packet);
      signals.push({ packet, curve, phase: n / 3 + i * 0.13 });
    }
  });
  let elapsed = 0;
  return {
    stats: { conceptual: true, sources: 3, signals: 9 },
    getState: () => ({ time: elapsed, signals: signals.map((s) => s.packet.position.toArray()) }),
    update(time) {
      elapsed = time;
      globe.rotation.y = time * 0.075;
      paper.position.y = -0.2 + Math.sin(time * 0.8) * 0.08;
      signals.forEach(({ packet, curve, phase }) => {
        packet.position.copy(curve.getPoint((time * 0.16 + phase) % 1));
        packet.rotation.set(time, time * 0.7, 0);
      });
      dots.forEach((d, i) => d.scale.setScalar(1 + Math.max(0, Math.sin(time * 1.5 - i)) * 0.35));
    },
  };
}
