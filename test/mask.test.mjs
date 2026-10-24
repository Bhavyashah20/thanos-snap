import test from 'node:test';
import assert from 'node:assert';
import { thresholdUpsample } from '../src/mask.js';

test('thresholds the red channel and scales nearest-neighbour to full size', () => {
  // 2x2 RGBA mask image: confidences 255,0 / 0,255
  const small = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
  const out = new Uint8Array(4 * 4);
  thresholdUpsample(small, 2, 2, out, 4, 4);
  assert.deepStrictEqual(Array.from(out), [1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1]);
});

test('values at or below 127 are background', () => {
  const small = new Uint8ClampedArray([127, 0, 0, 255, 128, 0, 0, 255]);
  const out = new Uint8Array(2);
  thresholdUpsample(small, 2, 1, out, 2, 1);
  assert.deepStrictEqual(Array.from(out), [0, 1]);
});
