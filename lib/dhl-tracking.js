'use strict';

/*
 * DHL tracking for MyParcel – modelled on the Home Assistant integrations
 * ha-dhl (https://github.com/ha-parcel-integrations/ha-dhl) and
 * ha-dhl-nl (https://github.com/ha-parcel-integrations/ha-dhl-nl).
 *
 * MIT License – Copyright (c) 2026 ha-parcel-integrations contributors.
 * Status vocabularies, endpoints and normalisation follow those projects;
 * the JavaScript port and Homey integration are part of MyParcel for Homey.
 *
 * Backends:
 *  - DHL eCommerce NL account  (my.dhlecommerce.nl)               → DhlNlClient
 *  - Keyless DHL Parcel gateway (api-gw.dhlparcel.nl)               → fetchGateway
 *  - DHL Express app backend    (dhle.dhl.com, 10-digit air waybill) → fetchExpress + ExpressBudget
 *  - DHL Paket DE account       (login.dhl.de OIDC + www.dhl.de)      → DhlDeSession / DhlDeClient
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
const S = STATUS;
const HISTORY_MAX_EVENTS = 20;
const TIMEOUT_MS = 30000;
const USER_AGENT = 'MyParcel Homey/0.3.4';

class DhlError extends Error {
  constructor(message, { status = null, auth = false, throttled = false } = {}) {
    super(message);
    this.status = status;
    this.auth = auth;
    this.throttled = throttled;
  }
}

async function request(fetchFn, url, options = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeout || TIMEOUT_MS) : null;
  try {
    return await fetchFn(url, { ...options, signal: controller?.signal });
  } catch (error) {
    throw new DhlError(`DHL is unreachable: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

function str(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function setCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(/,(?=\s*[A-Za-z0-9_.-]+=)/) : [];
}

class CookieJar {
  constructor(initial = {}) { this.cookies = { ...initial }; }
  absorb(res) {
    for (const line of setCookies(res)) {
      const [pair] = String(line).split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
    }
  }
  header() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
  get(name) { return this.cookies[name]; }
}

/* ======================================================================
 * DHL eCommerce NL (ha-dhl-nl) – status vocabulary
 * ==================================================================== */

const NL_STATUS_MAP = {
  PRENOTIFICATION_RECEIVED: S.REGISTERED,
  DATA_RECEIVED_WITH_PREFIX_LABEL: S.REGISTERED,
  OUT_FOR_DELIVERY: S.OUT_FOR_DELIVERY,
  LOAD_VEHICLE: S.OUT_FOR_DELIVERY,
  PARCEL_INTO_FALLBACK: S.OUT_FOR_DELIVERY,
  PARCEL_WILL_BE_DELIVERED_SOON: S.OUT_FOR_DELIVERY,
  NOTIFICATION_FOR_PARCELSHOP_COLLECTION_HAS_BEEN_SENT: S.AT_PICKUP_POINT,
  NOTIFICATION_FOR_PARCELSTATION_COLLECTION_HAS_BEEN_SENT: S.AT_PICKUP_POINT,
  AWAITING_RECEIVER_COLLECTION: S.AT_PICKUP_POINT,
  CLOSED_AWAITING_COLLECTION: S.AT_PICKUP_POINT,
  DELIVERED_AT_ACCESSPOINT: S.AT_PICKUP_POINT,
  DELIVERED_AT_PARCELSTATION: S.AT_PICKUP_POINT,
  DELIVERY_CODE_MISSING_PICK_UP: S.AT_PICKUP_POINT,
  ON_HOLD_FOR_COLLECTION: S.AT_PICKUP_POINT,
  PARCEL_FOUND_AT_PARCELSHOP: S.AT_PICKUP_POINT,
  PARCEL_HELD_FOR_COLLECTION_AT_LOCAL_DEPOT: S.AT_PICKUP_POINT,
  REMINDER_FOR_COLLECTION_SENT_EMAIL: S.AT_PICKUP_POINT,
  REMINDER_FOR_COLLECTION_SENT_LETTER: S.AT_PICKUP_POINT,
  REMINDER_FOR_COLLECTION_SENT_SMS: S.AT_PICKUP_POINT,
  COLLECTED_AT_PARCELSHOP: S.DELIVERED,
  COLLECTED_AT_ACCESSPOINT: S.DELIVERED,
  COLLECTED_AT_PARCELSTATION: S.DELIVERED,
  SHIPMENT_COLLECTED: S.DELIVERED,
  DELIVERED_AT_NEIGHBOURS: S.DELIVERED,
  DELIVERED_AT_PREFERED_NEIGHBOURS: S.DELIVERED,
  DELIVERED_AT_SAFEPLACE: S.DELIVERED,
  DELIVERED_IN_MAILBOX: S.DELIVERED,
  DELIVERED_DAMAGED: S.DELIVERED,
  DELIVERED_NOT_IN_TIME: S.DELIVERED,
  DELIVERED_NO_CODE_VALIDATION: S.DELIVERED,
  DELIVERED: S.DELIVERED,
  'INTERVENTION_RECEIVER_REQUESTS_DELIVERY_AT_ANOTHER_TIME/DATE': S.IN_TRANSIT,
  INTERVENTION_RECEIVER_REQUESTS_DELIVERY_AT_ACCESSPOINT: S.IN_TRANSIT,
  INTERVENTION_RECEIVER_REQUESTS_DELIVERY_AT_NEIGHBOURS: S.IN_TRANSIT,
  INTERVENTION_RECEIVER_REQUESTS_DELIVERY_AT_PARCELSHOP: S.IN_TRANSIT,
  INTERVENTION_RECEIVER_REQUESTS_DELIVERY_AT_PARCELSTATION: S.IN_TRANSIT,
  INTERVENTION_RECEIVER_REQUESTS_DELIVERY_AT_PREFERRED_NEIGHBOURS: S.IN_TRANSIT,
  PARCEL_ARRIVED_AT_LOCAL_DEPOT: S.IN_TRANSIT,
  PARCEL_SORTED_AT_HUB: S.IN_TRANSIT,
  PARCEL_PICKED_UP_AT_PARCELSHOP: S.IN_TRANSIT,
};
const NL_RETURNING = [
  'ADDRESS_UNKNOWN', 'CUSTOMS_DATA_INCORRECT_RETURN_TO_SHIPPER', 'DAMAGE_RETURN', 'DELIVERED_AT_SHIPPER',
  'DELIVERY_CODE_MISSING_RETURN', 'DELIVERY_DATA_INCORRECT_RETURN', 'EXPECTED_RETURN_DELIVERED_AT_SHIPPER_CALCULATED',
  'INTERVENTION_RECEIVER_REQUEST_DELIVERY_CANCELLED', 'INTERVENTION_REQUEST_CANCEL_INTERVENTION',
  'INTERVENTION_REQUEST_CANCEL_INTERVENTION_SUSPECTED_FRAUD', 'INTERVENTION_SHIPPER_REQUEST_DELIVERY_CANCELLED',
  'INVALID_SHIPMENT_SPECIFICATION_RETURN', 'MISROUTED_RETURN_TO_SHIPPER', 'NOT_HOME_RETURN_TO_SHIPPER', 'NO_MONEY_RETURN',
  'ON_ROUTE_TO_SHIPPER', 'PARCELSTATION_DELIVERY_UNSUCCESFULL_RETURN', 'PARCEL_ALREADY_RETURNED',
  'PARCEL_RELABELED_FOR_RETURN_TO_SHIPPER', 'PARCEL_SCANNED_AT_RETURN_HUB', 'PARCEL_SCANNED_FOR_RETURN_TO_HUB',
  'PARCEL_TOO_HEAVY_RETURN', 'PARCEL_TOO_LARGE_RETURN', 'POSTAL_CODE_INCORRECT', 'POSTPROCESS_DELIVERED_AT_SHIPPER',
  'POSTPROCESS_RETURN_CONSOLIDATION', 'POSTPROCESS_RETURN_CONSOLIDATION_DEPART', 'POSTPROCESS_RETURN_CONSOLIDATION_LOAD',
  'PO_BOX', 'RECEIVER_RETURN', 'RECEIVER_UNKNOWN_RETURN', 'REFUSED_AT_PARCELSHOP', 'REFUSED_BY_RECEIVER',
  'REFUSED_NOT_COLLECTED', 'REFUSED_RETURN', 'REFUSED_RETURN_TO_DD', 'RETURNED_NOT_COLLECTED', 'RETURNED_TO_SHIPPER',
  'RETURN_DELIVERED_AT_SHIPPER_CALCULATED', 'SPONTANEOUS_RETURN', 'STORAGE_PERIOD_ENDED_AT_ACCESSPOINT',
  'STORAGE_PERIOD_ENDED_AT_PARCELSHOP', 'STORAGE_PERIOD_ENDED_AT_PARCELSTATION', 'UNJUSTIFIED_SPONTANEOUS_RETURN',
];
// The account feed also lists these two as "returning"; on the keyless gateway they appear in the
// normal flow of a parcel dropped off at a ParcelShop, so ha-dhl leaves them out there.
const NL_ACCOUNT_ONLY_RETURNING = ['PARCEL_READY_FOR_RETURN_TO_HUB', 'PARCEL_RETURNED_FROM_ROUTE'];
for (const code of [...NL_RETURNING, ...NL_ACCOUNT_ONLY_RETURNING]) NL_STATUS_MAP[code] = S.RETURNING;
const GATEWAY_STATUS_MAP = { ...NL_STATUS_MAP };
for (const code of NL_ACCOUNT_ONLY_RETURNING) delete GATEWAY_STATUS_MAP[code];

