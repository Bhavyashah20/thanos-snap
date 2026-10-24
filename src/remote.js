import { thresholdUpsample } from './mask.js';

// The models run in a hidden extension-owned frame (the page's own security rules, e.g. Meet's Trusted
// Types, would block loading them in the page). This is the page's side of that conversation.

const SEG_WIDTH = 384; // segmentation runs on a downscaled copy; the mask is upsampled
const MASK_THRESHOLD = 80; // low on purpose: missing part of the person is worse than hiding a bit of wall

// Request/response over a MessagePort. Replies carry the request's id; {type:'ready'} announces the host.
export class Rpc {
  constructor(port, { timeoutMs = 15000 } = {}) {
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve) => (this.markReady = resolve));
    port.onmessage = (e) => {
      const m = e.data;
      if (m && m.type === 'ready') return this.markReady();
      const p = m && this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m);
    };
  }

  call(type, payload = {}, transfer = [], timeoutMs = this.timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`host timeout: ${type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.port.postMessage({ id, type, ...payload }, transfer);
    });
  }

  close() {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('host closed')); }
    this.pending.clear();
    if (this.port.close) this.port.close();
  }
}

const defaultDeps = {
  makeCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }),
  makeBitmap: (canvas) => createImageBitmap(canvas),
};

// Same shape as the old in-page segmenter: { input, send(), mask(), close() }.
// Draw the current frame onto `input`, await send(), then read mask() (null until the first result).
export async function createRemoteSegmenter({ rpc, width, height, makeCanvas = defaultDeps.makeCanvas, makeBitmap = defaultDeps.makeBitmap }) {
  const sw = Math.min(SEG_WIDTH, width);
  const sh = Math.round((height * sw) / width);
  await rpc.call('seg-init', { sw, sh }, [], 30000); // loads the model in the host: can take a few seconds
  const input = makeCanvas(sw, sh);
  const full = new Uint8Array(width * height);
  let have = false;
  return {
    input,
    async send() {
      const bitmap = await makeBitmap(input);
      const r = await rpc.call('seg-frame', { bitmap }, [bitmap]);
      thresholdUpsample(new Uint8Array(r.mask), sw, sh, full, width, height, MASK_THRESHOLD, 1);
      have = true;
    },
    mask: () => (have ? full : null),
    close: () => { rpc.call('seg-close').catch(() => {}); },
  };
}
