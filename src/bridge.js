// Isolated-world relay: the page (MAIN world) can't read chrome.storage or runtime URLs.
const DEFAULTS = { enabled: true, sensitivity: 0.5 };
const post = (settings) => window.postMessage({ source: 'snap-ext', settings }, '*');
const assetBase = chrome.runtime.getURL('mediapipe/');

async function sendAll() {
  post({ ...(await chrome.storage.local.get(DEFAULTS)), assetBase });
}
sendAll();
window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data.source === 'snap-ext-page' && e.data.type === 'hello') sendAll();
});
chrome.storage.onChanged.addListener(sendAll);
