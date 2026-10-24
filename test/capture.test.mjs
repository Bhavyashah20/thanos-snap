import test from 'node:test';
import assert from 'node:assert';
import { CaptureController } from '../src/capture.js';

const mk = (o = {}) => new CaptureController({ countdownSec: 3, timeoutMs: 15000, doneCoverage: 0.97, ...o });

test('inactive until started; update returns null', () => {
  const c = mk();
  assert.strictEqual(c.active, false);
  assert.strictEqual(c.update(0, 0), null);
});

test('counts down 3, 2, 1 one second apart', () => {
  const c = mk();
  assert.deepStrictEqual(c.start(1000), { phase: 'countdown', countdown: 3 });
  assert.deepStrictEqual(c.update(1500, 0.5), { phase: 'countdown', countdown: 3 });
  assert.deepStrictEqual(c.update(2000, 0.5), { phase: 'countdown', countdown: 2 });
  assert.deepStrictEqual(c.update(3000, 0.5), { phase: 'countdown', countdown: 1 });
});

test('after the countdown it asks for exactly one plate reset, then reports progress', () => {
  const c = mk();
  c.start(0);
  const first = c.update(3000, 0.6);
  assert.deepStrictEqual(first, { phase: 'capturing', progress: 0, resetPlate: true });
  assert.deepStrictEqual(c.update(3033, 0.0), { phase: 'capturing', progress: 0 });
  assert.deepStrictEqual(c.update(4000, 0.42), { phase: 'capturing', progress: 0.42 });
});

test('done once coverage reaches the threshold; then inactive', () => {
  const c = mk();
  c.start(0);
  c.update(3000, 0);
  assert.deepStrictEqual(c.update(5000, 0.97), { phase: 'done', progress: 1 });
  assert.strictEqual(c.active, false);
  assert.strictEqual(c.update(5033, 1), null);
});

test('fails with a reason if the room never becomes visible in time', () => {
  const c = mk();
  c.start(0);
  c.update(3000, 0);
  assert.strictEqual(c.update(3000 + 14999, 0.75).phase, 'capturing');
  assert.deepStrictEqual(c.update(3000 + 15000, 0.75), { phase: 'failed', reason: 'person-in-frame', progress: 0.75 });
  assert.strictEqual(c.active, false);
});

test('start while active restarts the countdown; cancel goes inactive', () => {
  const c = mk();
  c.start(0);
  c.update(2000, 0);
  assert.deepStrictEqual(c.start(2100), { phase: 'countdown', countdown: 3 });
  c.cancel();
  assert.strictEqual(c.active, false);
});
