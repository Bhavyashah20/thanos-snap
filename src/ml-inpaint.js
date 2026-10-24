import { MIGAN_SIZE as N } from './migan.js';

// Page-side client for the MI-GAN model that runs in the extension's host frame.
// inpaint(rgba, seen, w, h): `seen` marks real pixels (1) vs the hole (0); resolves to an RGBA w*h picture
// in which the hole has been filled with generated texture (real pixels are whatever the caller passed in).
export function createMlInpainter({ getHost }) {
  const canvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

  return {
    warm: () => getHost().then((rpc) => rpc.ready).catch(() => {}),

    async inpaint(rgba, seen, w, h) {
      const rpc = await getHost();
      await rpc.ready;
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

      const r = await rpc.call('ml-run', { rgb: rgb512.buffer, known: known.buffer }, [rgb512.buffer, known.buffer], 60000);

      sctx.imageSmoothingEnabled = true;
      sctx.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), N, N), 0, 0);
      fctx.imageSmoothingQuality = 'high';
      fctx.drawImage(small, 0, 0, w, h);
      console.info(`[thanos-snap] ML inpainting took ${Math.round(performance.now() - t0)} ms`);
      return fctx.getImageData(0, 0, w, h).data;
    },
  };
}
