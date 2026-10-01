'use strict';

const LOGIN_URL = 'https://login.bol.com/wsp/login';
const ORDERS_URL = 'https://www.bol.com/nl/nl/account/bestellingen/overzicht/';
const RESULT_URL = chrome.runtime.getURL('result.html');
const STATE_KEY = 'bolHomeyCapture032';
const MAX_CAPTURE = 250000;

const EMPTY = () => ({
  schema: 'nl.lrvdlinden.myparcel.bol-session',
  version: 3,
  helperVersion: '0.3.1',
  createdAt: null,
  updatedAt: null,
  loginStartedAt: null,
  lastUrl: '',
  oauth: {},
  auth: {},
  tokenRequest: {},
  storage: { local: {}, session: {} },
  cookies: [],
  ampereUrls: [],
  accountVerifiedAt: null,
  ordersProbeStartedAt: null,
  ordersProbeComplete: false,
  evidence: [],
  readyGeneration: 0,
  shownGeneration: 0
});

let state = EMPTY();
let ready = restore();

async function restore() {
  try {
    const data = await chrome.storage.local.get(STATE_KEY);
    if (data && data[STATE_KEY]) state = { ...EMPTY(), ...data[STATE_KEY] };
  } catch (_) {}
}

async function save() {
  state.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

function cleanText(value, max = 200000) {
  return String(value == null ? '' : value).slice(0, max);
}

function parseMaybeJson(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

function absorbTokenObject(obj) {
  if (!obj || typeof obj !== 'object') return false;
  let changed = false;
  const mapping = {
    access_token: 'access_token',
    accessToken: 'access_token',
    refresh_token: 'refresh_token',
    refreshToken: 'refresh_token',
    token_type: 'token_type',
    tokenType: 'token_type',
    expires_in: 'expires_in',
    expiresIn: 'expires_in',
    scope: 'scope',
    id_token: 'id_token',
    idToken: 'id_token'
  };
  for (const [source, target] of Object.entries(mapping)) {
    if (obj[source] == null || obj[source] === '') continue;
    const value = typeof obj[source] === 'number' ? obj[source] : cleanText(obj[source], 120000);
    if (state.auth[target] !== value) {
      state.auth[target] = value;
      changed = true;
    }
  }
  if (changed) state.auth.captured_at = new Date().toISOString();
  return changed;
}

function scanTokenLikeValue(value, depth = 0) {
  if (depth > 3 || value == null) return false;
  let changed = false;
  if (typeof value === 'object') {
    changed = absorbTokenObject(value) || changed;
    for (const v of Object.values(value)) changed = scanTokenLikeValue(v, depth + 1) || changed;
    return changed;
  }
  const text = String(value);
  const obj = parseMaybeJson(text);
  if (obj) changed = scanTokenLikeValue(obj, depth + 1) || changed;
  return changed;
}

function parseParams(text) {
  const out = {};
  try {
    const p = new URLSearchParams(String(text || ''));
    for (const [k, v] of p.entries()) out[k] = v;
  } catch (_) {}
  return out;
}

function absorbUrl(raw) {
  let changed = false;
  try {
    const u = new URL(raw);
    state.lastUrl = u.toString();
    const all = [u.searchParams, new URLSearchParams(u.hash.replace(/^#/, ''))];
    for (const params of all) {
      for (const key of ['code', 'state', 'access_token', 'refresh_token', 'token_type', 'expires_in', 'scope', 'id_token']) {
        const value = params.get(key);
        if (!value) continue;
        if (key === 'code' || key === 'state') state.oauth[key] = cleanText(value, 120000);
        else state.auth[key] = key === 'expires_in' ? Number(value) || value : cleanText(value, 120000);
        if (key !== 'code' && key !== 'state') state.auth.captured_at = new Date().toISOString();
        changed = true;
      }
    }
  } catch (_) {}
  return changed;
}

function normalizeCapturedText(value) {
  return cleanText(value, MAX_CAPTURE)
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u003[aA]/g, ':')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/');
}

function extractAmpereUrls(value) {
  const out = new Set();
  const texts = [normalizeCapturedText(value)];
  try { texts.push(decodeURIComponent(texts[0])); } catch (_) {}
  for (const text of texts) {
    const regex = /https?:\/\/bol\.prd\.amperebezorgt\.nl\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+/gi;
    for (const match of text.matchAll(regex)) {
      const candidate = match[0].replace(/[)\]}>"',.;]+$/g, '');
      try {
        const url = new URL(candidate);
        if (url.hostname.toLowerCase() === 'bol.prd.amperebezorgt.nl') out.add(url.toString());
      } catch (_) {}
    }
  }
  return [...out];
}

function absorbAmpereUrls(value) {
  const current = new Set(Array.isArray(state.ampereUrls) ? state.ampereUrls : []);
  let changed = false;
  const candidates = Array.isArray(value) ? value.flatMap(v => extractAmpereUrls(v)) : extractAmpereUrls(value);
  for (const url of candidates) {
    if (!current.has(url)) {
      current.add(url);
      changed = true;
    }
  }
  state.ampereUrls = [...current].slice(-50);
  return changed;
}

async function refreshCookies() {
  const all = [];
  for (const url of ['https://www.bol.com/', 'https://login.bol.com/', 'https://bol.com/']) {
    try {
      const cookies = await chrome.cookies.getAll({ url });
      for (const c of cookies) {
        const key = `${c.name}|${c.domain}|${c.path}`;
        if (all.some(x => `${x.name}|${x.domain}|${x.path}` === key)) continue;
        all.push({
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
  state.cookies = all;
}

function hasSessionMaterial() {
  return !!(state.auth.refresh_token || state.auth.access_token || state.cookies.length || state.ampereUrls.length);
}

function hasVerifiedSession() {
  return !!(state.auth.refresh_token || state.auth.access_token || (state.accountVerifiedAt && state.cookies.length));
}

function mode() {
  if (state.auth.access_token && state.auth.refresh_token) return 'access_refresh';
  if (state.auth.refresh_token) return 'refresh';
  if (state.auth.access_token) return 'access';
  if (state.accountVerifiedAt && state.cookies.length) return 'verified_cookies';
  if (state.cookies.length) return 'cookies';
  if (state.oauth.code) return 'oauth_code';
  return 'waiting';
}

function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeBundle() {
  const payload = {
    schema: state.schema,
    version: state.version,
    helperVersion: state.helperVersion,
    createdAt: state.createdAt || state.updatedAt || new Date().toISOString(),
    updatedAt: state.updatedAt,
    mode: mode(),
    oauth: state.oauth,
    auth: state.auth,
    tokenRequest: state.tokenRequest,
    cookies: state.cookies,
    storage: state.storage,
    ampereUrls: state.ampereUrls,
    accountVerifiedAt: state.accountVerifiedAt,
    evidence: state.evidence,
    lastUrl: state.lastUrl
  };
  return `BOLHOMEY3.${base64UrlEncode(JSON.stringify(payload))}`;
}

async function markReadyAndShow(force = false) {
  await refreshCookies();
  if (!hasSessionMaterial() || !hasVerifiedSession()) {
    await save();
    return false;
  }
  if (!state.createdAt) state.createdAt = new Date().toISOString();
  if (!state.readyGeneration) state.readyGeneration = Date.now();
  await save();
  if (force || state.shownGeneration !== state.readyGeneration) {
    state.shownGeneration = state.readyGeneration;
    await save();
    try { await chrome.tabs.create({ url: RESULT_URL }); } catch (_) {}
  }
  return true;
}

function bodyToText(requestBody) {
  if (!requestBody) return '';
  if (requestBody.formData) {
    const p = new URLSearchParams();
    for (const [k, arr] of Object.entries(requestBody.formData)) {
      for (const v of arr || []) p.append(k, v);
    }
    return p.toString();
  }
  if (Array.isArray(requestBody.raw)) {
    try {
      const decoder = new TextDecoder();
      return requestBody.raw.map(x => x && x.bytes ? decoder.decode(x.bytes) : '').join('');
    } catch (_) {}
  }
  return '';
}

chrome.webRequest.onBeforeRequest.addListener(details => {
  ready.then(async () => {
    absorbAmpereUrls(details.url || '');
    if (!/\/token(?:\?|$)/i.test(details.url)) return;
    const text = bodyToText(details.requestBody);
    const params = parseParams(text);
    const safe = {};
    for (const key of ['grant_type', 'client_id', 'redirect_uri', 'scope', 'code_verifier', 'code']) {
      if (params[key]) safe[key] = cleanText(params[key], 120000);
    }
    state.tokenRequest = { url: details.url, method: details.method, ...safe };
    if (params.code) state.oauth.code = cleanText(params.code, 120000);
    await save();
  });
}, { urls: ['https://login.bol.com/*', 'https://*.bol.com/*', 'https://*.amperebezorgt.nl/*'] }, ['requestBody']);

chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  ready.then(async () => {
    absorbAmpereUrls(details.url || '');
    for (const h of details.requestHeaders || []) {
      if (!h || !h.name) continue;
      const name = h.name.toLowerCase();
      const value = String(h.value || '');
      if (name === 'authorization' && /^bearer\s+/i.test(value)) {
        state.auth.access_token = cleanText(value.replace(/^bearer\s+/i, ''), 120000);
        state.auth.token_type = 'Bearer';
        state.auth.captured_at = new Date().toISOString();
      }
      if (/^(x-csrf-token|x-xsrf-token)$/i.test(name)) state.auth.csrf_token = cleanText(value, 120000);
    }
    await save();
  });
}, { urls: ['https://*.bol.com/*', 'https://bol.com/*', 'https://*.amperebezorgt.nl/*'] }, ['requestHeaders', 'extraHeaders']);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await ready;
    if (!message || !message.type) return sendResponse({ ok: false });

    if (message.type === 'start_login') {
      state = EMPTY();
      state.loginStartedAt = new Date().toISOString();
      state.createdAt = state.loginStartedAt;
      state.readyGeneration = Date.now();
      await save();
      await chrome.tabs.create({ url: LOGIN_URL });
      return sendResponse({ ok: true });
    }

    if (message.type === 'reset') {
      state = EMPTY();
      await save();
      return sendResponse({ ok: true });
    }

    if (message.type === 'ampere_urls') {
      absorbAmpereUrls(message.urls || message.payload?.urls || []);
      await save();
      return sendResponse({ ok: true });
    }

    if (message.type === 'page_state') {
      absorbUrl(message.url || '');
      absorbAmpereUrls(message.ampereUrls || []);
      if (message.localStorage && typeof message.localStorage === 'object') {
        state.storage.local = { ...state.storage.local, ...message.localStorage };
        scanTokenLikeValue(message.localStorage);
      }
      if (message.sessionStorage && typeof message.sessionStorage === 'object') {
        state.storage.session = { ...state.storage.session, ...message.sessionStorage };
        scanTokenLikeValue(message.sessionStorage);
      }
      await refreshCookies();
      await save();

      let current;
      try { current = new URL(message.url || ''); } catch (_) { current = null; }
      const host = current?.hostname?.toLowerCase() || '';
      const path = current?.pathname || '';
      const isBolPage = host.endsWith('bol.com') && host !== 'login.bol.com';
      const isOrdersPage = /\/account\/bestellingen\//i.test(path) || message.accountPage === true;

      if (state.loginStartedAt && isBolPage) {
        if (isOrdersPage) {
          state.accountVerifiedAt = new Date().toISOString();
          state.ordersProbeComplete = true;
          await save();
          setTimeout(() => ready.then(() => markReadyAndShow(false)).catch(() => {}), 2200);
        } else if (!state.ordersProbeStartedAt && sender?.tab?.id != null) {
          state.ordersProbeStartedAt = new Date().toISOString();
          await save();
          try { await chrome.tabs.update(sender.tab.id, { url: ORDERS_URL }); } catch (_) {
            try { await chrome.tabs.create({ url: ORDERS_URL }); } catch (_) {}
          }
        }
      }
      return sendResponse({ ok: true });
    }

    if (message.type === 'page_ready') {
      absorbUrl(message.payload && message.payload.url ? message.payload.url : message.url || '');
      absorbAmpereUrls(message.payload?.url || '');
      await save();
      return sendResponse({ ok: true });
    }

    if (message.type === 'network_response') {
      const payload = message.payload || {};
      absorbUrl(payload.url || message.url || '');
      absorbAmpereUrls(payload.url || '');
      const body = cleanText(payload.body || '', MAX_CAPTURE);
      absorbAmpereUrls(body);
      const obj = parseMaybeJson(body);
      const changed = obj ? scanTokenLikeValue(obj) : false;
      state.evidence.push({
        at: new Date().toISOString(),
        url: cleanText(payload.url || '', 3000),
        method: cleanText(payload.method || 'GET', 20),
        status: Number(payload.status || 0),
        tokenLike: !!changed,
        ampereLinks: extractAmpereUrls(body).length
      });
      if (state.evidence.length > 25) state.evidence = state.evidence.slice(-25);
      await refreshCookies();
      await save();
      return sendResponse({ ok: true });
    }

    if (message.type === 'get_state') {
      await refreshCookies();
      await save();
      return sendResponse({
        ok: true,
        ready: hasVerifiedSession(),
        verified: !!state.accountVerifiedAt,
        mode: mode(),
        bundle: hasSessionMaterial() && hasVerifiedSession() ? makeBundle() : '',
        hasAccessToken: !!state.auth.access_token,
        hasRefreshToken: !!state.auth.refresh_token,
        hasOauthCode: !!state.oauth.code,
        cookieCount: state.cookies.length,
        ampereCount: state.ampereUrls.length,
        updatedAt: state.updatedAt,
        lastUrl: state.lastUrl
      });
    }

    if (message.type === 'show_result') {
      const ok = await markReadyAndShow(true);
      return sendResponse({ ok });
    }

    sendResponse({ ok: false });
  })().catch(error => sendResponse({ ok: false, error: String(error && error.message || error) }));
  return true;
});
