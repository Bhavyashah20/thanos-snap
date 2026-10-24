const enabled = document.getElementById('enabled');
const sensitivity = document.getElementById('sensitivity');

chrome.storage.local.get({ enabled: true, sensitivity: 0.5 }).then((s) => {
  enabled.checked = s.enabled;
  sensitivity.value = s.sensitivity;
});
enabled.addEventListener('change', () => chrome.storage.local.set({ enabled: enabled.checked }));
sensitivity.addEventListener('input', () => chrome.storage.local.set({ sensitivity: Number(sensitivity.value) }));

const msg = document.getElementById('msg');
document.getElementById('capture').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'capture' });
    window.close(); // the countdown shows on the page itself
  } catch {
    msg.textContent = 'Open a page that is using your camera first (reload it after installing).';
  }
});
