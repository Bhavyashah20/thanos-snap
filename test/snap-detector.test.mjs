import test from 'node:test';
import assert from 'node:assert';
import { SnapDetector } from '../src/snap-detector.js';

const SR = 48000;
const N = 512;
const frameMs = (N / SR) * 1000;

function rng(seed = 1) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

// A snap-like click: ~3 ms exponentially decaying white noise starting at sample `at`.
function snapSignal(totalSamples, at, amp) {
  const r = rng(7);
  const x = new Float32Array(totalSamples);
  const tau = 0.003 * SR;
  for (let i = at; i < totalSamples; i++) x[i] = amp * r() * Math.exp(-(i - at) / tau);
  return x;
}

function run(det, signal, startMs = 0) {
  const hits = [];
  for (let off = 0; off + N <= signal.length; off += N) {
    const t = startMs + (off / SR) * 1000;
    if (det.feed(signal.subarray(off, off + N), t)) hits.push(Math.round(t));
  }
  return hits;
}

test('a sharp click fires exactly once', () => {
  const det = new SnapDetector({ sampleRate: SR, sensitivity: 0.5 });
  const hits = run(det, snapSignal(SR / 2, SR / 4, 0.5));
  assert.strictEqual(hits.length, 1);
});

test('a second click inside the cooldown is ignored, one after it fires', () => {
  const det = new SnapDetector({ sampleRate: SR, sensitivity: 0.5, cooldownMs: 1500 });
  const a = snapSignal(SR * 3, SR / 4, 0.5);
  const b = snapSignal(SR * 3, SR / 4 + Math.round(0.3 * SR), 0.5);
  const c = snapSignal(SR * 3, SR / 4 + Math.round(2 * SR), 0.5);
  const mix = new Float32Array(SR * 3);
  for (let i = 0; i < mix.length; i++) mix[i] = a[i] + b[i] + c[i];
  assert.strictEqual(run(det, mix).length, 2);
});

test('one second of steady white noise never fires', () => {
  const r = rng(3);
  const x = new Float32Array(SR);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * r();
  const det = new SnapDetector({ sampleRate: SR, sensitivity: 0.5 });
  assert.strictEqual(run(det, x).length, 0);
});

test('a low tone with an amplitude step (speech-like) never fires', () => {
  const x = new Float32Array(SR);
  for (let i = 0; i < x.length; i++) x[i] = (i < SR / 2 ? 0.05 : 0.8) * Math.sin((2 * Math.PI * 200 * i) / SR);
  const det = new SnapDetector({ sampleRate: SR, sensitivity: 0.5 });
  assert.strictEqual(run(det, x).length, 0);
});

test('silence never fires', () => {
  const det = new SnapDetector({ sampleRate: SR, sensitivity: 1 });
  assert.strictEqual(run(det, new Float32Array(SR)).length, 0);
});

test('sensitivity 1 fires on a quiet click, sensitivity 0 does not', () => {
  const quiet = snapSignal(SR / 2, SR / 4, 0.1);
  assert.strictEqual(run(new SnapDetector({ sampleRate: SR, sensitivity: 1 }), quiet).length, 1);
  assert.strictEqual(run(new SnapDetector({ sampleRate: SR, sensitivity: 0 }), quiet).length, 0);
});

test('setSensitivity changes behaviour live', () => {
  const quiet = snapSignal(SR / 2, SR / 4, 0.1);
  const det = new SnapDetector({ sampleRate: SR, sensitivity: 0 });
  assert.strictEqual(run(det, quiet).length, 0);
  det.setSensitivity(1);
  assert.strictEqual(run(det, quiet, 5000).length, 1);
});

void frameMs;
