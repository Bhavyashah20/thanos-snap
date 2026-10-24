import test from 'node:test';
import assert from 'node:assert';
import { MIGAN_SIZE, buildInput, decodeOutput } from '../src/migan.js';

const N = 4; // tiny stand-in for 512
const rgb = (r, g, b) => { const a = new Uint8ClampedArray(N * N * 4); for (let i = 0; i < N * N; i++) a.set([r, g, b, 255], i * 4); return a; };

test('model size is 512', () => assert.strictEqual(MIGAN_SIZE, 512));

test('channel 0 is known-0.5; channels 1-3 are the image in [-1,1] times the known mask', () => {
  const known = new Uint8Array(N * N).fill(1);
  known[0] = 0; // one hole pixel
  const x = buildInput(rgb(255, 0, 127.5), known, N, 0);
  assert.strictEqual(x.length, 4 * N * N);
  assert.strictEqual(x[0], -0.5);          // hole
  assert.strictEqual(x[1], 0.5);           // known
  assert.strictEqual(x[N * N + 1], 1);     // R=255 -> +1
  assert.strictEqual(x[2 * N * N + 1], -1); // G=0 -> -1
  assert.ok(Math.abs(x[3 * N * N + 1]) < 0.01); // B=127.5 rounds to 128 in a byte -> ~0
  assert.strictEqual(x[N * N], 0);         // hole pixel image channels are zeroed
});

test('erode shrinks the known area so blended edge pixels are not trusted', () => {
  const known = new Uint8Array(N * N).fill(1);
  known[0] = 0;
  const x = buildInput(rgb(10, 10, 10), known, N, 1);
  assert.strictEqual(x[1], -0.5, 'right neighbour of the hole is no longer known');
  assert.strictEqual(x[N], -0.5, 'pixel below the hole is no longer known');
  assert.strictEqual(x[N * N - 1], 0.5, 'far corner stays known');
});

test('decodeOutput maps [-1,1] planar RGB to opaque RGBA bytes', () => {
  const out = new Float32Array(3 * N * N);
  out.fill(-1, 0, N * N); out.fill(1, N * N, 2 * N * N); out.fill(0, 2 * N * N);
  const rgba = decodeOutput(out, N);
  assert.deepStrictEqual(Array.from(rgba.slice(0, 4)), [0, 255, 128, 255]);
});
