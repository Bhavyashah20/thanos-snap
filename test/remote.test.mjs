import test from 'node:test';
import assert from 'node:assert';
import { Rpc, createRemoteSegmenter } from '../src/remote.js';

// A fake MessagePort: the "host" side is a function (message) -> reply|Promise<reply>|undefined.
function fakePort(host) {
  const port = {
    sent: [],
    onmessage: null,
    postMessage(msg) {
      port.sent.push(msg);
      Promise.resolve(host && host(msg)).then((reply) => {
        if (reply) setTimeout(() => port.onmessage && port.onmessage({ data: { id: msg.id, ...reply } }), 0);
      });
    },
    emit(data) { port.onmessage({ data }); },
    close() { port.closed = true; },
  };
  return port;
}

test('Rpc: matches replies to requests by id', async () => {
  const port = fakePort((m) => ({ echo: m.type }));
  const rpc = new Rpc(port);
  const [a, b] = await Promise.all([rpc.call('one'), rpc.call('two')]);
  assert.strictEqual(a.echo, 'one');
  assert.strictEqual(b.echo, 'two');
});

test('Rpc: an error reply rejects the call', async () => {
  const rpc = new Rpc(fakePort(() => ({ error: 'model missing' })));
  await assert.rejects(rpc.call('x'), /model missing/);
});

test('Rpc: a call with no reply times out', async () => {
  const rpc = new Rpc(fakePort(() => undefined), { timeoutMs: 20 });
  await assert.rejects(rpc.call('x'), /timeout/);
});

test('Rpc: ready resolves when the host announces it, and close rejects pending calls', async () => {
  const port = fakePort(() => undefined);
  const rpc = new Rpc(port);
  const pending = rpc.call('x');
  port.emit({ type: 'ready' });
  await rpc.ready;
  rpc.close();
  await assert.rejects(pending, /closed/);
  assert.strictEqual(port.closed, true);
});

function segDeps() {
  return { makeCanvas: (w, h) => ({ width: w, height: h }), makeBitmap: async (c) => ({ bitmapOf: c }) };
}

test('remote segmenter: init handshake, mask is null until the first result, then upscaled to full size', async () => {
  const W = 8, H = 4; // small frame -> seg size = min(384, W) x round(H*sw/W) = 8x4
  const log = [];
  const port = fakePort((m) => {
    log.push(m.type);
    if (m.type === 'seg-init') return { ok: true };
    if (m.type === 'seg-frame') { const g = new Uint8Array(8 * 4); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g[y * 8 + x] = 255; return { mask: g.buffer }; }
  });
  const rpc = new Rpc(port);
  const seg = await createRemoteSegmenter({ rpc, width: W, height: H, ...segDeps() });
  assert.strictEqual(seg.mask(), null);
  await seg.send();
  const m = seg.mask();
  assert.strictEqual(m.length, W * H);
  assert.strictEqual(m[0], 1);       // left half is person
  assert.strictEqual(m[W - 1], 0);   // right edge is background
  assert.deepStrictEqual(log, ['seg-init', 'seg-frame']);
});

test('remote segmenter: failures surface to the caller', async () => {
  const rpc = new Rpc(fakePort((m) => (m.type === 'seg-init' ? { error: 'cannot load model' } : undefined)));
  await assert.rejects(createRemoteSegmenter({ rpc, width: 8, height: 4, ...segDeps() }), /cannot load model/);
});
