'use strict';

/*
 * DPD account tracking — three backends behind one canonical parcel model.
 *
 *   general  myDPD (dpdgroup.com) for NL, BE, FR, LU, CH, CZ, SK, SI, HR, HU, EE, LV, LT, AR,
 *            Portugal (Chronopost), Italy (BRT) and the UK (via the NL backend).
 *            Keycloak -> guest token -> consignee-SSO; the account token is reused
 *            until DPD rejects it.
 *   de       DPD Germany Paketnavigator (SOAP) with the account e-mail and password.
 *   pl       DPD Polska mobile backend: one SMS code, then a rotating refresh token.
 *
 * Endpoint knowledge, status maps and parsing are ported from ha-dpd:
 *
 * MIT License
 *
 * Copyright (c) 2026 ha-dpd contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const crypto = require('crypto');

const STATUS = Object.freeze({
  REGISTERED: 'registered',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  AT_PICKUP_POINT: 'at_pickup_point',
  DELIVERED: 'delivered',
  RETURNING: 'returning',
  PROBLEM: 'problem',
  UNKNOWN: 'unknown',
});
const HISTORY_MAX_EVENTS = 20;
const REQUEST_TIMEOUT_MS = 25000;

/* ------------------------------------------------------------ countries -- */

const COUNTRIES = [
  { code: 'DPD-NL', backend: 'general', name: ['Netherlands', 'Nederland', 'Niederlande', 'Pays-Bas'] },
  { code: 'DPD-BE', backend: 'general', name: ['Belgium', 'België', 'Belgien', 'Belgique'] },
  { code: 'DPD-DE', backend: 'de', name: ['Germany', 'Duitsland', 'Deutschland', 'Allemagne'] },
  { code: 'DPD-LU', backend: 'general', name: ['Luxembourg', 'Luxemburg', 'Luxemburg', 'Luxembourg'] },
  { code: 'DPD-FR', backend: 'general', name: ['France', 'Frankrijk', 'Frankreich', 'France'] },
  { code: 'DPD-CH', backend: 'general', name: ['Switzerland', 'Zwitserland', 'Schweiz', 'Suisse'] },
  { code: 'DPD-UK', backend: 'general', name: ['United Kingdom', 'Verenigd Koninkrijk', 'Vereinigtes Königreich', 'Royaume-Uni'] },
  { code: 'BRT', backend: 'general', name: ['Italy (BRT)', 'Italië (BRT)', 'Italien (BRT)', 'Italie (BRT)'] },
  { code: 'CHR-PT', backend: 'general', name: ['Portugal', 'Portugal', 'Portugal', 'Portugal'] },
  { code: 'DPD-PL', backend: 'pl', name: ['Poland', 'Polen', 'Polen', 'Pologne'] },
  { code: 'DPD-CZ', backend: 'general', name: ['Czech Republic', 'Tsjechië', 'Tschechien', 'République tchèque'] },
  { code: 'DPD-SK', backend: 'general', name: ['Slovakia', 'Slowakije', 'Slowakei', 'Slovaquie'] },
  { code: 'DPD-HU', backend: 'general', name: ['Hungary', 'Hongarije', 'Ungarn', 'Hongrie'] },
  { code: 'DPD-SI', backend: 'general', name: ['Slovenia', 'Slovenië', 'Slowenien', 'Slovénie'] },
  { code: 'DPD-HR', backend: 'general', name: ['Croatia', 'Kroatië', 'Kroatien', 'Croatie'] },
  { code: 'DPD-EE', backend: 'general', name: ['Estonia', 'Estland', 'Estland', 'Estonie'] },
  { code: 'DPD-LV', backend: 'general', name: ['Latvia', 'Letland', 'Lettland', 'Lettonie'] },
  { code: 'DPD-LT', backend: 'general', name: ['Lithuania', 'Litouwen', 'Litauen', 'Lituanie'] },
  { code: 'DPD-AR', backend: 'general', name: ['Argentina', 'Argentinië', 'Argentinien', 'Argentine'] },
];
const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map(c => [c.code, c]));
const BU_API_OVERRIDES = { 'DPD-UK': 'DPD-NL' };
const BU_COUNTRY_OVERRIDES = { 'CHR-PT': 'pt', 'DPD-UK': 'nl' };
const BU_TRACKING_URL_OVERRIDES = { BRT: 'https://www.mybrt.it/it/mybrt/my-parcels/incoming?parcelNumber={parcel_number}' };

function backendFor(bu) {
  return (COUNTRY_BY_CODE[bu] || COUNTRY_BY_CODE['DPD-NL']).backend;
}

/* --------------------------------------------------------------- errors -- */

class DpdAuthError extends Error {
  constructor(message) { super(message); this.name = 'DpdAuthError'; this.auth = true; }
}
class DpdApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'DpdApiError'; this.status = status; }
}

/* -------------------------------------------------------------- helpers -- */

