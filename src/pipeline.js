import { BackgroundPlate } from './background-plate.js';
import { DustEffect } from './dust.js';

const DILATE_RADIUS = 3;

// Grow a 0/1 mask by `r` pixels (separable, O(n)); hides the soft edge of an imperfect segmentation.
function dilate(mask, width, height, r, tmp, out) {
  const sweep = (src, dst, count, lines, stride, lineStride) => {
    for (let l = 0; l < lines; l++) {
      const base = l * lineStride;
      let since = r + 1;
      for (let i = 0; i < count; i++) {
        since = src[base + i * stride] ? 0 : since + 1;
        dst[base + i * stride] = since <= r ? 1 : 0;
      }
      since = r + 1;
      for (let i = count - 1; i >= 0; i--) {
        since = src[base + i * stride] ? 0 : since + 1;
        if (since <= r) dst[base + i * stride] = 1;
      }
    }
  };
  sweep(mask, tmp, width, height, 1, width);
  sweep(tmp, out, height, width, width, 1);
}

export class Pipeline {
  constructor({ segment, width, height, durationMs = 1700, returnMs = 600 }) {
    this.segment = segment;
    this.durationMs = durationMs;
    this.returnMs = returnMs;
    this.resize(width, height);
  }

  get state() {
    return this._state;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.plate = new BackgroundPlate(width, height);
    this.dust = null;
    this.tmp = new Uint8Array(width * height);
    this.grown = new Uint8Array(width * height);
    this._state = 'present';
  }

  trigger(nowMs) {
    if (this._state === 'present') {
      this._state = 'dusting';
      this.dust = null; // started on the next frame, from that frame's pixels
    } else if (this._state === 'gone') {
      this._state = 'returning';
      this.returnStartMs = nowMs;
    }
  }

  processFrame(rgba, out, nowMs) {
    const { width, height, grown } = this;
    dilate(this.segment(rgba), width, height, DILATE_RADIUS, this.tmp, grown);
    this.plate.update(rgba, grown);

    if (this._state === 'dusting' && !this.dust) {
      if (!grown.includes(1)) this._state = 'present'; // nobody to snap away
      else {
        this.dust = new DustEffect({ durationMs: this.durationMs });
        this.dust.start(rgba, grown, width, height, nowMs);
      }
    }

    if (this._state === 'dusting') {
      if (!this.dust.render(this.plate.read(), out, nowMs)) this._state = 'gone';
      else return;
    }
    if (this._state === 'returning' && nowMs - this.returnStartMs >= this.returnMs) this._state = 'present';

    out.set(rgba);
    if (this._state === 'present') return;

    const plate = this.plate.read();
    const a = this._state === 'returning' ? (nowMs - this.returnStartMs) / this.returnMs : 0;
    for (let i = 0; i < grown.length; i++) {
      if (!grown[i]) continue;
      const o = i * 4;
      out[o] = plate[o] + (rgba[o] - plate[o]) * a;
      out[o + 1] = plate[o + 1] + (rgba[o + 1] - plate[o + 1]) * a;
      out[o + 2] = plate[o + 2] + (rgba[o + 2] - plate[o + 2]) * a;
    }
  }
}