const NL_CATEGORY_MAP = {
  DATA_RECEIVED: S.REGISTERED, LEG: S.REGISTERED, CUSTOMS: S.IN_TRANSIT, UNDERWAY: S.IN_TRANSIT,
  IN_DELIVERY: S.IN_TRANSIT, INTERVENTION: S.PROBLEM, EXCEPTION: S.PROBLEM, PROBLEM: S.PROBLEM, DELIVERED: S.DELIVERED,
};
// On the gateway IN_DELIVERY means "with the courier".
const GATEWAY_CATEGORY_MAP = { ...NL_CATEGORY_MAP, IN_DELIVERY: S.OUT_FOR_DELIVERY };
const NL_ACTIVE_CATEGORIES = new Set(['CUSTOMS', 'DATA_RECEIVED', 'EXCEPTION', 'IN_DELIVERY', 'INTERVENTION', 'LEG', 'PROBLEM', 'UNDERWAY', 'UNKNOWN']);

/** Readable text for a DHL eCommerce status code ("PARCEL_SORTED_AT_HUB" → "Parcel sorted at hub"). */
function codeText(code) {
  const text = str(code).replace(/[_/]+/g, ' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function mapNlStatus(status, category) {
  const mapped = NL_STATUS_MAP[status];
  if (mapped) {
    // A return that reached the shipper is finished: category DELIVERED wins.
    if (mapped === S.RETURNING && category === 'DELIVERED') return S.DELIVERED;
    return mapped;
  }
  return NL_CATEGORY_MAP[category] || S.UNKNOWN;
}

function mapNlEvent(key, phase) {
  if (key && NL_STATUS_MAP[key]) return NL_STATUS_MAP[key];
  return phase ? (NL_CATEGORY_MAP[phase] || null) : null;
}

function sortHistory(entries) {
  const parsed = [];
  const loose = [];
  for (const entry of entries) {
    if (!entry || !entry.timestamp) continue;
    const time = Date.parse(entry.timestamp);
    if (Number.isFinite(time)) parsed.push([time, entry]); else loose.push(entry);
  }
  parsed.sort((a, b) => a[0] - b[0]);
  return [...parsed.map(([, entry]) => entry), ...loose].slice(-HISTORY_MAX_EVENTS);
}

/** History from the my.dhlecommerce.nl track-trace response ([0].view.phases[].events[]). */
function buildNlHistory(trackTrace) {
  if (!trackTrace) return null;
  const first = Array.isArray(trackTrace) ? trackTrace[0] : trackTrace;
  const phases = first?.view?.phases;
  if (!Array.isArray(phases)) return null;
  const entries = [];
  for (const block of phases) {
    for (const event of block?.events || []) {
      if (!event?.timestamp) continue;
      entries.push({ timestamp: event.timestamp, status: mapNlEvent(event.key, block.phase), rawStatus: codeText(event.key), code: event.key || '' });
    }
  }
  return sortHistory(entries);
}

function nlWindow(raw) {
  const indication = raw?.receivingTimeIndication || {};
  if (indication.indicationType === 'MomentIndication') return [indication.moment || null, null];
  if (indication.indicationType === 'IntervalIndication') return [indication.start || null, indication.end || null];
  return [null, null];
}

function nlPostcode(raw) {
  return str(raw?.receiver?.address?.postalCode || raw?.destination?.address?.postalCode).replace(/\s+/g, '');
}

function nlUrl(raw) {
  const barcode = str(raw?.barcode);
  const postal = nlPostcode(raw);
  if (barcode && postal) return `https://my.dhlecommerce.nl/portal/tracktrace/${barcode}/${postal}`;
  return barcode ? `https://www.dhl.com/nl-nl/home/tracking.html?tracking-id=${encodeURIComponent(barcode)}` : '';
}

/** One parcel from receiver-parcel-api/parcels or api/orders/sentShipments. */
function normalizeNlAccount(raw, { direction = 'incoming', history = null } = {}) {
  const category = str(raw?.category);
  const statusCode = str(raw?.status);
  const status = mapNlStatus(statusCode, category);
  const delivered = category === 'DELIVERED' || status === S.DELIVERED;
  const [from, to] = nlWindow(raw);
  const destination = raw?.destination || {};
  const pickup = destination.locationType === 'SERVICEPOINT';
  return {
    source: 'account',
    barcode: str(raw?.barcode),
    parcelId: str(raw?.parcelId || raw?.id),
    postcode: nlPostcode(raw),
    sender: str(raw?.sender?.name),
    receiver: str(raw?.receiver?.name),
    status,
    rawStatus: codeText(statusCode) || codeText(category),
    statusCode,
    category,
    delivered,
    deliveredAt: delivered ? from : null,
    plannedFrom: delivered ? null : from,
    plannedTo: delivered ? null : to,
    windowKnown: Boolean(!delivered && from && to),
    pickup,
    pickupPoint: pickup ? str(destination.name) : '',
    url: nlUrl(raw),
    weight: null,
    dimensions: null,
    history: history || null,
    direction,
    product: str(raw?.product || raw?.productType || raw?.type),
  };
}

function nlIsActive(raw) { return NL_ACTIVE_CATEGORIES.has(str(raw?.category)); }

class DhlNlClient {
  constructor({ email, password, fetchFn = fetch }) {
    this.email = str(email);
    this.password = String(password || '');
    this.fetch = fetchFn;
    this.jar = new CookieJar();
    this.user = null;
    this._login = null;
  }

  _headers(extra = {}) {
    const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT, ...extra };
    const cookie = this.jar.header();
    if (cookie) headers.Cookie = cookie;
    const xsrf = this.jar.get('XSRF-TOKEN');
    if (xsrf) headers['x-xsrf-token'] = decodeURIComponent(xsrf);
    return headers;
  }

  async login() {
    if (this._login) return this._login;
    this._login = (async () => {
      if (!this.email || !this.password) throw new DhlError('Enter your My DHL e-mail address and password.', { auth: true });
      const res = await request(this.fetch, 'https://my.dhlecommerce.nl/api/user/login', {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email: this.email, password: this.password }),
      });
      this.jar.absorb(res);
      const text = await res.text();
      if (res.status === 401 || res.status === 403) throw new DhlError('My DHL login failed: e-mail address or password is incorrect.', { status: res.status, auth: true });
      if (res.status !== 200) throw new DhlError(`My DHL login failed (HTTP ${res.status})`, { status: res.status });
      this.user = parseJson(text) || {};
      return this.user;
    })().finally(() => { this._login = null; });
    return this._login;
  }

  async _get(url, { reauth = true, text = false } = {}) {
    if (!this.user) await this.login();
    const res = await request(this.fetch, url, { headers: this._headers() });
    this.jar.absorb(res);
    if ((res.status === 401 || res.status === 403) && reauth) {
      this.user = null;
      await this.login();
      return this._get(url, { reauth: false, text });
    }
    const body = await res.text();
    if (res.status === 401 || res.status === 403) throw new DhlError('My DHL session was rejected.', { status: res.status, auth: true });
    if (res.status !== 200) throw new DhlError(`My DHL request failed (HTTP ${res.status})`, { status: res.status });
    const data = parseJson(body);
    if (data === null && !text) throw new DhlError('My DHL returned an unexpected response.');
    return data;
  }

  async getParcels() {
    const data = await this._get('https://my.dhlecommerce.nl/receiver-parcel-api/parcels');
    return Array.isArray(data) ? data : (Array.isArray(data?.parcels) ? data.parcels : []);
  }

  async getSentShipments() {
    try {
      const data = await this._get('https://my.dhlecommerce.nl/api/orders/sentShipments?max=250');
      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (error.auth) throw error;
      return []; // best effort: usually empty for consumer accounts
    }
  }

  /** Track & trace history; best effort (null on any failure). */
  async getTrackTrace(barcode, postcode, parcelId) {
    if (!barcode || !postcode) return null;
    const params = new URLSearchParams({ key: `${barcode}+${postcode}`, role: 'consumer-receiver' });
    if (parcelId) params.set('uuid', parcelId);
    try {
      return await this._get(`https://my.dhlecommerce.nl/receiver-parcel-api/track-trace?${params.toString()}`, { text: true });
    } catch (error) {
      if (error.auth) throw error;
      return null;
    }
  }
}

