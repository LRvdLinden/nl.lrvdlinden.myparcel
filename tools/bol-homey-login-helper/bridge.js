(() => {
  'use strict';

  const MARKER = '__BOL_HOMEY_HELPER_031__';
  const MAX_BODY = 250000;
  const interestingUrl = (url) => /(?:\/token(?:\?|$)|oauth|authorize|session|account|order|orders|bestelling|delivery|deliveries|shipment|tracking|amperebezorgt)/i.test(String(url || ''));

  function post(type, payload = {}) {
    try { window.postMessage({ marker: MARKER, type, payload }, '*'); } catch (_) {}
  }

  function safeBody(value) {
    if (value == null) return '';
    try {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text;
    } catch (_) { return ''; }
  }

  function captureResponse(url, method, status, text) {
    if (!interestingUrl(url)) return;
    post('network_response', {
      url: String(url || ''),
      method: String(method || 'GET').toUpperCase(),
      status: Number(status || 0),
      body: safeBody(text)
    });
  }

  const originalFetch = window.fetch;

  const probedOrderDetails = new Set();
  async function probeOrderDetails() {
    if (!/\/account\/bestellingen\//i.test(location.pathname)) return;
    const links = [];
    try {
      for (const anchor of document.querySelectorAll('a[href]')) {
        let url;
        try { url = new URL(anchor.href, location.href); } catch (_) { continue; }
        if (url.hostname.toLowerCase() !== 'www.bol.com') continue;
        if (!/\/account\/bestellingen\//i.test(url.pathname)) continue;
        if (/\/account\/bestellingen\/overzicht\/?$/i.test(url.pathname)) continue;
        if (probedOrderDetails.has(url.toString())) continue;
        probedOrderDetails.add(url.toString());
        links.push(url.toString());
        if (links.length >= 16) break;
      }
    } catch (_) {}
    for (const url of links) {
      try {
        const response = await originalFetch.call(window, url, { method: 'GET', credentials: 'include', redirect: 'follow' });
        const text = await response.clone().text();
        captureResponse(response.url || url, 'GET', response.status, text);
      } catch (_) {}
    }
  }
  if (typeof originalFetch === 'function') {
    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || (input && input.method) || 'GET';
      const response = await originalFetch.apply(this, arguments);
      try {
        if (interestingUrl(url)) {
          const clone = response.clone();
          clone.text().then(text => captureResponse(url, method, response.status, text)).catch(() => {});
        }
      } catch (_) {}
      return response;
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function(method, url) {
      this.__bolHomeyMethod = method;
      this.__bolHomeyUrl = url;
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function() {
      try {
        this.addEventListener('load', () => {
          if (!interestingUrl(this.__bolHomeyUrl)) return;
          const text = typeof this.responseText === 'string' ? this.responseText : '';
          captureResponse(this.__bolHomeyUrl, this.__bolHomeyMethod, this.status, text);
        }, { once: true });
      } catch (_) {}
      return send.apply(this, arguments);
    };
  }

  post('page_ready', { url: location.href });
  for (const delay of [1200, 3500, 6500]) setTimeout(() => probeOrderDetails().catch(() => {}), delay);
})();
