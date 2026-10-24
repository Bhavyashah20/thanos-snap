// MediaPipe's mask is a grayscale image (confidence in the red channel). Turn a small one into a
// full-size 0/1 person mask.
// `stride` is 4 for an RGBA image (confidence in the red channel) or 1 for a plain one-byte-per-pixel mask.
export function thresholdUpsample(rgba, sw, sh, out, w, h, threshold = 127, stride = 4) {
  // Bilinear sampling of the confidence before thresholding gives smooth contours; nearest-neighbour left stair-steps.
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / h - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / w - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const top = rgba[(y0 * sw + x0) * stride] * (1 - tx) + rgba[(y0 * sw + x1) * stride] * tx;
      const bot = rgba[(y1 * sw + x0) * stride] * (1 - tx) + rgba[(y1 * sw + x1) * stride] * tx;
      out[y * w + x] = top * (1 - ty) + bot * ty > threshold ? 1 : 0;
    }
  }
}
