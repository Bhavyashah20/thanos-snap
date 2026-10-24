// Soften a hard 0/1 mask into an alpha ramp (0..255) with a separable box blur of radius r.
// Pixels past the image border count as the nearest edge pixel, so a region touching the border stays opaque.
export function featherMask(mask, w, h, r, tmp, out) {
  if (r <= 0) {
    for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 255 : 0;
    return;
  }
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += mask[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum;
      sum += mask[row + Math.min(w - 1, x + r + 1)] - mask[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round((sum * 255) / (win * win));
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}
