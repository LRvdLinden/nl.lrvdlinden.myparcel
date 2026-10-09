'use strict';

/*
 * Mondial Relay account tracking – port of ha-mondial-relay (https://github.com/ha-parcel-integrations/ha-mondial-relay),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 *
 * Account model: InPost Group OAuth/PKCE "browser paste" sign-in (the official app's public client), then the
 * Mondial Relay mobile BFF with a bearer token plus a derived request-signing header on every call. The stored
 * credential is a (rotating) refresh token – never a password. There is no public per-code tracking in the HA
 * integration; parcels come from the account's received / shipped lists.
 */

const crypto = require('crypto');
const { CarrierError, request, parseJson, retryAfter, isObject, str } = require('./carrier-http');

const C = 'Mondial Relay';

const OAUTH = Object.freeze({
  authorizeUrl: 'https://account.inpost-group.com/oauth2/authorize',
  tokenUrl: 'https://account.inpost-group.com/oauth2/token',
  clientId: 'mondialrelay-mobile',
  redirectUri: 'https://account.inpost-group.com/callback',
  scope: 'openid',
  // Without brand=mr the IdP serves the generic InPost sign-up whose phone step only accepts +48.
  brand: 'mr',
});

const BFF = Object.freeze({
  base: 'https://mobile-app-bff.mondialrelay.app/api',
  received: 'parcels-list-received',
  shipped: 'parcels-list-shipped',
  userInfo: 'user-infos',
  pageSize: 20,
  acceptLanguage: 'en',
  originApp: 'MR',
  // Cloudflare in front of the BFF rejects generic HTTP-client user agents with a 403.
  userAgent: 'okhttp/4.12.0',
});

const SIGNING_VALUE = 'VCzt4PzS8ynJE2yy7zNBiQbTE3pkncqEyvrUsCDbXupGn8yqRrPDov2FYiAVfuUx';
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
const FALLBACK_TOKEN_LIFETIME_MS = 15 * 60 * 1000;
const MAX_PAGES = 50;

/**
 * Account markets (live-confirmed in ha-mondial-relay; anything else is an HTTP 400 on the authorize call).
 * The market only steers the sign-in page – the account backend is the same for all of them.
 */
const DEFAULT_MARKET = 'FR';
const MARKETS = Object.freeze({
  FR: { languages: ['fr-FR'], website: 'https://www.mondialrelay.fr', label: { en: 'France', nl: 'Frankrijk' } },
  BE: { languages: ['fr-BE', 'nl-BE'], website: 'https://www.mondialrelay.be', label: { en: 'Belgium', nl: 'België' } },
  NL: { languages: ['nl-NL'], website: 'https://www.mondialrelay.nl', label: { en: 'Netherlands', nl: 'Nederland' } },
  ES: { languages: ['es-ES'], website: 'https://www.inpost.es', label: { en: 'Spain', nl: 'Spanje' } },
  PT: { languages: ['pt-PT'], website: 'https://www.inpost.pt', label: { en: 'Portugal', nl: 'Portugal' } },
});
const COUNTRIES = MARKETS;

function marketOf(value) {
  const m = str(value).toUpperCase();
  return MARKETS[m] ? m : DEFAULT_MARKET;
}

function normalizeCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }

function mrError(message, { status = null, auth = false, retryAfter: ra = null, code = '' } = {}) {
  const error = new CarrierError(message, { status, auth, retryAfter: ra });
  error.code = code;
  return error;
}

/* ----------------------------------------------------------------- signing -- */

function deriveApiKey(param1, param2) {
  const inner = crypto.createHash('sha256').update(`${SIGNING_VALUE}${param1}${param2}`).digest('hex');
  return crypto.createHash('sha256').update(inner).digest('hex');
}

