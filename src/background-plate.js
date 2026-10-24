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

  read() {
    this.out.set(this.plate); // float -> clamped bytes (rounds)
    return this.out;
  }

  coverage() {
    return this.seenCount / this.seen.length;
  }
}
