import test from 'node:test';
import assert from 'node:assert';
import { Relight } from '../src/relight.js';

const W = 64, H = 48;
const room = (fn) => { const a = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a.set([...fn(x, y), 255], (y * W + x) * 4); return a; };
const hiddenRect = () => { const m = new Uint8Array(W * H); for (let y = 12; y < 36; y++) for (let x = 20; x < 44; x++) m[y * W + x] = 1; return m; };
const seen = new Uint8Array(W * H).fill(1);
const idx = (x, y) => (y * W + x) * 4;

test('a uniform exposure change shows up as a uniform correction inside the hidden area', () => {
  const base = room(() => [100, 100, 100]);
  const live = room(() => [130, 120, 100]); // brighter + warmer
  const r = new Relight(W, H);
  const out = new Uint8ClampedArray(W * H * 4);
  r.apply(live, base, seen, hiddenRect(), out);
  const o = idx(32, 24);
  assert.ok(Math.abs(out[o] - 130) <= 2 && Math.abs(out[o + 1] - 120) <= 2 && Math.abs(out[o + 2] - 100) <= 2, `got ${out[o]},${out[o + 1]},${out[o + 2]}`);
});

test('a lighting gradient across the picture is continued smoothly through the hidden area', () => {
  const base = room(() => [100, 100, 100]);
  const live = room((x) => [100 + Math.round((x / W) * 40), 100, 100]); // +0 on the left .. +40 on the right
  const r = new Relight(W, H);
  const out = new Uint8ClampedArray(W * H * 4);
  r.apply(live, base, seen, hiddenRect(), out);
  const left = out[idx(21, 24)], mid = out[idx(32, 24)], right = out[idx(42, 24)];
  assert.ok(left < mid && mid < right, `${left} ${mid} ${right}`);
  assert.ok(Math.abs(mid - 120) <= 6, `mid=${mid}`);
});

test('pixels outside the hidden area are not touched', () => {
  const base = room(() => [100, 100, 100]);
  const live = room(() => [130, 130, 130]);
  const r = new Relight(W, H);
  const out = new Uint8ClampedArray(W * H * 4).fill(7);
  r.apply(live, base, seen, hiddenRect(), out);
  assert.strictEqual(out[idx(2, 2)], 7);
});

test('if nothing is visible outside the hidden area the room is used as is', () => {
  const base = room(() => [100, 100, 100]);
  const live = room(() => [200, 200, 200]);
  const r = new Relight(W, H);
  const out = new Uint8ClampedArray(W * H * 4);
  r.apply(live, base, seen, new Uint8Array(W * H).fill(1), out);
  assert.strictEqual(out[idx(10, 10)], 100);
});