/** Fresh nonce + epoch seconds on every call – a reused signature is rejected as stale. */
function signatureHeaders({ deviceUid, language = BFF.acceptLanguage, originApp = BFF.originApp, now = Date.now() } = {}) {
  const param1 = crypto.randomUUID();
  const param2 = String(Math.floor(now / 1000));
  return {
    'X-MR-Param1': param1,
    'X-MR-Param2': param2,
    'X-MR-API-KEY': deriveApiKey(param1, param2),
    'device-uid': deviceUid,
    'Accept-Language': language,
    'X-OriginApp': originApp,
  };
}

function newDeviceUid() { return crypto.randomBytes(16).toString('hex'); }

/* ------------------------------------------------------------------- OAuth -- */

function urlsafe(bytes) { return crypto.randomBytes(bytes).toString('base64url'); }

function generatePkce() {
  const verifier = urlsafe(64);
  const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return { verifier, challenge };
}

function signInLanguage(language, market) {
  const choices = MARKETS[marketOf(market)].languages;
  const spoken = str(language).toLowerCase().slice(0, 2);
  return choices.find(c => spoken && c.startsWith(spoken)) || choices[0];
}

/** One-time authorization URL → { url, codeVerifier, state }. brand/lang/supported_markets are load-bearing. */
function buildAuthorizationUrl({ language = '', market = DEFAULT_MARKET } = {}) {
  const { verifier, challenge } = generatePkce();
  const state = urlsafe(24);
  const params = {
    response_type: 'code',
    client_id: OAUTH.clientId,
    redirect_uri: OAUTH.redirectUri,
    scope: OAUTH.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce: urlsafe(24),
    response_mode: 'query',
    brand: OAUTH.brand,
    lang: signInLanguage(language, market),
    supported_markets: marketOf(market),
  };
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return { url: `${OAUTH.authorizeUrl}?${query}`, codeVerifier: verifier, state };
}

function parseUrl(value) { try { return new URL(str(value)); } catch (_) { return null; } }

/** HTTPS, the expected host and the exact callback path – checked before a code is ever exchanged. */
function isValidCallbackUrl(value) {
  const u = parseUrl(value);
  const e = new URL(OAUTH.redirectUri);
  return Boolean(u && u.protocol === 'https:' && u.host === e.host && u.pathname === e.pathname);
}

function parseCallbackUrl(value) {
  const u = parseUrl(value);
  return { code: u?.searchParams.get('code') || null, state: u?.searchParams.get('state') || null };
}

/** Best-effort, unverified read of the ID token's `sub` (only used as a stable device id). */
function decodeIdTokenSubject(idToken) {
  const parts = str(idToken).split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return isObject(claims) && claims.sub ? String(claims.sub) : null;
  } catch (_) { return null; }
}

class MondialRelayOAuth {
  constructor({ refreshToken = null, fetchFn } = {}) {
    this.refreshToken = refreshToken || null;
    this.idToken = null;
    this.accessToken = null;
    this.expiresAt = 0;
    this.refreshTokenChanged = false;
    this.fetchFn = fetchFn;
  }

  popRefreshTokenChanged() { const v = this.refreshTokenChanged; this.refreshTokenChanged = false; return v; }

  get needsRefresh() { return !this.accessToken || Date.now() >= this.expiresAt - TOKEN_REFRESH_MARGIN_MS; }

  async exchangeCode(code, codeVerifier) {
    const payload = await this._post({
      grant_type: 'authorization_code', client_id: OAUTH.clientId, redirect_uri: OAUTH.redirectUri, code_verifier: codeVerifier, code,
    });
    this._store(payload);
    if (!payload.refresh_token) throw mrError('Mondial Relay token response had no refresh_token', { code: 'no_refresh_token' });
    this.refreshToken = payload.refresh_token;
  }

  async getAccessToken() {
    if (!this.refreshToken) throw mrError('Mondial Relay is not signed in', { auth: true, code: 'no_refresh_token' });
    if (this.needsRefresh) await this.refresh();
    return this.accessToken;
  }

  /** One forced refresh after a 401 – the caller retries exactly once. */
  async handleUnauthorized() {
    if (!this.refreshToken) throw mrError('Mondial Relay is not signed in', { auth: true, code: 'no_refresh_token' });
    await this.refresh();
    return this.accessToken;
  }

