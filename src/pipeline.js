import { BackgroundPlate } from './background-plate.js';
import { DustEffect } from './dust.js';
import { refineMask } from './refine.js';
import { Relight } from './relight.js';
import { featherMask } from './feather.js';


// Grow a 0/1 mask by `r` pixels (separable, O(n)); hides the soft edge of an imperfect segmentation.
function dilate(mask, width, height, r, tmp, out) {
  const sweep = (src, dst, count, lines, stride, lineStride) => {
    for (let l = 0; l < lines; l++) {
      const base = l * lineStride;
      let since = r + 1;
      for (let i = 0; i < count; i++) {
        since = src[base + i * stride] ? 0 : since + 1;
        dst[base + i * stride] = since <= r ? 1 : 0;
      }
      since = r + 1;
      for (let i = count - 1; i >= 0; i--) {
        since = src[base + i * stride] ? 0 : since + 1;
        if (since <= r) dst[base + i * stride] = 1;
      }
    }
  };
  sweep(mask, tmp, width, height, 1, width);
  sweep(tmp, out, height, width, width, 1);
}

const HOLD_FRAMES = 8; // keep hiding a region for ~0.27s after the mask last covered it

export class Pipeline {
  // mlInpaint(rgba, seen, w, h) -> Promise<RGBA>: optional; fills what the camera never saw behind the person.
  constructor({ segment, width, height, durationMs = 1700, returnMs = 600, minBackgroundFrames = 20, mlInpaint = null, mlEnabled = () => true }) {
    this.mlInpaint = mlInpaint;
    this.mlEnabled = mlEnabled;
    this.minBackgroundFrames = minBackgroundFrames;
    this.segment = segment;
    this.durationMs = durationMs;
    this.returnMs = returnMs;
    this.resize(width, height);
  }

  get state() {
    return this._state;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.plate = new BackgroundPlate(width, height, { minBackgroundFrames: this.minBackgroundFrames });
    this.dust = null;
    this.tmp = new Uint8Array(width * height);
    this.grown = new Uint8Array(width * height);
    this.hold = new Uint8Array(width * height);
    this.hidden = new Uint8Array(width * height);
    this.refined = new Uint8Array(width * height);
    this.relight = new Relight(width, height);
    this.alpha = new Uint8Array(width * height);
    this.region = new Uint8Array(width * height);
    this.ftmp = new Float32Array(width * height);
    this.comp = new Uint8ClampedArray(width * height * 4);
    this.noMask = null;
    this.maskArea = 0;
    this.stage = null;
    this.roomSource = 'learned'; // 'captured' once "Capture empty room" has completed
    this.mlRequested = false;
    this.mlResult = null;
    this.mlStartMs = null;
    this.baseArea = 0;
    this.baseFrame = this.baseMask = null;
    this._state = 'present';
  }

  // "Capture empty room": frames go into a staging copy (mask ignored: the caller vouches nobody is
  // in view); commitCapture() swaps it in, abortCapture() leaves the live room untouched.
  beginCapture() {
    this.stage = new BackgroundPlate(this.width, this.height, { minBackgroundFrames: 1 });
  }

  // While the person is in view (countdown), remember the frame where they cover the most picture.
  noteBaseline(rgba) {
    if (this.maskArea <= this.baseArea) return;
    this.baseArea = this.maskArea;
    this.baseFrame = Uint8ClampedArray.from(rgba);
    this.baseMask = Uint8Array.from(this.grown);
  }

  resetBaseline() {
    this.baseArea = 0;
    this.baseFrame = this.baseMask = null;
  }

  captureFrame(rgba) {
    if (this.stage) this.stage.update(rgba, this.noMask || (this.noMask = new Uint8Array(this.width * this.height)));
  }

  // Swap the staged room in. Returns false (and keeps the old room) if the captured room still looks
  // like the person at the spot where they were seen, i.e. they never really left.
  commitCapture() {
    const stage = this.stage;
    this.stage = null;
    if (!stage) return false;
    if (this.baseFrame && this.baseArea >= 0.02) {
      const { baseFrame: f, baseMask: m } = this;
      const room = stage.plate;
      let region = 0, changed = 0;
      for (let i = 0; i < m.length; i++) {
        if (!m[i]) continue;
        region++;
        const o = i * 4;
        const d = Math.max(Math.abs(room[o] - f[o]), Math.abs(room[o + 1] - f[o + 1]), Math.abs(room[o + 2] - f[o + 2]));
        if (d > 18) changed++;
      }
      if (changed / region < 0.4) return false;
    }
    this.plate = stage;
    this.mlStartMs = null;
    this.roomSource = 'captured';
    return true;
  }

  abortCapture() {
    this.stage = null;
  }