async function request(url, { method = 'GET', headers = {}, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await response.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (_) { json = null; } }
    return { status: response.status, text, json };
  } catch (error) {
    if (error.name === 'AbortError') throw new DpdApiError('DPD did not respond in time', 0);
    throw new DpdApiError(`DPD is unreachable: ${error.message}`, 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Convert a wall-clock date/time in an IANA zone to a UTC ISO string. */
function zonedToIso(date, time = '00:00:00', timeZone = 'UTC') {
  const d = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const t = String(time || '00:00:00').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!d || !t) return null;
  const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +(t[3] || 0));
  let offset = 0;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(guess));
    const get = type => Number(parts.find(p => p.type === type)?.value || 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    offset = asUtc - guess;
  } catch (_) { offset = 0; }
  return new Date(guess - offset).toISOString();
}

function isoWithZone(value, timeZone) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const m = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/);
  if (!m) return null;
  return zonedToIso(m[1], m[2] || '00:00:00', timeZone || 'UTC');
}

function dimensions(length, width, height) {
  const nums = [length, width, height].map(v => (v === null || v === undefined || v === '' ? null : Number(v)));
  if (!nums.some(v => v)) return null;
  const known = nums.every(v => v !== null && Number.isFinite(v));
  return { length: nums[0], width: nums[1], height: nums[2], text: known ? `${Math.round(nums[0])} x ${Math.round(nums[1])} x ${Math.round(nums[2])} cm` : null };
}

function sortHistory(entries) {
  return entries
    .filter(entry => entry && entry.timestamp)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    .slice(-HISTORY_MAX_EVENTS);
}

function base(barcode, direction) {
  return {
    carrier: 'DPD',
    barcode: barcode ? String(barcode) : null,
    direction,
    sender: null,
    receiver: null,
    status: STATUS.UNKNOWN,
    rawStatus: null,
    delivered: false,
    deliveredAt: null,
    plannedFrom: null,
    plannedTo: null,
    windowKnown: false,
    pickup: false,
    pickupPoint: null,
    deliveryType: null,
    url: null,
    weight: null,
    dimensions: null,
    history: [],
  };
}

/* ======================================================== GENERAL myDPD == */

const KEYCLOAK_TOKEN_URL = 'https://login.dpdgroup.com/auth/realms/login/protocol/openid-connect/token';
const DPD_BASE_URL = 'https://www.dpdgroup.com/concept/webservice';
const DPD_BASIC_TOKEN = 'bXlEUEQgTW9iaWxlIEFwcDpaMVdzeTQ4RGpseWcweDdVWjhvWTlYdmZIT2xIbW4yTmpJdnYycmpVVjY3N1hDOGhiTGlkNHY2OWpCQzlvZnpU';
const USER_AGENT = 'okhttp/4.12.0';
const UK_REFERENCE_URL = 'https://apis.track.dpd.co.uk/v1/reference';
const UK_TRACKING_URL = 'https://track.dpd.co.uk/parcels';

const DESCRIPTION_MAP = {
  ORDER_CREATED: STATUS.REGISTERED,
  PARCEL_HANDED: STATUS.IN_TRANSIT,
  IN_TRANSIT: STATUS.IN_TRANSIT,
  AT_DELIVERY_CENTER: STATUS.IN_TRANSIT,
  PARCEL_OUT_FOR_DELIVERY: STATUS.OUT_FOR_DELIVERY,
  AVAILABLE_FOR_COLLECTION: STATUS.AT_PICKUP_POINT,
  UNSUCCESSFUL_DELIVERY_ATTEMPTED: STATUS.IN_TRANSIT,
  RETURN_TO_SENDER: STATUS.RETURNING,
  DELIVERED: STATUS.DELIVERED,
};

const EVENT_TYPE_MAP = {
  ENA: STATUS.REGISTERED,
  ORI: STATUS.IN_TRANSIT, ORW: STATUS.IN_TRANSIT, HUI: STATUS.IN_TRANSIT, HUS: STATUS.IN_TRANSIT, HUW: STATUS.IN_TRANSIT, HUZ: STATUS.IN_TRANSIT,
  SPE: STATUS.IN_TRANSIT, SPL: STATUS.IN_TRANSIT, SPS: STATUS.IN_TRANSIT, SPV: STATUS.IN_TRANSIT, SPW: STATUS.IN_TRANSIT, SPZ: STATUS.IN_TRANSIT,
  DLI: STATUS.IN_TRANSIT, DLS: STATUS.IN_TRANSIT, DLW: STATUS.IN_TRANSIT, DLZ: STATUS.IN_TRANSIT, DLR: STATUS.IN_TRANSIT, MSDLO: STATUS.IN_TRANSIT,
  DLO: STATUS.OUT_FOR_DELIVERY,
  DEHD: STATUS.IN_TRANSIT, DEHDY: STATUS.IN_TRANSIT, DOMSDLO: STATUS.IN_TRANSIT, DOPKY: STATUS.IN_TRANSIT,
  DODEI: STATUS.AT_PICKUP_POINT,
  DEY: STATUS.DELIVERED, DEYY: STATUS.DELIVERED, DODEY: STATUS.DELIVERED, DODEYY: STATUS.DELIVERED,
  SPR: STATUS.RETURNING, DEN: STATUS.RETURNING, DODEN: STATUS.RETURNING, DODEH: STATUS.RETURNING,
  ENX: STATUS.PROBLEM, ORX: STATUS.PROBLEM, HUX: STATUS.PROBLEM, SPX: STATUS.PROBLEM, DLX: STATUS.PROBLEM, DEX: STATUS.PROBLEM, DODEX: STATUS.PROBLEM,
};

