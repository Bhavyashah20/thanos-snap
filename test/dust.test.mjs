import test from 'node:test';
import assert from 'node:assert';
import { DustEffect } from '../src/dust.js';

const W = 64, H = 48;
const RECT = { x0: 16, x1: 32, y0: 12, y1: 36 }; // person occupies x in [16,32), y in [12,36)
const PERSON = [200, 50, 50];
const BG = [0, 100, 0];

function fill(rgb) {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) a.set([...rgb, 255], i * 4);
  return a;
}
function scene() {
  const frame = fill(BG);
  const mask = new Uint8Array(W * H);
  for (let y = RECT.y0; y < RECT.y1; y++)
    for (let x = RECT.x0; x < RECT.x1; x++) {
      frame.set([...PERSON, 255], (y * W + x) * 4);
      mask[y * W + x] = 1;
    }
  return { frame, mask, plate: fill(BG) };
}
const isPerson = (buf, x, y) => {
  const o = (y * W + x) * 4;
  return buf[o] === PERSON[0] && buf[o + 1] === PERSON[1] && buf[o + 2] === PERSON[2];
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test('at t=start the person region is untouched', () => {
  const { frame, mask, plate } = scene();
  const d = new DustEffect({ durationMs: 1700, seed: 1 });
  d.start(frame, mask, W, H, 1000);
  const out = new Uint8ClampedArray(W * H * 4);
  assert.strictEqual(d.render(plate, out, 1000), true);
  assert.ok(same(out, frame));
});

test('after the duration the output is exactly the plate and render returns false', () => {
  const { frame, mask, plate } = scene();
  const d = new DustEffect({ durationMs: 1700, seed: 1 });
  d.start(frame, mask, W, H, 0);
  const out = new Uint8ClampedArray(W * H * 4);
  assert.strictEqual(d.render(plate, out, 1700 + 500), false);
  assert.ok(same(out, plate));
});

test('mid-way a partial share of the person is dissolved', () => {
  const { frame, mask, plate } = scene();
  const d = new DustEffect({ durationMs: 1700, seed: 1 });
  d.start(frame, mask, W, H, 0);
  const out = new Uint8ClampedArray(W * H * 4);
  d.render(plate, out, 0.3 * 1700);
  let intact = 0, total = 0;
  for (let y = RECT.y0; y < RECT.y1; y++)
    for (let x = RECT.x0; x < RECT.x1; x++) { total++; if (isPerson(out, x, y)) intact++; }
  const dissolved = 1 - intact / total;
  assert.ok(dissolved > 0.2 && dissolved < 0.8, `dissolved=${dissolved}`);
});

test('dissolving begins at the left edge of the person', () => {
  const { frame, mask, plate } = scene();
  const d = new DustEffect({ durationMs: 1700, seed: 1 });
  d.start(frame, mask, W, H, 0);
  const out = new Uint8ClampedArray(W * H * 4);
  d.render(plate, out, 0.08 * 1700);
  let maxX = -1, changed = 0;
  for (let y = RECT.y0; y < RECT.y1; y++)
    for (let x = RECT.x0; x < RECT.x1; x++)
      if (!isPerson(out, x, y)) { changed++; maxX = Math.max(maxX, x); }
  assert.ok(changed > 0, 'something has started to dissolve');
  assert.ok(maxX < RECT.x0 + 0.65 * (RECT.x1 - RECT.x0), `maxX=${maxX}`);
});

test('same seed gives identical output, different seed differs', () => {
  const { frame, mask, plate } = scene();
  const run = (seed) => {
    const d = new DustEffect({ durationMs: 1700, seed });
    d.start(frame, mask, W, H, 0);
    const out = new Uint8ClampedArray(W * H * 4);
    d.render(plate, out, 900);
    return out;
  };
  assert.ok(same(run(5), run(5)));
  assert.ok(!same(run(5), run(6)));
});

test('nothing appears left of or below the person (ash drifts right and up)', () => {
  const { frame, mask, plate } = scene();
  const d = new DustEffect({ durationMs: 1700, seed: 2 });
  d.start(frame, mask, W, H, 0);
  const out = new Uint8ClampedArray(W * H * 4);
  for (const t of [200, 600, 1000, 1400]) {
    d.render(plate, out, t);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (x < RECT.x0 - 2 || y > RECT.y1 + 2) {
          const o = (y * W + x) * 4;
          assert.deepStrictEqual([out[o], out[o + 1], out[o + 2]], BG, `pixel ${x},${y} at t=${t}`);
        }
      }
  }
});
