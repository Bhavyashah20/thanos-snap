import { Pipeline } from './pipeline.js';
import { createSegmenter } from './segmenter.js';
import { CaptureController } from './capture.js';

// Turns a real camera stream into a processed one. Returns { videoTrack, trigger(), stop() }.
export async function createRunner(realStream, { assetBase }) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream(realStream.getVideoTracks());
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));

  let width = video.videoWidth, height = video.videoHeight;
  // The model takes several seconds to load: show the plain camera until it's ready.
  let segmenter = null;
  let pipeline = null;
  const loadSegmenter = async () => {
    const seg = await createSegmenter({ assetBase, width, height });
    if (!running) return seg.close();
    segmenter = seg;
    pipeline = new Pipeline({ width, height, segment: () => segmenter.mask() });
  };

  const src = document.createElement('canvas');
  const srcCtx = src.getContext('2d', { willReadFrequently: true });
  const dst = document.createElement('canvas');
  const dstCtx = dst.getContext('2d');
  let outImg;
  const alloc = () => {
    src.width = dst.width = width;
    src.height = dst.height = height;
    outImg = new ImageData(width, height);
  };
  alloc();

  let running = true;
  let busy = false;
  const capture = new CaptureController();
  let onCaptureEvent = () => {};
  loadSegmenter().catch((err) => console.warn('[thanos-snap] segmenter failed; passing camera through', err));

  async function tick() {
    if (!running) return;
    if (busy) return schedule();
    busy = true;
    try {
      if (video.videoWidth && (video.videoWidth !== width || video.videoHeight !== height)) {
        width = video.videoWidth; height = video.videoHeight;
        if (segmenter) segmenter.close();
        segmenter = pipeline = null;
        alloc();
        loadSegmenter().catch(() => {});
      }
      srcCtx.drawImage(video, 0, 0, width, height);
      if (!segmenter) {
        dstCtx.drawImage(src, 0, 0);
        busy = false;
        return schedule();
      }
      segmenter.input.getContext('2d').drawImage(video, 0, 0, segmenter.input.width, segmenter.input.height);
      await segmenter.send();
      const frame = srcCtx.getImageData(0, 0, width, height);
      const now = performance.now();
      pipeline.processFrame(frame.data, outImg.data, now);
      if (capture.active) {
        let ev = capture.update(now, pipeline.maskArea);
        if (ev.phase === 'countdown') pipeline.noteBaseline(frame.data);
        if (ev.begin || ev.restart) pipeline.beginCapture(); // restart: only the current clean window counts
        if (ev.accepting) pipeline.captureFrame(frame.data);
        if (ev.phase === 'done' && !pipeline.commitCapture()) ev = { phase: 'failed', reason: 'person-in-frame', progress: 1 };
        if (ev.phase === 'failed') pipeline.abortCapture();
        onCaptureEvent(ev);
      }
      dstCtx.putImageData(outImg, 0, 0);
    } catch (err) {
      console.warn('[thanos-snap] frame failed', err);
    }
    busy = false;
    schedule();
  }
  // requestVideoFrameCallback doesn't fire in hidden tabs; fall back to a timer there.
  function schedule() {
    if (!running) return;
    if (document.hidden || !video.requestVideoFrameCallback) setTimeout(tick, 33);
    else video.requestVideoFrameCallback(tick);
  }
  schedule();

  // Debug hook for test-page/index.html#debug (reads the live pipeline; no effect on the output).
  window.__thanosSnapDebug = {
    get pipeline() { return pipeline; },
    get width() { return width; },
    get height() { return height; },
  };

  const outStream = dst.captureStream(30);
  return {
    videoTrack: outStream.getVideoTracks()[0],
    trigger: () => pipeline && !capture.active && pipeline.trigger(performance.now()),
    // Start "Capture empty room"; onEvent gets {phase, countdown?, progress?, reason?} until done/failed.
    capture(onEvent) {
      onCaptureEvent = onEvent;
      if (!pipeline) return onEvent({ phase: 'failed', reason: 'not-ready' });
      if (pipeline.state !== 'present') return onEvent({ phase: 'failed', reason: 'not-present' });
      pipeline.resetBaseline();
      onEvent(capture.start(performance.now()));
    },
    stop() {
      running = false;
      if (segmenter) segmenter.close();
      video.srcObject = null;
    },
  };
}
