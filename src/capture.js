// "Capture empty room": a countdown so you can step out of frame, then ~goodMs of frames in which
// the segmenter sees (almost) nobody are averaged into a staging copy of the room. The segmenter
// only decides "has the person left?"; what is kept comes from the camera, so a false positive on
// a chair or a lamp is captured as the room it is.
const MIN_AREA = 0.02; // below this fraction of the picture, nobody is there

export class CaptureController {
  constructor({ countdownSec = 3, timeoutMs = 15000, goodMs = 1500 } = {}) {
    this.countdownSec = countdownSec;
    this.timeoutMs = timeoutMs;
    this.goodMs = goodMs;
    this.active = false;
  }

  start(nowMs) {
    this.active = true;
    this.startMs = nowMs;
    this.baseline = 0; // largest person area seen during the countdown
    this.capturingSince = null;
    this.goodSince = null;
    return { phase: 'countdown', countdown: this.countdownSec };
  }

  cancel() {
    this.active = false;
  }

  // maskArea: fraction (0..1) of the frame the segmenter calls "person".
  // Returns the status to show, or null when idle. `accepting` says this frame may go into the room.
  update(nowMs, maskArea) {
    if (!this.active) return null;

    if (this.capturingSince === null) {
      this.baseline = Math.max(this.baseline, maskArea);
      const left = this.countdownSec * 1000 - (nowMs - this.startMs);
      if (left > 0) return { phase: 'countdown', countdown: Math.ceil(left / 1000) };
      this.capturingSince = nowMs;
      return { phase: 'capturing', progress: 0, accepting: false, begin: true };
    }

    const gone = maskArea <= Math.max(MIN_AREA, 0.5 * this.baseline);
    if (!gone) this.goodSince = null;
    else if (this.goodSince === null) this.goodSince = nowMs;
    const progress = this.goodSince === null ? 0 : Math.min(1, (nowMs - this.goodSince) / this.goodMs);

    if (progress >= 1) {
      this.active = false;
      return { phase: 'done', progress: 1 };
    }
    if (nowMs - this.capturingSince >= this.timeoutMs) {
      this.active = false;
      return { phase: 'failed', reason: 'person-in-frame', progress };
    }
    return { phase: 'capturing', progress, accepting: gone };
  }
}
