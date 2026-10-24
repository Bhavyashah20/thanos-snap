// Runs inside a hidden extension-owned iframe, so the hosting page's security rules (Trusted Types, CSP)
// don't apply. The page talks to us over a MessagePort handed over by the extension's content script.
import { SelfieSegmentation } from '@mediapipe/selfie_segmentation';
import * as ort from 'onnxruntime-web/wasm';
import { MIGAN_SIZE as N, buildInput, decodeOutput } from '../migan.js';

const here = (p) => new URL(p, location.href).href;
const HOLE_MARGIN = 32; // pixels at 512x512: real pixels this close to the hole are treated as unknown

let seg = null, input = null, inputCtx = null, maskCtx = null, latest = null, sw = 0, sh = 0;
let mlSession = null;

async function segInit(m) {
  if (seg) seg.close();
  sw = m.sw; sh = m.sh;
  input = Object.assign(document.createElement('canvas'), { width: sw, height: sh });
  inputCtx = input.getContext('2d');
  const maskCanvas = Object.assign(document.createElement('canvas'), { width: sw, height: sh });
  maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  latest = null;
  seg = new SelfieSegmentation({ locateFile: (f) => here('../mediapipe/' + f) });
  seg.setOptions({ modelSelection: 1 }); // landscape model: the general model left a sliver of head visible in testing
  seg.onResults((r) => { latest = r.segmentationMask; });
  await seg.initialize();
  return {};
}

async function segFrame(m) {
  inputCtx.drawImage(m.bitmap, 0, 0, sw, sh);
  m.bitmap.close();
  await seg.send({ image: input });
  if (!latest) return { mask: new ArrayBuffer(0) };
  maskCtx.clearRect(0, 0, sw, sh);
  maskCtx.drawImage(latest, 0, 0, sw, sh);
  const rgba = maskCtx.getImageData(0, 0, sw, sh).data;
  const gray = new Uint8Array(sw * sh);
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4];
  return { mask: gray.buffer, transfer: [gray.buffer] };
}

async function mlRun(m) {
  if (!mlSession) {
    ort.env.wasm.wasmPaths = here('../ort/');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    mlSession = await ort.InferenceSession.create(here('../models/migan-512-generator.onnx'), { executionProviders: ['wasm'] });
  }
  const x = buildInput(new Uint8ClampedArray(m.rgb), new Uint8Array(m.known), N, HOLE_MARGIN);
  const out = (await mlSession.run({ gen_input: new ort.Tensor('float32', x, [1, 4, N, N]) })).gen_output.data;
  const rgba = decodeOutput(out, N);
  return { rgba: rgba.buffer, transfer: [rgba.buffer] };
}

const handlers = {
  'seg-init': segInit,
  'seg-frame': segFrame,
  'seg-close': async () => { if (seg) seg.close(); seg = null; return {}; },
  'ml-run': mlRun,
};

function serve(port) {
  port.onmessage = async (e) => {
    const m = e.data;
    try {
      const { transfer = [], ...reply } = await handlers[m.type](m);
      port.postMessage({ id: m.id, ...reply }, transfer);
    } catch (err) {
      port.postMessage({ id: m.id, error: String((err && err.message) || err) });
    }
  };
  port.postMessage({ type: 'ready' });
}

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'port' && e.ports[0]) serve(e.ports[0]);
});