function generalTrackingUrl(parcelNumber, bu) {
  if (!parcelNumber) return null;
  const override = BU_TRACKING_URL_OVERRIDES[bu];
  if (override) return override.replace('{parcel_number}', encodeURIComponent(parcelNumber));
  const country = BU_COUNTRY_OVERRIDES[bu] || String(bu || 'DPD-NL').replace(/^DPD-/, '').toLowerCase();
  return `https://www.dpdgroup.com/${country}/mydpd/my-parcels/search?parcelNumber=${encodeURIComponent(parcelNumber)}`;
}

/** Planned window from the FMP block or the top-level fields, as UTC ISO strings. */
function generalPlannedWindow(shipment) {
  const tz = shipment?.status?.eventDateAndTimeZoneId || 'UTC';
  const fmp = shipment?.fmpDeliveryDateAndTime || {};
  const range = fmp.timeRange || {};
  if (fmp.deliveryDate && range.from && range.to) {
    return { from: zonedToIso(fmp.deliveryDate, range.from, tz), to: zonedToIso(fmp.deliveryDate, range.to, tz), windowKnown: true };
  }
  if (!shipment?.deliveryDate) return { from: null, to: null, windowKnown: false };
  if (shipment.deliveryTimeFrom && shipment.deliveryTimeTo) {
    return { from: zonedToIso(shipment.deliveryDate, shipment.deliveryTimeFrom, tz), to: zonedToIso(shipment.deliveryDate, shipment.deliveryTimeTo, tz), windowKnown: true };
  }
  return { from: zonedToIso(shipment.deliveryDate, '00:00:00', tz), to: zonedToIso(shipment.deliveryDate, '23:59:59', tz), windowKnown: false };
}

function generalDeliveredAt(shipment) {
  const status = shipment?.status || {};
  if (status.eventDateAndTime) return isoWithZone(status.eventDateAndTime, status.eventDateAndTimeZoneId || 'UTC');
  if (shipment?.deliveryDate) return zonedToIso(shipment.deliveryDate, '00:00:00', 'UTC');
  return null;
}

function generalHistory(events) {
  return sortHistory((Array.isArray(events) ? events : []).filter(e => e && e.date && e.time).map(event => ({
    timestamp: `${event.date}T${event.time}`,
    status: EVENT_TYPE_MAP[String(event.eventType || '').toUpperCase()] || null,
    rawStatus: event.eventTypeText || null,
  })));
}

/**
 * @param {object} shipment entry of incomingShipments / sendingShipments
 * @param {object} extra { detail, bu, ukCode, direction }
 */
function normalizeGeneral(shipment, { detail = null, bu = 'DPD-NL', ukCode = null, direction = 'incoming' } = {}) {
  const description = shipment?.status?.description || null;
  const delivered = description === 'DELIVERED';
  const deliveryType = shipment?.status?.deliveryType ? String(shipment.status.deliveryType).toUpperCase() : null;
  const isPickup = deliveryType === 'PARCELSHOP';
  const receiverName = detail?.receiver?.name || null;
  const parcel = base(shipment?.parcelNumber, direction);
  const window = delivered ? { from: null, to: null, windowKnown: false } : generalPlannedWindow(shipment);
  const weight = detail?.weight === undefined || detail?.weight === null || detail?.weight === '' ? null : Number(detail.weight);
  const dims = detail?.dimensions && typeof detail.dimensions === 'object' ? dimensions(detail.dimensions.length, detail.dimensions.width, detail.dimensions.height) : null;
  Object.assign(parcel, {
    sender: shipment?.senderName || null,
    receiver: isPickup ? null : receiverName,
    status: DESCRIPTION_MAP[description] || STATUS.UNKNOWN,
    rawStatus: description,
    delivered,
    deliveredAt: delivered ? generalDeliveredAt(shipment) : null,
    plannedFrom: window.from,
    plannedTo: window.to,
    windowKnown: window.windowKnown,
    pickup: isPickup,
    pickupPoint: isPickup ? receiverName : null,
    deliveryType,
    url: ukCode ? `${UK_TRACKING_URL}/${encodeURIComponent(ukCode)}` : generalTrackingUrl(shipment?.parcelNumber, bu),
    weight: Number.isFinite(weight) ? weight : null,
    dimensions: dims,
    history: generalHistory(detail?.parcelEvents),
    shipmentBUCode: shipment?.shipmentBUCode || null,
  });
  return parcel;
}

function fmpHashcode(shipment) {
  const rows = shipment?.availableActions?.FOLLOW_MY_PARCEL;
  const hash = Array.isArray(rows) && rows[0] ? rows[0].hashcode : null;
  return typeof hash === 'string' && hash ? hash : null;
}

class DpdGeneralClient {
  constructor({ email, password, bu = 'DPD-NL' }) {
    this.email = email || '';
    this.password = password || '';
    this.bu = bu;
    this.requestBu = BU_API_OVERRIDES[bu] || bu;
    this.token = null;
    this._loginPromise = null;
  }

