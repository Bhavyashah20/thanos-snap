import { Inpainter } from './inpaint.js';

// Running model of the empty room: updated only where the mask says "not person",
// so once the person is removed the plate fills the gap.
const BLEND = 0.15;
const FILL_EVERY = 4; // updates between inpaint recomputes

export class BackgroundPlate {
  // A pixel only counts as background once it has been clear of the person mask for
  // `minBackgroundFrames` frames in a row, so a segmentation hiccup can't bake the person in.
  constructor(width, height, { minBackgroundFrames = 20 } = {}) {
    this.minBackgroundFrames = minBackgroundFrames;
    this.reset(width, height);
  }

  reset(width, height) {
    this.width = width;
    this.height = height;
    this.plate = new Float32Array(width * height * 4);
    this.out = new Uint8ClampedArray(width * height * 4);
    this.seen = new Uint8Array(width * height);
    this.run = new Uint8Array(width * height); // consecutive frames clear of the mask
    this.seenCount = 0;
    this.updates = 0;
    this.filledAt = 0;
    this.filled = null;
    this.mlFill = null; // optional ML inpainting of the unseen pixels, blended in by mlWeight
    this.mlWeight = 0;
    this.dirty = true;
    this.inpainter = new Inpainter(width, height);
  }

  update(rgba, mask) {
    this.updates++;
    this.dirty = true;
    const { plate, seen, run, minBackgroundFrames } = this;
    for (let i = 0; i < seen.length; i++) {
      if (mask[i]) { run[i] = 0; continue; }
      if (run[i] < 255) run[i]++;
      const o = i * 4;
      if (!seen[i]) {
        if (run[i] < minBackgroundFrames) continue;
        plate[o] = rgba[o];
        plate[o + 1] = rgba[o + 1];
        plate[o + 2] = rgba[o + 2];
        plate[o + 3] = 255;
        seen[i] = 1;
        this.seenCount++;
      } else if (run[i] >= Math.min(3, minBackgroundFrames)) {
        plate[o] += (rgba[o] - plate[o]) * BLEND;
        plate[o + 1] += (rgba[o + 1] - plate[o + 1]) * BLEND;
        plate[o + 2] += (rgba[o + 2] - plate[o + 2]) * BLEND;
      }
    }
  }

  // The plate as bytes. Never-seen pixels (the person has covered them since the start) are
  // inpainted from the surrounding colours; that fill is recomputed every few updates, not every read.
  setMlFill(rgba, weight) {
    this.mlFill = rgba;
    this.mlWeight = weight;
    this.dirty = true;
  }

  read() {
    const { out, seen } = this;
    if (this.seenCount === seen.length) {
      if (this.dirty) { out.set(this.plate); this.dirty = false; } // float -> clamped bytes (rounds); cached until the next update
      return out;
    }
    out.set(this.plate);
    if (!this.filled || this.updates - this.filledAt >= FILL_EVERY) {
      this.inpainter.fill(this.plate, seen, this.filled || (this.filled = new Uint8ClampedArray(out.length)));
      this.filledAt = this.updates;
    }
    const { filled, mlFill, mlWeight: a } = this;
    const useMl = mlFill && a > 0;
    for (let i = 0; i < seen.length; i++) {
      if (seen[i]) continue;
      const o = i * 4;
      if (useMl) {
        out[o] = filled[o] + (mlFill[o] - filled[o]) * a;
        out[o + 1] = filled[o + 1] + (mlFill[o + 1] - filled[o + 1]) * a;
        out[o + 2] = filled[o + 2] + (mlFill[o + 2] - filled[o + 2]) * a;
      } else {
        out[o] = filled[o]; out[o + 1] = filled[o + 1]; out[o + 2] = filled[o + 2];
      }
      out[o + 3] = 255;
    }
    return out;
  }

  coverage() {
    return this.seenCount / this.seen.length;
  }
}
