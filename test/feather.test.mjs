import test from 'node:test';
import assert from 'node:assert';
import { featherMask } from '../src/feather.js';

const W = 24, H = 20;
const block = () => { const m = new Uint8Array(W * H); for (let y = 5; y < 15; y++) for (let x = 7; x < 17; x++) m[y * W + x] = 1; return m; };
const run = (m, r) => { const out = new Uint8Array(W * H); featherMask(m, W, H, r, new Float32Array(W * H), out); return out; };

test('radius 0 keeps the mask hard (0 or 255)', () => {
  const out = run(block(), 0);
  assert.strictEqual(out[10 * W + 12], 255);
  assert.strictEqual(out[0], 0);
});

test('deep inside is fully opaque, far outside is clear', () => {
  const out = run(block(), 2);
  assert.strictEqual(out[10 * W + 12], 255);
  assert.strictEqual(out[0], 0);
  assert.strictEqual(out[19 * W + 23], 0);
});

test('alpha ramps smoothly across the edge (monotonic, partial at the border)', () => {
  const out = run(block(), 3);
  const row = Array.from({ length: 8 }, (_, i) => out[10 * W + (3 + i)]); // x = 3..10 crosses only the left edge at x=7
  for (let i = 1; i < row.length; i++) assert.ok(row[i] >= row[i - 1], `not monotonic: ${row}`);
  assert.ok(row.some((v) => v > 20 && v < 235), `no soft transition: ${row}`);
});

test('every pixel the hard mask covers keeps alpha > 0 so the person is never left half-visible at the core', () => {
  const m = block();
  const out = run(m, 3);
  for (let i = 0; i < m.length; i++) if (m[i]) assert.ok(out[i] > 0);
});
