'use strict';

/*
 * Dragonfly Shipping / Intelcom tracking – port of ha-dragonfly (https://github.com/ha-parcel-integrations/ha-dragonfly),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 * Public, keyless cfworker tracking endpoint (one deployment per country domain); the tracking code is the only credential.
 */

const { CarrierError, request, parseJson, retryAfter, isObject, str, toIso, parseTime, sortHistory } = require('./carrier-http');

const C = 'Dragonfly';
const DEFAULT_COUNTRY = 'NL';

/**
 * code → backend. Every country runs the same cfworker platform on its own domain; only the host,
 * the consumer deep link, the label languages and the consumer brand differ (Intelcom = Canada).
 */
const COUNTRIES = Object.freeze({
  NL: {
    host: 'dragonflyshipping.nl', brand: 'Dragonfly', labelLanguages: ['nl', 'en'],
    trackingUrl: 'https://dragonflyshipping.nl/nl/volg-je-pakket/?tracking-id={code}',
    label: { en: 'Netherlands', nl: 'Nederland' },
  },
  AU: {
    host: 'dragonflyshipping.com.au', brand: 'Dragonfly', labelLanguages: ['en'],
    trackingUrl: 'https://dragonflyshipping.com.au/track-your-package/?tracking-id={code}',
    label: { en: 'Australia', nl: 'Australië' },
  },
  CA: {
    host: 'intelcom.ca', brand: 'Intelcom', labelLanguages: ['en', 'fr'],
    trackingUrl: 'https://intelcom.ca/en/track-your-package/?tracking-id={code}',
    label: { en: 'Canada (Intelcom)', nl: 'Canada (Intelcom)' },
  },
});

// Dragonfly `step` (progress bar 1..4); a negative step is the site's exception state.
const STEP_MAP = { 1: 'registered', 2: 'in_transit', 3: 'out_for_delivery', 4: 'delivered' };

function countryOf(code) {
  const c = str(code).toUpperCase();
  return COUNTRIES[c] ? c : DEFAULT_COUNTRY;
}

function brandFor(country) { return COUNTRIES[countryOf(country)].brand; }

/** Upper case, everything that is not A-Z/0-9 dropped – the consumer site's own sanitiser. */
function normalizeCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }

function mapStep(step) {
  if (step === undefined || step === null || step === '') return 'unknown';
  const n = Number(step);
  if (!Number.isFinite(n)) return 'unknown';
  if (n < 0) return 'problem';
  return STEP_MAP[n] || 'unknown';
}

function mapEventStep(step) {
  if (step === undefined || step === null || step === '') return null;
  const n = Number(step);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 'problem';
  return STEP_MAP[n] || null;
}

function trackingUrl(code, country) {
  return code ? COUNTRIES[countryOf(country)].trackingUrl.replace('{code}', encodeURIComponent(code)) : '';
}

/** Label languages: the user's language first when the backend may carry it, then the country's own order. */
function labelLanguages(country, lang) {
  const base = COUNTRIES[countryOf(country)].labelLanguages;
  const l = str(lang).toLowerCase();
  return base.includes(l) ? [l, ...base.filter(x => x !== l)] : base;
}

function formatLabel(label, status) {
  let text = String(label).replace(/\[link .+?\](.+?)\[\/link\]/gi, '$1');
  const address = isObject(status.package_location) ? status.package_location.address : null;
  if (isObject(address)) text = text.replace(/\{([^{}]+)\}/g, (m, key) => (address[key] === undefined ? m : String(address[key])));
  return text;
}

/** `labels[key][lang]` on newer payloads, `[key][lang]` on older ones – the consumer site's own fallback chain. */
function statusLabel(status, { key = 'shortLabel', country = DEFAULT_COUNTRY, lang = '' } = {}) {
  if (!isObject(status)) return '';
  for (const source of [status.labels, status]) {
    if (!isObject(source) || !isObject(source[key])) continue;
    for (const l of labelLanguages(country, lang)) {
      if (source[key][l]) return formatLabel(source[key][l], status);
    }
  }
  return '';
}

/** Epoch milliseconds (status timestamps) or ISO strings (ETA fields) → ISO string. */
function iso(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return toIso(value);
  if (/^\d{12,}$/.test(String(value))) return toIso(Number(value));
  return String(value);
}

