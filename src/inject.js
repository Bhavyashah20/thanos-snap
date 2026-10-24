import { wrapGetUserMedia } from './gum-wrapper.js';
import { createRunner } from './runner.js';
import { startAudioTrigger } from './audio-trigger.js';

const settings = { enabled: true, sensitivity: 0.5, assetBase: null };
const detectors = new Set();
let markReady;
const ready = new Promise((r) => (markReady = r));

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'snap-ext') return;
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
      return createRunner(real, { assetBase: settings.assetBase });
    },
    startAudioTrigger: (gum, onSnap) =>
      startAudioTrigger(gum, onSnap, settings, (d) => { detectors.add(d); return () => detectors.delete(d); }),
    makeStream: (tracks) => new MediaStream(tracks),
  });
}
