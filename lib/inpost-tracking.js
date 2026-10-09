'use strict';

/*
 * InPost tracking – port of ha-inpost (https://github.com/ha-parcel-integrations/ha-inpost),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 *  - public tracking by code (inposteasy.com) for PL, IT, PT, GB and ES,
 *  - InPost account (PL / IT) through InPost Group's OAuth + PKCE sign-in.
 */

const crypto = require('crypto');
const { CarrierError, request, parseJson, retryAfter, isObject, str, toIso, parseTime, sortHistory } = require('./carrier-http');

const C = 'InPost';
const API_BASE = 'https://api-inmobile-pl.easypack24.net';
const PL_PARCELS_URL = `${API_BASE}/v3/parcels/tracked`;
const IT_PARCELS_URL = `${API_BASE}/global/cps/api/v1/parcels`;
const AUTHENTICATE_URL = `${API_BASE}/v1/authenticate`;
const OAUTH_AUTHORIZE_URL = 'https://account.inpost-group.com/oauth2/authorize';
const OAUTH_TOKEN_URL = 'https://account.inpost-group.com/oauth2/token';
const OAUTH_REDIRECT_URI = 'https://account.inpost-group.com/callback';
const OAUTH_CLIENT_ID = 'inpost-mobile';
const BASE_HEADERS = {
  'User-Agent': 'InPost-Mobile/3.27.2 (Android 14; SDK 34) okhttp/4.11.0',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'X-Api-Version': '1',
};
const TIMEOUT = 20000;

const COUNTRIES = ['PL', 'IT', 'PT', 'GB', 'ES'];
const ACCOUNT_MARKETS = ['PL', 'IT'];
const TRACKING_URL_BY_COUNTRY = {
  PL: 'https://inpost.pl/en/find-parcel?number={code}',
  IT: 'https://inpost.it/trova-il-tuo-pacco?number={code}',
  PT: 'https://www.inpost.pt/seguimento-do-envio/?exp={code}&language=pt&pais=PT',
  GB: 'https://inpost.co.uk/tracking/result?parcel_code={code}',
  ES: 'https://www.inpost.es/seguimiento-del-envio/?exp={code}&language=ES',
};

const STATUS_MAP = {
  created: 'registered', confirmed: 'registered', dispatched_by_sender: 'registered', dispatched_by_sender_to_pok: 'registered',
  taken_by_courier: 'in_transit', taken_by_courier_from_pok: 'in_transit', collected_from_sender: 'in_transit',
  adopted_at_source_branch: 'in_transit', sent_from_source_branch: 'in_transit', adopted_at_sorting_center: 'in_transit',
  sent_from_sorting_center: 'in_transit', adopted_at_target_branch: 'in_transit', redirect_to_box: 'in_transit',
  permanently_redirected_to_box_machine: 'in_transit', permanently_redirected_to_customer_service_point: 'in_transit', readdressed: 'in_transit',
  out_for_delivery: 'out_for_delivery', out_for_delivery_to_address: 'out_for_delivery',
  ready_to_pickup: 'at_pickup_point', ready_for_collection: 'at_pickup_point', ready_to_pickup_from_branch: 'at_pickup_point',
  ready_to_pickup_from_pok: 'at_pickup_point', ready_to_pickup_from_pok_registered: 'at_pickup_point', stack_in_box_machine: 'at_pickup_point',
  stack_in_customer_service_point: 'at_pickup_point', pickup_reminder_sent: 'at_pickup_point', pickup_reminder_sent_address: 'at_pickup_point',
  stack_parcel_in_box_machine_pickup_time_expired: 'at_pickup_point',
  delivered: 'delivered', collected_by_customer: 'delivered', claimed: 'delivered',
  returned_to_sender: 'returning', return_pickup_confirmation_to_sender: 'returning',
  delay_in_delivery: 'problem', delivery_attempt_failed: 'problem', rejected_by_receiver: 'problem', not_collected: 'problem',
  missing: 'problem', oversized: 'problem', canceled: 'problem', cancelled: 'problem', pickup_time_expired: 'problem',
  stack_parcel_pickup_time_expired: 'problem', avizo: 'problem', avizo_rejected: 'problem', undelivered: 'problem',
  undelivered_cod_cash_receiver: 'problem', undelivered_incomplete_address: 'problem', undelivered_lack_of_access_letterbox: 'problem',
  undelivered_no_mailbox: 'problem', undelivered_not_live_address: 'problem', undelivered_unknown_receiver: 'problem', undelivered_wrong_address: 'problem',
};
const STATUS_GROUP_MAP = { to_send: 'registered', in_delivery: 'in_transit', to_pickup: 'at_pickup_point', delivered: 'delivered' };
const IT_STATUS_MAP = {
  at_the_origin: 'registered', in_transit: 'in_transit', in_transit_last_mile: 'out_for_delivery', awaiting_collection: 'at_pickup_point',
  delivered: 'delivered', not_delivered: 'problem', exception: 'problem', return: 'returning',
};
const TRACKING_STATUS_MAP = {
  'CRE.1001': 'registered', 'FMD.1001': 'registered', 'FMD.1002': 'in_transit',
  'MMD.1001': 'in_transit', 'MMD.1002': 'in_transit', 'MMD.1003': 'in_transit', 'MMD.1004': 'in_transit',
  'LMD.1001': 'in_transit', 'LMD.1002': 'in_transit', 'LMD.3006': 'in_transit', 'LMD.3014': 'in_transit',
  'LMD.1004': 'at_pickup_point', 'LMD.1005': 'at_pickup_point', 'LMD.9001': 'at_pickup_point', 'LMD.9002': 'problem', 'LMD.9014': 'returning',
  'EOL.1001': 'delivered', 'EOL.1003': 'delivered', 'EOL.9001': 'problem', 'RTS.1001': 'returning', 'RTS.1002': 'returning',
};

