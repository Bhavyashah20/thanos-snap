import { SnapDetector } from './snap-detector.js';

const BLOCK = 512;

// Listens to a separate mic stream (no echo-cancel/noise-suppress: they squash a snap's transient)
// and calls onSnap() on each detected snap. `gum` is the browser's original getUserMedia.
export async function startAudioTrigger(gum, onSnap, { sensitivity }, registerDetector) {
  const stream = await gum({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const ctx = new AudioContext();
  await ctx.resume();
  const detector = new SnapDetector({ sampleRate: ctx.sampleRate, sensitivity });
  const unregister = registerDetector(detector);
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(BLOCK, 1, 1);
  proc.onaudioprocess = (e) => {
    if (detector.feed(e.inputBuffer.getChannelData(0), performance.now())) onSnap();
  };
  const mute = ctx.createGain();
  mute.gain.value = 0; // ScriptProcessor must be connected to run; keep it silent
  source.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);

  return {
    stop() {
      unregister();
      proc.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
