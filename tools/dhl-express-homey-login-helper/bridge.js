(() => {
  const SOURCE = 'dhl-express-homey-helper';
  const interesting = url => /mydhl\.express\.dhl/i.test(String(url || '')) &&
    /shipment|tracking|track|manage|history|list|dashboard|proview|waybill|awb/i.test(String(url || ''));

  const send = payload => {
    try { window.postMessage({ source: SOURCE, ...payload }, '*'); } catch (_) {}
  };

  const originalFetch = window.fetch;
  window.fetch = async function(input, init = {}) {
    const response = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url;
      if (interesting(url)) {
        const clone = response.clone();
        clone.text().then(responseText => send({
          type: 'capture',
          url,
          method: init?.method || 'GET',
          body: typeof init?.body === 'string' ? init.body.slice(0, 120000) : '',
          responseText: String(responseText || '').slice(0, 350000)
        })).catch(() => {});
      }
    } catch (_) {}
    return response;
  };

  const XHR = window.XMLHttpRequest;
  const open = XHR.prototype.open;
  const sendXhr = XHR.prototype.send;
  XHR.prototype.open = function(method, url) {
    this.__dhlHomey = { method, url };
    return open.apply(this, arguments);
  };
  XHR.prototype.send = function(body) {
    try {
      this.addEventListener('load', () => {
        const meta = this.__dhlHomey || {};
        if (!interesting(meta.url)) return;
        const responseText = typeof this.responseText === 'string' ? this.responseText : '';
        send({
          type: 'capture',
          url: meta.url,
          method: meta.method || 'GET',
          body: typeof body === 'string' ? body.slice(0, 120000) : '',
          responseText: responseText.slice(0, 350000)
        });
      });
    } catch (_) {}
    return sendXhr.apply(this, arguments);
  };
})();
