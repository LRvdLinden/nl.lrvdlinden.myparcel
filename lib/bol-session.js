'use strict';

const crypto = require('crypto');

const ORDER_OVERVIEW = 'https://www.bol.com/nl/nl/account/bestellingen/overzicht/';
const ACCOUNT_OVERVIEW = 'https://www.bol.com/nl/nl/account/overzicht/';
const AMPERE_HOST = 'bol.prd.amperebezorgt.nl';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function decodeBase64Url(value) {
  const text = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = text + '='.repeat((4 - (text.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function decodeBundle(input) {
  const raw = clean(input);
  if (!raw) throw Object.assign(new Error('Bol.com session code is required.'), { code: 'AUTH_REAUTH_REQUIRED' });

  const prefixes = ['BOLHOMEY3.', 'BOLHOMEY2.', 'BOLHOMEY.'];
  let payload = raw;
  for (const prefix of prefixes) {
    if (raw.startsWith(prefix)) {
      payload = decodeBase64Url(raw.slice(prefix.length));
      break;
    }
  }

  let data;
  try {
    data = JSON.parse(payload);
  } catch (_) {
    try { data = JSON.parse(decodeBase64Url(payload)); } catch (error) {
      throw Object.assign(new Error('Invalid bol.com session code.'), { code: 'AUTH_REAUTH_REQUIRED' });
    }
  }

  if (!data || typeof data !== 'object') throw Object.assign(new Error('Invalid bol.com session code.'), { code: 'AUTH_REAUTH_REQUIRED' });
  const cookies = Array.isArray(data.cookies) ? data.cookies : [];
  const auth = data.auth && typeof data.auth === 'object' ? data.auth : {};
  const oauth = data.oauth && typeof data.oauth === 'object' ? data.oauth : {};
  const ampereUrls = Array.isArray(data.ampereUrls) ? data.ampereUrls.filter(Boolean) : [];
  if (!cookies.length && !auth.access_token && !auth.refresh_token && !oauth.code && !ampereUrls.length) {
    throw Object.assign(new Error('The bol.com session code contains no usable login session.'), { code: 'AUTH_REAUTH_REQUIRED' });
  }
  return { ...data, cookies, auth, oauth, ampereUrls };
}

function encodeBase64Url(value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeBundle(bundle) {
  return `BOLHOMEY3.${encodeBase64Url(JSON.stringify(bundle || {}))}`;
}

function cookieHeader(bundle, hostname = 'www.bol.com') {
  const now = Date.now() / 1000;
  const host = clean(hostname).toLowerCase();
  return (bundle.cookies || [])
    .filter(cookie => {
      const domain = clean(cookie.domain).replace(/^\./, '').toLowerCase();
      const unexpired = !cookie.expirationDate || Number(cookie.expirationDate) > now;
      return cookie.name && cookie.value != null && unexpired && (!domain || host === domain || host.endsWith(`.${domain}`));
    })
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u003[aA]/g, ':')
    .replace(/\\\//g, '/');
}

function extractAmpereUrls(input) {
  const found = new Set();
  const variants = [htmlDecode(input)];
  try { variants.push(decodeURIComponent(variants[0])); } catch (_) {}
  for (const text of variants) {
    const regex = /https?:\/\/bol\.prd\.amperebezorgt\.nl\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+/gi;
    for (const match of text.matchAll(regex)) {
      const candidate = match[0].replace(/[),.;]+$/, '');
      try {
        const url = new URL(candidate);
        if (url.hostname.toLowerCase() === AMPERE_HOST) found.add(url.toString());
      } catch (_) {}
    }
  }
  return [...found];
}

function extractOrderDetailUrls(input, base = ORDER_OVERVIEW) {
  const found = new Set();
  const text = htmlDecode(input);
  const regex = /href\s*=\s*["']([^"']+)["']/gi;
  for (const match of text.matchAll(regex)) {
    const href = match[1];
    if (!/\/account\/bestellingen\//i.test(href)) continue;
    try {
      const url = new URL(href, base);
      if (url.hostname.toLowerCase() !== 'www.bol.com') continue;
      if (/\/account\/bestellingen\/overzicht\/?$/i.test(url.pathname)) continue;
      found.add(url.toString());
    } catch (_) {}
  }
  return [...found];
}

function textFromHtml(html) {
  return htmlDecode(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(text, regexes) {
  for (const regex of regexes) {
    const m = String(text || '').match(regex);
    if (m && m[1]) return clean(m[1]);
  }
  return '';
}

function trackingId(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    return segments.at(-1) || crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  } catch (_) {
    return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 16);
  }
}

class BolSessionClient {
  constructor({ sessionCode, fetchFn = fetch, log = () => {}, onBundleUpdated = null } = {}) {
    this.bundle = decodeBundle(sessionCode);
    this.fetch = fetchFn;
    this.log = log;
    this.onBundleUpdated = typeof onBundleUpdated === 'function' ? onBundleUpdated : null;
  }

  diagnostics() {
    return {
      helperVersion: this.bundle.helperVersion || '',
      hasAccessToken: Boolean(this.bundle.auth?.access_token),
      hasRefreshToken: Boolean(this.bundle.auth?.refresh_token),
      hasOauthCode: Boolean(this.bundle.oauth?.code),
      cookieCount: this.bundle.cookies?.length || 0,
      ampereUrlCount: this.bundle.ampereUrls?.length || 0,
      accountVerifiedAt: this.bundle.accountVerifiedAt || null,
      mode: this.bundle.mode || '',
    };
  }

  async _persistBundle() {
    this.bundle.updatedAt = new Date().toISOString();
    if (this.onBundleUpdated) await this.onBundleUpdated(encodeBundle(this.bundle));
  }

  async refreshAccessToken({ force = false } = {}) {
    const refreshToken = clean(this.bundle.auth?.refresh_token);
    const tokenRequest = this.bundle.tokenRequest && typeof this.bundle.tokenRequest === 'object' ? this.bundle.tokenRequest : {};
    if (!refreshToken || !tokenRequest.url) return false;

    let endpoint;
    try {
      endpoint = new URL(tokenRequest.url);
      if (endpoint.protocol !== 'https:' || endpoint.hostname.toLowerCase() !== 'login.bol.com' || !/\/token(?:\/|$)/i.test(endpoint.pathname)) return false;
    } catch (_) { return false; }

    if (!force) {
      const capturedAt = Date.parse(this.bundle.auth?.captured_at || this.bundle.updatedAt || this.bundle.createdAt || '');
      const expiresIn = Number(this.bundle.auth?.expires_in || 0);
      if (capturedAt && expiresIn > 0 && Date.now() < capturedAt + Math.max(60, expiresIn - 300) * 1000) return false;
    }

    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (tokenRequest.client_id) body.set('client_id', clean(tokenRequest.client_id));
    const scope = clean(this.bundle.auth?.scope || tokenRequest.scope);
    if (scope) body.set('scope', scope);

    const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    const cookies = cookieHeader(this.bundle, endpoint.hostname);
    if (cookies) headers.cookie = cookies;

    const response = await this.fetch(endpoint.toString(), { method: 'POST', headers, body: body.toString(), redirect: 'follow' });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch (_) {}
    if (!response.ok || !data.access_token) {
      const error = new Error(`bol.com token refresh failed (${response.status}).`);
      error.statusCode = response.status;
      error.code = [400, 401, 403].includes(response.status) ? 'TOKEN_REFRESH_REJECTED' : 'TOKEN_REFRESH_FAILED';
      throw error;
    }

    this.bundle.auth = {
      ...this.bundle.auth,
      ...data,
      refresh_token: data.refresh_token || refreshToken,
      captured_at: new Date().toISOString(),
    };
    this.bundle.mode = this.bundle.auth.refresh_token ? 'access_refresh' : 'access';
    await this._persistBundle();
    return true;
  }

  async _request(url, { bolSession = false } = {}) {
    const u = new URL(url);
    const headers = {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
      'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8',
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    };
    if (bolSession) {
      const cookies = cookieHeader(this.bundle, u.hostname);
      if (!cookies) throw Object.assign(new Error('Bol.com web session is missing. Reconnect with helper 0.3.1.'), { code: 'AUTH_REAUTH_REQUIRED' });
      headers.cookie = cookies;
    }

    const response = await this.fetch(url, { method: 'GET', headers, redirect: 'follow' });
    const text = await response.text();
    let finalHost = '';
    try { finalHost = new URL(response.url || url).hostname.toLowerCase(); } catch (_) {}
    const loginPage = finalHost === 'login.bol.com' || /login\.bol\.com\/authorize|\/wsp\/login/i.test(text.slice(0, 100000));
    if (bolSession && (loginPage || [401, 403].includes(response.status))) {
      const error = new Error('Bol.com session expired. Reconnect with the Bol.com Homey Login Helper.');
      error.code = 'AUTH_REAUTH_REQUIRED';
      error.statusCode = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} while loading ${u.hostname}`);
      error.statusCode = response.status;
      throw error;
    }
    return { text, url: response.url || url, status: response.status };
  }

  capturedAmpereUrls() {
    const urls = new Set();
    for (const value of this.bundle.ampereUrls || []) {
      for (const url of extractAmpereUrls(value)) urls.add(url);
    }
    return [...urls];
  }

  async discoverAmpereUrls({ maxDetailPages = 16, tolerateAuthFailure = false } = {}) {
    const urls = new Set(this.capturedAmpereUrls());
    let liveError = null;

    if (this.bundle.auth?.refresh_token) {
      try { await this.refreshAccessToken(); } catch (error) {
        this.log('[BolSessionClient] token refresh skipped', error.message);
      }
    }

    try {
      const details = new Set();
      for (const page of [ORDER_OVERVIEW, ACCOUNT_OVERVIEW]) {
        const response = await this._request(page, { bolSession: true });
        for (const url of extractAmpereUrls(response.text)) urls.add(url);
        for (const detail of extractOrderDetailUrls(response.text, response.url)) details.add(detail);
      }

      let count = 0;
      for (const detail of details) {
        if (count++ >= maxDetailPages) break;
        try {
          const response = await this._request(detail, { bolSession: true });
          for (const url of extractAmpereUrls(response.text)) urls.add(url);
        } catch (error) {
          if (error.code === 'AUTH_REAUTH_REQUIRED') throw error;
          this.log('[BolSessionClient] order detail skipped', detail, error.message);
        }
      }
    } catch (error) {
      liveError = error;
      this.log('[BolSessionClient] live bol.com discovery unavailable', error.message);
      if (!tolerateAuthFailure && !urls.size) throw error;
    }

    return { urls: [...urls], liveError };
  }

  async fetchAmpereParcel(url) {
    const fallback = {
      id: trackingId(url),
      tracking: trackingId(url),
      sender: 'bol.com',
      status: 'Ampère',
      deliveryDate: '',
      deliveryWindow: '',
      updatedAt: new Date().toISOString(),
      detailsUrl: url,
      delivered: false,
      carrier: 'ampere',
    };
    try {
      const response = await this._request(url, { bolSession: false });
      const raw = htmlDecode(response.text);
      const visible = textFromHtml(raw);
      const status = firstMatch(raw, [
        /"status(?:Description|Text|Label)?"\s*:\s*"([^"]{2,100})"/i,
        /"shipmentStatus"\s*:\s*"([^"]{2,100})"/i,
      ]) || firstMatch(visible, [
        /\b(Bezorgd|Onderweg|Aangemeld|Vandaag bezorgd|We zijn onderweg|Pakket ontvangen|Afgeleverd)\b/i,
      ]) || 'Ampère';
      const deliveryDate = firstMatch(raw, [
        /"(?:deliveryDate|expectedDeliveryDate|date)"\s*:\s*"(\d{4}-\d{2}-\d{2}[^"]*)"/i,
      ]);
      const from = firstMatch(raw, [/"(?:startTime|from|windowStart)"\s*:\s*"([^"}]{2,40})"/i]);
      const to = firstMatch(raw, [/"(?:endTime|to|windowEnd)"\s*:\s*"([^"}]{2,40})"/i]);
      const delivered = /bezorgd|afgeleverd|delivered/i.test(status);
      return {
        ...fallback,
        status,
        deliveryDate,
        deliveryWindow: [from, to].filter(Boolean).join(' - '),
        updatedAt: new Date().toISOString(),
        delivered,
      };
    } catch (error) {
      this.log('[BolSessionClient] Ampère tracking page fallback', url, error.message);
      return fallback;
    }
  }
}

module.exports = {
  BolSessionClient,
  decodeBundle,
  encodeBundle,
  cookieHeader,
  extractAmpereUrls,
  extractOrderDetailUrls,
  ORDER_OVERVIEW,
};
