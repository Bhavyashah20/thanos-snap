// MediaPipe's mask is a grayscale image (confidence in the red channel). Turn a small one into a
// full-size 0/1 person mask.
export function thresholdUpsample(rgba, sw, sh, out, w, h, threshold = 127) {
  for (let y = 0; y < h; y++) {
    const row = Math.min(sh - 1, Math.floor((y * sh) / h)) * sw;
    for (let x = 0; x < w; x++) {
      const col = Math.min(sw - 1, Math.floor((x * sw) / w));
      out[y * w + x] = rgba[(row + col) * 4] > threshold ? 1 : 0;
    }
  }
}
