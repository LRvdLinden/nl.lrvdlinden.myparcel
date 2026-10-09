'use strict';

/*
 * GLS public tracking — no account needed, only a tracking number and the
 * delivery postal code. Ported from the transports and mappings used by
 * ha-parcel-integrations/ha-gls (MIT) so every GLS country behaves the same:
 *
 *   NL            apm.gls.nl tracktrace details (weight, dimensions, ETA window, ParcelShop, history)
 *   DE            anonymous GLS app session (register/validate) + trackings API
 *   PL            myGLS Poland public tracking (number only)
 *   US            GLS US public summary API (number only)
 *   CA            GLS Canada public tracking (postcode route, number-only fallback)
 *   AT BE CH CZ DK FI FR HR HU IE IT LU RS SI SK
 *                 pan-EU GLS group tracker (rstt028, rstt029 fallback)
 *
 * Every transport returns the same canonical parcel object (see normalize*).
 *
 * Endpoint knowledge, status maps and parsing are ported from ha-gls:
 *
 * MIT License
 *
 * Copyright (c) 2026 ha-dhl-nl contributors
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
const STATUS_VALUES = Object.values(STATUS);
const HISTORY_MAX_EVENTS = 20;
const REQUEST_TIMEOUT_MS = 20000;

const TRACKING_URL = 'https://gls-group.com/GROUP/en/parcel-tracking?match={parcel_no}';
const NL_DETAILS_URL = 'https://{host}/api/tracktrace/v1/{parcel_no}/postalcode/{postal_code}/details/{culture}';
const CA_DETAILS_URL = 'https://web.gls-canada.com/api/tracking/{postal_code}/{parcel_no}';
const CA_BASIC_URL = 'https://web.gls-canada.com/api/tracking/{parcel_no}';
const US_TRACKING_URL = 'https://connect.gls-us.com/api/public/tracking/TrackShipmentSummariesByTrackingNumbers';
const PL_TRACKING_URL = 'https://mygls.gls-poland.com.pl/api/v1/mygls-tracking/public/tracking/shipment/track/{parcel_no}';
const DE_TRACKINGS_HOST = 'gls-pakete-de-backend-app.ooh.glsnxt.com';
const DE_ADD_URL = `https://${DE_TRACKINGS_HOST}/api/v1/trackings`;
const DE_DETAIL_URL = `https://${DE_TRACKINGS_HOST}/api/v1/trackings/{parcel_number}`;
const DE_REGISTER_URL = 'https://api-backend.glsnxt.com/ecosystem/user-service/v1/users/register';
const DE_VALIDATE_URL = 'https://api-backend.glsnxt.com/ecosystem/user-service/v1/users/validate';
const GROUP_RSTT028_URL = 'https://{host}/app/service/open/rest/{group_locale}/rstt028/{awb}?caller=witt002&millis={millis}&tuOwnerCode=&postalCode={postal_code}';
const GROUP_RSTT029_URL = 'https://{host}/app/service/open/rest/{group_locale}/rstt029?match={awb}&type={type}&caller=witt002&millis={millis}';

const group = (code, host, locale, regex, example, trackingUrl, extra = {}) => ({
  code, transport: 'group', host, group_locale: locale, postcode_regex: regex, postcode_example: example, tracking_url: trackingUrl, ...extra,
});

const COUNTRIES = {
  NL: { code: 'NL', transport: 'nl', host: 'apm.gls.nl', culture: 'nl-NL', postcode_regex: /^\d{4}[A-Z]{2}$/, postcode_example: '1234AB', tracking_url: 'https://www.gls-info.nl/tracking?trackid={parcel_no}&zipcode={postal_code}' },
  DE: { code: 'DE', transport: 'de', host: DE_TRACKINGS_HOST, culture: 'de-DE', postcode_regex: /^\d{5}$/, postcode_example: '12345' },
  CA: { code: 'CA', transport: 'ca', host: 'web.gls-canada.com', culture: 'en-CA', postcode_regex: /^[ABCEGHJKLMNPRSTVXY]\d[A-Z]\d[A-Z]\d$/, postcode_example: 'K1A 0B1', tracking_url: 'https://gls-group.com/CA/en/send-and-receive/track-a-shipment/?match={parcel_no}' },
  US: { code: 'US', transport: 'us', host: 'connect.gls-us.com', culture: 'en-US', postcode_regex: /^\d{5}(-?\d{4})?$/, postcode_example: '90210' },
  PL: { code: 'PL', transport: 'pl', host: 'mygls.gls-poland.com.pl', culture: 'pl-PL', postcode_regex: /^\d{2}-?\d{3}$/, postcode_example: '00-001', tracking_url: 'https://gls-group.com/PL/en/parcel-tracking/?match={parcel_no}' },
  CH: group('CH', 'gls-group.eu', 'GROUP/en', /^\d{4}$/, '8001', 'https://gls-group.eu/EU/en/parcel-tracking?match={parcel_no}'),
  CZ: group('CZ', 'gls-group.com', 'CZ/en', /^\d{3}\s?\d{2}$/, '110 00', 'https://gls-group.eu/CZ/en/parcel-tracking?match={parcel_no}'),
  SK: group('SK', 'gls-group.com', 'SK/sk', /^\d{3}\s?\d{2}$/, '821 01', 'https://gls-group.eu/SK/sk/sledovanie-zasielok?match={parcel_no}'),
  AT: group('AT', 'gls-group.com', 'AT/en', /^\d{4}$/, '1010', 'https://gls-group.com/AT/de/paket-verfolgen/?match={parcel_no}'),
  IE: group('IE', 'gls-group.com', 'IE/en', /^[A-Z0-9]{3}[A-Z0-9]{4}$/, 'D02AF30', 'https://gls-group.com/IE/en/parcel-tracking/?match={parcel_no}'),
  FR: group('FR', 'gls-group.com', 'FR/en', /^\d{5}$/, '39100', 'https://gls-group.com/FR/fr/suivi-de-colis/?match={parcel_no}'),
  SI: group('SI', 'gls-group.com', 'SI/en', /^\d{4}$/, '1000', 'https://gls-group.com/SI/sl/sledenje-posiljki/?match={parcel_no}'),
  HR: group('HR', 'gls-group.com', 'HR/en', /^\d{5}$/, '10000', 'https://gls-group.com/HR/hr/pracenje-paketa/?match={parcel_no}'),
  IT: group('IT', 'gls-group.com', 'IT/en', /^\d{5}$/, '20121', 'https://gls-group.com/IT/it/servizi-online/ricerca-spedizioni/?match={parcel_no}&type=NAT', { group_type: 'NAT' }),
  BE: group('BE', 'gls-group.com', 'BE/en', /^\d{4}$/, '1000', 'https://gls-group.com/BE/vl/pakket-volgen/?match={parcel_no}'),
  DK: group('DK', 'gls-group.com', 'DK/en', /^\d{4}$/, '1000', 'https://gls-group.com/DK/en/parcel-tracking/?match={parcel_no}'),
  FI: group('FI', 'gls-group.com', 'FI/en', /^\d{5}$/, '00100', 'https://gls-group.com/FI/fi/laehetysseuranta/?match={parcel_no}'),
  HU: group('HU', 'gls-group.com', 'HU/en', /^\d{4}$/, '1011', 'https://gls-group.com/HU/hu/csomagkovetes/?match={parcel_no}'),
  LU: group('LU', 'gls-group.com', 'LU/en', /^\d{4}$/, '1009', 'https://gls-group.com/LU/en/track-trace/?match={parcel_no}'),
  RS: group('RS', 'gls-group.eu', 'RS/en', /^\d{5}$/, '11000', 'https://gls-group.eu/RS/sr/pracenje-paketa/?match={parcel_no}'),
};

class GlsTrackingError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'GlsTrackingError';
    this.status = status;
    this.code = code;
  }
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(values[key] ?? ''));
}

function normalizePostcode(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function normalizeTrackingNumber(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function validatePostcode(country, postcode) {
  const def = COUNTRIES[country];
  if (!def) return false;
  return def.postcode_regex.test(normalizePostcode(postcode));
}

/** Parse the free-text tracking list: one parcel per line, optional postcode after a space/comma/semicolon. */
function parseTrackingList(text) {
  const seen = new Set();
  const rows = [];
  for (const line of String(text || '').split(/[\r\n]+/)) {
    const cleaned = line.replace(/#.*$/, '').trim();
    if (!cleaned) continue;
    const [numberPart, ...rest] = cleaned.split(/[\s,;]+/);
    const parcelNo = normalizeTrackingNumber(numberPart);
    if (!parcelNo || seen.has(parcelNo)) continue;
    seen.add(parcelNo);
    const postcode = rest.length ? normalizePostcode(rest.join('')) : '';
    rows.push({ parcelNo, postcode });
  }
  return rows;
}

function formatTrackingList(rows) {
  return rows.map(row => (row.postcode ? `${row.parcelNo} ${row.postcode}` : row.parcelNo)).join('\n');
}

function trackingUrl(country, parcelNo, postcode) {
  if (!parcelNo) return null;
  const template = COUNTRIES[country]?.tracking_url;
  if (template && (postcode || !template.includes('{postal_code}'))) return template.replace('{parcel_no}', encodeURIComponent(parcelNo)).replace('{postal_code}', encodeURIComponent(postcode || ''));
  return TRACKING_URL.replace('{parcel_no}', encodeURIComponent(parcelNo));
}

function toIso(value) {
  if (!value) return null;
  const text = String(value).trim();
  return text || null;
}

function sortHistory(entries) {
  const withTime = entries.filter(entry => entry && entry.timestamp);
  withTime.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  return withTime.slice(-HISTORY_MAX_EVENTS);
}

function dimensionsOf(length, width, height) {
  if (![length, width, height].some(value => value)) return null;
  const known = [length, width, height].every(value => value !== null && value !== undefined && value !== '');
  return { length: length ?? null, width: width ?? null, height: height ?? null, text: known ? `${length} x ${width} x ${height} cm` : null };
}

function decodeHtml(value) {
  if (typeof value !== 'string') return value ?? null;
  return value
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function baseParcel(barcode, country, postcode) {
  return {
    carrier: 'GLS',
    barcode: barcode || null,
    sender: null,
    receiver: null,
    status: STATUS.UNKNOWN,
    rawStatus: null,
    delivered: false,
    deliveredAt: null,
    plannedFrom: null,
    plannedTo: null,
    pickup: false,
    pickupPoint: null,
    url: trackingUrl(country, barcode, postcode),
    weight: null,
    dimensions: null,
    history: [],
    country,
  };
}

/* ------------------------------------------------------------------ NL -- */

const NL_STATE_MAP = { 0: STATUS.REGISTERED, 1: STATUS.IN_TRANSIT, 2: STATUS.IN_TRANSIT, 3: STATUS.OUT_FOR_DELIVERY, 4: STATUS.DELIVERED };

function normalizeNl(raw, { postcode, parcelNo } = {}) {
  const address = raw.addressInfo || {};
  const scanInfo = raw.deliveryScanInfo || {};
  const state = raw.state;
  const delivered = Boolean(scanInfo.isDelivered) || state === 4;
  const eta = raw.deliveryStatus || {};
  const parcels = Array.isArray(raw.parcels) ? raw.parcels : [];
  const isPickup = Boolean(raw.isPickup) || Boolean((raw.deliveryListInfo || {}).isParcelShop);
  const shop = scanInfo.parcelShop;
  let status = state === null || state === undefined ? STATUS.UNKNOWN : (NL_STATE_MAP[state] || STATUS.UNKNOWN);
  // A pickup parcel that has been scanned at the ParcelShop but not collected yet.
  if (!delivered && isPickup && shop && status !== STATUS.DELIVERED) status = STATUS.AT_PICKUP_POINT;
  const barcode = raw.parcelNo || parcelNo;
  const parcel = baseParcel(barcode, 'NL', postcode);
  let weight = raw.weighedWeight;
  if (weight === null || weight === undefined) weight = raw.suppliedWeight;
  Object.assign(parcel, {
    sender: (address.from || {}).name || null,
    receiver: (address.to || {}).name || null,
    status,
    rawStatus: parcels[0]?.lastStatus || null,
    delivered,
    deliveredAt: delivered ? toIso(scanInfo.dateTime) : null,
    plannedFrom: delivered ? null : toIso(eta.etaTimestampMin),
    plannedTo: delivered ? null : toIso(eta.etaTimestampMax),
    pickup: isPickup,
    pickupPoint: isPickup ? (typeof shop === 'object' && shop ? shop.name || null : (shop || null)) : null,
    weight: weight === null || weight === undefined ? null : Number(weight),
    dimensions: dimensionsOf(raw.length, raw.width, raw.height),
    history: sortHistory((raw.scans || []).filter(scan => scan && scan.dateTime).map(scan => ({
      timestamp: scan.dateTime,
      status: NL_STATE_MAP[scan.state] || null,
      rawStatus: scan.eventReasonDescr || null,
    }))),
  });
  if (!parcel.rawStatus && parcel.history.length) parcel.rawStatus = parcel.history[parcel.history.length - 1].rawStatus;
  return parcel;
}

/* --------------------------------------------------------------- GROUP -- */

const GROUP_STATUS_MAP = {
  PREADVICE: STATUS.REGISTERED, PROCESSING: STATUS.REGISTERED,
  INTRANSIT: STATUS.IN_TRANSIT, INWAREHOUSE: STATUS.IN_TRANSIT, INPICKUP: STATUS.IN_TRANSIT, MULTIPACK: STATUS.IN_TRANSIT,
  INDELIVERY: STATUS.OUT_FOR_DELIVERY,
  DELIVEREDPS: STATUS.AT_PICKUP_POINT,
  DELIVERED: STATUS.DELIVERED,
  NOTPICKEDUP: STATUS.RETURNING, RETURNED: STATUS.RETURNING,
  NOTDELIVERED: STATUS.PROBLEM, CANCELLED: STATUS.PROBLEM, CANCELED: STATUS.PROBLEM, UNAVAILABLE: STATUS.PROBLEM,
};
const GROUP_EVENT_MAP = {
  '0.100': STATUS.REGISTERED, '0.0': STATUS.IN_TRANSIT, '2.0': STATUS.IN_TRANSIT, '11.0': STATUS.OUT_FOR_DELIVERY,
  '17.0': STATUS.IN_TRANSIT, '3.0': STATUS.DELIVERED, '3.896': STATUS.AT_PICKUP_POINT,
};

function groupDateTime(date, time) {
  if (!date || !time) return null;
  let d = String(date).trim();
  if (/^\d{2}-\d{2}-\d{2}$/.test(d)) d = `20${d}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}:\d{2}$/.test(String(time).trim())) return null;
  return `${d}T${String(time).trim()}`;
}

function groupWeight(infos) {
  let weight = null;
  for (const info of Array.isArray(infos) ? infos : []) {
    if (info?.type !== 'WEIGHT' || typeof info.value !== 'string') continue;
    const match = info.value.match(/^\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)\s*$/);
    if (match && match[2].toLowerCase() === 'kg') weight = Number(match[1].replace(',', '.'));
  }
  return weight;
}

function normalizeGroup(raw, { country, postcode, parcelNo } = {}) {
  const progress = raw.progressBar || {};
  const statusInfo = progress.statusInfo;
  let status = progress.retourFlag ? STATUS.RETURNING : (statusInfo ? (GROUP_STATUS_MAP[statusInfo] || STATUS.UNKNOWN) : STATUS.UNKNOWN);
  // A retour flag wins (as in ha-gls); a parcel delivered back to the sender is not "delivered" for the recipient.
  const delivered = statusInfo === 'DELIVERED' && !progress.retourFlag;
  const history = Array.isArray(raw.history) ? raw.history : [];
  const newest = history[0] || null;
  const barcode = parcelNo || raw.referenceNo || raw.tuNo;
  const parcel = baseParcel(barcode, country, postcode);
  const statusText = (newest && newest.evtDscr) || progress.statusText || null;
  Object.assign(parcel, {
    status,
    rawStatus: statusText ? decodeHtml(statusText) : null,
    delivered,
    deliveredAt: delivered && newest ? groupDateTime(newest.date, newest.time) : null,
    pickup: statusInfo === 'DELIVEREDPS',
    weight: groupWeight(raw.infos),
    history: sortHistory(history.map(event => ({
      timestamp: groupDateTime(event.date, event.time),
      status: GROUP_EVENT_MAP[event.evtNo] || null,
      rawStatus: event.evtDscr ? decodeHtml(event.evtDscr) : null,
    }))),
  });
  return parcel;
}

/* ------------------------------------------------------------------ PL -- */

const PL_EVENT_MAP = {
  'utworzenie paczki': STATUS.REGISTERED,
  'w drodze': STATUS.IN_TRANSIT,
  'w doręczeniu': STATUS.OUT_FOR_DELIVERY,
  'gotowa do odbioru': STATUS.AT_PICKUP_POINT,
  'niedoręczona': STATUS.PROBLEM,
  'doręczona': STATUS.DELIVERED,
};
const plText = value => (typeof value === 'string' && value.trim() ? value.trim().normalize('NFC').toLowerCase() : null);

function normalizePl(raw, { postcode, parcelNo } = {}) {
  const ident = typeof raw.progressBarIdent === 'string' ? raw.progressBarIdent.trim().toUpperCase() : '';
  let status = GROUP_STATUS_MAP[ident] || STATUS.UNKNOWN;
  const events = (Array.isArray(raw.eventReasons) ? raw.eventReasons : []).filter(event => event && typeof event === 'object');
  const newest = events[0] || null;
  const newestStatus = newest ? PL_EVENT_MAP[plText(newest.packageStatusName)] || null : null;
  if (status === STATUS.UNKNOWN && newestStatus) status = newestStatus;
  const delivered = status === STATUS.DELIVERED;
  const barcode = raw.parcelNumber || parcelNo;
  const parcel = baseParcel(barcode, 'PL', postcode);
  let deliveredAt = null;
  if (delivered) {
    deliveredAt = toIso(raw.stateDate);
    if (!deliveredAt) {
      const moments = events.map(event => event.packageStatusDate).filter(Boolean).sort();
      deliveredAt = moments.length ? moments[moments.length - 1] : null;
    }
  }
  const eventText = newest && typeof newest.packageStatusDescription === 'string' ? newest.packageStatusDescription.trim() || null : null;
  Object.assign(parcel, {
    status,
    rawStatus: eventText || raw.progressBar || null,
    delivered,
    deliveredAt,
    pickup: status === STATUS.AT_PICKUP_POINT,
    history: sortHistory(events.map(event => ({
      timestamp: toIso(event.packageStatusDate),
      status: PL_EVENT_MAP[plText(event.packageStatusName)] || null,
      rawStatus: event.packageStatusName || null,
    }))),
  });
  return parcel;
}

/* ------------------------------------------------------------------ US -- */

const US_STATUS_MAP = { 'shipment delivered': STATUS.DELIVERED, delivered: STATUS.DELIVERED, 'label created': STATUS.REGISTERED, 'arrival scan': STATUS.IN_TRANSIT };
const usNorm = value => (typeof value === 'string' ? value.split(/\s+/).join(' ').trim().toLowerCase() || null : null);
function usLookup(value) {
  const n = usNorm(value);
  if (!n) return null;
  if (US_STATUS_MAP[n]) return US_STATUS_MAP[n];
  const idx = n.indexOf(' - ');
  return idx > 0 ? US_STATUS_MAP[n.slice(0, idx)] || null : null;
}
function usDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value.trim().endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value.trim()) ? value.trim() : `${value.trim()}Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  if (year === 1 || year === 1900 || year < 1971) return null;
  return parsed.toISOString();
}
function usSelect(raw, parcelNo) {
  const target = String(parcelNo || '').toLowerCase();
  const matches = (Array.isArray(raw?.shipments) ? raw.shipments : []).filter(s => s && typeof s.trackingNumber === 'string' && s.trackingNumber.toLowerCase() === target);
  if (!matches.length) return null;
  const recency = s => {
    const events = (Array.isArray(s.transitDetails) ? s.transitDetails : []).map(d => usDate(d?.eventDateTime)).filter(Boolean).sort();
    return events[events.length - 1] || usDate(s.deliveryDate) || usDate(s.shipDate) || '';
  };
  return matches.reduce((best, s) => (recency(s) >= recency(best) ? s : best));
}
function normalizeUs(raw, { postcode, parcelNo } = {}) {
  const shipment = usSelect(raw, parcelNo) || {};
  let status = usLookup(shipment.status) || STATUS.UNKNOWN;
  const events = (Array.isArray(shipment.transitDetails) ? shipment.transitDetails : []).filter(d => d && typeof d === 'object');
  const eventTimes = events.map(d => usDate(d.eventDateTime)).filter(Boolean).sort();
  if (status === STATUS.UNKNOWN) {
    if (usDate(shipment.deliveryDate)) status = STATUS.DELIVERED;
    else if (eventTimes.length) status = STATUS.IN_TRANSIT;
    else if (usDate(shipment.shipDate)) status = STATUS.REGISTERED;
  }
  const barcode = shipment.trackingNumber || parcelNo;
  const parcel = baseParcel(barcode, 'US', postcode);
  const delivered = status === STATUS.DELIVERED;
  Object.assign(parcel, {
    status,
    rawStatus: shipment.status || null,
    delivered,
    deliveredAt: delivered ? (usDate(shipment.deliveryDate) || eventTimes[eventTimes.length - 1] || null) : null,
    history: sortHistory(events.map(d => ({ timestamp: usDate(d.eventDateTime), status: usLookup(d.eventDetails), rawStatus: d.eventDetails || null }))),
  });
  return parcel;
}

/* ------------------------------------------------------------------ CA -- */

const CA_STATUS_MAP = {
  'shipment created': STATUS.REGISTERED, 'information received': STATUS.REGISTERED, created: STATUS.REGISTERED,
  'picked up': STATUS.IN_TRANSIT, 'in transit': STATUS.IN_TRANSIT,
  'on delivery': STATUS.OUT_FOR_DELIVERY, 'out for delivery': STATUS.OUT_FOR_DELIVERY,
  delivered: STATUS.DELIVERED,
};
const caNorm = value => (typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null);
function caDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  return `${value.replace(' ', 'T')}+00:00`;
}
function caShipment(raw, parcelNo) {
  const target = String(parcelNo || '').toLowerCase();
  return (Array.isArray(raw?.shipments) ? raw.shipments : []).find(s => s && typeof s.trackingNumber === 'string' && s.trackingNumber.toLowerCase() === target) || null;
}
function caParty(value) {
  if (typeof value === 'string') return value || null;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.name === 'string' && value.name) return value.name;
  return [value.city, value.provinceCode, value.countryCode].filter(Boolean).join(', ') || null;
}
function normalizeCa(raw, { postcode, parcelNo } = {}) {
  const shipment = caShipment(raw, parcelNo) || {};
  const current = shipment.currentStatus && typeof shipment.currentStatus === 'object' ? shipment.currentStatus : {};
  const status = CA_STATUS_MAP[caNorm(current.name)] || STATUS.UNKNOWN;
  const barcode = shipment.trackingNumber || parcelNo;
  const parcel = baseParcel(barcode, 'CA', postcode);
  const parcels = (Array.isArray(shipment.parcels) ? shipment.parcels : []).filter(p => p && typeof p === 'object');
  const dims = new Set(parcels.map(p => JSON.stringify([p.length ?? null, p.width ?? null, p.height ?? null])));
  let dimensions = null;
  if (dims.size === 1) {
    const [l, w, h] = JSON.parse([...dims][0]);
    dimensions = dimensionsOf(l, w, h);
  }
  const history = [];
  for (const p of parcels) for (const a of Array.isArray(p.activities) ? p.activities : []) {
    if (a && typeof a === 'object') history.push({ timestamp: caDate(a.activityDate), status: CA_STATUS_MAP[caNorm(a.status)] || null, rawStatus: a.status || null });
  }
  Object.assign(parcel, {
    sender: caParty(shipment.sender),
    receiver: caParty(shipment.consignee),
    status,
    rawStatus: current.name || null,
    delivered: status === STATUS.DELIVERED,
    deliveredAt: status === STATUS.DELIVERED ? caDate(current.date) : null,
    weight: shipment.totalWeight === undefined || shipment.totalWeight === null ? null : Number(shipment.totalWeight),
    dimensions,
    history: sortHistory(history),
  });
  return parcel;
}

