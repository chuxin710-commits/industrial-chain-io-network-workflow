import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rate = 48000,
  seconds = 32,
  count = rate * seconds;
const left = new Float64Array(count),
  right = new Float64Array(count);
let seed = 20261008;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return (seed / 4294967296) * 2 - 1;
};
const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
const add = (time, length, fn, pan = 0) => {
  const begin = Math.round(time * rate),
    end = Math.min(count, begin + Math.round(length * rate));
  const l = Math.sqrt((1 - pan) / 2),
    r = Math.sqrt((1 + pan) / 2);
  for (let i = begin; i < end; i++) {
    const t = (i - begin) / rate,
      value = fn(t);
    left[i] += value * l;
    right[i] += value * r;
  }
};
const chords = [
  [50, 53, 57, 60],
  [46, 50, 53, 57],
  [53, 57, 60, 64],
  [48, 52, 55, 59],
];
const motif = [0, 2, 1, 3, 2, 1, 3, 2];
for (let bar = 0; bar < 16; bar++) {
  const chord = chords[Math.floor(bar / 2) % 4],
    start = bar * 2;
  for (let voice = 0; voice < 3; voice++) {
    const f = freq(chord[voice] + 12);
    add(
      start,
      2.3,
      (t) => {
        const envelope = Math.min(1, t / 0.24) * Math.max(0, 1 - t / 2.3) * 0.075;
        return (
          envelope *
          (Math.sin(2 * Math.PI * f * t) +
            0.34 * Math.sin(2 * Math.PI * f * 1.003 * t) +
            0.12 * Math.sin(4 * Math.PI * f * t))
        );
      },
      (voice - 1) * 0.45,
    );
  }
  for (let step = 0; step < 8; step++) {
    const f = freq(chord[motif[step]] + 24),
      time = start + step * 0.25;
    const intensity = bar < 2 ? 0.5 : bar >= 14 ? 0.6 : 1;
    add(
      time,
      0.46,
      (t) => {
        const env = (1 - Math.exp(-t * 220)) * Math.exp(-t * 13) * 0.092 * intensity;
        return (
          env *
          (Math.sin(2 * Math.PI * f * t) +
            0.24 * Math.sin(4 * Math.PI * f * t) +
            0.13 * Math.sin(6 * Math.PI * f * t))
        );
      },
      Math.sin(step * 1.7) * 0.55,
    );
    if (time + 0.375 < seconds)
      add(
        time + 0.375,
        0.35,
        (t) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 14) * 0.028 * intensity,
        -Math.sin(step * 1.7) * 0.5,
      );
  }
  if (bar >= 2 && bar < 15) {
    for (let beat = 0; beat < 4; beat++) {
      const time = start + beat * 0.5;
      add(time, 0.4, (t) => {
        const phase = 2 * Math.PI * (48 * t + 105 * 0.026 * (1 - Math.exp(-t / 0.026)));
        return 0.5 * Math.sin(phase) * Math.exp(-t * 15) + random() * 0.032 * Math.exp(-t * 130);
      });
      const bass = freq(chord[0] - 24);
      add(
        time + 0.07,
        0.32,
        (t) =>
          (1 - Math.exp(-t * 180)) *
          Math.exp(-t * 10) *
          (0.22 * Math.sin(2 * Math.PI * bass * t) + 0.06 * Math.sin(4 * Math.PI * bass * t)),
      );
      if (beat === 1 || beat === 3)
        add(
          time,
          0.16,
          (t) => (random() * 0.14 + Math.sin(2 * Math.PI * 185 * t) * 0.07) * Math.exp(-t * 32),
          0.08,
        );
    }
    let previous = 0;
    for (let hat = 0; hat < 16; hat++) {
      const strength = hat % 4 === 2 ? 0.075 : 0.032;
      add(
        start + hat * 0.125,
        0.055,
        (t) => {
          const n = random();
          const high = n - previous;
          previous = n;
          return high * strength * Math.exp(-t * 95);
        },
        hat % 2 ? 0.32 : -0.32,
      );
    }
  }
}
for (const time of [7.75, 15.75, 23.75])
  add(
    time,
    1.25,
    (t) =>
      random() * 0.024 * Math.exp(-t * 4) +
      Math.sin(2 * Math.PI * (320 * t + 100 * t * t)) * 0.025 * Math.exp(-t * 5),
    -0.2,
  );

let peak = 0,
  energy = 0;
for (let i = 0; i < count; i++) {
  const t = i / rate,
    fade = Math.min(1, t / 0.25) * Math.min(1, (seconds - t) / 0.8);
  const kickDucking = 0.86 + 0.14 * (1 - Math.exp(-(t % 0.5) * 14));
  left[i] = Math.tanh(left[i] * 1.4) * fade * kickDucking;
  right[i] = Math.tanh(right[i] * 1.4) * fade * kickDucking;
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  energy += left[i] ** 2 + right[i] ** 2;
}
const gain = 0.88 / peak,
  buffer = Buffer.alloc(44 + count * 4);
buffer.write('RIFF', 0);
buffer.writeUInt32LE(buffer.length - 8, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(2, 22);
buffer.writeUInt32LE(rate, 24);
buffer.writeUInt32LE(rate * 4, 28);
buffer.writeUInt16LE(4, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(count * 4, 40);
for (let i = 0; i < count; i++) {
  buffer.writeInt16LE(Math.round(left[i] * gain * 32767), 44 + i * 4);
  buffer.writeInt16LE(Math.round(right[i] * gain * 32767), 46 + i * 4);
}
await mkdir('public/media', { recursive: true });
await writeFile('public/media/chainlab-original-score.wav', buffer);
const metadata = {
  title: 'The Chain of Discovery',
  composition: 'Original programmed electronic instrumental',
  duration: seconds,
  sampleRate: rate,
  channels: 2,
  bpm: 120,
  key: 'D minor',
  progression: 'Dm / Bb / F / C',
  seed: 20261008,
  voices: [
    'warm synth pads',
    'plucked arpeggio',
    'sub bass',
    'synthesized kick',
    'noise snare and hats',
  ],
  samplesUsed: false,
  vocals: false,
  peakAmplitude: 0.88,
  rmsDb: 20 * Math.log10(Math.sqrt(energy / (count * 2)) * gain),
};
await writeFile('public/media/score-manifest.json', JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(metadata, null, 2));
