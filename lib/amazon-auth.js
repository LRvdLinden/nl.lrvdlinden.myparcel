'use strict';

/*
 * Amazon device sign-in – port of ha-amazon (https://github.com/ha-parcel-integrations/ha-amazon),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors
 * (custom_components/amazon_orders/account/auth.py).
 *
 * That module is itself adapted from alexapy (https://gitlab.com/keatontaylor/alexapy),
 * Copyright Keaton Taylor and Alan Tse, Licensed under the Apache License, Version 2.0
 * (http://www.apache.org/licenses/LICENSE-2.0). The adapted parts are the sign-in URL, the device
 * registration, the access-token refresh and the token-to-cookie exchange from alexapy/alexalogin.py.
 * They are rewritten here for Node's fetch; alexapy itself is not a dependency. Distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND. See ha-amazon's NOTICE file.
 *
 * Sign-in is a link the user opens in their own browser (where Amazon handles the password, OTP /
 * 2-step verification, passkeys and captchas); the user pastes the final "maplanding" address back.
 * The password never passes through Homey.
 */

const crypto = require('crypto');
const { CarrierError, request, parseJson, isObject, retryAfter } = require('./carrier-http');

const C = 'Amazon';
const APP_NAME = 'Alexa Media Player';
// Shown in the user's Amazon device list ("<first name>'s Homey Parcels").
const DEVICE_NAME = 'Homey Parcels';
const CALL_VERSION = '2.2.556530.0';
const FALLBACK_API_HOST = 'api.amazon.com';
const LANDING_URL = 'https://www.amazon.com/ap/maplanding';
const DEVICE_ID_SUFFIX = '23413249564c5635564d32573831';
const TOKEN_FIELDS = {
  app_name: APP_NAME,
  app_version: CALL_VERSION,
  'di.sdk.version': '6.12.4',
  package_name: 'com.amazon.echo',
  'di.hw.version': 'iPhone',
  platform: 'iOS',
  'di.os.name': 'iOS',
  'di.os.version': '16.6',
  current_version: '6.12.4',
  previous_version: '6.12.4',
};

// Sign-in page language per storefront; anything missing signs in in English.
const SIGN_IN_LANGUAGE = {
  'amazon.nl': 'nl_NL', 'amazon.de': 'de_DE', 'amazon.fr': 'fr_FR', 'amazon.co.uk': 'en_GB', 'amazon.es': 'es_ES', 'amazon.it': 'it_IT',
  'amazon.ca': 'en_CA', 'amazon.com.au': 'en_AU', 'amazon.co.jp': 'ja_JP', 'amazon.in': 'en_IN', 'amazon.com.mx': 'es_MX',
  'amazon.com.br': 'pt_BR', 'amazon.se': 'sv_SE', 'amazon.pl': 'pl_PL', 'amazon.com': 'en_US',
};

function b64url(buffer) { return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

/** A fresh per-device serial (32 upper-case hex chars). */
function newDeviceSerial() { return crypto.randomBytes(16).toString('hex').toUpperCase(); }

/** A fresh PKCE code verifier. */
function newCodeVerifier() { return b64url(crypto.randomBytes(32)); }

function deviceId(serial) { return Buffer.from(String(serial)).toString('hex') + DEVICE_ID_SUFFIX; }

function codeChallenge(verifier) { return b64url(crypto.createHash('sha256').update(String(verifier)).digest()); }

/** The Amazon sign-in URL the user opens in their own browser. */
function buildSignInUrl(domain, serial, verifier) {
  const q = new URLSearchParams({
    'openid.return_to': LANDING_URL,
    'openid.assoc_handle': 'amzn_dp_project_dee_ios',
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    pageId: 'amzn_dp_project_dee_ios',
    accountStatusPolicy: 'P1',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.mode': 'checkid_setup',
    'openid.ns.oa2': 'http://www.amazon.com/ap/ext/oauth/2',
    'openid.oa2.client_id': `device:${deviceId(serial)}`,
    'openid.ns.pape': 'http://specs.openid.net/extensions/pape/1.0',
    'openid.oa2.response_type': 'code',
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.pape.max_auth_age': '0',
    'openid.oa2.scope': 'device_auth_access offline_access',
    'openid.oa2.code_challenge_method': 'S256',
    'openid.oa2.code_challenge': codeChallenge(verifier),
    language: SIGN_IN_LANGUAGE[domain] || 'en_US',
  });
  return `https://www.amazon.com/ap/signin?${q.toString()}`;
}

/**
 * The authorization code from the pasted landing URL, or null. Homey addition: a bare code
 * (copied from the URL by hand on a phone) is accepted too.
 */
function extractAuthorizationCode(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^[A-Za-z0-9_-]{8,}$/.test(text)) return text;
  const at = text.indexOf('?');
  if (at < 0) return null;
  try {
    const value = new URLSearchParams(text.slice(at + 1).split('#')[0]).get('openid.oa2.authorization_code');
    return value || null;
  } catch (_) { return null; }
}

function apiHosts(domain, preferred) {
  const hosts = [`api.${domain}`, FALLBACK_API_HOST];
  if (preferred && hosts.includes(preferred)) { hosts.splice(hosts.indexOf(preferred), 1); hosts.unshift(preferred); }
  return [...new Set(hosts)];
}

/** Whether a status means "this sign-in is no good" rather than "slow down". */
function isRejection(status) { return status >= 400 && status < 500 && status !== 408 && status !== 429; }

function form(data) { return new URLSearchParams(data).toString(); }

