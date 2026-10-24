const enabled = document.getElementById('enabled');
const sensitivity = document.getElementById('sensitivity');

chrome.storage.local.get({ enabled: true, sensitivity: 0.5 }).then((s) => {
  enabled.checked = s.enabled;
  sensitivity.value = s.sensitivity;
});
enabled.addEventListener('change', () => chrome.storage.local.set({ enabled: enabled.checked }));
sensitivity.addEventListener('input', () => chrome.storage.local.set({ sensitivity: Number(sensitivity.value) }));
