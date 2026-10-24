import test from 'node:test';
import assert from 'node:assert';
import { CaptureController } from '../src/capture.js';

const mk = (o = {}) => new CaptureController({ countdownSec: 3, timeoutMs: 15000, goodMs: 1500, ...o });
// a frame report: how much of the picture the segmenter thinks is a person
const u = (c, now, maskArea) => c.update(now, maskArea);

test('inactive until started; update returns null', () => {
  const c = mk();
  assert.strictEqual(c.active, false);
  assert.strictEqual(u(c, 0, 0.3), null);
});

test('counts down 3, 2, 1 one second apart', () => {
  const c = mk();
  assert.deepStrictEqual(c.start(1000), { phase: 'countdown', countdown: 3 });
  assert.deepStrictEqual(u(c, 1500, 0.3), { phase: 'countdown', countdown: 3 });
  assert.deepStrictEqual(u(c, 2000, 0.3), { phase: 'countdown', countdown: 2 });
  assert.deepStrictEqual(u(c, 3000, 0.3), { phase: 'countdown', countdown: 1 });
});

test('after the countdown it signals begin exactly once', () => {
  const c = mk();
  c.start(0);
  u(c, 1000, 0.3);
  assert.deepStrictEqual(u(c, 3000, 0.3), { phase: 'capturing', progress: 0, accepting: false, begin: true });
  assert.strictEqual(u(c, 3033, 0.3).begin, undefined);
});

test('progress only advances while the person is out of view (area under half of the countdown area)', () => {
  const c = mk();
  c.start(0);
  u(c, 2000, 0.4); // person present: baseline area 0.4
  u(c, 3000, 0.4); // begin
  assert.deepStrictEqual(u(c, 3500, 0.4), { phase: 'capturing', progress: 0, accepting: false }, 'still there');
  assert.deepStrictEqual(u(c, 3600, 0.05), { phase: 'capturing', progress: 0, accepting: true, restart: true }, 'left: starts counting');
  const mid = u(c, 4350, 0.05);
  assert.strictEqual(mid.accepting, true);
  assert.ok(Math.abs(mid.progress - 0.5) < 0.01, `progress=${mid.progress}`);
});

test('stepping back into view resets progress', () => {
  const c = mk();
  c.start(0);
  u(c, 2000, 0.4); u(c, 3000, 0.4);
  u(c, 3100, 0.05);
  u(c, 3700, 0.05);
  assert.strictEqual(u(c, 3800, 0.4).progress, 0);
});

test('done after goodMs of clean frames; then inactive', () => {
  const c = mk();
  c.start(0);
  u(c, 2000, 0.4); u(c, 3000, 0.4);
  u(c, 3100, 0.05);
  assert.deepStrictEqual(u(c, 3100 + 1500, 0.05), { phase: 'done', progress: 1 });
  assert.strictEqual(c.active, false);
});

test('an empty room (nobody at the start) needs a tiny mask area, not half of nothing', () => {
  const c = mk();
  c.start(0);
  u(c, 2000, 0.0); u(c, 3000, 0.0);
  assert.strictEqual(u(c, 3033, 0.0).accepting, true);
  assert.strictEqual(u(c, 3066, 0.1).accepting, false, 'someone walked in');
});

test('fails with a reason if the person never leaves', () => {
  const c = mk();
  c.start(0);
  u(c, 2000, 0.4); u(c, 3000, 0.4);
  assert.strictEqual(u(c, 3000 + 14999, 0.4).phase, 'capturing');
  assert.deepStrictEqual(u(c, 3000 + 15000, 0.4), { phase: 'failed', reason: 'person-in-frame', progress: 0 });
  assert.strictEqual(c.active, false);
});

test('start while active restarts the countdown; cancel goes inactive', () => {
  const c = mk();
  c.start(0);
  u(c, 2000, 0.3);
  assert.deepStrictEqual(c.start(2100), { phase: 'countdown', countdown: 3 });
  c.cancel();
  assert.strictEqual(c.active, false);
});

test('each new clean window asks the pipeline to restart staging; interruptions restart it again', () => {
  const c = mk();
  c.start(0);
  u(c, 2000, 0.4); u(c, 3000, 0.4);
  assert.strictEqual(u(c, 3100, 0.05).restart, true, 'first clean frame');
  assert.strictEqual(u(c, 3200, 0.05).restart, undefined, 'same window');
  u(c, 3300, 0.4); // came back into view
  assert.strictEqual(u(c, 3400, 0.05).restart, true, 'new window');
});