/* ======================================================================
 * Keyless DHL Parcel gateway (api-gw.dhlparcel.nl)
 * ==================================================================== */

const GATEWAY_PATTERNS = [/^3S[A-Z]{3}\d{10}$/, /^JJD\d{18,24}$/, /^(CR|LX)\d{9}[A-Z]{2}$/];
const EXPRESS_AWB = /^\d{10}$/;
const TRACKING_CODE = /^[A-Z0-9]{8,35}$/;

function normalizeCode(value) { return str(value).toUpperCase().replace(/[\s-]+/g, ''); }
function isGatewayCode(code) { return GATEWAY_PATTERNS.some(pattern => pattern.test(normalizeCode(code))); }
function isExpressAwb(code) { return EXPRESS_AWB.test(normalizeCode(code)); }
function isValidCode(code) { return TRACKING_CODE.test(normalizeCode(code)); }

/**
 * "code [postcode] [out|uit|outgoing]" per line → [{ code, postcode, direction }].
 * A postcode is only used for the my.dhlecommerce.nl tracking link.
 */
function parseTrackingList(text) {
  const out = [];
  const seen = new Set();
  for (const line of String(text || '').split(/[\n,;]+/)) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const code = normalizeCode(parts.shift());
    if (!isValidCode(code) || seen.has(code)) continue;
    let direction = 'incoming';
    let postcode = '';
    for (const part of parts) {
      if (/^(out|uit|outgoing|uitgaand|sent|verzonden)$/i.test(part)) direction = 'outgoing';
      else if (!postcode) postcode = part.toUpperCase();
      else postcode = `${postcode}${part.toUpperCase()}`;
    }
    seen.add(code);
    out.push({ code, postcode: postcode.replace(/\s+/g, ''), direction });
  }
  return out;
}

function formatTrackingList(entries) {
  return entries.map(entry => [entry.code, entry.postcode, entry.direction === 'outgoing' ? 'out' : ''].filter(Boolean).join(' ')).join('\n');
}

async function fetchGateway(codes, { fetchFn = fetch } = {}) {
  const list = [...new Set(codes.map(normalizeCode).filter(Boolean))];
  if (!list.length) return {};
  const res = await request(fetchFn, `https://api-gw.dhlparcel.nl/track-trace?key=${encodeURIComponent(list.join(','))}`, {
    headers: { accept: '*/*', 'User-Agent': USER_AGENT },
  });
  if (res.status === 404) return {};
  const text = await res.text();
  if (res.status !== 200) throw new DhlError(`DHL tracking gateway returned HTTP ${res.status}`, { status: res.status });
  const data = parseJson(text);
  const out = {};
  if (Array.isArray(data)) for (const item of data) if (item?.barcode) out[normalizeCode(item.barcode)] = item;
  return out;
}

