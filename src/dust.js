// The "snap" effect: the person is cut into small cells that each break off at a time that
// sweeps from the left edge to the right (plus noise), then drift right and up as dark ash,
// shrinking and fading, leaving the background plate behind.
const TARGET_CELLS = 40000;
const ASH = [70, 52, 42];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DustEffect {
  constructor({ durationMs = 1700, seed = 1 } = {}) {
    this.durationMs = durationMs;
    this.seed = seed;
    this.cells = null;
  }

  start(rgba, mask, width, height, nowMs) {
    this.width = width;
    this.height = height;
    this.startMs = nowMs;
    this.frame = Uint8ClampedArray.from(rgba);
    this.mask = Uint8Array.from(mask);
    const rand = mulberry32(this.seed);

    let minX = width, maxX = -1, count = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (mask[y * width + x]) { count++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    const step = (this.step = Math.max(1, Math.round(Math.sqrt(count / TARGET_CELLS))));
    const bw = Math.max(1, maxX - minX);
    const dur = this.durationMs;

    const cells = [];
    for (let cy = 0; cy < height; cy += step)
      for (let cx = 0; cx < width; cx += step) {
        const mx = Math.min(width - 1, cx + (step >> 1)), my = Math.min(height - 1, cy + (step >> 1));
        if (!mask[my * width + mx]) continue;
        const xf = Math.min(1, Math.max(0, (cx - minX) / bw));
        const o = (my * width + mx) * 4;
        cells.push({
          cx, cy,
          d: 1 + 0.6 * dur * (0.75 * xf + 0.25 * rand()),
          life: dur * (0.25 + 0.15 * rand()),
          vx: ((0.15 + 0.35 * rand()) * width) / 1000,
          vy: -((rand() * 0.08) * height) / 1000,
          r: (this.frame[o] + ASH[0]) >> 1, g: (this.frame[o + 1] + ASH[1]) >> 1, b: (this.frame[o + 2] + ASH[2]) >> 1,
        });
      }
    this.cells = cells;
  }

  // Writes the composited frame into `out`; returns false once the effect has finished.
  render(plate, out, nowMs) {
    out.set(plate);
    if (!this.cells) return false;
    const t = nowMs - this.startMs;
    if (t >= this.durationMs) return false;
    const { width, height, step, frame, mask, cells } = this;

    for (const c of cells) {
      if (t >= c.d) continue;
      const x1 = Math.min(width, c.cx + step), y1 = Math.min(height, c.cy + step);
      for (let y = c.cy; y < y1; y++)
        for (let x = c.cx; x < x1; x++) {
          const i = y * width + x;
          if (!mask[i]) continue;
          const o = i * 4;
          out[o] = frame[o]; out[o + 1] = frame[o + 1]; out[o + 2] = frame[o + 2]; out[o + 3] = 255;
        }
    }

    for (const c of cells) {
      const age = t - c.d;
      if (age < 0 || age >= c.life) continue;
      const p = age / c.life;
      const alpha = (1 - p) * (1 - p * 0.3);
      const drift = age * (1 + p);
      const px = Math.round(c.cx + c.vx * drift), py = Math.round(c.cy + c.vy * drift);
      const size = Math.max(1, Math.round(step * (1 - 0.5 * p)));
      const x1 = Math.min(width, px + size), y1 = Math.min(height, py + size);
      for (let y = Math.max(0, py); y < y1; y++)
        for (let x = Math.max(0, px); x < x1; x++) {
          const o = (y * width + x) * 4;
          out[o] = out[o] * (1 - alpha) + c.r * alpha;
          out[o + 1] = out[o + 1] * (1 - alpha) + c.g * alpha;
          out[o + 2] = out[o + 2] * (1 - alpha) + c.b * alpha;
        }
    }
    return true;
  }
}
