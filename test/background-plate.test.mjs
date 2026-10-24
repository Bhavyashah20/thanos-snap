import test from 'node:test';
import assert from 'node:assert';
import { BackgroundPlate } from '../src/background-plate.js';

const W = 4, H = 2;
function solid(r, g, b) {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) a.set([r, g, b, 255], i * 4);
  return a;
}

test('background pixels converge to the frame', () => {
  const p = new BackgroundPlate(W, H, { minBackgroundFrames: 1 });
  const frame = solid(100, 150, 200);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < 40; i++) p.update(frame, mask);
  const out = p.read();
  assert.ok(Math.abs(out[0] - 100) <= 2 && Math.abs(out[1] - 150) <= 2 && Math.abs(out[2] - 200) <= 2);
});

test('person pixels leave the plate unchanged', () => {
  const p = new BackgroundPlate(W, H, { minBackgroundFrames: 1 });
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < 40; i++) p.update(solid(10, 20, 30), mask);
  mask[0] = 1;
  for (let i = 0; i < 40; i++) p.update(solid(250, 250, 250), mask);
  const out = p.read();
  assert.ok(Math.abs(out[0] - 10) <= 2, 'masked pixel kept old value');
  assert.ok(Math.abs(out[4] - 250) <= 2, 'unmasked pixel followed the frame');
});

test('never-seen pixels are excluded from coverage', () => {
  const p = new BackgroundPlate(W, H, { minBackgroundFrames: 1 });
  const mask = new Uint8Array(W * H).fill(1);
  mask[7] = 0;
  p.update(solid(90, 90, 90), mask);
  assert.strictEqual(p.coverage(), 1 / (W * H));
});

test('reset resizes and clears', () => {
  const p = new BackgroundPlate(W, H, { minBackgroundFrames: 1 });
  p.update(solid(90, 90, 90), new Uint8Array(W * H));
  p.reset(2, 2);
  assert.strictEqual(p.read().length, 2 * 2 * 4);
  assert.strictEqual(p.coverage(), 0);
});

test('read() fills never-seen pixels from the nearest seen pixel in the row', () => {
  const p = new BackgroundPlate(W, H, { minBackgroundFrames: 1 });
  const mask = new Uint8Array(W * H);
  mask[1] = 1; mask[2] = 1; // row 0: x=1,2 hidden by a person
  p.update(solid(77, 88, 99), mask);
  const out = p.read();
  for (const x of [1, 2]) {
    assert.deepStrictEqual([out[x * 4], out[x * 4 + 1], out[x * 4 + 2]], [77, 88, 99]);
    assert.strictEqual(out[x * 4 + 3], 255);
  }
});

test('read() fills a fully-unseen row from the row above', () => {
  const p = new BackgroundPlate(W, H, { minBackgroundFrames: 1 });
  const mask = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) mask[W + x] = 1; // row 1 fully hidden
  p.update(solid(40, 50, 60), mask);
  const out = p.read();
  assert.deepStrictEqual([out[W * 4], out[W * 4 + 1], out[W * 4 + 2]], [40, 50, 60]);
});

test('a hole between two different colours is filled smoothly, not copied from one side', () => {
  const p = new BackgroundPlate(8, 2, { minBackgroundFrames: 1 });
  const frame = new Uint8ClampedArray(8 * 2 * 4);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) frame.set([x < 3 ? 200 : 100, 0, 0, 255], (y * 8 + x) * 4);
  const mask = new Uint8Array(16);
  for (let y = 0; y < 2; y++) { mask[y * 8 + 3] = 1; mask[y * 8 + 4] = 1; }
  p.update(frame, mask);
  const out = p.read();
  const r3 = out[3 * 4], r4 = out[4 * 4];
  assert.ok(r3 < 200 && r3 > 100 && r4 < 200 && r4 > 100, `r3=${r3} r4=${r4}`);
  assert.ok(r3 >= r4, 'monotonic across the hole');
});

test('a pixel is trusted only after minBackgroundFrames clear frames in a row', () => {
  const p = new BackgroundPlate(W, H, { minBackgroundFrames: 5 });
  const none = new Uint8Array(W * H);
  for (let i = 0; i < 4; i++) p.update(solid(90, 90, 90), none);
  assert.strictEqual(p.coverage(), 0);
  p.update(solid(90, 90, 90), none);
  assert.strictEqual(p.coverage(), 1);
});

test('a flickering mask resets the run, so flicker never admits a pixel', () => {
  const p = new BackgroundPlate(W, H, { minBackgroundFrames: 5 });
  const none = new Uint8Array(W * H), all = new Uint8Array(W * H).fill(1);
  for (let i = 0; i < 20; i++) p.update(solid(90, 90, 90), i % 4 === 3 ? all : none);
  assert.strictEqual(p.coverage(), 0);
});

test('one empty-mask frame does not bake the person into the background', () => {
  const p = new BackgroundPlate(W, H, { minBackgroundFrames: 5 });
  const bgFrame = solid(200, 200, 200);
  const personFrame = solid(200, 200, 200);
  for (const i of [0, 1]) personFrame.set([5, 5, 5, 255], i * 4); // 2 dark person pixels
  const hide = new Uint8Array(W * H); hide[0] = 1; hide[1] = 1;
  p.update(personFrame, new Uint8Array(W * H)); // segmenter hiccup: empty mask, person visible
  for (let i = 0; i < 10; i++) p.update(i === 0 ? personFrame : bgFrame, hide);
  for (let i = 0; i < 10; i++) p.update(bgFrame, hide);
  const out = p.read();
  assert.ok(out[0] > 150, `person pixel baked in as ${out[0]}`);
});
