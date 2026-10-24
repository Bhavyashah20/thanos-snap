// Pull-push inpainting: average the known pixels into coarser and coarser levels ("pull"),
// then fill each unknown pixel from the next coarser level, blended by how much of it is known ("push").
// Gives a smooth fill from the surrounding colours; no ML involved.
export class Inpainter {
  constructor(width, height) {
    this.levels = [];
    let w = width, h = height;
    for (;;) {
      this.levels.push({ w, h, rgb: new Float32Array(w * h * 3), wt: new Float32Array(w * h) });
      if (w === 1 && h === 1) break;
      w = (w + 1) >> 1;
      h = (h + 1) >> 1;
    }
  }

  // plate: Float32 RGBA, seen: 0/1 per pixel, out: Uint8ClampedArray RGBA (every pixel written).
  fill(plate, seen, out) {
    const L = this.levels;
    const base = L[0];
    for (let i = 0; i < seen.length; i++) {
      base.wt[i] = seen[i];
      base.rgb[i * 3] = plate[i * 4];
      base.rgb[i * 3 + 1] = plate[i * 4 + 1];
      base.rgb[i * 3 + 2] = plate[i * 4 + 2];
    }
    for (let l = 1; l < L.length; l++) {
      const c = L[l - 1], p = L[l];
      p.rgb.fill(0);
      p.wt.fill(0);
      for (let y = 0; y < c.h; y++)
        for (let x = 0; x < c.w; x++) {
          const ci = y * c.w + x, pi = (y >> 1) * p.w + (x >> 1), w = c.wt[ci];
          if (!w) continue;
          p.wt[pi] += w;
          p.rgb[pi * 3] += c.rgb[ci * 3] * w;
          p.rgb[pi * 3 + 1] += c.rgb[ci * 3 + 1] * w;
          p.rgb[pi * 3 + 2] += c.rgb[ci * 3 + 2] * w;
        }
      for (let i = 0; i < p.wt.length; i++) {
        const sum = p.wt[i];
        if (sum) { p.rgb[i * 3] /= sum; p.rgb[i * 3 + 1] /= sum; p.rgb[i * 3 + 2] /= sum; }
        p.wt[i] = Math.min(1, sum / 4);
      }
    }
    for (let l = L.length - 2; l >= 0; l--) {
      const c = L[l], p = L[l + 1];
      for (let y = 0; y < c.h; y++) {
        const fy = Math.min(p.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const y0 = Math.floor(fy), y1 = Math.min(p.h - 1, y0 + 1), ty = fy - y0;
        for (let x = 0; x < c.w; x++) {
          const i = y * c.w + x, w = c.wt[i];
          if (w >= 1) continue;
          const fx = Math.min(p.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
          const x0 = Math.floor(fx), x1 = Math.min(p.w - 1, x0 + 1), tx = fx - x0;
          for (let k = 0; k < 3; k++) {
            const up =
              (p.rgb[(y0 * p.w + x0) * 3 + k] * (1 - tx) + p.rgb[(y0 * p.w + x1) * 3 + k] * tx) * (1 - ty) +
              (p.rgb[(y1 * p.w + x0) * 3 + k] * (1 - tx) + p.rgb[(y1 * p.w + x1) * 3 + k] * tx) * ty;
            c.rgb[i * 3 + k] = w * c.rgb[i * 3 + k] + (1 - w) * up;
          }
        }
      }
    }
    for (let i = 0; i < seen.length; i++) {
      out[i * 4] = base.rgb[i * 3];
      out[i * 4 + 1] = base.rgb[i * 3 + 1];
      out[i * 4 + 2] = base.rgb[i * 3 + 2];
      out[i * 4 + 3] = 255;
    }
  }
}