function mapGatewayEvent(event) {
  return GATEWAY_STATUS_MAP[event?.status] || GATEWAY_CATEGORY_MAP[event?.category] || S.UNKNOWN;
}

function normalizeGateway(raw, { direction = 'incoming', postcode = '' } = {}) {
  const events = Array.isArray(raw?.events) ? raw.events : [];
  const last = events[events.length - 1] || {};
  const delivered = Boolean(raw?.deliveredAt);
  let status = events.length ? mapGatewayEvent(last) : S.UNKNOWN;
  if (delivered) status = S.DELIVERED;
  else if (status === S.DELIVERED) status = S.OUT_FOR_DELIVERY;
  const barcode = normalizeCode(raw?.barcode);
  const destination = raw?.destination || raw?.receiver?.address || {};
  const pickupName = str(raw?.destination?.name || last?.destination?.name);
  const pickup = raw?.destination?.locationType === 'SERVICEPOINT' || status === S.AT_PICKUP_POINT;
  const shipper = raw?.shipper || raw?.sender || {};
  return {
    source: 'gateway',
    barcode,
    sender: str(shipper.name || raw?.shipperName),
    receiver: str(raw?.receiver?.name),
    status,
    rawStatus: codeText(last.status) || codeText(last.category),
    statusCode: str(last.status),
    delivered,
    deliveredAt: raw?.deliveredAt || null,
    plannedFrom: delivered ? null : (last.momentIndication || raw?.plannedDeliveryTimeframe?.from || null),
    plannedTo: delivered ? null : (raw?.plannedDeliveryTimeframe?.to || null),
    windowKnown: Boolean(!delivered && raw?.plannedDeliveryTimeframe?.from && raw?.plannedDeliveryTimeframe?.to),
    pickup,
    pickupPoint: pickup ? pickupName : '',
    url: postcode ? `https://my.dhlecommerce.nl/portal/tracktrace/${barcode}/${postcode}` : `https://www.dhl.com/nl-nl/home/tracking.html?tracking-id=${encodeURIComponent(barcode)}`,
    weight: null,
    dimensions: null,
    history: sortHistory(events.map(event => ({ timestamp: event.timestamp, status: mapGatewayEvent(event), rawStatus: codeText(event.status) || codeText(event.category), code: event.status || '' }))),
    direction,
    product: str(raw?.product || raw?.type),
    postcode: str(destination.postalCode || postcode).replace(/\s+/g, ''),
  };
}

/* ======================================================================
 * DHL Express app backend (dhle.dhl.com)
 * ==================================================================== */

const EXPRESS_URL = 'https://dhle.dhl.com/access/access/com.dhl.exp.dhlmobile';
const EXPRESS_APP_VERSION = '6.1.0';
const EXPRESS_THROTTLE_CODE = 'DRG10012';
const EXPRESS_REFILL_MS = 2400 * 1000; // one request per 40 minutes (ha-dhl's measured cooldown)
const EXPRESS_JITTER = 0.15;
let expressBearer = null;

function expressBearerToken() {
  if (expressBearer) return expressBearer;
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from('MyBillSDSHOLIENBTAICGKREANTDIMON'), Buffer.from('hq1wNoGMkcqcKAR6'));
  const plain = Buffer.concat([decipher.update(Buffer.from('ArnvnwcNI+HBw27G2csnAMJGPW3qTpB5xaDSOeNfaEcIeQd9mlcT3C1vZIkWV9Ph', 'base64')), decipher.final()]);
  expressBearer = plain.subarray(3).toString('utf8');
  return expressBearer;
}

function expressTransactionId() {
  const d = new Date();
  const date = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `UNKNOWN-XX-GUST-0000-${date}-AH-000000-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function expressEnvelope(awb) {
  return {
    method: 'tracking',
    service: 'shipments',
    data: {
      parameters: {},
      timezoneOffset: '+00:00',
      appVersion: EXPRESS_APP_VERSION,
      UIClient: 'Android',
      device_info: {
        device_unique_id: 'myparcel-homey', device_language: 'en', os_version: 'unknown', rooted: 'false',
        app_id: 'com.dhl.exp.dhlmobile', time_zone: 'UTC', deviceId: 'myparcel-homey', cordovaVer: 'unknown', deviceModel: 'homey',
      },
      airWayBill: awb,
      countryCode: '',
      languageCd: 'en',
      addShipmentToODD: 'N',
      moreDetails: 'Y',
      iv: '',
      captchaVerificationData: { captchaText: '', token: '' },
      postCd: null,
      ctyNm: null,
      sbNm: null,
    },
    authentication: { provider: 'DEMP.RS1', token: '', login: '' },
  };
}

/** Fetch one air waybill; null = not found. Throws DhlError(throttled) on DHL's "stand down" code. */
async function fetchExpress(awb, { fetchFn = fetch } = {}) {
  const res = await request(fetchFn, `${EXPRESS_URL}?appVersion=${EXPRESS_APP_VERSION}&service=shipments-tracking`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Cache-Control': 'no-cache',
      Authorization: expressBearerToken(), transactionId: expressTransactionId(),
    },
    body: JSON.stringify(expressEnvelope(normalizeCode(awb))),
  });
  const text = await res.text();
  if (text.includes(EXPRESS_THROTTLE_CODE)) throw new DhlError('DHL Express asked to slow down', { status: res.status, throttled: true });
  if (res.status === 401 || res.status === 403) throw new DhlError(`DHL Express tracking refused (HTTP ${res.status})`, { status: res.status, auth: true });
  if (res.status !== 200) throw new DhlError(`DHL Express tracking failed (HTTP ${res.status})`, { status: res.status });
  const data = parseJson(text);
  if (!Array.isArray(data) || !data.length) return null;
  return data[0];
}

const EXPRESS_CHECKPOINTS = [
  ['delivered', S.DELIVERED],
  ['shipment is out with courier for delivery', S.OUT_FOR_DELIVERY],
  ['delivery attempt could not be completed', S.PROBLEM],
  ['further consignee information needed', S.PROBLEM],
  ['delivery not accepted', S.PROBLEM],
  ['on hold awaiting for payment', S.PROBLEM],
  ['returned to shipper', S.RETURNING],
  ['shipment information received', S.REGISTERED],
  ['shipment is scheduled for delivery', S.IN_TRANSIT],
  ['arrived at dhl delivery facility', S.IN_TRANSIT],
  ['shipment accepted', S.IN_TRANSIT],
  ['shipment picked up', S.IN_TRANSIT],
  ['picked up', S.IN_TRANSIT],
  ['processed at', S.IN_TRANSIT],
  ['arrived at dhl sort facility', S.IN_TRANSIT],
  ['shipment has departed from a dhl facility', S.IN_TRANSIT],
  ['shipment is in transit to destination', S.IN_TRANSIT],
  ['in transit', S.IN_TRANSIT],
  ['customs clearance status updated', S.IN_TRANSIT],
  ['clearance processing complete', S.IN_TRANSIT],
  ['payment is received and recorded', S.IN_TRANSIT],
];

function mapExpressCheckpoint(description) {
  const text = str(description).replace(/\s+/g, ' ').toLowerCase();
  for (const [prefix, status] of EXPRESS_CHECKPOINTS) if (text.startsWith(prefix)) return status;
  return S.UNKNOWN;
}

const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

/** "Friday, July 31, 2026" + "13:07" → "2026-07-31T13:07:00" (facility local time, no offset). */
function expressTimestamp(checkpoint) {
  const date = str(checkpoint?.date).match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  const time = str(checkpoint?.time).match(/^(\d{1,2}):(\d{2})/);
  if (!date || !time || MONTHS[date[1].toLowerCase()] === undefined) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${date[3]}-${pad(MONTHS[date[1].toLowerCase()] + 1)}-${pad(date[2])}T${pad(time[1])}:${time[2]}:00`;
}

