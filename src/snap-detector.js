// Detects a finger snap from blocks of mono audio samples.
// A snap is a short, sharp, high-frequency transient: the high-band energy jumps well above
// the noise floor and falls back to under half its peak within ~60 ms. Sustained noise,
// speech and low tones never satisfy both.
const MAX_BURST_FRAMES = 6;

export class SnapDetector {
  constructor({ sampleRate, sensitivity = 0.5, cooldownMs = 1500 }) {
    this.sampleRate = sampleRate;
    this.sensitivity = sensitivity;
    this.cooldownMs = cooldownMs;
    this.floor = 0.001;
    this.prevHf = 0;
    this.prevSample = 0;
    this.pendingPeak = 0;
    this.pendingFrames = 0;
    this.lastFireMs = -Infinity;
  }

  setSensitivity(s) {
    this.sensitivity = Math.min(1, Math.max(0, s));
  }

  // Minimum high-band RMS for an onset: 0.14 (sensitivity 0) down to 0.01 (sensitivity 1).
  threshold() {
    return 0.14 - 0.13 * this.sensitivity;
  }

  // RMS of the first difference of the block (a cheap high-pass) carrying filter state across blocks.
  highBandRms(frame) {
    let sum = 0;
    let prev = this.prevSample;
    for (let i = 0; i < frame.length; i++) {
      const d = frame[i] - prev;
      sum += d * d;
      prev = frame[i];
    }
    this.prevSample = prev;
    return Math.sqrt(sum / frame.length);
  }

  feed(frame, nowMs) {
    const hf = this.highBandRms(frame);
    const thr = this.threshold();
    let fired = false;

    if (this.pendingFrames > 0) {
      if (hf < this.pendingPeak * 0.5) {
        if (nowMs - this.lastFireMs >= this.cooldownMs) {
          this.lastFireMs = nowMs;
          fired = true;
        }
        this.pendingFrames = 0;
      } else if (++this.pendingFrames > MAX_BURST_FRAMES) {
        this.pendingFrames = 0; // sustained, not a snap
      } else {
        this.pendingPeak = Math.max(this.pendingPeak, hf);
      }
    } else {
      const rising = hf > thr && hf > this.floor * 4 && this.prevHf < thr;
      if (rising) {
        this.pendingPeak = hf;
        this.pendingFrames = 1;
      } else {
        this.floor = 0.98 * this.floor + 0.02 * hf;
      }
    }

    this.prevHf = hf;
    return fired;
  }
}
