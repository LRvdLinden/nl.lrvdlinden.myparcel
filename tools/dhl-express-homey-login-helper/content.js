'use strict';
window.addEventListener('message', event => {
  const data = event?.data;
  if (!data || data.source !== 'dhl-express-homey-helper' || data.type !== 'capture') return;
  chrome.runtime.sendMessage({
    type: 'capture',
    url: String(data.url || ''),
    method: String(data.method || 'GET'),
    body: String(data.body || ''),
    responseText: String(data.responseText || '')
  }).catch(() => {});
});
