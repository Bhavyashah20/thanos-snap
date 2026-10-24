import test from 'node:test';
import assert from 'node:assert';
import { Pipeline } from '../src/pipeline.js';

const W = 64, H = 48;
const BG = [0, 100, 0], PERSON = [200, 50, 50];

function frameWith(rects) {
  const f = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) f.set([...BG, 255], i * 4);
  for (const r of rects) for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) f.set([...PERSON, 255], (y * W + x) * 4);
  return f;
}
function maskOf(rects) {
  const m = new Uint8Array(W * H);
  for (const r of rects) for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) m[y * W + x] = 1;
  return m;
}
const R1 = { x0: 16, x1: 32, y0: 12, y1: 36 };
const R2 = { x0: 44, x1: 56, y0: 12, y1: 36 };
const px = (b, x, y) => Array.from(b.subarray((y * W + x) * 4, (y * W + x) * 4 + 3));

function make(rects, opts = {}) {
  let current = rects;
  const p = new Pipeline({ width: W, height: H, durationMs: 1000, returnMs: 400, segment: () => maskOf(current), ...opts });
  const out = new Uint8ClampedArray(W * H * 4);
  const step = (t, r = current) => { current = r; p.processFrame(frameWith(r), out, t); return out; };
  return { p, out, step };
}

test('present: output equals input', () => {
  const { p, step } = make([R1]);
  const out = step(0);
  assert.deepStrictEqual(out, frameWith([R1]));
  assert.strictEqual(p.state, 'present');
});

test('learn the room while present, then trigger -> dusting -> gone', () => {
  const { p, step } = make([]);
  for (let t = 0; t < 10; t++) step(t * 33, []); // empty room
  step(400, [R1]);
  p.trigger(400);
  step(433, [R1]);
  assert.strictEqual(p.state, 'dusting');
  step(1600, [R1]);
  assert.strictEqual(p.state, 'gone');
});

test('gone: the person region shows the background, not the live frame', () => {
  const { p, step } = make([]);
  for (let t = 0; t < 10; t++) step(t * 33, []);
  step(400, [R1]);
  p.trigger(400);
  step(433, [R1]);
  const out = step(2000, [R1]);
  assert.deepStrictEqual(px(out, 24, 24), BG);
  assert.deepStrictEqual(px(out, 16, 12), BG, 'corner pixel of the person');
  assert.deepStrictEqual(px(out, 5, 5), BG);
});

test('gone: a dilated margin hides the mask edge', () => {
  const { p, step } = make([]);
  for (let t = 0; t < 10; t++) step(t * 33, []);
  step(400, [R1]);
  p.trigger(400);
  step(433, [R1]);
  // Person's real silhouette is slightly wider than the (imperfect) mask.
  const wider = { ...R1, x1: R1.x1 + 1 };
  p.processFrame(frameWith([wider]), (step.out = new Uint8ClampedArray(W * H * 4)), 2000);
  assert.deepStrictEqual(px(step.out, R1.x1, 24), BG);
});

test('trigger while gone returns the person; trigger during dusting is ignored', () => {
  const { p, step } = make([]);
  for (let t = 0; t < 10; t++) step(t * 33, []);
  step(400, [R1]);
  p.trigger(400);
  step(433, [R1]);
  p.trigger(500); // ignored
  step(600, [R1]);
  assert.strictEqual(p.state, 'dusting');
  step(2000, [R1]);
  assert.strictEqual(p.state, 'gone');
  p.trigger(2100);
  step(2133, [R1]);
  assert.strictEqual(p.state, 'returning');
  const mid = step(2300, [R1]);
  const g = px(mid, 24, 24)[0];
  assert.ok(g > 0 && g < 200, `mid-fade red=${g}`);
  const end = step(2600, [R1]);
  assert.strictEqual(p.state, 'present');
  assert.deepStrictEqual(px(end, 24, 24), PERSON);
});

test('empty mask: trigger is ignored and output is the plain frame', () => {
  const { p, step } = make([]);
  const out = step(0, []);
  p.trigger(10);
  step(40, []);
  assert.strictEqual(p.state, 'present');
  assert.deepStrictEqual(out, frameWith([]));
});

test('two separate people both disappear', () => {
  const { p, step } = make([]);
  for (let t = 0; t < 10; t++) step(t * 33, []);
  step(400, [R1, R2]);
  p.trigger(400);
  step(433, [R1, R2]);
  const out = step(2000, [R1, R2]);
  assert.deepStrictEqual(px(out, 24, 24), BG);
  assert.deepStrictEqual(px(out, 50, 24), BG);
});

test('resize resets to present', () => {
  const { p, step } = make([]);
  for (let t = 0; t < 10; t++) step(t * 33, []);
  step(400, [R1]);
  p.trigger(400);
  step(433, [R1]);
  p.resize(32, 24);
  assert.strictEqual(p.state, 'present');
});

test('before the segmenter has a mask (null), frames pass through and the plate learns nothing', () => {
  let ready = false;
  const p = new Pipeline({ width: W, height: H, durationMs: 1000, segment: () => (ready ? maskOf([R1]) : null) });
  const out = new Uint8ClampedArray(W * H * 4);
  const f = frameWith([R1]);
  p.processFrame(f, out, 0); // person is in frame; mask not ready yet
  assert.deepStrictEqual(out, f);
  ready = true;
  p.trigger(100);
  p.processFrame(f, out, 133);
  p.processFrame(f, out, 2000);
  // the person must NOT have been baked into the background
  assert.notDeepStrictEqual(px(out, 24, 24), PERSON);
});