async function jsonObject(res) {
  const body = parseJson(await res.text());
  if (body === undefined) throw new CarrierError('Amazon returned an unparseable body');
  if (!isObject(body)) throw new CarrierError('Amazon returned an unexpected body (not a JSON object)');
  return body;
}

function statusError(status, res) {
  if (status === 429 || status === 503) return new CarrierError(`Amazon request failed: HTTP ${status}`, { status, retryAfter: retryAfter(res) });
  return new CarrierError(`Amazon request failed: HTTP ${status}`, { status });
}

/**
 * POST to the regional API host, falling back to the global one. A 4xx is an auth failure only when
 * every host that answered said so; otherwise one host's outage would look like a rejected sign-in.
 */
async function postApi(domain, path, { preferredHost = null, json = null, data = null, fetchFn = fetch } = {}) {
  const statuses = [];
  let lastRes = null;
  let lastError = null;
  for (const host of apiHosts(domain, preferredHost)) {
    let res;
    try {
      res = await request(`https://${host}${path}`, {
        method: 'POST',
        headers: json ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: json ? JSON.stringify(json) : form(data || {}),
      }, { carrier: C, fetchFn });
    } catch (error) { lastError = error; continue; }
    if (res.status === 200) return { host, body: await jsonObject(res) };
    statuses.push(res.status);
    lastRes = res;
  }
  if (!statuses.length) throw lastError || new CarrierError('Amazon is unreachable');
  const last = statuses[statuses.length - 1];
  if (statuses.every(isRejection)) throw new CarrierError(`Amazon rejected the sign-in (HTTP ${last})`, { status: last, auth: true });
  throw statusError(last, lastRes);
}

/** Exchange the authorization code for a refresh token → { host, refreshToken, accessToken, expiresIn }. */
async function registerDevice(domain, serial, verifier, authorizationCode, { fetchFn = fetch } = {}) {
  const frc = crypto.randomBytes(313).toString('base64').replace(/=+$/, '');
  const payload = {
    requested_extensions: ['device_info', 'customer_info'],
    cookies: { website_cookies: [], domain: `.${domain}` },
    registration_data: {
      domain: 'Device',
      app_version: CALL_VERSION,
      device_type: 'A2IVLV5VM2W81',
      device_name: `%FIRST_NAME%'s%DUPE_STRATEGY_1ST%${DEVICE_NAME}`,
      os_version: '16.6',
      device_serial: serial,
      device_model: 'iPhone',
      app_name: APP_NAME,
      software_version: '1',
    },
    auth_data: {
      client_id: deviceId(serial),
      authorization_code: authorizationCode,
      code_verifier: verifier,
      code_algorithm: 'SHA-256',
      client_domain: 'DeviceLegacy',
    },
    user_context_map: { frc },
    requested_token_type: ['bearer', 'mac_dms', 'website_cookies'],
  };
  const { host, body } = await postApi(domain, '/auth/register', { json: payload, fetchFn });
  const bearer = body?.response?.success?.tokens?.bearer;
  const expiresIn = Number.parseInt(bearer?.expires_in, 10);
  if (!isObject(bearer) || !bearer.refresh_token || !bearer.access_token || !Number.isFinite(expiresIn)) {
    throw new CarrierError('Amazon registration returned no bearer token', { auth: true });
  }
  return { host, refreshToken: String(bearer.refresh_token), accessToken: String(bearer.access_token), expiresIn };
}

/** Renew the access token → { host, accessToken }. */
async function refreshAccessToken(domain, refreshToken, { preferredHost = null, fetchFn = fetch } = {}) {
  const data = { ...TOKEN_FIELDS, source_token: refreshToken, requested_token_type: 'access_token', source_token_type: 'refresh_token' };
  const { host, body } = await postApi(domain, '/auth/token', { preferredHost, data, fetchFn });
  if (!body.access_token) throw new CarrierError('Amazon refresh returned no access token', { auth: true });
  return { host, accessToken: String(body.access_token) };
}

/** Mint website cookies for the storefront → [{ Name, Value, Path, Secure, HttpOnly, domain }]. */
async function exchangeTokenForCookies(domain, refreshToken, { fetchFn = fetch } = {}) {
  const data = { ...TOKEN_FIELDS, domain: `.${domain}`, source_token: refreshToken, requested_token_type: 'auth_cookies', source_token_type: 'refresh_token' };
  const res = await request(`https://www.${domain}/ap/exchangetoken/cookies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form(data),
  }, { carrier: C, fetchFn });
  if (isRejection(res.status)) throw new CarrierError(`Amazon rejected the sign-in (HTTP ${res.status})`, { status: res.status, auth: true });
  if (res.status !== 200) throw statusError(res.status, res);
  const body = await jsonObject(res);
  const grouped = body?.response?.tokens?.cookies;
  const cookies = [];
  if (isObject(grouped)) {
    for (const [cookieDomain, items] of Object.entries(grouped)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) if (isObject(item) && item.Name) cookies.push({ ...item, domain: cookieDomain });
    }
  }
  if (!cookies.length) throw new CarrierError('Amazon cookie exchange returned no cookies', { auth: true });
  return cookies;
}

module.exports = {
  APP_NAME, DEVICE_NAME, LANDING_URL, FALLBACK_API_HOST, SIGN_IN_LANGUAGE,
  newDeviceSerial, newCodeVerifier, buildSignInUrl, extractAuthorizationCode, registerDevice, refreshAccessToken, exchangeTokenForCookies,
  _internal: { deviceId, codeChallenge, apiHosts, isRejection },
};
