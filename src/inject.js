import { wrapGetUserMedia } from './gum-wrapper.js';
import { createRunner } from './runner.js';
import { startAudioTrigger } from './audio-trigger.js';
import { Rpc } from './remote.js';

console.info('[thanos-snap] 0.2.0 loaded (models run in the extension host frame)');
const settings = { enabled: true, sensitivity: 0.5, mlFill: false };
const detectors = new Set();
let hostPromise = null, hostResolve = null;
const hostPort = (port) => hostResolve && hostResolve(new Rpc(port));
// The models live in an extension-owned frame; ask the content script for a channel to it (once).
const getHost = () => {
  if (!hostPromise) {
    hostPromise = new Promise((resolve, reject) => {
      hostResolve = resolve;
      setTimeout(() => { hostPromise = null; reject(new Error('model host did not start')); }, 10000);
      window.postMessage({ source: 'snap-ext-page', type: 'need-host' }, '*');
    });
  }
  return hostPromise;
};
const runners = new Set();
const report = (event) => window.postMessage({ source: 'snap-ext-page', type: 'capture', ...event }, '*');
let markReady;
const ready = new Promise((r) => (markReady = r));

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== 'snap-ext') return;
  if (e.data.type === 'host-port') return e.ports[0] && hostPort(e.ports[0]);
  if (e.data.command === 'capture') {
    if (!runners.size) report({ phase: 'failed', reason: 'no-camera' });
    runners.forEach((r) => r.capture(report));
    return;
  }
  Object.assign(settings, e.data.settings);
  markReady();
  detectors.forEach((d) => d.setSensitivity(settings.sensitivity));
});
window.postMessage({ source: 'snap-ext-page', type: 'hello' }, '*');

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  wrapGetUserMedia(navigator.mediaDevices, {
    getSettings: () => settings,
    createRunner: async (real) => {
      await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('no settings from bridge')), 3000))]);
      const runner = await createRunner(real, { getHost, isMlEnabled: () => settings.mlFill });
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