  // Snap without a captured room: ask the model to invent what is behind the person, in the background
  // (it arrives during the dissolve; until then the smooth fill is used).
  requestMlFill() {
    const { mlInpaint, plate } = this;
    if (!mlInpaint || !this.mlEnabled() || this.mlRequested || this.roomSource === 'captured' || plate.coverage() >= 0.999) return;
    this.mlRequested = true;
    Promise.resolve(mlInpaint(Uint8ClampedArray.from(plate.read()), Uint8Array.from(plate.seen), this.width, this.height))
      .then((rgba) => { if (rgba && this.plate === plate) { this.mlResult = rgba; this.mlStartMs = -1; } })
      .catch((err) => console.warn('[thanos-snap] ML inpainting failed; keeping the smooth fill', err));
  }

  trigger(nowMs) {
    if (this._state === 'present') {
      this._state = 'dusting';
      this.dust = null; // started on the next frame, from that frame's pixels
      this.requestMlFill();
    } else if (this._state === 'gone') {
      this._state = 'returning';
      this.returnStartMs = nowMs;
    }
  }

  processFrame(rgba, out, nowMs) {
    const { width, height, grown } = this;
    const mask = this.segment(rgba);
    if (!mask) return out.set(rgba); // segmenter not ready yet: show the camera, learn nothing
    // The mask is upsampled from a small image, so its edges are blocky: grow it with the frame size.
    dilate(mask, width, height, Math.max(3, Math.round(width / 80)), this.tmp, grown);
    if (this.roomSource === 'captured' && !this.stage) {
      // With a real picture of the empty room, whatever differs from it and touches the person is the person.
      refineMask(rgba, this.plate.read(), this.plate.seen, grown, width, height, this.refined);
      dilate(this.refined, width, height, 3, this.tmp, grown);
    }
    const { hold, hidden } = this;
    let covered = 0;
    for (let i = 0; i < grown.length; i++) {
      covered += grown[i];
      hold[i] = grown[i] ? HOLD_FRAMES : hold[i] > 0 ? hold[i] - 1 : 0;
      hidden[i] = hold[i] > 0 ? 1 : 0;
    }
    this.maskArea = covered / grown.length;
    if (this.mlStartMs === -1) { this.mlStartMs = nowMs; this.plate.setMlFill(this.mlResult, 0); }
    else if (this.mlStartMs !== null && this.plate.mlWeight < 1) this.plate.setMlFill(this.mlResult, Math.min(1, (nowMs - this.mlStartMs) / 400));
    // A captured room stays as captured (Relight handles lighting changes); a learned one keeps learning.
    if (this.roomSource !== 'captured') this.plate.update(rgba, hidden);

    if (this._state === 'dusting' && !this.dust) {
      if (!grown.includes(1)) this._state = 'present'; // nobody to snap away
      else {
        this.dust = new DustEffect({ durationMs: this.durationMs });
        this.dust.start(rgba, grown, width, height, nowMs);
      }
    }

    if (this._state === 'returning' && nowMs - this.returnStartMs >= this.returnMs) this._state = 'present';
    if (this._state === 'present') return out.set(rgba);

    // The live picture with the person's area replaced by the room, re-lit to match the live exposure.
    // Soft edge: the pasted room fades in over a few pixels outside the hidden area instead of a hard cut-out.
    const { comp, alpha, region } = this;
    featherMask(hidden, width, height, Math.max(2, Math.round(width / 160)), this.ftmp, alpha);
    for (let i = 0; i < alpha.length; i++) region[i] = alpha[i] ? 1 : 0;
    comp.set(rgba);
    this.relight.apply(rgba, this.plate.read(), this.plate.seen, region, comp);
    for (let i = 0; i < alpha.length; i++) {
      const a = alpha[i];
      if (a === 0 || a === 255) continue;
      const o = i * 4, k = a / 255;
      comp[o] = rgba[o] + (comp[o] - rgba[o]) * k;
      comp[o + 1] = rgba[o + 1] + (comp[o + 1] - rgba[o + 1]) * k;
      comp[o + 2] = rgba[o + 2] + (comp[o + 2] - rgba[o + 2]) * k;
    }

    if (this._state === 'dusting') {
      if (this.dust.render(comp, out, nowMs)) return;
      this._state = 'gone';
    }

    out.set(rgba);
    const a = this._state === 'returning' ? (nowMs - this.returnStartMs) / this.returnMs : 0;
    for (let i = 0; i < hidden.length; i++) {
      if (!hidden[i]) continue;
      const o = i * 4;
      out[o] = comp[o] + (rgba[o] - comp[o]) * a;
      out[o + 1] = comp[o + 1] + (rgba[o + 1] - comp[o + 1]) * a;
      out[o + 2] = comp[o + 2] + (rgba[o + 2] - comp[o + 2]) * a;
    }
  }
}
