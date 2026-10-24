// "Capture empty room": countdown (so you can step out of frame), then the background memory is
// reset and rebuilt from real pixels until (almost) the whole frame has been seen without you in it.
export class CaptureController {
  constructor({ countdownSec = 3, timeoutMs = 15000, doneCoverage = 0.97 } = {}) {
    this.countdownSec = countdownSec;
    this.timeoutMs = timeoutMs;
    this.doneCoverage = doneCoverage;
    this.active = false;
  }

  start(nowMs) {
    this.active = true;
    this.startMs = nowMs;
    this.capturingSince = null;
    return { phase: 'countdown', countdown: this.countdownSec };
  }

  cancel() {
    this.active = false;
  }

  // Returns the status to show, or null when idle. `resetPlate: true` appears exactly once.
  update(nowMs, coverage) {
    if (!this.active) return null;

    if (this.capturingSince === null) {
      const left = this.countdownSec * 1000 - (nowMs - this.startMs);
      if (left > 0) return { phase: 'countdown', countdown: Math.ceil(left / 1000) };
      this.capturingSince = nowMs;
      return { phase: 'capturing', progress: 0, resetPlate: true };
    }

    if (coverage >= this.doneCoverage) {
      this.active = false;
      return { phase: 'done', progress: 1 };
    }
    if (nowMs - this.capturingSince >= this.timeoutMs) {
      this.active = false;
      return { phase: 'failed', reason: 'person-in-frame', progress: coverage };
    }
    return { phase: 'capturing', progress: coverage };
  }
}
