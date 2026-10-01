'use strict';

const KEY = 'dhlExpressHomeySessionV1';
const LOGIN_URL = 'https://dhlpass.dhl.com/nl-nl/login/?CountryCode=nl&LangCode=nl&client_id=mydhlplus&additional_params=isMobileDHL_EQtrue&redirect_uri=https://mydhl.express.dhl/index/en/login-redirect.html&response_type=code&rt=1&oidc-auth=true';

const empty = () => ({
  schema: 'nl.lrvdlinden.myparcel.dhl-express-session',
  version: 1,
  helperVersion: '0.1.0',
  createdAt: null,
  updatedAt: null,
  lastUrl: '',
  userAgent: '',
  cookies: [],
  requests: []
});

let state = empty();
let ready = (async () => {
  try {
    const stored = await chrome.storage.local.get(KEY);
    if (stored?.[KEY]) state = { ...empty(), ...stored[KEY] };
  } catch (_) {}
})();

async function save() {
  state.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [KEY]: state });
}

async function refreshCookies() {
  const result = [];
  for (const url of ['https://dhlpass.dhl.com/', 'https://mydhl.express.dhl/']) {
    try {
      const rows = await chrome.cookies.getAll({ url });
      for (const c of rows) {
        const key = [c.name, c.domain, c.path].join('|');
        if (result.some(x => [x.name, x.domain, x.path].join('|') === key)) continue;
        result.push({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: !!c.secure,
          httpOnly: !!c.httpOnly,
          sameSite: c.sameSite || 'unspecified',
          expirationDate: c.expirationDate || null,
          session: !!c.session
        });
      }
    } catch (_) {}
  }
  state.cookies = result;
}

function requestKey(row) {
  return [row.method || 'GET', row.url || ''].join('|');
}

function addRequest(row) {
  if (!row?.url || !/^https:\/\/mydhl\.express\.dhl\//i.test(row.url)) return;
  if (!/shipment|tracking|track|manage|history|list|dashboard|proview|waybill|awb/i.test(row.url)) return;

  const clean = {
    url: String(row.url).slice(0, 3000),
    method: String(row.method || 'GET').toUpperCase(),
    body: String(row.body || '').slice(0, 120000),
    responseText: String(row.responseText || '').slice(0, 350000),
    headers: row.headers && typeof row.headers === 'object' ? row.headers : {},
    referer: String(row.referer || state.lastUrl || 'https://mydhl.express.dhl/').slice(0, 3000),
    capturedAt: new Date().toISOString()
  };

  const key = requestKey(clean);
  const index = state.requests.findIndex(x => requestKey(x) === key);
  if (index >= 0) state.requests[index] = { ...state.requests[index], ...clean };
  else state.requests.push(clean);
  state.requests = state.requests.slice(-80);
}

function b64url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function makeBundle() {
  await refreshCookies();
  if (!state.createdAt) state.createdAt = new Date().toISOString();
  await save();
  return 'DHLEXPRESS1.' + b64url(JSON.stringify(state));
}

chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  ready.then(async () => {
    if (!/^https:\/\/mydhl\.express\.dhl\//i.test(details.url || '')) return;
    const headers = {};
    for (const h of details.requestHeaders || []) {
      const name = String(h?.name || '').toLowerCase();
      const value = String(h?.value || '');
      if (!value) continue;
      if (/^(accept|accept-language|content-type|x-[a-z0-9-]+)$/i.test(name)) headers[name] = value;
      if (name === 'referer') headers.referer = value;
    }
    addRequest({ url: details.url, method: details.method, headers, referer: headers.referer || '' });
    await save();
  });
}, { urls: ['https://mydhl.express.dhl/*'] }, ['requestHeaders', 'extraHeaders']);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  ready.then(async () => {
    const url = changeInfo.url || tab?.url || '';
    if (!url) return;
    state.lastUrl = url;
    if (/mydhl\.express\.dhl/i.test(url)) {
      await refreshCookies();
      if (!state.createdAt) state.createdAt = new Date().toISOString();
      await save();
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ready.then(async () => {
    if (message?.type === 'capture') {
      addRequest(message);
      await save();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'start') {
      state = empty();
      state.createdAt = new Date().toISOString();
      state.userAgent = navigator.userAgent || '';
      await save();
      await chrome.tabs.create({ url: LOGIN_URL });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'bundle') {
      const bundle = await makeBundle();
      sendResponse({
        ok: true,
        bundle,
        cookies: state.cookies.length,
        requests: state.requests.length
      });
      return;
    }
    if (message?.type === 'reset') {
      state = empty();
      await chrome.storage.local.remove(KEY);
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false });
  }).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