/* ------------------------------------------------------------------ DE -- */

const DE_ENUM_MAP = { OUT_FOR_DELIVERY: STATUS.OUT_FOR_DELIVERY, DELIVERED: STATUS.DELIVERED, NOT_DELIVERED: STATUS.PROBLEM, BLOCKED: STATUS.PROBLEM, UNKNOWN: STATUS.UNKNOWN };
const DE_TEXT_MAP = { 'Das Paket wird voraussichtlich im Laufe des Tages zugestellt.': STATUS.OUT_FOR_DELIVERY };
function deDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  return `${value.replace(' ', 'T')}+00:00`;
}
function normalizeDe(raw, { postcode, parcelNo } = {}) {
  let rawStatus = raw.latestStatusText || null;
  const eventsNewestFirst = Array.isArray(raw.deliveryEvents) ? raw.deliveryEvents : [];
  if (!rawStatus && eventsNewestFirst.length) rawStatus = eventsNewestFirst[0].description || null;
  const deliveredAt = deDate(raw.deliveredAt);
  let status = STATUS.UNKNOWN;
  if (deliveredAt) status = STATUS.DELIVERED;
  else if (raw.hasDeliveryAttemptFailed) status = STATUS.PROBLEM;
  else if (rawStatus && DE_TEXT_MAP[String(rawStatus).trim()]) status = DE_TEXT_MAP[String(rawStatus).trim()];
  else if (eventsNewestFirst.length) status = STATUS.IN_TRANSIT;
  const shop = raw.shopInformation;
  const pickup = Boolean(shop && (typeof shop === 'object' || typeof shop === 'string'));
  const sender = (raw.senderInformation && raw.senderInformation.name) || (raw.realTimeTrackingInformation && raw.realTimeTrackingInformation.senderName) || null;
  const receiver = raw.recipientName || (raw.consigneeInformation && raw.consigneeInformation.name) || null;
  const barcode = raw.trackingReference || parcelNo;
  const parcel = baseParcel(barcode, 'DE', postcode);
  parcel.url = TRACKING_URL.replace('{parcel_no}', encodeURIComponent(raw.parcelNumber || barcode || ''));
  Object.assign(parcel, {
    sender,
    receiver,
    status,
    rawStatus,
    delivered: Boolean(deliveredAt),
    deliveredAt,
    pickup,
    pickupPoint: pickup ? (typeof shop === 'object' ? shop.name || null : shop) : null,
    history: sortHistory([...eventsNewestFirst].reverse().map(event => ({ timestamp: deDate(event.occurrenceDateTime), status: null, rawStatus: event.description || null }))),
    parcelNumber: raw.parcelNumber || null,
  });
  return parcel;
}

