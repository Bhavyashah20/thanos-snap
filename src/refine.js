// Background-subtraction refinement of the model's person mask. Once there is a real capture of the
// empty room, anything that differs from it AND is connected to the model's mask is the person too
// (an arm the model missed, hair, something they hold). Pure pixel maths, no ML.
const THRESHOLD = 32; // max per-channel difference (0..255) that counts as "not the room"
const MAX_AREA = 0.85; // if more than this fraction is flagged, the camera moved: trust only the model

let stack = new Int32Array(0);

// Exposure / white-balance drift: per-channel median of frame/room over pixels clearly outside the person.
function channelGains(frame, room, seen, mask, w, h) {
  const gains = [1, 1, 1];
  for (let c = 0; c < 3; c++) {
    const ratios = [];
    for (let y = 0; y < h; y += 5)
      for (let x = 0; x < w; x += 5) {
        const i = y * w + x;
        if (mask[i] || !seen[i] || room[i * 4 + c] < 16) continue;
        ratios.push(frame[i * 4 + c] / room[i * 4 + c]);
      }
    if (ratios.length >= 50) {
      ratios.sort((a, b) => a - b);
      gains[c] = ratios[ratios.length >> 1];
    }
  }
  return gains;
}

// out: Uint8Array(w*h), 1 = person. `mask` is the model's mask; `seen` marks room pixels that are real.
export function refineMask(frame, room, seen, mask, w, h, out) {
  const n = w * h;
  out.set(mask);
  const [gr, gg, gb] = channelGains(frame, room, seen, mask, w, h);
  if (stack.length < n) stack = new Int32Array(n);

  let top = 0;
  for (let i = 0; i < n; i++) if (mask[i]) stack[top++] = i;
  let area = top;

  const differs = (i) => {
    if (!seen[i]) return false;
    const o = i * 4;
    const d = Math.max(Math.abs(frame[o] - room[o] * gr), Math.abs(frame[o + 1] - room[o + 1] * gg), Math.abs(frame[o + 2] - room[o + 2] * gb));
    return d > THRESHOLD;
  };

  while (top > 0) {
    const i = stack[--top];
    const x = i % w;
    if (x > 0 && !out[i - 1] && differs(i - 1)) { out[i - 1] = 1; stack[top++] = i - 1; area++; }
    if (x < w - 1 && !out[i + 1] && differs(i + 1)) { out[i + 1] = 1; stack[top++] = i + 1; area++; }
    if (i >= w && !out[i - w] && differs(i - w)) { out[i - w] = 1; stack[top++] = i - w; area++; }
    if (i < n - w && !out[i + w] && differs(i + w)) { out[i + w] = 1; stack[top++] = i + w; area++; }
  }
  if (area > MAX_AREA * n) out.set(mask);
}
