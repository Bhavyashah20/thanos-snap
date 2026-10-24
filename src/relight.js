import { Inpainter } from './inpaint.js';

const BLOCK = 4; // the lighting correction is smooth, so it is solved on a 4x coarser grid
const MAX_CORRECTION = 90;

// Seamless "paste": the captured room was recorded under different exposure / white balance / shading
// than the live picture. Measure live - room just outside the hidden area, spread that difference smoothly
// into the hidden area (pull-push), and add it to the room there.
export class Relight {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.gw = Math.ceil(width / BLOCK);
    this.gh = Math.ceil(height / BLOCK);
    this.inpainter = new Inpainter(this.gw, this.gh);
    this.diff = new Float32Array(this.gw * this.gh * 4);
    this.known = new Uint8Array(this.gw * this.gh);
    this.sum = new Float32Array(this.gw * this.gh * 3);
    this.count = new Uint16Array(this.gw * this.gh);
  }

  // Writes room + correction into `out` for hidden pixels only (out is otherwise untouched).
  apply(live, room, seen, hidden, out) {
    const { width: w, height: h, gw, gh, sum, count, diff, known } = this;
    sum.fill(0);
    count.fill(0);
    for (let y = 0; y < h; y++) {
      const row = (y / BLOCK) | 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (hidden[i] || !seen[i]) continue;
        const b = row * gw + ((x / BLOCK) | 0), o = i * 4;
        sum[b * 3] += live[o] - room[o];
        sum[b * 3 + 1] += live[o + 1] - room[o + 1];
        sum[b * 3 + 2] += live[o + 2] - room[o + 2];
        count[b]++;
      }
    }
    for (let b = 0; b < known.length; b++) {
      const bx = b % gw, by = (b / gw) | 0;
      const area = Math.min(BLOCK, w - bx * BLOCK) * Math.min(BLOCK, h - by * BLOCK);
      known[b] = count[b] * 2 >= area ? 1 : 0;
      for (let k = 0; k < 3; k++) diff[b * 4 + k] = known[b] ? Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, sum[b * 3 + k] / count[b])) : 0;
    }
    const field = this.inpainter.solve(diff, known);

    for (let y = 0; y < h; y++) {
      const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / BLOCK - 0.5));
      const y0 = fy | 0, y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!hidden[i]) continue;
        const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / BLOCK - 0.5));
        const x0 = fx | 0, x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
        const o = i * 4;
        for (let k = 0; k < 3; k++) {
          const c =
            (field[(y0 * gw + x0) * 3 + k] * (1 - tx) + field[(y0 * gw + x1) * 3 + k] * tx) * (1 - ty) +
            (field[(y1 * gw + x0) * 3 + k] * (1 - tx) + field[(y1 * gw + x1) * 3 + k] * tx) * ty;
          out[o + k] = room[o + k] + c;
        }
        out[o + 3] = 255;
      }
    }
  }
}