  async login() {
    if (this._loginPromise) return this._loginPromise;
    this._loginPromise = this._login().finally(() => { this._loginPromise = null; });
    return this._loginPromise;
  }

  async _login() {
    if (!this.email || !this.password) throw new DpdAuthError('DPD e-mail and password are required');
    const kc = await request(KEYCLOAK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: new URLSearchParams({ client_id: 'MOBILE-APP-PROD', grant_type: 'password', scope: 'openid', username: this.email, password: this.password }).toString(),
    });
    if (kc.status >= 500) throw new DpdApiError(`DPD login HTTP ${kc.status}`, kc.status);
    if (!kc.json?.access_token) throw new DpdAuthError(`DPD login failed: ${kc.json?.error_description || kc.json?.error || kc.status}`);
    const guest = await request(`${DPD_BASE_URL}/oauth/token?grant_type=client_credentials`, {
      method: 'POST', headers: { Authorization: `Basic ${DPD_BASIC_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    });
    if (guest.status >= 500) throw new DpdApiError(`DPD guest token HTTP ${guest.status}`, guest.status);
    if (!guest.json?.access_token) throw new DpdAuthError('DPD guest token request did not return a token');
    const sso = await request(`${DPD_BASE_URL}/users/login/consignee-sso?bu=${encodeURIComponent(this.requestBu)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${guest.json.access_token}`, 'Content-Type': 'text/plain', 'User-Agent': USER_AGENT }, body: kc.json.access_token,
    });
    if (sso.status >= 500) throw new DpdApiError(`DPD consignee-sso HTTP ${sso.status}`, sso.status);
    if (!sso.json?.access_token) throw new DpdAuthError('DPD consignee-sso did not return a token');
    this.token = sso.json.access_token;
    return this.token;
  }

  async _authorized(url, options = {}) {
    if (!this.token) await this.login();
    const call = () => request(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${this.token}`, 'User-Agent': USER_AGENT } });
    let res = await call();
    if (res.status === 401 || res.status === 403) {
      this.token = null;
      await this.login();
      res = await call();
    }
    return res;
  }