const b64url = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function decodeJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return isObject(value) ? value : null;
  } catch (_) { return null; }
}

/* ------------------------------------------------------------- tracking -- */

async function fetchTracking(code) {
  const res = await request(`https://inposteasy.com/api/tracking/${encodeURIComponent(code)}?language=en`, { headers: { Accept: 'application/json' } }, { carrier: C, timeout: TIMEOUT });
  const text = await res.text();
  if (res.status === 404) return null;
  if (res.status !== 200) throw new CarrierError(`InPost tracking failed (HTTP ${res.status})`, { status: res.status, retryAfter: retryAfter(res) });
  const body = parseJson(text);
  if (!isObject(body)) throw new CarrierError('InPost returned an unexpected tracking response');
  if (body.status === 500 && !('trackingNumber' in body)) throw new CarrierError('InPost tracking is temporarily unavailable', { status: 500 });
  return body;
}

function normalizeTracking(raw, { code, country = 'GB' } = {}) {
  const r = isObject(raw) ? raw : {};
  const barcode = str(r.trackingNumber || code);
  const key = typeof r.status === 'string' ? r.status.toUpperCase() : '';
  const status = key ? (TRACKING_STATUS_MAP[key] || 'unknown') : 'unknown';
  const delivered = status === 'delivered';
  const details = Array.isArray(r.trackingDetails) ? r.trackingDetails : [];
  let deliveredAt = null;
  if (delivered) {
    for (const d of details) {
      const k = typeof d?.status === 'string' ? d.status.toUpperCase() : '';
      if (TRACKING_STATUS_MAP[k] === 'delivered' && parseTime(d.datetime) !== null) deliveredAt = toIso(d.datetime);
    }
  }
  const template = TRACKING_URL_BY_COUNTRY[String(country || '').toUpperCase()];
  return {
    barcode,
    sender: '',
    receiver: '',
    status,
    rawStatus: str(r.statusTitle || r.status),
    statusCode: key,
    statusDescription: str(r.statusDescription),
    delivered,
    deliveredAt,
    plannedFrom: null,
    plannedTo: null,
    windowKnown: false,
    pickup: status === 'at_pickup_point',
    pickupPoint: '',
    url: template && barcode ? template.replace('{code}', encodeURIComponent(barcode)) : '',
    weight: null,
    dimensions: null,
    history: sortHistory(details.filter(isObject).map(d => {
      const k = typeof d.status === 'string' ? d.status.toUpperCase() : '';
      return { timestamp: toIso(d.datetime), status: TRACKING_STATUS_MAP[k] || null, rawStatus: str(d.statusTitle || d.status) };
    })),
    direction: 'incoming',
    origin: str(r.origin?.countryCode),
    destination: str(r.destination?.countryCode),
    pending: !isObject(raw),
  };
}

/* -------------------------------------------------------------- account -- */

function signInLanguage(language, market) {
  const local = { PL: 'pl-PL', IT: 'it-IT' }[market];
  if (local && String(language || '').toLowerCase().startsWith(local.slice(0, 2))) return local;
  return 'en';
}

function authorizationUrl(market, language) {
  const verifier = b64url(crypto.randomBytes(64));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(24));
  const params = new URLSearchParams({
    response_type: 'code', client_id: OAUTH_CLIENT_ID, redirect_uri: OAUTH_REDIRECT_URI, scope: 'openid',
    code_challenge: challenge, code_challenge_method: 'S256', state, nonce: b64url(crypto.randomBytes(24)),
    response_mode: 'query', lang: signInLanguage(language, market), supported_markets: market,
  });
  return { url: `${OAUTH_AUTHORIZE_URL}?${params.toString()}`, verifier, state };
}