function expressEdd(raw) {
  const date = str(raw?.eddDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = str(raw?.eddTime).toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  let hh = 0; let mm = 0;
  if (time) {
    hh = Number(time[1]) % 12 + (time[3] === 'PM' ? 12 : 0);
    if (!time[3]) hh = Number(time[1]);
    mm = Number(time[2]);
  }
  return `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+00:00`;
}

function placeName(value) {
  if (!value) return '';
  if (typeof value === 'string') return str(value);
  return str(value.value || value.label || value.city || value.name || value.description || value.countryCode);
}

function normalizeExpress(raw, { direction = 'incoming' } = {}) {
  const checkpoints = (Array.isArray(raw?.checkpoints) ? raw.checkpoints : []).filter(c => c && typeof c === 'object');
  const newest = checkpoints[0] || {};
  const top = str(raw?.status).toUpperCase();
  let status;
  if (top === 'DELIVERED') status = S.DELIVERED;
  else {
    status = mapExpressCheckpoint(newest.description);
    if (status === S.UNKNOWN && raw?.eddDate && Date.parse(raw.eddDate) >= Date.now() - 86400000) status = S.IN_TRANSIT;
    if (status === S.UNKNOWN && checkpoints.length) status = S.IN_TRANSIT;
  }
  const delivered = status === S.DELIVERED;
  const pieces = Number(raw?.pieces?.value || newest.totalPieces || 0) || null;
  const awb = normalizeCode(raw?.id);
  const history = checkpoints.slice().reverse().map(checkpoint => ({
    timestamp: expressTimestamp(checkpoint),
    status: mapExpressCheckpoint(checkpoint.description),
    rawStatus: str(checkpoint.description),
    location: str(checkpoint.location),
  })).filter(entry => entry.timestamp);
  return {
    source: 'express',
    barcode: awb,
    sender: str(raw?.shipper?.name || raw?.shipperName || raw?.origin?.label),
    receiver: str(raw?.consignee?.name || raw?.receiverName),
    status,
    rawStatus: str(raw?.status && top !== 'DELIVERED' ? raw.status : newest.description) || (delivered ? 'Delivered' : ''),
    statusCode: top,
    delivered,
    deliveredAt: delivered ? expressTimestamp(newest) : null,
    plannedFrom: delivered ? null : expressEdd(raw),
    plannedTo: null,
    windowKnown: false,
    pickup: false,
    pickupPoint: '',
    url: `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(awb)}`,
    weight: null,
    dimensions: null,
    history: history.slice(-HISTORY_MAX_EVENTS),
    direction,
    origin: placeName(raw?.origin) || str(checkpoints[checkpoints.length - 1]?.location),
    destination: placeName(raw?.destination),
    service: str(raw?.productName || raw?.product?.name || raw?.label),
    pieces,
    proofOfDelivery: str(raw?.signature?.link?.url),
    lastLocation: str(newest.location),
  };
}

/**
 * ha-dhl's Express request budget: capacity 1, refilled every 40 minutes, and an exponential
 * stand-down (never shorter than the refill, ±15 % jitter) when DHL answers DRG10012.
 * State is plain JSON so a device can persist it across restarts.
 */
class ExpressBudget {
  constructor(state = {}) {
    this.tokens = Number.isFinite(state.tokens) ? state.tokens : 1;
    this.updatedAt = Number(state.updatedAt) || Date.now();
    this.blockedUntil = Number(state.blockedUntil) || 0;
    this.strikes = Number(state.strikes) || 0;
    this.fetchedAt = state.fetchedAt && typeof state.fetchedAt === 'object' ? { ...state.fetchedAt } : {};
  }

  _refill(now) {
    const gained = (now - this.updatedAt) / EXPRESS_REFILL_MS;
    if (gained > 0) {
      this.tokens = Math.min(1, this.tokens + gained);
      this.updatedAt = now;
    }
  }

  /** Milliseconds until a request may be made (0 = now). */
  waitMs(now = Date.now()) {
    this._refill(now);
    if (this.blockedUntil > now) return this.blockedUntil - now;
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) * EXPRESS_REFILL_MS);
  }

  take(now = Date.now()) {
    if (this.waitMs(now) > 0) return false;
    this.tokens -= 1;
    return true;
  }

  success(code = null, now = Date.now()) {
    this.strikes = 0;
    this.blockedUntil = 0;
    if (code) this.fetchedAt[code] = now;
  }

  throttled(now = Date.now(), staggerMs = 0) {
    this.strikes += 1;
    const base = Math.max(EXPRESS_REFILL_MS, EXPRESS_REFILL_MS * (2 ** (this.strikes - 1)));
    const capped = Math.min(base, 12 * 3600 * 1000);
    const jitter = 1 + ((Math.random() * 2 - 1) * EXPRESS_JITTER);
    this.blockedUntil = now + Math.round(capped * jitter) + staggerMs;
    this.tokens = 0;
  }

  /** Never-fetched codes first, then shipments with the courier, then the one fetched longest ago. */
  pick(codes, hot = []) {
    const never = codes.filter(code => !this.fetchedAt[code]);
    if (never.length) return never[0];
    const urgent = codes.filter(code => hot.includes(code));
    const pool = urgent.length ? urgent : codes;
    const sorted = pool.slice().sort((a, b) => (this.fetchedAt[a] || 0) - (this.fetchedAt[b] || 0));
    return sorted[0] || null;
  }

  forget(keep) {
    for (const code of Object.keys(this.fetchedAt)) if (!keep.includes(code)) delete this.fetchedAt[code];
  }

  toJSON() {
    return { tokens: this.tokens, updatedAt: this.updatedAt, blockedUntil: this.blockedUntil, strikes: this.strikes, fetchedAt: this.fetchedAt };
  }
}

/* ======================================================================
 * DHL Paket DE (ha-dhl account/countries/de)
 * ==================================================================== */

