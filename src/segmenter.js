import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';
import { thresholdUpsample } from './mask.js';

const SEG_WIDTH = 384; // segmentation runs on a downscaled copy; the mask is upsampled

// Returns { size, input, send(): Promise<void>, mask(): Uint8Array, close() }.
// Draw the current frame onto `input` (a SEG_WIDTH-wide canvas), then await send().
export async function createSegmenter({ assetBase, width, height }) {
  const sw = Math.min(SEG_WIDTH, width);
  const sh = Math.round((height * sw) / width);
  const input = document.createElement('canvas');
  input.width = sw; input.height = sh;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sw; maskCanvas.height = sh;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const full = new Uint8Array(width * height);

  const seg = new SelfieSegmentation({ locateFile: (f) => assetBase + f });
  seg.setOptions({ modelSelection: 1 });
  let latest = null;
  seg.onResults((r) => { latest = r.segmentationMask; });
  await seg.initialize();

  return {
    input,
    async send() {
      await seg.send({ image: input });
      if (!latest) return;
      maskCtx.clearRect(0, 0, sw, sh);
      maskCtx.drawImage(latest, 0, 0, sw, sh);
      thresholdUpsample(maskCtx.getImageData(0, 0, sw, sh).data, sw, sh, full, width, height);
    },
    mask: () => full,
    close: () => seg.close(),
  };
}