/* ------------------------------------------------------------ transport -- */

class GlsTracker {
  /**
   * @param {object} options
   * @param {string} options.country ISO-2 code from COUNTRIES
   * @param {object} [options.state] persistent state for the DE anonymous session ({ deAppInstanceId, deParcelNumbers })
   * @param {function} [options.onStateChange] called with the updated state when it changes
   * @param {function} [options.log]
   */
  constructor({ country = 'NL', state = {}, onStateChange = null, log = () => {} } = {}) {
    if (!COUNTRIES[country]) throw new GlsTrackingError(`Unsupported GLS country: ${country}`, 0, 'COUNTRY');
    this.country = country;
    this.def = COUNTRIES[country];
    this.state = { deAppInstanceId: null, deParcelNumbers: {}, ...state };
    this.onStateChange = onStateChange;
    this.log = log;
    this._deToken = null;
    this._deTokenExpires = 0;
  }

  async _request(url, { method = 'GET', headers = {}, body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': 'MyParcel-Homey', ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let json = null;
      if (text) { try { json = JSON.parse(text); } catch (_) { json = null; } }
      return { status: response.status, text, json };
    } catch (error) {
      if (error.name === 'AbortError') throw new GlsTrackingError('GLS did not respond in time', 0, 'TIMEOUT');
      throw new GlsTrackingError(`GLS is unreachable: ${error.message}`, 0, 'NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch one parcel. Returns a canonical parcel, or null when GLS does not know
   * the number (yet) for this postcode. Throws GlsTrackingError on outages.
   */
  async track(parcelNo, postcode) {
    const number = normalizeTrackingNumber(parcelNo);
    const zip = normalizePostcode(postcode);
    if (!number) throw new GlsTrackingError('Tracking number is missing', 0, 'INPUT');
    switch (this.def.transport) {
      case 'nl': return this._trackNl(number, zip);
      case 'group': return this._trackGroup(number, zip);
      case 'pl': return this._trackPl(number, zip);
      case 'us': return this._trackUs(number, zip);
      case 'ca': return this._trackCa(number, zip);
      case 'de': return this._trackDe(number, zip);
      default: throw new GlsTrackingError(`Unsupported transport ${this.def.transport}`);
    }
  }

  async _trackNl(parcelNo, postcode) {
    const url = fill(NL_DETAILS_URL, { host: this.def.host, parcel_no: parcelNo, postal_code: postcode, culture: this.def.culture });
    const res = await this._request(url);
    if (res.status === 204 || res.status === 404) return null;
    if (res.status !== 200) throw new GlsTrackingError(`GLS HTTP ${res.status}`, res.status);
    if (!res.json || typeof res.json !== 'object') return null;
    return normalizeNl(res.json, { postcode, parcelNo });
  }

  async _trackGroup(parcelNo, postcode) {
    const url = fill(GROUP_RSTT028_URL.replace('{group_locale}', this.def.group_locale), { host: this.def.host, awb: parcelNo, millis: Date.now(), postal_code: postcode });
    const res = await this._request(url);
    if (!res.json) throw new GlsTrackingError('GLS tracking is temporarily unavailable (maintenance)', res.status, 'MAINTENANCE');
    const lastError = res.json.lastError;
    if (lastError === 'E609') {
      const fallback = await this._groupFallback(parcelNo);
      return fallback ? normalizeGroup(fallback, { country: this.country, postcode, parcelNo }) : null;
    }
    if (lastError) return null;
    if (res.status !== 200) throw new GlsTrackingError(`GLS HTTP ${res.status}`, res.status);
    return normalizeGroup(res.json, { country: this.country, postcode, parcelNo });
  }

  async _groupFallback(parcelNo) {
    const preferred = this.def.group_type || '';
    const candidates = [preferred, preferred === 'NAT' ? '' : 'NAT'];
    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const url = fill(GROUP_RSTT029_URL.replace('{group_locale}', this.def.group_locale), { host: this.def.host, awb: parcelNo, type: candidates[attempt], millis: Date.now() });
      const res = await this._request(url);
      if (!res.json) throw new GlsTrackingError('GLS tracking is temporarily unavailable (maintenance)', res.status, 'MAINTENANCE');
      const retry = res.status >= 500 || (res.status === 404 && res.json.lastError === 'E206');
      if (retry) {
        if (attempt < candidates.length - 1) continue;
        if (res.status >= 500) throw new GlsTrackingError(`GLS HTTP ${res.status}`, res.status);
        return null;
      }
      if (res.json.lastError) return null;
      const tu = Array.isArray(res.json.tuStatus) ? res.json.tuStatus : [];
      return tu.length ? { ...tu[0] } : null;
    }
    return null;
  }

  async _trackPl(parcelNo, postcode) {
    const res = await this._request(fill(PL_TRACKING_URL, { parcel_no: parcelNo }));
    if (res.status === 400 && res.json && res.json.code === 'mygls-tracking-400(111)') return null;
    if (res.status !== 200) throw new GlsTrackingError(`GLS HTTP ${res.status}`, res.status);
    if (!res.json || typeof res.json !== 'object' || Array.isArray(res.json)) return null;
    return normalizePl(res.json, { postcode, parcelNo });
  }

  async _trackUs(parcelNo, postcode) {
    const res = await this._request(US_TRACKING_URL, { method: 'POST', headers: { 'Accept-Language': 'en-US' }, body: { trackingNumbers: parcelNo, isFreight: false } });
    if (res.status === 204) return null;
    if (res.status !== 200) throw new GlsTrackingError(`GLS HTTP ${res.status}`, res.status);
    if (!res.json || !usSelect(res.json, parcelNo)) return null;
    return normalizeUs(res.json, { postcode, parcelNo });
  }

  async _trackCa(parcelNo, postcode) {
    const usable = body => {
      const shipment = body ? caShipment(body, parcelNo) : null;
      if (!shipment) return null;
      if (caNorm(shipment.currentStatus?.name) === 'norecord') return null;
      return body;
    };
    let res = await this._request(fill(CA_DETAILS_URL, { postal_code: postcode, parcel_no: parcelNo }), { headers: { 'Accept-Language': 'en-CA' } });
    if (res.status === 200) {
      const body = usable(res.json);
      return body ? normalizeCa(body, { postcode, parcelNo }) : null;
    }
    if (![401, 403, 404].includes(res.status)) throw new GlsTrackingError(`GLS HTTP ${res.status}`, res.status);
    res = await this._request(fill(CA_BASIC_URL, { parcel_no: parcelNo }), { headers: { 'Accept-Language': 'en-CA' } });
    if (res.status !== 200) throw new GlsTrackingError(`GLS HTTP ${res.status}`, res.status);
    const body = usable(res.json);
    return body ? normalizeCa(body, { postcode, parcelNo }) : null;
  }

  /* DE: anonymous app identity (no user account, no personal data). */
  _saveState() {
    if (typeof this.onStateChange === 'function') {
      try { this.onStateChange({ ...this.state }); } catch (_) { /* ignore */ }
    }
  }

  _storeDeToken(payload) {
    if (!payload || !payload.accessToken) throw new GlsTrackingError('GLS Germany returned no access token', 0, 'DE_SESSION');
    this._deToken = payload.accessToken;
    const expires = Date.parse(payload.expiresAt || '') || (typeof payload.expiresAt === 'number' ? payload.expiresAt * 1000 : 0);
    this._deTokenExpires = expires || Date.now() + 60 * 3600 * 1000;
  }

  async _deRegister() {
    const id = crypto.randomUUID();
    const res = await this._request(DE_REGISTER_URL, { method: 'POST', body: { appInstanceId: id } });
    if (res.status !== 201) throw new GlsTrackingError(`GLS Germany register failed (HTTP ${res.status})`, res.status, 'DE_SESSION');
    this.state.deAppInstanceId = id;
    this.state.deParcelNumbers = {};
    this._storeDeToken(res.json);
    this._saveState();
  }

  async _deToken_() {
    if (!this.state.deAppInstanceId) await this._deRegister();
    if (this._deToken && Date.now() < this._deTokenExpires - 6 * 3600 * 1000) return this._deToken;
    const res = await this._request(DE_VALIDATE_URL, { method: 'POST', body: { appInstanceId: this.state.deAppInstanceId } });
    if (res.status === 404) await this._deRegister();
    else if (res.status !== 200) throw new GlsTrackingError(`GLS Germany validate failed (HTTP ${res.status})`, res.status, 'DE_SESSION');
    else this._storeDeToken(res.json);
    return this._deToken;
  }

  async _deRequest(method, url, body) {
    let token = await this._deToken_();
    const call = () => this._request(url, { method, body, headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'de-DE' } });
    let res = await call();
    if (res.status === 401) {
      this._deToken = null;
      token = await this._deToken_();
      res = await call();
    }
    return res;
  }

  async _trackDe(parcelNo, postcode) {
    const known = this.state.deParcelNumbers?.[parcelNo];
    let res;
    if (known) {
      res = await this._deRequest('GET', fill(DE_DETAIL_URL, { parcel_number: known }));
      if (res.status === 404) {
        delete this.state.deParcelNumbers[parcelNo];
        this._saveState();
        return this._trackDe(parcelNo, postcode);
      }
    } else {
      res = await this._deRequest('POST', DE_ADD_URL, { trackingReference: parcelNo, postcode });
      if (res.status === 409) {
        // Already added to this anonymous instance but the id was lost: start a fresh instance once.
        await this._deRegister();
        res = await this._deRequest('POST', DE_ADD_URL, { trackingReference: parcelNo, postcode });
      }
    }
    if (res.status === 404) return null;
    if (res.status !== 200) throw new GlsTrackingError(`GLS HTTP ${res.status}`, res.status);
    if (!res.json) return null;
    if (res.json.parcelNumber && this.state.deParcelNumbers?.[parcelNo] !== res.json.parcelNumber) {
      this.state.deParcelNumbers = { ...(this.state.deParcelNumbers || {}), [parcelNo]: res.json.parcelNumber };
      this._saveState();
    }
    return normalizeDe(res.json, { postcode, parcelNo });
  }
}

module.exports = {
  GlsTracker,
  GlsTrackingError,
  COUNTRIES,
  STATUS,
  STATUS_VALUES,
  normalizePostcode,
  normalizeTrackingNumber,
  validatePostcode,
  parseTrackingList,
  formatTrackingList,
  trackingUrl,
  normalizeNl,
  normalizeGroup,
  normalizePl,
  normalizeUs,
  normalizeCa,
  normalizeDe,
};
