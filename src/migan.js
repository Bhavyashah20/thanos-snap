// MI-GAN (Picsart AI Research, MIT) 512x512 generator: input [1,4,512,512] =
//   ch0: known - 0.5   (known = 1 where the picture is real, 0 in the hole)
//   ch1-3: RGB in [-1,1], zeroed in the hole
// output [1,3,512,512] RGB in [-1,1].
export const MIGAN_SIZE = 512;

// Shrink the known region by `r` pixels (Chebyshev) so blended-with-hole pixels at its border aren't trusted.
function erode(known, n, r) {
  if (r <= 0) return known;
  const tmp = new Uint8Array(n * n), out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = 1;
      for (let d = -r; d <= r && v; d++) { const xx = x + d; if (xx >= 0 && xx < n && !known[y * n + xx]) v = 0; }
      tmp[y * n + x] = v;
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = 1;
      for (let d = -r; d <= r && v; d++) { const yy = y + d; if (yy >= 0 && yy < n && !tmp[yy * n + x]) v = 0; }
      out[y * n + x] = v;
    }
  return out;
}

// rgba: n*n*4 bytes, known: n*n 0/1 -> Float32Array(4*n*n)
export function buildInput(rgba, known, n, erodePx = 2) {
  const k = erode(known, n, erodePx);
  const x = new Float32Array(4 * n * n);
  for (let i = 0; i < n * n; i++) {
    const m = k[i];
    x[i] = m - 0.5;
    for (let c = 0; c < 3; c++) x[(c + 1) * n * n + i] = m ? rgba[i * 4 + c] / 127.5 - 1 : 0;
  }
  return x;
}

// Planar RGB float [-1,1] -> opaque RGBA bytes.
export function decodeOutput(out, n) {
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    rgba[i * 4] = (out[i] + 1) * 127.5;
    rgba[i * 4 + 1] = (out[n * n + i] + 1) * 127.5;
    rgba[i * 4 + 2] = (out[2 * n * n + i] + 1) * 127.5;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