  async getParcels() {
    const res = await this._authorized(`${DPD_BASE_URL}/v7/parcels?bu=${encodeURIComponent(this.requestBu)}&lang=en`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incomingParcels: [], sendingParcels: [], confirmedParcels: null, shipmentCollections: [], confirmedShipmentCollections: null }),
    });
    if (res.status === 401 || res.status === 403) throw new DpdAuthError('DPD rejected the account token');
    if (res.status !== 200 || !res.json) throw new DpdApiError(`DPD parcels HTTP ${res.status}`, res.status);
    return {
      incoming: Array.isArray(res.json.incomingShipments) ? res.json.incomingShipments : [],
      outgoing: Array.isArray(res.json.sendingShipments) ? res.json.sendingShipments : [],
    };
  }

  async getDetail(parcelNumber, { shipmentBUCode = '', parcelType = 'INCOMING' } = {}) {
    const params = new URLSearchParams({ parcelType, businessUnit: this.requestBu, lang: 'en', continueWithoutVerification: 'false' });
    if (shipmentBUCode) params.set('shipmentBUCode', shipmentBUCode);
    try {
      const res = await this._authorized(`${DPD_BASE_URL}/v10/parcels/details/${encodeURIComponent(parcelNumber)}?${params}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      return res.status === 200 ? res.json : null;
    } catch (_) { return null; }
  }

  async getFmpWindow(hashcode) {
    if (!hashcode) return null;
    try {
      const auth = await this._authorized(`${DPD_BASE_URL}/fmp/authenticate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authMethod: 'HASHCODE', credentials: hashcode }),
      });
      if (auth.status !== 200 || !auth.json?.access_token) return null;
      const shipment = await request(`${DPD_BASE_URL}/v3/fmp/shipment?lang=en`, {
        headers: { Authorization: `Bearer ${auth.json.access_token}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      });
      const delivery = shipment.status === 200 ? shipment.json?.deliveryDateAndTime : null;
      return delivery && typeof delivery === 'object' ? delivery : null;
    } catch (_) { return null; }
  }

  async getUkTrackingCode(parcelNumber) {
    try {
      const res = await request(`${UK_REFERENCE_URL}?origin=PRTK&postcode=&referenceNumber=${encodeURIComponent(parcelNumber)}`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      });
      const data = res.status === 200 ? res.json?.data : null;
      return Array.isArray(data) && data[0]?.parcelCode ? data[0].parcelCode : null;
    } catch (_) { return null; }
  }
}

/* ========================================================== GERMANY (de) == */

const DE_SOAP_URL = 'https://api.paketnavigator.de/services/v1/Navigator3Service.asmx';
const DE_NS = 'https://cloud.dpd.com/';
const DE_PARTNER_NAME = 'Android Paketnavigator3';
const DE_PARTNER_TOKEN = 'A33363237662F5945576';
const DE_PARTNER_SECRET = '272 WetFd2mpXrgD';
const DE_USER_AGENT = 'ksoap2-android/2.6.0+';
const DE_SESSION_ERRORS = new Set(['ERROR_SESSION_NOT_VALID', 'ERROR_KEYPHASE']);

function computeKeyPhase(nowUtc, cloudUserId, methodName) {
  const p = (nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes() + 1000) * 3;
  const digest = crypto.createHash('md5').update(`${p}${DE_PARTNER_NAME}${cloudUserId}${methodName}${DE_PARTNER_SECRET}`, 'utf8').digest('base64');
  return `${p}${digest.slice(0, 16)}`;
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dictToXml(data) {
  let out = '';
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      for (const item of value) out += item && typeof item === 'object' ? `<${key}>${dictToXml(item)}</${key}>` : `<${key}>${xmlEscape(typeof item === 'boolean' ? String(item) : item)}</${key}>`;
    } else if (value && typeof value === 'object') {
      out += `<${key}>${dictToXml(value)}</${key}>`;
    } else if (value === null || value === undefined) {
      out += `<${key} />`;
    } else {
      out += `<${key}>${xmlEscape(typeof value === 'boolean' ? (value ? 'true' : 'false') : value)}</${key}>`;
    }
  }
  return out;
}

function buildEnvelope(methodName, fields) {
  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
    + `<soap:Body><${methodName} xmlns="${DE_NS}"><${methodName}Request xmlns="${DE_NS}">${dictToXml(fields)}</${methodName}Request></${methodName}></soap:Body></soap:Envelope>`;
}

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    return String.fromCodePoint(parseInt(k.slice(1), 10));
  });
}

/** Minimal XML -> tree parser for SOAP responses (elements, text, CDATA; attributes ignored). */
function parseXml(xml) {
  const root = { tag: '#root', children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    } else if (m[3]) {
      const node = { tag: m[3].includes(':') ? m[3].split(':').pop() : m[3], children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) {
      top.text += decodeEntities(m[6]);
    }
  }
  if (stack.length !== 1) throw new DpdApiError('DPD Germany returned malformed XML', 0);
  return root;
}

function nodeToValue(node) {
  if (!node.children.length) {
    const text = node.text.trim();
    if (!text) return null;
    if (text === 'true' || text === 'false') return text === 'true';
    return text;
  }
  const grouped = {};
  for (const child of node.children) {
    (grouped[child.tag] = grouped[child.tag] || []).push(nodeToValue(child));
  }
  const out = {};
  for (const [tag, values] of Object.entries(grouped)) out[tag] = values.length === 1 ? values[0] : values;
  return out;
}

function parseSoapResponse(methodName, xml) {
  const root = parseXml(xml);
  const envelope = root.children.find(c => c.tag === 'Envelope');
  const body = envelope?.children.find(c => c.tag === 'Body');
  if (!body || !body.children.length) return {};
  const parsed = nodeToValue(body.children[0]);
  if (!parsed || typeof parsed !== 'object') return {};
  const key = `${methodName}Result`;
  const keys = Object.keys(parsed);
  if (keys.length === 1 && keys[0] === key && parsed[key] && typeof parsed[key] === 'object') return parsed[key];
  return parsed;
}

function asList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.filter(v => v && typeof v === 'object');
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1) {
      const inner = value[keys[0]];
      if (Array.isArray(inner)) return inner.filter(v => v && typeof v === 'object');
      if (inner && typeof inner === 'object') return [inner];
      return [];
    }
    return [value];
  }
  return [];
}

function errorCodes(body) {
  const codes = new Set();
  for (const error of asList(body?.ErrorDataList)) if (error.ErrorCode) codes.add(error.ErrorCode);
  if (body?.ErrorCode) codes.add(body.ErrorCode);
  return codes;
}

class DpdDeClient {
  constructor({ email, password, hardwareId }) {
    this.email = email || '';
    this.password = password || '';
    this.hardwareId = hardwareId || crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    this.sessionToken = null;
    this.cloudUserId = '0';
  }

  _deviceData() {
    return { Version: '1', HardwareID: this.hardwareId, BootSystemID: 'Android_Phone', Name: 'Homey', AppVersion: '4.1.2', PushToken: '', AllowPushNotifications: false };
  }

  async _raw(methodName, fields, cloudUserId) {
    const envelope = buildEnvelope(methodName, {
      Version: 100,
      Language: 'de_DE',
      PartnerCredentials: { Name: DE_PARTNER_NAME, Token: DE_PARTNER_TOKEN, KeyPhase: computeKeyPhase(new Date(), cloudUserId, methodName) },
      ...fields,
    });
    const res = await request(DE_SOAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `${DE_NS}${methodName}`, Accept: 'text/xml', 'User-Agent': DE_USER_AGENT },
      body: envelope,
    });
    if (res.status !== 200 && res.status !== 500) throw new DpdApiError(`DPD Germany HTTP ${res.status}`, res.status);
    const body = parseSoapResponse(methodName, res.text || '');
    if (body.faultstring) throw new DpdApiError('DPD Germany SOAP fault', res.status);
    return body;
  }

  async login() {
    if (!this.email || !this.password) throw new DpdAuthError('DPD e-mail and password are required');
    const anon = await this._raw('getSessionFullState', { SessionToken: '', DeviceData: this._deviceData() }, '0');
    const anonToken = anon.SessionToken || anon.SessionFullState?.SessionToken;
    if (!anonToken) throw new DpdAuthError('DPD Germany did not return an anonymous session');
    const body = await this._raw('getUserLogin', { SessionToken: anonToken, UserName: this.email, UserPassword: this.password }, '0');
    if (errorCodes(body).size || body.Ack === false) throw new DpdAuthError(`DPD Germany login failed: ${[...errorCodes(body)].join(', ') || body.ErrorMsg || 'rejected'}`);
    const state = body.SessionFullState || body;
    const token = state.SessionToken || body.SessionToken;
    if (!token) throw new DpdAuthError('DPD Germany login did not return a session');
    this.sessionToken = token;
    const account = state.AccountData || {};
    const cloud = body.cloudUserID || body.CloudUserID || account.CloudUserID || account.cloudUserID;
    if (cloud) this.cloudUserId = String(cloud);
    return state;
  }

  async getSessionState() {
    if (!this.sessionToken) return this.login();
    const body = await this._raw('getSessionFullState', { SessionToken: this.sessionToken, DeviceData: this._deviceData() }, this.cloudUserId);
    const codes = errorCodes(body);
    if ([...codes].some(code => DE_SESSION_ERRORS.has(code))) {
      this.sessionToken = null;
      return this.login();
    }
    const state = body.SessionFullState || {};
    if (state.SessionToken) this.sessionToken = state.SessionToken;
    return state;
  }

  async getParcels() {
    const state = await this.getSessionState();
    return {
      incoming: asList(state.ReceiveTrackingDataList),
      outgoing: [...asList(state.SendTrackingDataList), ...asList(state.ReturnTrackingDataList)],
    };
  }
}

const DE_STATUS_ID_MAP = { DELIVERED: STATUS.DELIVERED, OUT_FOR_DELIVERY: STATUS.OUT_FOR_DELIVERY, DELIVERY_ATTEMPT: STATUS.PROBLEM, RETURN_TO_SENDER: STATUS.RETURNING, NO_TRACKINGDATA: STATUS.REGISTERED };
const DE_SHOP_STATUS_MAP = { parcel_pickedup_by_consignee: STATUS.DELIVERED, parcel_in_shop: STATUS.AT_PICKUP_POINT, newdelivery_in_progress: STATUS.IN_TRANSIT };
const DE_CONTAINER_SLOTS = [['Delivered', STATUS.DELIVERED], ['CarLoad', STATUS.OUT_FOR_DELIVERY], ['DeliveryDepot', STATUS.IN_TRANSIT], ['OnTheRoad', STATUS.IN_TRANSIT], ['Start', STATUS.REGISTERED]];
const truthy = value => value === true || value === 'true' || value === '1' || value === 1;

function mapStatusDe(raw) {
  if (raw.ParcelFlowTypeID === 'returning') return STATUS.RETURNING;
  if (raw.Delivered === true) return STATUS.DELIVERED;
  const shopStatus = raw.DeliveryParcelShop?.ParcelStatus;
  if (DE_SHOP_STATUS_MAP[shopStatus]) return DE_SHOP_STATUS_MAP[shopStatus];
  const statusId = raw.LastStatusInfo?.StatusID;
  if (statusId && DE_STATUS_ID_MAP[statusId]) return DE_STATUS_ID_MAP[statusId];
  const container = raw.StatusInfoContainer || {};
  for (const [slot, status] of DE_CONTAINER_SLOTS) {
    if (container[slot] && typeof container[slot] === 'object' && truthy(container[slot].StatusReached)) return status;
  }
  if (raw.isDelayed || raw.showWarning) return STATUS.PROBLEM;
  return STATUS.UNKNOWN;
}

function deAddressName(address) {
  if (!address || typeof address !== 'object') return null;
  if (address.Company) return address.Company;
  const combined = `${address.FirstName || ''} ${address.LastName || ''}`.trim();
  return combined || address.Name || null;
}

function deStatusDate(value) {
  const m = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})$/);
  return m ? zonedToIso(`${m[3]}-${m[2]}-${m[1]}`, `${m[4]}:${m[5]}:00`, 'Europe/Berlin') : null;
}

const toFloat = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function normalizeDe(raw, { direction = 'incoming' } = {}) {
  const last = raw.LastStatusInfo || {};
  const statusDate = deStatusDate(last.StatusDate);
  const delivered = raw.Delivered === true;
  const order = raw.OrderInfo || {};
  let plannedFrom = null;
  let plannedTo = null;
  if (!delivered && truthy(order.EstimatedDeliveryDateTimeSpecified)) {
    plannedFrom = isoWithZone(order.EstimatedDeliveryDateTimeFrom, 'UTC');
    plannedTo = isoWithZone(order.EstimatedDeliveryDateTimeTo, 'UTC');
  }
  const newDelivery = raw.NewDeliveryInfo || {};
  if (!delivered && truthy(newDelivery.DateChanged) && newDelivery.PlannedDeliveryDate) {
    const redirected = isoWithZone(newDelivery.PlannedDeliveryDate, 'UTC');
    if (redirected) plannedTo = redirected;
  }
  const shop = raw.DeliveryParcelShop || {};
  const isPickup = truthy(shop.isParcelShopDelivery);
  let length = toFloat(order.Length); let width = toFloat(order.Width); let height = toFloat(order.Height);
  if (![length, width, height].some(Boolean)) { length = toFloat(order.LengthByCustomer); width = toFloat(order.WidthByCustomer); height = toFloat(order.HeightByCustomer); }
  const dims = [length, width, height].some(Boolean) ? dimensions((length || 0) / 10, (width || 0) / 10, (height || 0) / 10) : null;
  const container = raw.StatusInfoContainer || {};
  const history = [];
  for (const [slot, status] of [...DE_CONTAINER_SLOTS].reverse()) {
    const info = container[slot];
    if (!info || typeof info !== 'object' || !truthy(info.StatusReached)) continue;
    const ts = deStatusDate(info.StatusDate);
    if (ts) history.push({ timestamp: ts, status, rawStatus: info.StatusText_Mobile || info.StatusID || null });
  }
  const parcel = base(raw.ParcelNo, direction);
  Object.assign(parcel, {
    sender: raw.ParcelFlowTypeID === 'sending' ? deAddressName(raw.SendParcelData?.PickupAddress) : null,
    receiver: deAddressName(raw.ShipAddress) || deAddressName(raw.LabelAddress) || order.ReceiverName || null,
    status: mapStatusDe(raw),
    rawStatus: last.StatusText_Mobile || last.StatusID || null,
    delivered,
    deliveredAt: delivered ? (statusDate || isoWithZone(raw.DeliveryDateTime, 'UTC')) : null,
    plannedFrom,
    plannedTo,
    windowKnown: Boolean(plannedFrom && plannedTo),
    pickup: isPickup,
    pickupPoint: isPickup ? deAddressName(shop.ParcelShop) : null,
    deliveryType: isPickup ? 'PARCELSHOP' : 'HOME',
    url: null,
    weight: toFloat(order.Weight),
    dimensions: dims,
    history: sortHistory(history),
  });
  return parcel;
}

/* =========================================================== POLAND (pl) == */

const PL_SSO_URL = 'https://dpdsso.dpd.com.pl';
const PL_API_URL = 'https://mobapp.dpd.com.pl';
const PL_CLIENT_ID = 'DPDClientMDU';
const PL_REDIRECT_URI = 'https://dpdsso.dpd.com.pl/landing-page?messageType=activeAccount';
const PL_TOKEN_URL = `${PL_SSO_URL}/auth/realms/DPD/protocol/openid-connect/token`;
const PL_MOBILE_HEADERS = { 'X-Mobile-Platform': 'android', 'X-Mobile-Version': '2.10.2' };
const PL_STATUS_MAP = {
  READY_TO_SEND: STATUS.REGISTERED,
  RECEIVED_FROM_SENDER: STATUS.IN_TRANSIT, SENT: STATUS.IN_TRANSIT, IN_TRANSPORT: STATUS.IN_TRANSIT, RECEIVED_IN_DEPOT: STATUS.IN_TRANSIT, REDIRECTED: STATUS.IN_TRANSIT, RESCHEDULED: STATUS.IN_TRANSIT,
  HANDED_OVER_FOR_DELIVERY: STATUS.OUT_FOR_DELIVERY,
  READY_TO_PICK_UP: STATUS.AT_PICKUP_POINT, SELF_PICKUP: STATUS.AT_PICKUP_POINT, HARD_RESERVED: STATUS.AT_PICKUP_POINT,
  DELIVERED: STATUS.DELIVERED, PICKED_UP: STATUS.DELIVERED,
  RETURNED_TO_SENDER: STATUS.RETURNING, EXPIRED_PICKUP: STATUS.RETURNING,
  UNSUCCESSFUL_DELIVERY: STATUS.PROBLEM,
};
const PL_FINAL = new Set(['DELIVERED', 'PICKED_UP', 'RETURNED_TO_SENDER', 'EXPIRED_PICKUP']);

function normalizePolishPhone(value) {
  let digits = String(value || '').replace(/[\s-]/g, '');
  if (digits.startsWith('+48')) digits = digits.slice(3);
  else if (digits.startsWith('0048')) digits = digits.slice(4);
  return /^\d{9}$/.test(digits) ? digits : null;
}

const plIso = value => (typeof value === 'string' && value ? isoWithZone(value, 'Europe/Warsaw') : null);

function normalizePl(raw) {
  const rawStatus = raw?.main_status && typeof raw.main_status === 'object' ? raw.main_status.status || null : null;
  const status = PL_STATUS_MAP[rawStatus] || STATUS.UNKNOWN;
  const delivery = raw?.delivery && typeof raw.delivery === 'object' ? raw.delivery : {};
  const statuses = Array.isArray(raw?.statuses) ? raw.statuses : [];
  const parcel = base(raw?.waybill, 'incoming');
  const planned = plIso(delivery.planned_delivery_date || raw?.planned_delivery_date);
  Object.assign(parcel, {
    carrier: 'DPD Polska',
    sender: raw?.sender?.name || null,
    status,
    rawStatus,
    delivered: status === STATUS.DELIVERED,
    deliveredAt: plIso(delivery.delivered_datetime),
    plannedFrom: status === STATUS.DELIVERED ? null : planned,
    windowKnown: false,
    pickup: status === STATUS.AT_PICKUP_POINT,
    history: sortHistory(statuses.filter(s => s && typeof s === 'object').map(s => ({
      timestamp: plIso(s.date || s.create_time || s.createTime),
      status: PL_STATUS_MAP[s.status] || null,
      rawStatus: s.status || null,
    }))),
  });
  return parcel;
}

class DpdPlClient {
  constructor({ refreshToken = null, onRefreshToken = null } = {}) {
    this.refreshToken = refreshToken;
    this.onRefreshToken = onRefreshToken;
    this.accessToken = null;
    this.expiresAt = 0;
  }

  static async sendSms(phone) {
    const number = normalizePolishPhone(phone);
    if (!number) throw new DpdAuthError('Enter a Polish nine-digit mobile number');
    const res = await request(`${PL_SSO_URL}/api/phone-verifications/${number}`, { method: 'PUT' });
    if ([400, 401, 403, 422].includes(res.status)) throw new DpdAuthError(`DPD Poland rejected the phone number (${res.status})`);
    if (res.status >= 300) throw new DpdApiError(`DPD Poland HTTP ${res.status}`, res.status);
    return number;
  }

  async register(phone, code) {
    const number = normalizePolishPhone(phone);
    const res = await request(`${PL_SSO_URL}/api/users?redirect_uri=${encodeURIComponent(PL_REDIRECT_URI)}&client_id=${PL_CLIENT_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailRegistration: null, phoneRegistration: { phone: number, code: String(code || '').trim() }, type: 'PhoneBasedUserRegistrationModel' }),
    });
    if ([400, 401, 403, 422].includes(res.status)) throw new DpdAuthError('DPD Poland rejected the SMS code');
    if (res.status >= 300) throw new DpdApiError(`DPD Poland HTTP ${res.status}`, res.status);
    if (!res.json?.code) throw new DpdAuthError('DPD Poland did not return an authorization code');
    await this._token({ grant_type: 'authorization_code', code: res.json.code, client_id: PL_CLIENT_ID });
    return this.refreshToken;
  }

  async _token(data) {
    const res = await request(PL_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });
    if ([400, 401, 403].includes(res.status)) throw new DpdAuthError(`DPD Poland rejected the ${data.grant_type} grant`);
    if (res.status >= 300) throw new DpdApiError(`DPD Poland HTTP ${res.status}`, res.status);
    if (!res.json?.access_token) throw new DpdAuthError('DPD Poland token response had no access token');
    this.accessToken = res.json.access_token;
    if (res.json.refresh_token && res.json.refresh_token !== this.refreshToken) {
      this.refreshToken = res.json.refresh_token;
      if (typeof this.onRefreshToken === 'function') this.onRefreshToken(this.refreshToken);
    }
    this.expiresAt = Date.now() + (Number(res.json.expires_in) || 300) * 1000;
  }

  async _authorized(method, url, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.accessToken || Date.now() >= this.expiresAt - 60000) {
        if (!this.refreshToken) throw new DpdAuthError('DPD Poland has no refresh token');
        await this._token({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: PL_CLIENT_ID });
      }
      const res = await request(url, {
        method,
        headers: { ...PL_MOBILE_HEADERS, Authorization: `Bearer ${this.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if ((res.status === 401 || res.status === 403) && attempt === 0) { this.accessToken = null; continue; }
      if (res.status === 401 || res.status === 403) throw new DpdAuthError('DPD Poland rejected refreshed credentials');
      if (res.status >= 300 || !res.json || typeof res.json !== 'object') throw new DpdApiError(`DPD Poland HTTP ${res.status}`, res.status);
      return res.json;
    }
    throw new DpdAuthError('DPD Poland authentication failed');
  }

  async getParcels() {
    const body = await this._authorized('POST', `${PL_API_URL}/mdupackageservices/api/v1/packages?userContext=RECEIVER`, { alias: null, sent: null });
    const packages = Array.isArray(body.packages) ? body.packages.filter(p => p && typeof p === 'object') : [];
    const out = [];
    for (const parcel of packages) {
      const status = parcel?.main_status?.status;
      if (parcel.waybill && !PL_FINAL.has(status)) {
        try { out.push({ ...parcel, ...(await this._authorized('GET', `${PL_API_URL}/mdupackageservices/api/v1/packages/${encodeURIComponent(String(parcel.waybill))}`)) }); continue; } catch (_) { /* use list entry */ }
      }
      out.push(parcel);
    }
    return { incoming: out, outgoing: [] };
  }
}

module.exports = {
  STATUS,
  COUNTRIES,
  COUNTRY_BY_CODE,
  backendFor,
  DpdAuthError,
  DpdApiError,
  DpdGeneralClient,
  DpdDeClient,
  DpdPlClient,
  normalizeGeneral,
  normalizeDe,
  normalizePl,
  fmpHashcode,
  normalizePolishPhone,
  computeKeyPhase,
  parseSoapResponse,
  buildEnvelope,
  zonedToIso,
  DESCRIPTION_MAP,
};
