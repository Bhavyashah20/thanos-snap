import { Pipeline } from './pipeline.js';
import { createSegmenter } from './segmenter.js';

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
      pipeline.processFrame(frame.data, outImg.data, performance.now());
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
    trigger: () => pipeline && pipeline.trigger(performance.now()),
    stop() {
      running = false;
      if (segmenter) segmenter.close();
      video.srcObject = null;
    },
  };
}