function buildHistory(list, opts = {}) {
  const out = [];
  for (const status of Array.isArray(list) ? list : []) {
    if (!isObject(status)) continue;
    const timestamp = iso(status.timestamp);
    if (!timestamp) continue;
    out.push({ timestamp, status: mapEventStep(status.step) || 'unknown', rawStatus: statusLabel(status, opts) });
  }
  return sortHistory(out, 20);
}

class DragonflyClient {
  constructor({ country = DEFAULT_COUNTRY, fetchFn } = {}) {
    this.country = countryOf(country);
    this.host = COUNTRIES[this.country].host;
    this.fetchFn = fetchFn;
  }

  /** The `result` object for a known parcel, or null when the worker reports `not_found` (also: not yet scanned). */
  async parcel(code) {
    const url = `https://${this.host}/cfworker/v3/tracking/${encodeURIComponent(code)}/`;
    const res = await request(url, { headers: { Accept: 'application/json' } }, { carrier: C, ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}) });
    const text = await res.text();
    if (res.status === 429) throw new CarrierError('Dragonfly rate limit reached (HTTP 429)', { status: 429, retryAfter: retryAfter(res) });
    if (res.status !== 200) throw new CarrierError(`Dragonfly request failed (HTTP ${res.status})`, { status: res.status });
    const payload = parseJson(text);
    if (payload === undefined) throw new CarrierError('Dragonfly returned an unreadable response');
    if (!isObject(payload)) throw new CarrierError('Dragonfly returned an unexpected response');
    const data = payload.data;
    if (payload.success) {
      const result = isObject(data) ? data.result : null;
      return isObject(result) ? result : null; // a hollow success envelope counts as unknown
    }
    if (isObject(data) && data.code === 'not_found') return null;
    throw new CarrierError(`Dragonfly: ${(isObject(data) && data.code) || 'unknown error envelope'}`);
  }
}

/**
 * Canonical parcel. `raw` null → pending placeholder (code not known to Dragonfly yet).
 * opts: { country, lang, direction }
 */
function normalize(raw, code, opts = {}) {
  const country = countryOf(opts.country);
  const r = isObject(raw) ? raw : {};
  const last = isObject(r.last_status) ? r.last_status : {};
  const step = last.step;
  const status = mapStep(step);
  const delivered = Boolean(last.isDelivered) || Number(step) === 4;
  const publicEta = isObject(r.public_eta) ? r.public_eta : {};
  let from = iso(publicEta.from || r.eta);
  let to = iso(r.live_buffered_eta || publicEta.to || r.buffered_eta);
  const tf = parseTime(from);
  const tt = parseTime(to);
  if (tf !== null && tt !== null && tf === tt) to = null;
  else if (tf !== null && tt !== null && tt < tf) [from, to] = [to, from];
  if (delivered) { from = null; to = null; }
  const barcode = normalizeCode(r.tracking_id || code);
  // last_mile_pickup = a driver comes to collect a parcel from you (e.g. a return), not a pickup-point delivery.
  const collect = last.task_type === 'last_mile_pickup';
  const labelOpts = { country, lang: opts.lang };
  return {
    barcode,
    sender: str(r.client_code),
    receiver: '',
    status: isObject(raw) ? status : 'unknown',
    rawStatus: statusLabel(last, labelOpts),
    statusCode: step === undefined || step === null ? '' : String(step),
    delivered,
    deliveredAt: delivered ? iso(last.timestamp) : null,
    plannedFrom: from,
    plannedTo: to,
    windowKnown: Boolean(from && to),
    pickup: false,
    pickupPoint: '',
    url: trackingUrl(barcode, country),
    weight: null,
    dimensions: null,
    history: buildHistory(r.status_list, labelOpts),
    direction: opts.direction === 'outgoing' || collect ? 'outgoing' : 'incoming',
    service: collect ? 'last_mile_pickup' : str(last.task_type),
    origin: '',
    destination: country,
    pickupCode: '',
    pickupDeadline: null,
    item: '',
    stopsUntilYou: null,
    pending: !isObject(raw),
  };
}

module.exports = {
  DragonflyClient, normalize, normalizeCode, statusLabel, buildHistory, mapStep, trackingUrl, brandFor, countryOf,
  COUNTRIES, DEFAULT_COUNTRY, STEP_MAP,
};
