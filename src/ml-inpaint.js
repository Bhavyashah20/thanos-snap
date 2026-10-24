import * as ort from 'onnxruntime-web/wasm';
import { MIGAN_SIZE as N, buildInput, decodeOutput } from './migan.js';

// Browser glue around the MI-GAN generator (CPU/WASM, single thread: pages are not cross-origin isolated).
// inpaint(rgba, seen, w, h): `seen` marks real pixels (1) vs the hole (0); resolves to an RGBA w*h picture
// in which the hole has been filled with generated texture (real pixels are whatever the caller passed in).
// Real pixels this close to the hole are treated as unknown: they are often the person's own edge that the
// segmentation missed, and the model would happily grow them into structure (a red cape became a red blob).
const HOLE_MARGIN = 32; // pixels at 512x512

export function createMlInpainter({ baseUrl }) {
  let sessionP = null;
  const session = () =>
    (sessionP ||= (async () => {
      ort.env.wasm.wasmPaths = baseUrl + 'ort/';
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      return ort.InferenceSession.create(baseUrl + 'models/migan-512-generator.onnx', { executionProviders: ['wasm'] });
    })());

  const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

  return {
    warm: () => session().catch((err) => console.warn('[thanos-snap] ML model failed to load', err)),

    async inpaint(rgba, seen, w, h) {
      const s = await session();
      const t0 = performance.now();
      const full = canvas(w, h), small = canvas(N, N);
      const fctx = full.getContext('2d', { willReadFrequently: true });
      const sctx = small.getContext('2d', { willReadFrequently: true });

      fctx.putImageData(new ImageData(Uint8ClampedArray.from(rgba), w, h), 0, 0);
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(full, 0, 0, N, N);
      const rgb512 = sctx.getImageData(0, 0, N, N).data;

      // The mask is scaled without smoothing so it stays 0/1.
      const m = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) m.set(seen[i] ? [255, 255, 255, 255] : [0, 0, 0, 255], i * 4);
      fctx.putImageData(new ImageData(m, w, h), 0, 0);
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(full, 0, 0, N, N);
      const md = sctx.getImageData(0, 0, N, N).data;
      const known = new Uint8Array(N * N);
      for (let i = 0; i < N * N; i++) known[i] = md[i * 4] > 127 ? 1 : 0;

      const x = buildInput(rgb512, known, N, HOLE_MARGIN);
      const out = (await s.run({ gen_input: new ort.Tensor('float32', x, [1, 4, N, N]) })).gen_output.data;

      sctx.imageSmoothingEnabled = true;
      sctx.putImageData(new ImageData(decodeOutput(out, N), N, N), 0, 0);
      fctx.imageSmoothingQuality = 'high';
      fctx.drawImage(small, 0, 0, w, h);
      console.info(`[thanos-snap] ML inpainting took ${Math.round(performance.now() - t0)} ms`);
      return fctx.getImageData(0, 0, w, h).data;
    },
  };
}
