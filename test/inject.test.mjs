import test from 'node:test';
import assert from 'node:assert';
import { wrapGetUserMedia } from '../src/gum-wrapper.js';

function track(kind) {
  return { kind, stopped: false, stop() { this.stopped = true; } };
}
function fakeStream(...tracks) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  };
}
function setup({ enabled = true, runnerThrows = false } = {}) {
  const realVideo = track('video'), realAudio = track('audio');
  const real = fakeStream(realVideo, realAudio);
  const calls = { orig: [], results: [], runnerStopped: 0, triggerStopped: 0, triggered: 0, onSnap: null };
  const md = { getUserMedia: async (c) => { calls.orig.push(c); const r = c.video ? real : fakeStream(track('audio')); calls.results.push(r); return r; } };
  const outVideo = track('video');
  wrapGetUserMedia(md, {
    getSettings: () => ({ enabled, sensitivity: 0.5 }),
    createRunner: async () => {
      if (runnerThrows) throw new Error('segmenter failed to load');
      return { videoTrack: outVideo, trigger: () => calls.triggered++, stop: () => calls.runnerStopped++ };
    },
    startAudioTrigger: async (_gum, onSnap) => { calls.onSnap = onSnap; return { stop: () => calls.triggerStopped++ }; },
    makeStream: (tracks) => fakeStream(...tracks),
  });
  return { md, real, realVideo, realAudio, outVideo, calls };
}

test('audio-only request returns exactly what the browser returned', async () => {
  const { md, calls } = setup();
  const s = await md.getUserMedia({ audio: true });
  assert.strictEqual(s, calls.results[0]);
});

test('audio-only request does not create a runner', async () => {
  const { md, calls } = setup();
  const s = await md.getUserMedia({ audio: true, video: false });
  assert.strictEqual(s.getVideoTracks().length, 0);
  assert.strictEqual(calls.onSnap, null);
});

test('video request returns processed video plus the original audio track', async () => {
  const { md, outVideo, realAudio, realVideo } = setup();
  const s = await md.getUserMedia({ video: true, audio: true });
  assert.strictEqual(s.getVideoTracks()[0], outVideo);
  assert.notStrictEqual(s.getVideoTracks()[0], realVideo);
  assert.strictEqual(s.getAudioTracks()[0], realAudio);
});

test('stopping the returned video track stops the real camera, the runner and the trigger', async () => {
  const { md, outVideo, realVideo, calls } = setup();
  const s = await md.getUserMedia({ video: true });
  s.getVideoTracks()[0].stop();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(outVideo.stopped);
  assert.ok(realVideo.stopped, 'real camera track stopped (LED off)');
  assert.strictEqual(calls.runnerStopped, 1);
  assert.strictEqual(calls.triggerStopped, 1);
});

test('a snap from the audio trigger triggers the runner', async () => {
  const { md, calls } = setup();
  await md.getUserMedia({ video: true });
  calls.onSnap();
  assert.strictEqual(calls.triggered, 1);
});

test('runner failure falls back to the real stream and leaves the camera running', async () => {
  const { md, real, realVideo } = setup({ runnerThrows: true });
  const s = await md.getUserMedia({ video: true });
  assert.strictEqual(s, real);
  assert.strictEqual(realVideo.stopped, false);
});

test('disabled extension passes everything through', async () => {
  const { md, real } = setup({ enabled: false });
  assert.strictEqual(await md.getUserMedia({ video: true }), real);
});