function parseCallback(value, expectedState) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { throw new CarrierError('Paste the complete https://account.inpost-group.com/callback?… address.'); }
  if (url.protocol !== 'https:' || url.host !== 'account.inpost-group.com' || url.pathname !== '/callback') throw new CarrierError('Paste the complete https://account.inpost-group.com/callback?… address.');
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.get('state') !== expectedState) throw new CarrierError('This sign-in belongs to an older attempt. Start the InPost sign-in again.');
  return code;
}

async function postOauth(form) {
  const res = await request(OAUTH_TOKEN_URL, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() }, { carrier: C, timeout: TIMEOUT });
  const body = parseJson(await res.text());
  if (res.status === 200 && isObject(body) && body.access_token) return body;
  if (res.status === 400 || res.status === 401) throw new CarrierError(`InPost rejected the sign-in (${body?.error || res.status})`, { status: res.status, auth: true });
  throw new CarrierError(`InPost sign-in failed (HTTP ${res.status})`, { status: res.status, retryAfter: retryAfter(res) });
}

async function exchangeCode(code, verifier, market) {
  const body = await postOauth({ grant_type: 'authorization_code', client_id: OAUTH_CLIENT_ID, redirect_uri: OAUTH_REDIRECT_URI, code_verifier: verifier, code });
  if (!body.refresh_token) throw new CarrierError('InPost did not return a refresh token');
  const claims = decodeJwt(body.access_token) || {};
  if (claims.market && claims.market !== market) throw new CarrierError(`This InPost account belongs to ${claims.market}, not ${market}. Sign out of InPost in your browser and try again.`);
  if (!/^\d+$/.test(String(claims.phone || ''))) throw new CarrierError('InPost did not identify the account (no phone number in the sign-in).');
  return { accessToken: body.access_token, refreshToken: body.refresh_token, phone: String(claims.phone), market };
}

class InPostAccountClient {
  constructor({ market = 'PL', accessToken, refreshToken, method = 'sso', onTokens = null }) {
    this.market = market;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.method = method;
    this.onTokens = onTokens;
    this._refreshing = null;
  }

  async refresh() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      if (!this.refreshToken) throw new CarrierError('Not signed in to InPost', { auth: true });
      if (this.method === 'sms') {
        const res = await request(AUTHENTICATE_URL, { method: 'POST', headers: BASE_HEADERS, body: JSON.stringify({ refreshToken: this.refreshToken, phoneOS: 'Android' }) }, { carrier: C, timeout: TIMEOUT });
        const body = parseJson(await res.text());
        if (res.status === 429) throw new CarrierError('InPost rate limit reached', { status: 429, retryAfter: retryAfter(res) });
        if (res.status !== 200 || !body?.authToken) throw new CarrierError('The InPost login has expired', { status: res.status, auth: true });
        this.accessToken = body.authToken;
        if (body.refreshToken) this.refreshToken = body.refreshToken;
      } else {
        const body = await postOauth({ grant_type: 'refresh_token', client_id: OAUTH_CLIENT_ID, refresh_token: this.refreshToken });
        this.accessToken = body.access_token;
        if (body.refresh_token) this.refreshToken = body.refresh_token;
      }
      if (typeof this.onTokens === 'function') this.onTokens({ accessToken: this.accessToken, refreshToken: this.refreshToken });
    })().finally(() => { this._refreshing = null; });
    return this._refreshing;
  }

  async _get(url) {
    const auth = () => ({ ...BASE_HEADERS, Authorization: this.method === 'sms' ? this.accessToken : `Bearer ${this.accessToken}` });
    let res = await request(url, { headers: auth() }, { carrier: C, timeout: TIMEOUT });
    if (res.status === 401) {
      await this.refresh();
      res = await request(url, { headers: auth() }, { carrier: C, timeout: TIMEOUT });
    }
    const text = await res.text();
    if (res.status !== 200) throw new CarrierError(`InPost request failed (HTTP ${res.status})`, { status: res.status, retryAfter: retryAfter(res) });
    const body = parseJson(text);
    if (!isObject(body)) throw new CarrierError('InPost returned an unexpected response');
    return body;
  }

  async parcels() {
    if (this.market === 'IT') {
      const out = [];
      let cursor = null;
      for (let page = 0; page < 10; page += 1) {
        const body = await this._get(`${IT_PARCELS_URL}?role=RECEIVER${cursor ? `&pagingState=${encodeURIComponent(cursor)}` : ''}`);
        if (!Array.isArray(body.parcels)) throw new CarrierError('InPost returned no parcel list');
        out.push(...body.parcels.filter(isObject));
        cursor = isObject(body.nextPage) ? body.nextPage.pagingState : null;
        if (!cursor) break;
      }
      return out;
    }
    const body = await this._get(PL_PARCELS_URL);
    if (!Array.isArray(body.parcels)) throw new CarrierError('InPost returned no parcel list');
    return body.parcels.filter(isObject);
  }
}

