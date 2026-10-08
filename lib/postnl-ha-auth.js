'use strict';

const crypto = require('crypto');

const BASE = 'https://login.postnl.nl';
const TENANT = '101112a0-4a0f-4bbb-8176-2f1b2d370d7c';
const OIDC_CLIENT_ID = 'bd9f1610-b56d-4e05-a09b-f696f05ddade';
const CAPTURE_CLIENT_ID = 'dkyxkt9x888ye422mawmf769yfm9y44j';
const REDIRECT_URI = 'https://www.postnl.nl/';
const SCOPE = 'openid poa-profiles-api offline_access';
const FLOW_VERSION = '20250910094830574377';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

class PostNLHaAuthError extends Error {
  constructor(message, code = 'AUTH_LOGIN_FAILED') { super(message); this.name = 'PostNLHaAuthError'; this.code = code; }
}

class CookieJar {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies.entries()].map(([k,v]) => `${k}=${v}`).join('; '); }
  absorb(response) {
    let lines = [];
    try { if (typeof response.headers.getSetCookie === 'function') lines = response.headers.getSetCookie(); } catch (_) {}
    if (!lines.length) { const raw = response.headers.get('set-cookie'); if (raw) lines = String(raw).split(/,(?=\s*[^;,=]+=[^;,]+)/g); }
    for (const line of lines) {
      const first = String(line || '').split(';', 1)[0];
      const index = first.indexOf('=');
      if (index > 0) this.cookies.set(first.slice(0,index).trim(), first.slice(index+1).trim());
    }
  }
  get(name) { return this.cookies.get(name) || null; }
}

function formBody(obj) { return new URLSearchParams(Object.entries(obj).filter(([,v]) => v !== undefined && v !== null)); }
function jsValue(body, key) {
  const escaped=String(key).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=String(body||'').match(new RegExp(escaped+'\\s*[\\\'\"]([^\\\'\"]+)[\\\'\"]'));
  return match ? match[1] : null;
}
function jsonValue(body, key) {
  const escaped=String(key).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=String(body||'').match(new RegExp('"'+escaped+'"\\s*:\\s*"([^"]+)"'));
  return match ? match[1] : null;
}

class PostNLHaAuth {
  constructor({ username, password, fetchFn = global.fetch, log = () => {} } = {}) {
    this.username = String(username || '').trim();
    this.password = String(password || '');
    this.fetch = fetchFn;
    this.log = log;
    this.jar = new CookieJar();
  }

  async _request(url, options = {}, follow = true, depth = 0) {
    if (depth > 12) throw new PostNLHaAuthError('PostNL login redirect loop.');
    const headers = { 'User-Agent': USER_AGENT, ...(options.headers || {}) };
    const cookie = this.jar.header();
    if (cookie) headers.Cookie = cookie;
    const response = await this.fetch(url, { ...options, headers, redirect: 'manual' });
    this.jar.absorb(response);
    const location = response.headers.get('location');
    if (follow && location && response.status >= 300 && response.status < 400) {
      const next = new URL(location, url).toString();
      return this._request(next, { method: 'GET', headers: { Referer: url } }, true, depth + 1);
    }
    return response;
  }

