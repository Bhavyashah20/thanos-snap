import { wrapGetUserMedia } from './gum-wrapper.js';
import { createRunner } from './runner.js';
import { startAudioTrigger } from './audio-trigger.js';

const settings = { enabled: true, sensitivity: 0.5, assetBase: null };
const detectors = new Set();
const runners = new Set();
const report = (event) => window.postMessage({ source: 'snap-ext-page', type: 'capture', ...event }, '*');
let markReady;
const ready = new Promise((r) => (markReady = r));

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'snap-ext') return;
  if (e.data.command === 'capture') {
    if (!runners.size) report({ phase: 'failed', reason: 'no-camera' });
    runners.forEach((r) => r.capture(report));
    return;
  }
  Object.assign(settings, e.data.settings);
  if (settings.assetBase) markReady();
  detectors.forEach((d) => d.setSensitivity(settings.sensitivity));
});
window.postMessage({ source: 'snap-ext-page', type: 'hello' }, '*');

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  wrapGetUserMedia(navigator.mediaDevices, {
    getSettings: () => settings,
    createRunner: async (real) => {
      await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('no settings from bridge')), 3000))]);
      const runner = await createRunner(real, { assetBase: settings.assetBase });
      runners.add(runner);
      const stop = runner.stop;
      runner.stop = () => { runners.delete(runner); stop(); };
      return runner;
    },
    startAudioTrigger: (gum, onSnap) =>
      startAudioTrigger(gum, onSnap, settings, (d) => { detectors.add(d); return () => detectors.delete(d); }),
    makeStream: (tracks) => new MediaStream(tracks),
  });
}
