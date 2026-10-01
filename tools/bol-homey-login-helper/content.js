(() => {
  'use strict';

  const MARKER = '__BOL_HOMEY_HELPER_031__';
  const TOKEN_KEY = /(access|refresh|oauth|auth|token|session|login|identity|id[_-]?token)/i;
  const SECRET_KEY = /(password|passwd|passphrase|credit|card|iban)/i;
  const MAX_VALUE = 50000;

  function storageSnapshot(storage) {
    const out = {};
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key || SECRET_KEY.test(key)) continue;
        const value = storage.getItem(key);
        if (!TOKEN_KEY.test(key) && !TOKEN_KEY.test(String(value || ''))) continue;
        out[key] = String(value || '').slice(0, MAX_VALUE);
      }
    } catch (_) {}
    return out;
  }

  function extractAmpereUrls() {
    const urls = new Set();
    const add = value => {
      if (!value) return;
      const text = String(value)
        .replace(/\\u002[fF]/g, '/')
        .replace(/\\u003[aA]/g, ':')
        .replace(/\\\//g, '/')
        .replace(/&amp;/g, '&');
      const regex = /https?:\/\/bol\.prd\.amperebezorgt\.nl\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+/gi;
      for (const match of text.matchAll(regex)) {
        try {
          const url = new URL(match[0].replace(/[)\]}>"',.;]+$/g, ''));
          if (url.hostname.toLowerCase() === 'bol.prd.amperebezorgt.nl') urls.add(url.toString());
        } catch (_) {}
      }
    };
    try { add(document.documentElement?.innerHTML || ''); } catch (_) {}
    try { for (const a of document.querySelectorAll('a[href]')) add(a.href); } catch (_) {}
    try { for (const e of performance.getEntriesByType('resource')) add(e.name); } catch (_) {}
    return [...urls];
  }

  function sendPageState() {
    const url = location.href;
    chrome.runtime.sendMessage({
      type: 'page_state',
      url,
      search: location.search || '',
      hash: location.hash || '',
      accountPage: /\/account\/bestellingen\//i.test(location.pathname),
      ampereUrls: extractAmpereUrls(),
      localStorage: storageSnapshot(window.localStorage),
      sessionStorage: storageSnapshot(window.sessionStorage)
    }).catch(() => {});
  }

  window.addEventListener('message', event => {
    if (event.source !== window || !event.data || event.data.marker !== MARKER) return;
    chrome.runtime.sendMessage({
      type: event.data.type,
      payload: event.data.payload || {},
      url: location.href
    }).catch(() => {});
  });

  sendPageState();
  window.addEventListener('pageshow', sendPageState);
  window.addEventListener('hashchange', sendPageState);
  window.addEventListener('popstate', sendPageState);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sendPageState();
  });
  for (const delay of [800, 1800, 3500, 6000, 9000]) setTimeout(sendPageState, delay);
})();