  _pkcePair() {
    const verifier = crypto.randomBytes(96).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  async login() {
    if (!this.username || !this.password) throw new PostNLHaAuthError('Vul je PostNL e-mailadres en wachtwoord in.', 'AUTH_INVALID_CREDENTIALS');
    const { verifier, challenge } = this._pkcePair();
    const state = crypto.randomBytes(24).toString('base64url');
    const authorize = new URL(`${BASE}/${TENANT}/login/authorize`);
    authorize.search = new URLSearchParams({
      client_id: OIDC_CLIENT_ID, response_type: 'code', scope: SCOPE, redirect_uri: REDIRECT_URI,
      state, nonce: state, code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();

    const loginResponse = await this._request(authorize.toString(), { method: 'GET' }, true);
    const loginUrl = loginResponse.url || authorize.toString();
    const loginBody = await loginResponse.text();
    const csrf = this.jar.get('_csrf_token') || jsValue(loginBody, 'aicCsrf:');
    if (!csrf) throw new PostNLHaAuthError('PostNL login kon geen CSRF-token vinden.');

    const txid = crypto.randomBytes(30).toString('base64url');
    await this._request(`${BASE}/widget/traditional_signin.jsonp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: loginUrl },
      body: formBody({
        utf8: '✓', signInEmailAddress: this.username, currentPassword: this.password,
        capture_screen: 'signIn', js_version: 'd445bf4', capture_transactionId: txid,
        form: 'signInForm', flow: 'standard', client_id: CAPTURE_CLIENT_ID,
        redirect_uri: `${loginUrl}&socialRedirect=True`, response_type: 'token',
        flow_version: FLOW_VERSION, settings_version: '', locale: 'en-US', recaptchaVersion: '2',
      }),
    }, false);

    const resultUrl = new URL(`${BASE}/widget/get_result.jsonp`);
    resultUrl.search = new URLSearchParams({ transactionId: txid, cache: String(Date.now()) }).toString();
    const resultResponse = await this._request(resultUrl.toString(), { method: 'GET' }, false);
    const resultBody = await resultResponse.text();
    const captureToken = jsonValue(resultBody, 'accessToken');
    if (!captureToken) throw new PostNLHaAuthError('PostNL heeft de inloggegevens niet geaccepteerd.', 'AUTH_INVALID_CREDENTIALS');

    const loginParsed = new URL(loginUrl);
    const tokenUrl = `${BASE}/${TENANT}/auth-ui/v2/token-url?${loginParsed.searchParams.toString()}`;
    let exchange = await this._request(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: loginUrl },
      body: formBody({ screen: 'signIn', authenticated: 'True', registering: 'False', accessToken: captureToken, _csrf_token: csrf }),
    }, false);
    let authUrl = exchange.headers.get('location');
    let exchangeBody = await exchange.text();

    if (!authUrl) {
      const existingToken = jsValue(exchangeBody, 'existingToken:');
      const screen = jsValue(exchangeBody, 'screenToRender:');
      const nextCsrf = jsValue(exchangeBody, 'aicCsrf:');
      if (screen !== 'loginSuccess' || !existingToken || !nextCsrf) throw new PostNLHaAuthError('PostNL Hosted Login bereikte loginSuccess niet.');
      exchange = await this._request(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: tokenUrl },
        body: formBody({ screen: 'loginSuccess', accessToken: existingToken, _csrf_token: nextCsrf }),
      }, false);
      authUrl = exchange.headers.get('location');
    }
    if (!authUrl) throw new PostNLHaAuthError('PostNL Hosted Login gaf geen authorize redirect terug.');

    const authResponse = await this._request(new URL(authUrl, tokenUrl).toString(), { method: 'GET' }, false);
    const finalLocation = authResponse.headers.get('location') || '';
    const callback = new URL(finalLocation, REDIRECT_URI);
    const code = callback.searchParams.get('code');
    const returnedState = callback.searchParams.get('state');
    if (!code) throw new PostNLHaAuthError('PostNL OIDC gaf geen authorization code terug.');
    if (returnedState !== state) throw new PostNLHaAuthError('PostNL OIDC state mismatch.');

    const token = await PostNLHaAuth.tokenRequest({
      fetchFn: this.fetch,
      data: { grant_type: 'authorization_code', client_id: OIDC_CLIENT_ID, code, redirect_uri: REDIRECT_URI, code_verifier: verifier },
    });
    this.log('[PostNL HA auth] login succeeded');
    return token;
  }

  static async tokenRequest({ fetchFn = global.fetch, data }) {
    const response = await fetchFn(`${BASE}/${TENANT}/login/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': USER_AGENT },
      body: formBody(data),
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) { payload = {}; }
    if (!response.ok || !payload.access_token) {
      const message = payload.error_description || payload.error || `HTTP ${response.status}`;
      throw new PostNLHaAuthError(`PostNL token request failed: ${message}`, 'AUTH_TOKEN_FAILED');
    }
    return {
      access_token: payload.access_token, refresh_token: payload.refresh_token || null,
      expires_in: payload.expires_in || 3600, token_type: payload.token_type || 'Bearer',
      client_id: OIDC_CLIENT_ID, auth_method: 'ha_capture',
    };
  }

  static async refresh(refreshToken, fetchFn = global.fetch) {
    return this.tokenRequest({ fetchFn, data: { grant_type: 'refresh_token', client_id: OIDC_CLIENT_ID, refresh_token: refreshToken } });
  }
}

module.exports = { PostNLHaAuth, PostNLHaAuthError, OIDC_CLIENT_ID, REDIRECT_URI };