const DE_OIDC_ROOT = 'https://login.dhl.de/af5f9bb6-27ad-4af4-9445-008e7a5cddb8/login';
const DE_CLIENT_ID = '83471082-5c13-4fce-8dcb-19d2a3fca413';
const DE_REDIRECT_URI = 'dhllogin://de.deutschepost.dhl/login';
const DE_CLAIMS = '{"id_token":{"email":null,"post_number":null,"twofa":null,"service_mask":null,"deactivate_account":null,"last_login":null,"customer_type":null,"display_name":null,"data_confirmation_required":null}}';
const DE_TRACKING_URL = 'https://www.dhl.de/int-verfolgen/data/search';
const DE_PUBLIC_TRACKING_URL = 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html';
const DE_TOKEN_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/x-www-form-urlencoded',
  origin: 'https://login.dhl.de',
  'user-agent': 'DHLPaket_PROD/1367 CFNetwork/1240.0.4 Darwin/20.6.0',
  'accept-language': 'de-de',
};
const DE_TRACKING_HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'accept-language': 'de-de',
};

function b64url(buffer) { return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function decodeJwt(token) {
  try {
    const part = String(token || '').split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (_) { return null; }
}

/** Parse "dhllogin://…?code=…&state=…" (query or fragment) pasted by the user. */
function parseDeRedirect(value) {
  const text = str(value);
  const match = text.match(/[?#&](?:code)=([^&#\s]+)/);
  const state = text.match(/[?#&]state=([^&#\s]+)/);
  if (match) return { code: decodeURIComponent(match[1]), state: state ? decodeURIComponent(state[1]) : '' };
  if (/^[A-Za-z0-9._~-]{16,}$/.test(text)) return { code: text, state: '' };
  return { code: '', state: '' };
}

class DhlDeSession {
  constructor({ refreshToken = null, fetchFn = fetch, onRefreshToken = null } = {}) {
    this.refreshToken = refreshToken;
    this.fetch = fetchFn;
    this.onRefreshToken = onRefreshToken;
    this.idToken = null;
    this.expiresAt = 0;
    this.endpoints = null;
    this._refreshing = null;
  }

  async _discover() {
    if (this.endpoints) return this.endpoints;
    const res = await request(this.fetch, `${DE_OIDC_ROOT}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } });
    const data = parseJson(await res.text());
    if (res.status !== 200 || !data?.authorization_endpoint || !data?.token_endpoint) throw new DhlError(`DHL login discovery failed (HTTP ${res.status})`, { status: res.status });
    this.endpoints = { authorization: data.authorization_endpoint, token: data.token_endpoint };
    return this.endpoints;
  }

  async authorizationUrl() {
    const { authorization } = await this._discover();
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const params = {
      response_type: 'code', client_id: DE_CLIENT_ID, redirect_uri: DE_REDIRECT_URI, scope: 'openid offline_access',
      claims: DE_CLAIMS, code_challenge: challenge, code_challenge_method: 'S256', state, nonce: b64url(crypto.randomBytes(16)), prompt: 'login',
    };
    const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return { url: `${authorization}?${query}`, verifier, state };
  }

  async _token(body) {
    const { token } = await this._discover();
    const res = await request(this.fetch, token, {
      method: 'POST',
      headers: { ...DE_TOKEN_HEADERS, Authorization: `Basic ${Buffer.from(`${DE_CLIENT_ID}:`).toString('base64')}` },
      body: new URLSearchParams(body).toString(),
    });
    const text = await res.text();
    const data = parseJson(text) || {};
    if (res.status === 200 && data.access_token) return data;
    if ((res.status === 400 || res.status === 401) && ['invalid_grant', 'unauthorized_client', 'invalid_client'].includes(data.error)) {
      throw new DhlError(`DHL rejected the login (${data.error})`, { status: res.status, auth: true });
    }
    throw new DhlError(`DHL login failed (HTTP ${res.status})`, { status: res.status });
  }

  _store(data) {
    if (!data.id_token) throw new DhlError('DHL login returned no ID token');
    this.idToken = data.id_token;
    this.expiresAt = Date.now() + (Number(data.expires_in) || 1800) * 1000;
    if (data.refresh_token && data.refresh_token !== this.refreshToken) {
      this.refreshToken = data.refresh_token;
      // Persist a rotated refresh token immediately – losing it burns the session.
      if (typeof this.onRefreshToken === 'function') this.onRefreshToken(this.refreshToken);
    }
    const claims = decodeJwt(this.idToken) || {};
    if (!('post_number' in claims)) throw new DhlError('DHL account link (post number) is missing; sign in again', { auth: true });
    return claims;
  }

  async exchange(code, verifier) {
    const data = await this._token({ redirect_uri: DE_REDIRECT_URI, grant_type: 'authorization_code', code_verifier: verifier, code });
    if (!data.refresh_token) throw new DhlError('DHL did not grant offline access (no refresh token)', { auth: true });
    this.refreshToken = data.refresh_token;
    return this._store(data);
  }

  async refresh() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      if (!this.refreshToken) throw new DhlError('Not signed in to DHL', { auth: true });
      return this._store(await this._token({ redirect_uri: DE_REDIRECT_URI, grant_type: 'refresh_token', refresh_token: this.refreshToken }));
    })().finally(() => { this._refreshing = null; });
    return this._refreshing;
  }

  async getIdToken() {
    if (!this.idToken || Date.now() > this.expiresAt - 300000) await this.refresh();
    return this.idToken;
  }
}

class DhlDeClient {
  constructor({ session, fetchFn = fetch }) {
    this.session = session;
    this.fetch = fetchFn;
  }

  async _search(params) {
    const run = async token => {
      const res = await request(this.fetch, `${DE_TRACKING_URL}?${new URLSearchParams(params).toString()}`, {
        headers: { ...DE_TRACKING_HEADERS, Cookie: `dhli=${token}` },
      });
      return { status: res.status, body: parseJson(await res.text()) };
    };
    let result = await run(await this.session.getIdToken());
    if (result.status === 401) {
      await this.session.refresh();
      result = await run(this.session.idToken);
    }
    if (result.status === 401 || result.status === 403) throw new DhlError('DHL.de rejected the session', { status: result.status, auth: result.status === 401 });
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') {
      throw new DhlError(`DHL.de tracking failed (HTTP ${result.status}${result.status === 403 ? ', requests must come from Germany' : ''})`, { status: result.status });
    }
    return result.body;
  }

  async getInbox() {
    const body = await this._search({ noRedirect: 'true', language: 'de', cid: 'app' });
    const list = Array.isArray(body.sendungen) ? body.sendungen.filter(x => x && typeof x === 'object') : [];
    const active = list.filter(x => str(x?.sendungsinfo?.sendungsliste).toUpperCase() !== 'ARCHIVIERT');
    return active.length ? active : list;
  }

  async getByNumber(code) {
    const body = await this._search({ piececode: normalizeCode(code), noRedirect: 'true', language: 'de', cid: 'app' });
    const list = Array.isArray(body.sendungen) ? body.sendungen.filter(x => x && typeof x === 'object') : [];
    const element = list.find(x => normalizeCode(x?.id) === normalizeCode(code)) || list[0] || null;
    return element && !deIsNotFound(element) ? element : null;
  }
}

const DE_LADDER = { 0: S.REGISTERED, 1: S.REGISTERED, 2: S.IN_TRANSIT, 3: S.IN_TRANSIT, 4: S.OUT_FOR_DELIVERY };

function mapDeLadder(fortschritt, maximal) {
  let max = Number(maximal);
  if (!Number.isFinite(max) || max <= 0) max = 5;
  const value = Number(fortschritt);
  if (!Number.isFinite(value) || fortschritt === null || fortschritt === '') return S.UNKNOWN;
  if (value === max) return S.DELIVERED;
  if (value > max || value < 0) return S.UNKNOWN;
  return DE_LADDER[value] || S.UNKNOWN;
}

function htmlText(value) {
  return str(String(value || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')).replace(/\s+/g, ' ');
}

function deTimestamp(value) {
  const text = str(value);
  if (!text) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return text;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) ? text : null; // naive: Europe/Berlin local time
}

/** Free-text German / English status → canonical (for the Post & DHL app API and fallbacks). */
function mapDeText(text) {
  const t = str(text).toLowerCase();
  if (!t) return S.UNKNOWN;
  if (/rücksendung|ruecksendung|retoure|zurück an|zurueck an|returned to sender|return to sender/.test(t)) return S.RETURNING;
  if (/nicht zugestellt|konnte nicht|nicht angetroffen|nicht möglich|nicht moeglich|problem|fehler|verzög|verzoeg|beschädig|beschaedig|exception|zollamt.*angehalten|could not be delivered/.test(t)) return S.PROBLEM;
  if (/(liegt|ist).*(packstation|filiale|paketshop|postfiliale).*(bereit|abhol)|zur abholung|abholbereit|ready for pick ?up|bereit zur abholung/.test(t)) return S.AT_PICKUP_POINT;
  if (/in zustellung|zustellfahrzeug|wird heute zugestellt|an den zusteller übergeben|an den zusteller uebergeben|out for delivery|auf dem weg zu (ihnen|dir)|zustellung erfolgt heute/.test(t)) return S.OUT_FOR_DELIVERY;
  if (/(nachbar|empfänger|empfaenger|briefkasten|ablageort|wunschort)[^.]*(übergeben|uebergeben|abgegeben|zugestellt|abgelegt)|zugestellt an/.test(t) && !/wird[^.]*(zugestellt|übergeben)/.test(t)) return S.DELIVERED;
  // "an DHL übergeben" / "beim Absender abgeholt" are hand-overs into the network, not deliveries.
  if (/(an|bei) (dhl|die deutsche post|deutsche post)[^.]*übergeben|(an|bei) (dhl|die deutsche post|deutsche post)[^.]*uebergeben|(beim|vom) absender abgeholt|abholung beim absender|eingeliefert|abgegeben/.test(t)) return S.IN_TRANSIT;
  if (/erfolgreich zugestellt|wurde zugestellt|ist zugestellt|zugestellt an|wurde .*abgeholt|vom empfänger abgeholt|vom empfaenger abgeholt|delivered/.test(t) && !/wird.*zugestellt|voraussichtlich/.test(t)) return S.DELIVERED;
  if (/elektronisch angekündigt|angekündigt|angekuendigt|auftragsdaten|announced|label created|daten.*übermittelt/.test(t)) return S.REGISTERED;
  if (/bearbeitet|paketzentrum|transport|unterwegs|sortiert|weitergeleitet|in transit|processed|on its way|zoll|übergeben|uebergeben/.test(t)) return S.IN_TRANSIT;
  return S.UNKNOWN;
}

/** ha-dhl: an inbox element without `sendungsverlauf` is a stub that needs a by-number lookup. */
function deNeedsEnrichment(element) {
  if (element?.sendungNichtGefunden && typeof element.sendungNichtGefunden === 'object') return false;
  const details = element?.sendungsdetails;
  if (!details || typeof details !== 'object' || (details.sendungNichtGefunden && typeof details.sendungNichtGefunden === 'object')) return false;
  return !(details.sendungsverlauf && typeof details.sendungsverlauf === 'object');
}

/** ha-dhl: explicit "no data" marker, or no events and no short status. */
function deIsNotFound(element) {
  if (element?.sendungNichtGefunden?.keineDatenVerfuegbar) return true;
  const verlauf = element?.sendungsdetails?.sendungsverlauf;
  if (!verlauf || typeof verlauf !== 'object') return true;
  const hasEvents = Array.isArray(verlauf.events) && verlauf.events.length > 0;
  return !hasEvents && !verlauf.kurzStatus && !verlauf.status;
}

function findDeep(value, key, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = findDeep(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function deWindow(zustellung) {
  const von = zustellung?.zustellzeitfensterVon;
  const bis = zustellung?.zustellzeitfensterBis;
  const fenster = zustellung?.zustellzeitfenster;
  const datum = zustellung?.zustelldatum;
  if (von || bis) return { from: deTimestamp(von), to: deTimestamp(bis), known: Boolean(von && bis) };
  if (fenster) return { from: deTimestamp(fenster) || null, to: null, known: false, text: deTimestamp(fenster) ? '' : str(fenster) };
  if (datum) return { from: deTimestamp(datum) || str(datum), to: null, known: false };
  return { from: null, to: null, known: false };
}

/** One element of www.dhl.de's `sendungen` list (the ha-dhl DE shape). */
function normalizeDeInbox(raw) {
  const barcode = normalizeCode(raw?.id);
  const info = raw?.sendungsinfo || {};
  const richtung = str(info.sendungsrichtung).toUpperCase();
  const outgoing = ['AUSGEHEND', 'ABGEHEND'].includes(richtung);
  const name = htmlText(info.sendungsname);
  const details = raw?.sendungsdetails || {};
  const verlauf = details.sendungsverlauf || {};
  const events = Array.isArray(verlauf.events) ? verlauf.events : [];
  const rawStatus = htmlText(verlauf.status || verlauf.kurzStatus);
  let status = mapDeLadder(verlauf.fortschritt, verlauf.maximalFortschritt);
  if (status === S.UNKNOWN) status = mapDeText(rawStatus);
  let delivered;
  if (typeof details.istZugestellt === 'boolean') delivered = details.istZugestellt;
  else delivered = status === S.DELIVERED;
  if (delivered) status = S.DELIVERED;
  else if (status === S.DELIVERED) status = S.OUT_FOR_DELIVERY;
  const zustellung = details.zustellung || {};
  const win = delivered ? { from: null, to: null, known: false } : deWindow(zustellung);
  let pickupPoint = '';
  if (!delivered && status === S.OUT_FOR_DELIVERY && zustellung.packageStationType === 'PACKAGE_STATION' && zustellung.abholcodeAvailable === true) {
    status = S.AT_PICKUP_POINT;
    for (const event of events.slice().reverse()) {
      const anchor = String(event?.status || '').match(/<a\b[^>]*>(.*?)<\/a>/i);
      if (anchor) { pickupPoint = htmlText(anchor[1]); break; }
      if (event?.status) break;
    }
  }
  if (details.retoure || details.ruecksendung) status = delivered ? S.DELIVERED : S.RETURNING;
  return {
    source: 'dhlde',
    barcode,
    sender: outgoing ? '' : name,
    receiver: outgoing ? name : '',
    status,
    rawStatus,
    statusCode: str(verlauf.fortschritt),
    delivered,
    deliveredAt: delivered ? deTimestamp(verlauf.datumAktuellerStatus) : null,
    plannedFrom: win.from,
    plannedTo: win.to,
    windowKnown: win.known,
    windowText: win.text || '',
    pickup: status === S.AT_PICKUP_POINT,
    pickupPoint,
    url: `${DE_PUBLIC_TRACKING_URL}?piececode=${encodeURIComponent(barcode)}`,
    weight: null,
    dimensions: null,
    history: sortHistory(events.map(event => ({ timestamp: deTimestamp(event?.datum), status: null, rawStatus: htmlText(event?.status) }))),
    direction: outgoing ? 'outgoing' : 'incoming',
    product: str(details.produktName || info.produkt),
  };
}

/** One shipment from the Post & DHL app API (app.dhl.de /shipments). Shape is tolerant on purpose. */
function normalizeDeApp(raw) {
  if (raw && typeof raw === 'object' && (raw.sendungsinfo || raw.sendungsdetails)) return normalizeDeInbox(raw);
  const pick = (...values) => { for (const v of values) { const s = typeof v === 'object' ? '' : str(v); if (s) return s; } return ''; };
  const barcode = normalizeCode(pick(raw?.shipmentNumber, raw?.trackingNumber, raw?.pieceCode, raw?.piececode, raw?.id, raw?.barcode));
  const rawStatus = htmlText(pick(raw?.status?.statusText, raw?.status?.status, raw?.statusText, raw?.shortStatus, raw?.status?.text, typeof raw?.status === 'string' ? raw.status : '', raw?.lastEvent?.status, raw?.lastEvent?.text));
  const fortschritt = findDeep(raw, 'fortschritt') ?? findDeep(raw, 'progress');
  const maximal = findDeep(raw, 'maximalFortschritt') ?? findDeep(raw, 'maxProgress');
  let status = fortschritt !== undefined ? mapDeLadder(fortschritt, maximal) : S.UNKNOWN;
  if (status === S.UNKNOWN) status = mapDeText(rawStatus);
  const flag = findDeep(raw, 'istZugestellt') ?? findDeep(raw, 'delivered') ?? findDeep(raw, 'isDelivered');
  const delivered = typeof flag === 'boolean' ? flag : status === S.DELIVERED;
  if (delivered) status = S.DELIVERED;
  else if (status === S.DELIVERED) status = S.OUT_FOR_DELIVERY;
  const direction = /out|ausgehend|abgehend|sent/i.test(pick(raw?.direction, raw?.shipmentDirection, raw?.sendungsrichtung)) ? 'outgoing' : 'incoming';
  const from = pick(raw?.deliveryTimeframe?.from, raw?.deliveryTimeframe?.start, raw?.zustellzeitfensterVon, raw?.estimatedDelivery?.from, raw?.deliveryDate, raw?.expectedDeliveryDate);
  const to = pick(raw?.deliveryTimeframe?.to, raw?.deliveryTimeframe?.end, raw?.zustellzeitfensterBis, raw?.estimatedDelivery?.to);
  const windowText = typeof raw?.deliveryTimeframe === 'string' ? str(raw.deliveryTimeframe) : '';
  const events = Array.isArray(raw?.events) ? raw.events : (Array.isArray(raw?.history) ? raw.history : []);
  const packstation = pick(raw?.packstation?.name, raw?.packstation?.number ? `Packstation ${raw.packstation.number}` : '', raw?.pickupLocation?.name, raw?.retailOutlet?.name);
  if (!delivered && packstation && /bereit|abhol|ready/i.test(rawStatus)) status = S.AT_PICKUP_POINT;
  return {
    source: 'app',
    barcode,
    sender: pick(raw?.sender?.name, raw?.senderName, raw?.shipper?.name, raw?.sendungsname, raw?.title, raw?.name),
    receiver: pick(raw?.receiver?.name, raw?.recipient?.name, raw?.receiverName),
    status,
    rawStatus,
    statusCode: str(fortschritt ?? ''),
    delivered,
    deliveredAt: delivered ? (pick(raw?.deliveredAt, raw?.deliveryDate, raw?.lastEvent?.timestamp, raw?.status?.timestamp) || null) : null,
    plannedFrom: delivered ? null : (deTimestamp(from) || (from || null)),
    plannedTo: delivered ? null : (deTimestamp(to) || null),
    windowKnown: Boolean(!delivered && deTimestamp(from) && deTimestamp(to)),
    windowText: delivered ? '' : windowText,
    pickup: status === S.AT_PICKUP_POINT || Boolean(packstation),
    pickupPoint: packstation,
    url: barcode ? `${DE_PUBLIC_TRACKING_URL}?piececode=${encodeURIComponent(barcode)}` : '',
    weight: null,
    dimensions: null,
    history: sortHistory(events.map(event => ({ timestamp: pick(event?.timestamp, event?.datum, event?.date, event?.dateTime), status: null, rawStatus: htmlText(pick(event?.status, event?.text, event?.description)) }))),
    direction,
    product: pick(raw?.product, raw?.productName),
  };
}

module.exports = {
  STATUS,
  HISTORY_MAX_EVENTS,
  DhlError,
  CookieJar,
  codeText,
  // NL
  NL_STATUS_MAP,
  mapNlStatus,
  buildNlHistory,
  normalizeNlAccount,
  nlIsActive,
  DhlNlClient,
  // gateway
  normalizeCode,
  isGatewayCode,
  isExpressAwb,
  isValidCode,
  parseTrackingList,
  formatTrackingList,
  fetchGateway,
  normalizeGateway,
  // express
  expressBearerToken,
  fetchExpress,
  normalizeExpress,
  mapExpressCheckpoint,
  ExpressBudget,
  EXPRESS_REFILL_MS,
  // DE
  DhlDeSession,
  DhlDeClient,
  parseDeRedirect,
  mapDeLadder,
  mapDeText,
  normalizeDeInbox,
  normalizeDeApp,
  deNeedsEnrichment,
  deIsNotFound,
  decodeJwt,
};
