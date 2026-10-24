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
  const p = new Pipeline({ width: W, height: H, durationMs: 1000, returnMs: 400, segment: () => maskOf(current), minBackgroundFrames: 1, ...opts });
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
  const p = new Pipeline({ width: W, height: H, durationMs: 1000, segment: () => (ready ? maskOf([R1]) : null), minBackgroundFrames: 1 });
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

test('gone: a one-frame mask dropout does not flash the person back', () => {
  let current = [];
  const p = new Pipeline({ width: W, height: H, durationMs: 1000, minBackgroundFrames: 1, segment: () => maskOf(current) });
  const out = new Uint8ClampedArray(W * H * 4);
  const run = (t, rects, personInPicture = rects) => { current = rects; p.processFrame(frameWith(personInPicture), out, t); };
  for (let t = 0; t < 10; t++) run(t * 33, []);
  run(400, [R1]);
  p.trigger(400);
  run(433, [R1]);
  run(2000, [R1]);
  assert.strictEqual(p.state, 'gone');
  run(2033, [], [R1]); // segmenter misses the person for one frame; they are still in the picture
  assert.deepStrictEqual(px(out, 24, 24), BG);
});

test('capture: beginCapture stages a new room without touching the live one until commit', () => {
  const { p, step } = make([]);
  for (let t = 0; t < 10; t++) step(t * 33, []);
  const before = Uint8ClampedArray.from(p.plate.read());
  assert.strictEqual(p.roomSource, 'learned');
  p.beginCapture();
  const bright = new Uint8ClampedArray(W * H * 4).fill(240);
  p.captureFrame(bright);
  assert.deepStrictEqual(p.plate.read(), before, 'live plate unchanged while staging');
  p.abortCapture();
  assert.deepStrictEqual(p.plate.read(), before, 'abort keeps the old room');
  p.beginCapture();
  p.captureFrame(bright);
  p.commitCapture();
  assert.strictEqual(p.roomSource, 'captured');
  assert.strictEqual(p.plate.read()[0], 240);
  assert.strictEqual(p.plate.coverage(), 1);
});

test('maskArea reports the fraction of the picture covered by the person', () => {
  const { p, step } = make([R1]);
  step(0);
  assert.ok(Math.abs(p.maskArea - ((R1.x1 - R1.x0) * (R1.y1 - R1.y0)) / (W * H)) < 0.2, `maskArea=${p.maskArea}`);
  assert.ok(p.maskArea > 0);
});

test('commitCapture rejects a capture in which the person never left the spot they were seen in', () => {
  const { p, step } = make([]);
  for (let t = 0; t < 10; t++) step(t * 33, []);
  step(400, [R1]); // person present: baseline
  p.noteBaseline(frameWith([R1]));
  p.beginCapture();
  for (let i = 0; i < 20; i++) p.captureFrame(frameWith([R1])); // still standing there
  assert.strictEqual(p.commitCapture(), false);
  assert.strictEqual(p.roomSource, 'learned');
});

test('commitCapture accepts a capture where the baseline area now shows something else', () => {
  const { p, step } = make([]);
  for (let t = 0; t < 10; t++) step(t * 33, []);
  step(400, [R1]);
  p.noteBaseline(frameWith([R1]));
  p.beginCapture();
  for (let i = 0; i < 20; i++) p.captureFrame(frameWith([]));
  assert.strictEqual(p.commitCapture(), true);
  assert.strictEqual(p.roomSource, 'captured');
});

test('commitCapture accepts when nobody was in view at the start (no baseline)', () => {
  const { p } = make([]);
  p.beginCapture();
  p.captureFrame(frameWith([]));
  assert.strictEqual(p.commitCapture(), true);
});

test('with a captured room, a limb the model missed is still hidden when gone', () => {
  const ARM = { x0: 32, x1: 38, y0: 20, y1: 30 }; // touches R1's right edge; the model mask will not include it
  let current = [];
  const p = new Pipeline({ width: W, height: H, durationMs: 1000, minBackgroundFrames: 1, segment: () => maskOf(current) });
  const out = new Uint8ClampedArray(W * H * 4);
  p.beginCapture();
  for (let i = 0; i < 5; i++) p.captureFrame(frameWith([]));
  assert.strictEqual(p.commitCapture(), true);
  const run = (t) => { current = [R1]; p.processFrame(frameWith([R1, ARM]), out, t); };
  run(0);
  p.trigger(10);
  run(33);
  run(2000);
  assert.strictEqual(p.state, 'gone');
  assert.deepStrictEqual(px(out, 35, 25), BG, 'arm hidden');
  assert.deepStrictEqual(px(out, 24, 24), BG, 'body hidden');
});

test('gone: the pasted background is matched to the live lighting (no seam after an exposure change)', () => {
  const brighten = (f) => { const g = Uint8ClampedArray.from(f); for (let i = 0; i < g.length; i += 4) { g[i] *= 1.2; g[i + 1] *= 1.2; g[i + 2] *= 1.2; } return g; };
  let current = [];
  const p = new Pipeline({ width: W, height: H, durationMs: 1000, minBackgroundFrames: 1, segment: () => maskOf(current) });
  const out = new Uint8ClampedArray(W * H * 4);
  p.beginCapture();
  for (let i = 0; i < 5; i++) p.captureFrame(frameWith([]));
  assert.strictEqual(p.commitCapture(), true);
  const run = (t) => { current = [R1]; p.processFrame(brighten(frameWith([R1])), out, t); }; // the camera auto-brightened
  run(0);
  p.trigger(10);
  run(33);
  run(2000);
  assert.strictEqual(p.state, 'gone');
  const g = px(out, 24, 24)[1];
  assert.ok(Math.abs(g - 120) <= 4, `hidden area green=${g}, live wall green=${px(out, 5, 5)[1]}`);
  assert.ok(Math.abs(px(out, 5, 5)[1] - g) <= 4, 'no seam between pasted and live');
});