  async refresh() {
    const payload = await this._post({ grant_type: 'refresh_token', client_id: OAUTH.clientId, refresh_token: this.refreshToken });
    this._store(payload);
    if (payload.refresh_token && payload.refresh_token !== this.refreshToken) {
      this.refreshToken = payload.refresh_token;
      this.refreshTokenChanged = true;
    }
  }

  async _post(body) {
    const res = await request(OAUTH.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
    }, { carrier: C, ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}) });
    const text = await res.text();
    const payload = (text && parseJson(text)) || {};
    if (res.status === 200 && isObject(payload) && payload.access_token) return payload;
    const error = isObject(payload) ? payload.error : null;
    // 400/401 = the IdP rejected the code / refresh token: the user has to sign in again.
    if (res.status === 400 || res.status === 401) throw mrError(`Mondial Relay sign-in rejected (${error || res.status})`, { status: res.status, auth: true, code: 'oauth_rejected' });
    if (res.status === 429) throw mrError('Mondial Relay sign-in rate limited (HTTP 429)', { status: 429, retryAfter: retryAfter(res) });
    throw mrError(`Mondial Relay token endpoint returned HTTP ${res.status}`, { status: res.status, code: 'oauth_unavailable' });
  }

  _store(payload) {
    if (!payload.access_token) throw mrError('Mondial Relay token response had no access_token');
    this.accessToken = payload.access_token;
    this.idToken = payload.id_token || this.idToken;
    const seconds = Number(payload.expires_in);
    this.expiresAt = Date.now() + (Number.isFinite(seconds) ? seconds * 1000 : FALLBACK_TOKEN_LIFETIME_MS);
  }
}

/* --------------------------------------------------------------------- BFF -- */

class MondialRelayClient {
  constructor({ oauth, deviceUid, fetchFn } = {}) {
    this.oauth = oauth;
    this.deviceUid = deviceUid;
    this.fetchFn = fetchFn;
  }

  async _headers() {
    const token = await this.oauth.getAccessToken();
    return { Authorization: `Bearer ${token}`, 'User-Agent': BFF.userAgent, Accept: 'application/json', ...signatureHeaders({ deviceUid: this.deviceUid }) };
  }

