import test from 'node:test';
import assert from 'node:assert';
import { refineMask } from '../src/refine.js';

const W = 40, H = 30;
const WALL = [200, 195, 185];

function img(fn) {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a.set([...(fn(x, y) || WALL), 255], (y * W + x) * 4);
  return a;
}
const room = img(() => null);
const seen = new Uint8Array(W * H).fill(1);
const maskOf = (fn) => { const m = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fn(x, y)) m[y * W + x] = 1; return m; };
const at = (m, x, y) => m[y * W + x];

const SKIN = [230, 150, 120];
const body = (x, y) => x >= 15 && x < 25 && y >= 8 && y < 30;
const arm = (x, y) => x >= 25 && x < 31 && y >= 14 && y < 24; // touches the body's right side
const far = (x, y) => x >= 2 && x < 5 && y >= 2 && y < 5;    // unrelated object, not connected

test('adds pixels that differ from the room and touch the model mask (the missed arm)', () => {
  const frame = img((x, y) => (body(x, y) || arm(x, y) ? SKIN : null));
  const out = new Uint8Array(W * H);
  refineMask(frame, room, seen, maskOf(body), W, H, out);
  assert.strictEqual(at(out, 28, 18), 1, 'arm included');
  assert.strictEqual(at(out, 20, 20), 1, 'body kept');
  assert.strictEqual(at(out, 5, 25), 0, 'plain wall untouched');
});

test('does not add a different object that is not connected to the person', () => {
  const frame = img((x, y) => (body(x, y) || far(x, y) ? SKIN : null));
  const out = new Uint8Array(W * H);
  refineMask(frame, room, seen, maskOf(body), W, H, out);
  assert.strictEqual(at(out, 3, 3), 0);
});

test('a frame identical to the room adds nothing beyond the model mask', () => {
  const out = new Uint8Array(W * H);
  const m = maskOf(body);
  refineMask(room, room, seen, m, W, H, out);
  assert.deepStrictEqual(Array.from(out), Array.from(m));
});

test('an overall exposure change does not flood the picture', () => {
  const brighter = img((x, y) => (body(x, y) ? SKIN : WALL.map((v) => v * 1.18)));
  const out = new Uint8Array(W * H);
  refineMask(brighter, room, seen, maskOf(body), W, H, out);
  assert.strictEqual(at(out, 5, 25), 0);
  assert.strictEqual(at(out, 35, 5), 0);
});

test('if the whole picture differs (camera moved) it falls back to the model mask', () => {
  const moved = img((x, y) => [60 + x, 90, 150 - y]);
  const m = maskOf(body);
  const out = new Uint8Array(W * H);
  refineMask(moved, room, seen, m, W, H, out);
  assert.deepStrictEqual(Array.from(out), Array.from(m));
});

test('pixels the room never saw are not judged', () => {
  const frame = img((x, y) => (body(x, y) || arm(x, y) ? SKIN : null));
  const partial = Uint8Array.from(seen);
  for (let y = 14; y < 24; y++) for (let x = 25; x < 31; x++) partial[y * W + x] = 0;
  const out = new Uint8Array(W * H);
  refineMask(frame, room, partial, maskOf(body), W, H, out);
  assert.strictEqual(at(out, 28, 18), 0);
});
