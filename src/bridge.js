// Isolated-world relay: the page (MAIN world) can't read chrome.storage or runtime URLs.
const DEFAULTS = { enabled: true, sensitivity: 0.5 };
const post = (settings) => window.postMessage({ source: 'snap-ext', settings }, '*');
const assetBase = chrome.runtime.getURL('mediapipe/');

async function sendAll() {
  post({ ...(await chrome.storage.local.get(DEFAULTS)), assetBase });
}
sendAll();
chrome.storage.onChanged.addListener(sendAll);

// "Capture empty room": popup -> here -> page; progress comes back and is drawn as an overlay.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'capture') window.postMessage({ source: 'snap-ext', command: 'capture' }, '*');
});

const REASONS = {
  'person-in-frame': "Couldn't see the whole room. Step fully out of the camera's view and try again.",
  'no-camera': 'No camera is running on this page. Start your video first.',
  'not-ready': 'Still loading. Try again in a few seconds.',
  'not-present': 'Snap yourself back in first, then capture.',
};
let host, box, bar, text, hideTimer;

function overlay() {
  if (host) return;
  host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    .box{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;min-width:260px;max-width:420px;
      padding:12px 18px;border-radius:12px;background:rgba(20,17,15,.94);color:#eee;font:14px/1.4 system-ui,sans-serif;
      box-shadow:0 8px 30px rgba(0,0,0,.4);text-align:center;display:none}
    .big{font-size:34px;font-weight:600;line-height:1.1}
    .track{height:6px;border-radius:3px;background:#3a332e;margin-top:8px;overflow:hidden}
    .bar{height:100%;width:0;background:#d9a441;transition:width .15s}
  </style><div class="box"><div class="text"></div><div class="track"><div class="bar"></div></div></div>`;
  box = root.querySelector('.box');
  bar = root.querySelector('.bar');
  text = root.querySelector('.text');
  document.documentElement.appendChild(host);
}

function show(html, progress, hideAfterMs) {
  overlay();
  clearTimeout(hideTimer);
  box.style.display = 'block';
  text.innerHTML = html;
  bar.parentElement.style.display = progress === null ? 'none' : 'block';
  if (progress !== null) bar.style.width = Math.round(progress * 100) + '%';
  if (hideAfterMs) hideTimer = setTimeout(() => (box.style.display = 'none'), hideAfterMs);
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.source !== 'snap-ext-page') return;
  if (d.type === 'hello') return sendAll();
  if (d.type !== 'capture') return;
  if (d.phase === 'countdown') show(`Step out of the camera view<div class="big">${d.countdown}</div>`, null);
  else if (d.phase === 'capturing') show(`Capturing the empty room… ${Math.round(d.progress * 100)}%<br>Stay out of view`, d.progress);
  else if (d.phase === 'done') show('Room captured. You can step back in.', 1, 3000);
  else show(REASONS[d.reason] || 'Capture failed.', null, 6000);
});