function personName(value) {
  if (isObject(value)) return str(value.name);
  return typeof value === 'string' ? str(value) : '';
}

function mapPl(status, group) {
  const key = status ? String(status).trim().toLowerCase() : '';
  if (key && STATUS_MAP[key]) return STATUS_MAP[key];
  const g = group ? STATUS_GROUP_MAP[String(group).trim().toLowerCase()] : null;
  return g || 'unknown';
}

function normalizePl(raw) {
  const status = mapPl(raw.status, raw.statusGroup);
  const delivered = status === 'delivered';
  const point = isObject(raw.pickUpPoint) ? raw.pickUpPoint : null;
  const addr = isObject(point?.addressDetails) ? point.addressDetails : {};
  const code = str(raw.shipmentNumber);
  return {
    barcode: code,
    sender: personName(raw.sender),
    receiver: personName(raw.receiver),
    status,
    rawStatus: str(raw.status).replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()),
    statusCode: str(raw.status),
    delivered,
    deliveredAt: delivered ? toIso(raw.pickUpDate || raw.returnedToSenderDate) : null,
    plannedFrom: null,
    plannedTo: null,
    windowKnown: false,
    pickup: status === 'at_pickup_point' || Boolean(raw.operations?.collect) || Boolean(point),
    pickupPoint: str(point?.name) || str(point?.locationDescription),
    pickupAddress: [addr.street, [addr.postCode, addr.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || str(point?.locationDescription),
    pickupCode: status === 'at_pickup_point' ? str(raw.openCode) : '',
    pickupDeadline: status === 'at_pickup_point' ? toIso(raw.expiryDate) : null,
    url: code ? `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(code)}` : '',
    weight: null,
    dimensions: raw.parcelSize ? { text: `Size ${raw.parcelSize}` } : null,
    history: sortHistory((Array.isArray(raw.eventLog) ? raw.eventLog : []).filter(isObject).map(e => ({
      timestamp: toIso(e.date),
      status: e.name ? (STATUS_MAP[String(e.name).trim().toLowerCase()] || null) : null,
      rawStatus: str(e.name).replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()),
    })).filter(e => e.timestamp)),
    direction: 'incoming',
  };
}

function normalizeIt(raw) {
  const events = (Array.isArray(raw.events) ? raw.events : []).filter(isObject)
    .map(e => [parseTime(toIso(e.eventTime)), e])
    .sort((a, b) => (a[0] === null ? -1 : b[0] === null ? 1 : a[0] - b[0]))
    .map(([, e]) => e);
  const latest = events[events.length - 1] || {};
  const key = typeof latest.status === 'string' ? latest.status.trim().toLowerCase() : '';
  const status = IT_STATUS_MAP[key] || 'unknown';
  const delivered = status === 'delivered';
  const loc = raw.pickUp?.location?.point;
  const pickupPoint = typeof loc === 'string' ? str(loc) : (isObject(loc) ? str(loc.name || loc.id || loc.description) : '');
  const code = str(raw.primaryParcelNumber);
  return {
    barcode: code,
    sender: str(raw.sender?.representativeName),
    receiver: str(raw.receiver?.representativeName),
    status,
    rawStatus: str(latest.status).replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) || str(latest.eventCode),
    statusCode: str(latest.eventCode || latest.status),
    delivered,
    deliveredAt: delivered ? toIso(latest.eventTime) : null,
    plannedFrom: null,
    plannedTo: null,
    windowKnown: false,
    pickup: status === 'at_pickup_point' || Boolean(pickupPoint),
    pickupPoint,
    url: code ? `https://inpost.it/trova-il-tuo-pacco?number=${encodeURIComponent(code)}` : '',
    weight: null,
    dimensions: null,
    history: events.map(e => {
      const k = typeof e.status === 'string' ? e.status.trim().toLowerCase() : '';
      return { timestamp: toIso(e.eventTime), status: IT_STATUS_MAP[k] || null, rawStatus: str(e.eventCode || e.status) };
    }).slice(-20),
    direction: 'incoming',
  };
}

module.exports = {
  COUNTRIES, ACCOUNT_MARKETS, fetchTracking, normalizeTracking, authorizationUrl, parseCallback, exchangeCode,
  InPostAccountClient, normalizePl, normalizeIt, TRACKING_STATUS_MAP, STATUS_MAP,
};
