// Running model of the empty room: updated only where the mask says "not person",
// so once the person is removed the plate fills the gap.
const BLEND = 0.15;

export class BackgroundPlate {
  constructor(width, height) {
    this.reset(width, height);
  }

  reset(width, height) {
    this.width = width;
    this.height = height;
    this.plate = new Float32Array(width * height * 4);
    this.out = new Uint8ClampedArray(width * height * 4);
    this.seen = new Uint8Array(width * height);
    this.seenCount = 0;
  }

  update(rgba, mask) {
    const { plate, seen } = this;
    for (let i = 0; i < seen.length; i++) {
      if (mask[i]) continue;
      const o = i * 4;
      if (!seen[i]) {
        plate[o] = rgba[o];
        plate[o + 1] = rgba[o + 1];
        plate[o + 2] = rgba[o + 2];
        plate[o + 3] = 255;
        seen[i] = 1;
        this.seenCount++;
      } else {
        plate[o] += (rgba[o] - plate[o]) * BLEND;
        plate[o + 1] += (rgba[o + 1] - plate[o + 1]) * BLEND;
        plate[o + 2] += (rgba[o + 2] - plate[o + 2]) * BLEND;
      }
    }
  }

  // The plate as bytes. Never-seen pixels (the person has covered them since the start)
  // are filled from the nearest seen pixel in their row, else from a neighbouring row.
  read() {
    const { out, width, height, seen } = this;
    out.set(this.plate); // float -> clamped bytes (rounds)
    if (this.seenCount === seen.length) return out;

    const copyPx = (to, from) => out.copyWithin(to * 4, from * 4, from * 4 + 4);
    const rowOk = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
      const base = y * width;
      let first = -1;
      for (let x = 0; x < width; x++) if (seen[base + x]) { first = x; break; }
      if (first < 0) continue;
      rowOk[y] = 1;
      for (let x = 0; x < first; x++) copyPx(base + x, base + first);
      for (let x = first + 1, last = first; x < width; x++) {
        if (seen[base + x]) last = x;
        else copyPx(base + x, base + last);
      }
    }
    const copyRow = (to, from) => out.copyWithin(to * width * 4, from * width * 4, (from + 1) * width * 4);
    for (let y = 1; y < height; y++) if (!rowOk[y] && rowOk[y - 1]) { copyRow(y, y - 1); rowOk[y] = 1; }
    for (let y = height - 2; y >= 0; y--) if (!rowOk[y] && rowOk[y + 1]) { copyRow(y, y + 1); rowOk[y] = 1; }
    return out;
  }

  coverage() {
    return this.seenCount / this.seen.length;
  }
}