  /**
   * 401 → one token refresh + retry, then auth error (code 'unauthorized').
   * 403 with a valid token → the signing headers were refused (code 'signing_rejected'): never a re-login.
   */
  async _get(path, params = null) {
    const url = `${BFF.base}/${path}${params ? `?${new URLSearchParams(params).toString()}` : ''}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await request(url, { headers: await this._headers() }, { carrier: C, ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}) });
      const text = await res.text();
      if (res.status === 401) {
        if (attempt === 0) {
          try { await this.oauth.handleUnauthorized(); } catch (error) {
            if (error.auth) throw mrError('Mondial Relay session refresh failed', { status: 401, auth: true, code: 'unauthorized' });
            throw error;
          }
          continue;
        }
        throw mrError('Mondial Relay rejected the session (HTTP 401)', { status: 401, auth: true, code: 'unauthorized' });
      }
      if (res.status === 403) throw mrError('Mondial Relay rejected the request signature (HTTP 403)', { status: 403, code: 'signing_rejected' });
      if (res.status === 429) throw mrError('Mondial Relay rate limit reached (HTTP 429)', { status: 429, retryAfter: retryAfter(res) });
      if (res.status !== 200) throw mrError(`Mondial Relay request failed (HTTP ${res.status})`, { status: res.status });
      const body = parseJson(text);
      if (body === undefined) throw mrError('Mondial Relay returned an unreadable response');
      return body;
    }
    throw mrError('Mondial Relay rejected the session (HTTP 401)', { status: 401, auth: true, code: 'unauthorized' });
  }

  async _page(path, pageIndex) {
    const body = await this._get(path, { pageIndex: String(pageIndex), pageSize: String(BFF.pageSize) });
    if (!isObject(body) || !Array.isArray(body.list)) throw mrError('Mondial Relay returned an unexpected list response');
    return body;
  }

  async _list(path) {
    const items = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const envelope = await this._page(path, page);
      items.push(...envelope.list.filter(isObject));
      if (!Number.isInteger(envelope.totalPages) || page >= envelope.totalPages - 1) break;
    }
    return items;
  }

  async userInfo() {
    const body = await this._get(BFF.userInfo);
    if (!isObject(body)) throw mrError('Mondial Relay returned an unexpected account record');
    return body;
  }

  /** Bounded single-page call proving the parcel feed is readable (setup only). */
  async validateParcelAccess() { await this._page(BFF.received, 0); }

  async received() { return this._list(BFF.received); }

  async shipped() { return this._list(BFF.shipped); }
}

/** Only an explicit `phone.valid === false` counts as unconfirmed; never a setup gate on its own. */
function hasConfirmedPhone(userInfo) {
  const phone = isObject(userInfo) ? userInfo.phone : null;
  if (isObject(phone) && 'valid' in phone) return phone.valid !== false;
  return true;
}

function accountType(userInfo) { return isObject(userInfo) && userInfo.userType ? String(userInfo.userType) : ''; }

/** Drop repeated expedition.shipmentUid within ONE list (keep the first); never reconcile across lists. */
function dedupeByShipmentUid(items) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isObject(item)) continue;
    const uid = isObject(item.expedition) ? item.expedition.shipmentUid : null;
    if (uid) { if (seen.has(uid)) continue; seen.add(uid); }
    out.push(item);
  }
  return out;
}

function barcodeOf(expedition) {
  if (expedition.shipmentId !== undefined && expedition.shipmentId !== null && expedition.shipmentId !== '') return normalizeCode(expedition.shipmentId);
  return normalizeCode(expedition.tracingCode);
}

function humanHint(hint) {
  const text = str(hint).replace(/_/g, ' ').toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

/**
 * One `{expedition, delivery}` list item → canonical parcel.
 * Like ha-mondial-relay pre-1.0: `stepSection` has no confirmed vocabulary, so status is always `unknown`,
 * delivered is never set and no ETA / pickup point / weight is claimed. statusCode = String(stepSection);
 * rawStatus shows the backend's own `stepHint` (display only, never used for mapping) or the step number.
 */
function normalize(raw, code, opts = {}) {
  const r = isObject(raw) ? raw : {};
  const expedition = isObject(r.expedition) ? r.expedition : {};
  const step = expedition.stepSection;
  const statusCode = step === undefined || step === null ? '' : String(step);
  const rawStatus = humanHint(expedition.stepHint) || statusCode;
  const barcode = barcodeOf(expedition) || normalizeCode(code);
  return {
    barcode,
    sender: str(expedition.brandLabel),
    receiver: '',
    status: 'unknown',
    rawStatus,
    statusCode,
    delivered: false,
    deliveredAt: null,
    plannedFrom: null,
    plannedTo: null,
    windowKnown: false,
    pickup: false,
    pickupPoint: '',
    url: '',
    weight: null,
    dimensions: null,
    history: [],
    direction: opts.direction === 'outgoing' ? 'outgoing' : 'incoming',
    service: '',
    origin: '',
    destination: isObject(r.delivery) ? str(r.delivery.country) : '',
    pickupCode: '',
    pickupDeadline: null,
    item: '',
    stopsUntilYou: null,
    shipmentUid: str(expedition.shipmentUid),
    tracingCode: str(expedition.tracingCode),
  };
}

module.exports = {
  MondialRelayOAuth, MondialRelayClient, normalize, normalizeCode, dedupeByShipmentUid, hasConfirmedPhone, accountType,
  buildAuthorizationUrl, isValidCallbackUrl, parseCallbackUrl, decodeIdTokenSubject, signatureHeaders, deriveApiKey, signInLanguage,
  generatePkce, newDeviceUid, marketOf, MARKETS, COUNTRIES, DEFAULT_MARKET, OAUTH, BFF,
};
