'use strict';

/*
 * Amazon order tracking – port of ha-amazon (https://github.com/ha-parcel-integrations/ha-amazon),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors
 * (custom_components/amazon_orders/account/client.py, parcels.py, const.py).
 * The sign-in in ./amazon-auth.js is adapted (via ha-amazon) from alexapy, Copyright Keaton Taylor and
 * Alan Tse, Apache License 2.0 – see ha-amazon's NOTICE and LICENSE-Apache-2.0.
 *
 * Account based and experimental: Amazon has no tracking API, so every poll renews the stored sign-in,
 * mints website cookies, reads the signed-in orders page and follows the order lines that are still
 * moving (order-line page → ship-track page). Fan-out is capped like HA: at most MAX_TRACK_LOADS
 * shipments per poll (stalest first), a delivered shipment is read once and then cached, and nothing
 * delivered longer ago than DELIVERED_LOOKBACK_DAYS is followed.
 */

const { CarrierError, request, retryAfter, sortHistory, zonedIso } = require('./carrier-http');
const auth = require('./amazon-auth');
const pages = require('./amazon-pages');

const { STATUS } = pages;
const C = 'Amazon';

/** Storefronts (HA COUNTRY_DOMAINS). Setting `country` holds the code; the domain is what Amazon uses. */
const COUNTRIES = {
  NL: { domain: 'amazon.nl', label: 'Netherlands', timeZone: 'Europe/Amsterdam' },
  DE: { domain: 'amazon.de', label: 'Germany', timeZone: 'Europe/Berlin' },
  FR: { domain: 'amazon.fr', label: 'France', timeZone: 'Europe/Paris' },
  GB: { domain: 'amazon.co.uk', label: 'United Kingdom', timeZone: 'Europe/London' },
  US: { domain: 'amazon.com', label: 'United States', timeZone: 'America/New_York' },
  BE: { domain: 'amazon.com.be', label: 'Belgium', timeZone: 'Europe/Brussels' },
  ES: { domain: 'amazon.es', label: 'Spain', timeZone: 'Europe/Madrid' },
  IT: { domain: 'amazon.it', label: 'Italy', timeZone: 'Europe/Rome' },
  IE: { domain: 'amazon.ie', label: 'Ireland', timeZone: 'Europe/Dublin' },
  SE: { domain: 'amazon.se', label: 'Sweden', timeZone: 'Europe/Stockholm' },
  PL: { domain: 'amazon.pl', label: 'Poland', timeZone: 'Europe/Warsaw' },
  CA: { domain: 'amazon.ca', label: 'Canada', timeZone: 'America/Toronto' },
  AU: { domain: 'amazon.com.au', label: 'Australia', timeZone: 'Australia/Sydney' },
  JP: { domain: 'amazon.co.jp', label: 'Japan', timeZone: 'Asia/Tokyo' },
  IN: { domain: 'amazon.in', label: 'India', timeZone: 'Asia/Kolkata' },
  MX: { domain: 'amazon.com.mx', label: 'Mexico', timeZone: 'America/Mexico_City' },
  BR: { domain: 'amazon.com.br', label: 'Brazil', timeZone: 'America/Sao_Paulo' },
};
const DEFAULT_COUNTRY = 'NL';

const ORDERS_PATHS = ['/your-orders/orders', '/gp/css/order-history'];
const MAX_TRACK_LOADS = 10;
const DELIVERED_LOOKBACK_DAYS = 7;
const REQUEST_PAUSE_MS = 1000;
const HISTORY_MAX_EVENTS = 20;
const MAX_STORED_EVENTS = 30;
const MAX_REDIRECTS = 5;
// Polling tiers (minutes) – HA: hot 15 (out for delivery), mid 45 (in flight), idle 120 (nothing in flight).
const HOT_INTERVAL_MINUTES = 15;
const MID_INTERVAL_MINUTES = 45;
const IDLE_INTERVAL_MINUTES = 120;

const WEB_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/** Country code (or a storefront domain) → { code, domain, label, timeZone }. */
function resolveCountry(value) {
  const text = String(value || '').trim();
  const upper = text.toUpperCase();
  if (COUNTRIES[upper]) return { code: upper, ...COUNTRIES[upper] };
  const domain = text.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  for (const [code, entry] of Object.entries(COUNTRIES)) if (entry.domain === domain) return { code, ...entry };
  return { code: DEFAULT_COUNTRY, ...COUNTRIES[DEFAULT_COUNTRY] };
}

/** Barcodes are Amazon tracking ids (e.g. TBA…, AMZNL…) or shipment stand-ins; keep their case, drop spaces. */
function normalizeCode(code) { return String(code || '').trim().replace(/\s+/g, ''); }

/* ------------------------------------------------------------------ cookies -- */

function parseSetCookie(line) {
  const parts = String(line || '').split(';').map(s => s.trim());
  const first = parts.shift() || '';
  const eq = first.indexOf('=');
  if (eq <= 0) return null;
  const cookie = { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim(), expired: false };
  for (const attr of parts) {
    const [k, ...rest] = attr.split('=');
    const key = k.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'max-age' && Number(val) <= 0) cookie.expired = true;
    if (key === 'expires' && Date.parse(val) < Date.now()) cookie.expired = true;
  }
  return cookie;
}

function setCookieLines(res) {
  const headers = res?.headers;
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') { const list = headers.getSetCookie(); if (Array.isArray(list)) return list; }
  const raw = headers.get?.('set-cookie');
  return raw ? String(raw).split(/,(?=\s*[^;,=\s]+=)/) : [];
}

/* -------------------------------------------------------------------- client -- */

class AmazonClient {
  /**
   * @param {object} o
   * @param {string} o.country      country code or storefront domain
   * @param {string} o.refreshToken stored refresh token (from the device registration)
   * @param {string} [o.apiHost]    API host that answered last time
   * @param {object} [o.state]      persisted { final, last } shipment cache (see `state`)
   */
  constructor({ country = DEFAULT_COUNTRY, refreshToken, apiHost = null, state = null, fetchFn = null, pauseMs = REQUEST_PAUSE_MS, sleep = null, now = null } = {}) {
    const resolved = resolveCountry(country);
    this.country = resolved.code;
    this.domain = resolved.domain;
    this.timeZone = resolved.timeZone;
    this.refreshToken = refreshToken;
    this.apiHost = apiHost;
    this.fetchFn = fetchFn || ((...args) => fetch(...args));
    this.pauseMs = pauseMs;
    this.sleep = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.now = now || (() => Date.now());
    this.cookies = {};
    this._requests = 0;
    // Shipments read in full once delivered are never fetched again; `last` lets a capped cycle rotate.
    this.state = { final: { ...(state?.final || {}) }, last: { ...(state?.last || {}) } };
  }

  today() { return pages.todayIn(this.timeZone, this.now()); }

  /** Renew the access token and mint fresh website cookies (like HA, on every poll). */
  async authenticate() {
    const { host } = await auth.refreshAccessToken(this.domain, this.refreshToken, { preferredHost: this.apiHost, fetchFn: this.fetchFn });
    this.apiHost = host;
    const cookies = await auth.exchangeTokenForCookies(this.domain, this.refreshToken, { fetchFn: this.fetchFn });
    this.cookies = {};
    for (const item of cookies) this.cookies[item.Name] = String(item.Value ?? '').replace(/^"|"$/g, '');
  }

  _cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }

  _absorbCookies(res) {
    for (const line of setCookieLines(res)) {
      const cookie = parseSetCookie(line);
      if (!cookie) continue;
      if (cookie.expired) delete this.cookies[cookie.name]; else this.cookies[cookie.name] = cookie.value.replace(/^"|"$/g, '');
    }
  }

  /** GET a signed-in page; follows redirects itself so cookies set on the way are kept. */
  async fetchPage(path) {
    if (this._requests) await this.sleep(this.pauseMs);
    this._requests += 1;
    let url = /^https?:/.test(path) ? path : `https://www.${this.domain}${path}`;
    let res;
    for (let hop = 0; ; hop += 1) {
      res = await request(url, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': WEB_USER_AGENT, Cookie: this._cookieHeader(), 'Accept-Language': 'en-GB,en;q=0.8' } }, { carrier: C, fetchFn: this.fetchFn });
      this._absorbCookies(res);
      const location = res.headers?.get?.('location');
      if (res.status >= 300 && res.status < 400 && location && hop < MAX_REDIRECTS) { url = new URL(location, url).toString(); continue; }
      break;
    }
    const { status } = res;
    if (status === 401 || status === 403) throw new CarrierError(`Amazon refused the page (HTTP ${status})`, { status, auth: true });
    if (status === 429 || status === 503) throw new CarrierError(`Amazon rate-limited (HTTP ${status})`, { status, retryAfter: retryAfter(res) });
    let landedOn = '';
    try { landedOn = new URL(url).pathname; } catch (_) { /* keep empty */ }
    if (status >= 300 && status < 400 && /\/ap\/signin/.test(res.headers?.get?.('location') || '')) landedOn = '/ap/signin';
    if (status !== 200 && landedOn !== '/ap/signin') throw new CarrierError(`Amazon request failed (HTTP ${status})`, { status });
    const page = await res.text();
    if (landedOn.includes('/ap/signin') || pages.looksSignedOut(page)) throw new CarrierError('Amazon redirected to the sign-in page', { auth: true });
    return page;
  }

  /** Read the orders page, falling back to the legacy history path. */
  async fetchTiles(today) {
    let failure = null;
    for (const path of ORDERS_PATHS) {
      let tiles;
      try {
        tiles = pages.parseOrderTiles(await this.fetchPage(path), today);
      } catch (error) {
        if (error.auth || error.status === 429 || error.status === 503 || !error.status) throw error;
        failure = error;
        continue;
      }
      if (tiles.length) return tiles;
    }
    if (failure) throw failure;
    pages.warnOnce('no-order-lines', 'No order lines were recognised on the Amazon orders page. If you have recent orders, Amazon may have changed the page.');
    return [];
  }

  async readShipment(tiles, today) {
    const popPage = await this.fetchPage(tiles[0].popPath);
    const trackPath = pages.parseTrackLink(popPage);
    let track = null;
    if (trackPath) {
      track = pages.parseTrackPage(await this.fetchPage(trackPath), today, { zonedIso, fallbackZone: this.timeZone });
      if (!track.trackingId && !track.events.length) pages.warnOnce('empty-track-page', 'A shipment tracking page held no tracking id and no timeline; Amazon may have changed the page.');
    }
    return slim(pages.buildRecord(this.domain, tiles, trackPath, track), today);
  }

  static isDelivered(tiles, record) { return pages.tileDelivered(tiles[0]) || record.milestone === 'DELIVERED'; }

  /**
   * One raw record per shipment worth showing. `skip(key, record)` may veto re-reading a shipment
   * (the device passes "already announced as delivered").
   */
  async getParcels({ skip = null } = {}) {
    this._requests = 0;
    await this.authenticate();
    const today = this.today();
    const tiles = await this.fetchTiles(today);

    const groups = new Map();
    for (const tile of tiles) {
      const key = pages.tileKey(tile);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tile);
    }
    const { final, last } = this.state;
    for (const key of Object.keys(final)) if (!groups.has(key)) delete final[key];
    for (const key of Object.keys(last)) if (!groups.has(key)) delete last[key];

    const cutoff = pages.addDays(today, -DELIVERED_LOOKBACK_DAYS);
    const work = [];
    for (const [key, group] of groups) {
      const lead = group[0];
      if (final[key]) continue;
      if (pages.tileDelivered(lead) && lead.deliveredOn && lead.deliveredOn < cutoff) continue;
      if (skip && last[key] && skip(key, last[key].record)) continue;
      work.push(key);
    }
    work.sort((a, b) => (last[a]?.at || 0) - (last[b]?.at || 0));
    const read = new Set();
    for (const key of work.slice(0, MAX_TRACK_LOADS)) {
      const group = groups.get(key);
      const record = await this.readShipment(group, today);
      last[key] = { record, at: this.now() };
      read.add(key);
      if (AmazonClient.isDelivered(group, record)) final[key] = record;
    }

    const records = [];
    for (const [key, group] of groups) {
      if (final[key]) records.push({ ...final[key], key });
      else if (last[key]) {
        // Homey: a shipment not re-read this cycle still gets the order line's current wording (no extra request).
        const record = read.has(key) ? last[key].record : refreshFromTiles(last[key].record, group, today);
        last[key].record = record;
        records.push({ ...record, key });
      }
    }
    return records;
  }
}

/** Keep what the mapping needs; the embedded page state is dropped (privacy, store size). */
function slim(record, today) {
  const { page_state: _drop, ...rest } = record;
  return { ...rest, events: (record.events || []).slice(0, MAX_STORED_EVENTS), seen_on: today };
}

function refreshFromTiles(record, tiles, today) {
  const lead = tiles[0];
  return {
    ...record,
    order_status: lead.statusText || null,
    order_status_note: lead.statusNote,
    delivered_on: lead.deliveredOn || record.delivered_on || null,
    items: tiles.map(t => t.title),
    seen_on: today,
  };
}

/* ------------------------------------------------------------------- mapping -- */

// Progress-tracker milestones: only DELIVERED has been observed.
const MILESTONE_MAP = { DELIVERED: STATUS.DELIVERED };

// Timeline messages, lower-cased.
const EVENT_MAP = {
  'package arrived at an amazon facility': STATUS.IN_TRANSIT,
  'package departed an amazon facility': STATUS.IN_TRANSIT,
  'parcel arrived at a carrier facility': STATUS.IN_TRANSIT,
  'package left the courier facility': STATUS.IN_TRANSIT,
  'out for delivery': STATUS.OUT_FOR_DELIVERY,
  'delivered to customer': STATUS.DELIVERED,
  'delivered to letterbox': STATUS.DELIVERED,
};
// Homey addition (not in ha-amazon, unconfirmed wording): pickup-location events.
const PICKUP_EVENT_PREFIXES = ['ready for pickup', 'available for pickup', 'ready for collection', 'available for collection', 'ready to be picked up'];

const CARRIER_NAMES = { DRAGONFLY: 'Dragonfly', DHL_CONNECT: 'DHL' };

function parseIso(value) {
  if (!value) return null;
  const text = String(value).trim();
  const t = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) || !/T\d{2}:\d{2}/.test(text) ? text : `${text}Z`);
  return Number.isFinite(t) ? t : null;
}

function eventStatus(message) {
  if (!message) return null;
  const text = String(message).trim().toLowerCase();
  if (EVENT_MAP[text]) return EVENT_MAP[text];
  if (text.startsWith('delivered')) return STATUS.DELIVERED;
  if (PICKUP_EVENT_PREFIXES.some(prefix => text.startsWith(prefix))) return STATUS.AT_PICKUP_POINT;
  return null;
}

/** A timeline message → canonical status or null (unmapped: warn once). */
function mapEventStatus(message) {
  if (!message) return null;
  const mapped = eventStatus(message);
  if (!mapped) pages.warnOnce(`event=${String(message).trim()}`, `Unrecognised Amazon status: event=${String(message).trim()} → reported as 'unknown'.`);
  return mapped;
}

function orderTextStatus(text) {
  const [kind, confirmed] = pages.classifyOrderText(text);
  if (!kind || kind === pages.SKIP) return null;
  if (!confirmed) {
    const masked = pages.mask(text);
    pages.warnOnce(`plausible-status=${masked}`, `The Amazon order-line text "${masked}" was read as ${kind} from wording that is not confirmed yet; please confirm it is right.`);
  }
  return kind;
}

function eventsNewestFirst(raw) {
  return (Array.isArray(raw.events) ? raw.events : [])
    .filter(e => e && typeof e === 'object')
    .map((e, i) => [parseIso(e.timestamp) ?? -Infinity, i, e])
    .sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]))
    .map(([, , e]) => e);
}

/** Milestone, else the newest mappable event, else the order-line text, else unknown (warn once). */
function resolveStatus(raw) {
  const milestone = raw.milestone || null;
  if (milestone && MILESTONE_MAP[milestone]) return MILESTONE_MAP[milestone];
  const events = eventsNewestFirst(raw);
  let status = null;
  for (const event of events) { status = eventStatus(event.message); if (status) break; }
  if (!status) status = orderTextStatus(raw.order_status);
  if (!status) {
    const newest = events[0]?.message || null;
    pages.warnOnce(`milestone=${milestone} event=${newest} order_status=${pages.mask(raw.order_status)}`,
      `Unrecognised Amazon status: milestone=${milestone} event=${newest} order_status=${pages.mask(raw.order_status)} → reported as 'unknown'.`);
    return STATUS.UNKNOWN;
  }
  if (milestone) pages.warnOnce(`milestone=${milestone}`, `Unrecognised Amazon status: milestone=${milestone}.`);
  return status;
}

function barcodeOf(raw) {
  if (raw.tracking_id) return String(raw.tracking_id);
  const shipment = raw.shipment_id;
  if (!shipment) return null;
  const pkg = raw.package_id;
  return pkg === undefined || pkg === null || pkg === '' || pkg === '1' ? String(shipment) : `${shipment}-${pkg}`;
}

function carrierName(raw) {
  const code = raw.carrier_code;
  if (!code) {
    if (raw.carrier_header) pages.warnOnce(`carrier-header=${pages.mask(raw.carrier_header)}`, `Amazon named the delivery carrier as "${pages.mask(raw.carrier_header)}", which could not be read.`);
    else if (raw.tracking_id) pages.warnOnce('carrier=missing', "Amazon's tracking page named no delivery carrier.");
    return 'Amazon';
  }
  if (CARRIER_NAMES[code]) return CARRIER_NAMES[code];
  pages.warnOnce(`carrier=${code}`, `Amazon named a delivery carrier that has not been seen before (carrier_code=${code}).`);
  return String(code).replace(/_/g, ' ').toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());
}

function trackingUrl(raw) {
  const path = raw.track_path || raw.pop_path;
  if (!path) return '';
  return /^https?:/.test(String(path)) ? String(path) : `https://www.${raw.domain}${path}`;
}

function deliveredAt(raw) {
  let best = null;
  for (const event of Array.isArray(raw.events) ? raw.events : []) {
    if (!event || eventStatus(event.message) !== STATUS.DELIVERED) continue;
    const t = parseIso(event.timestamp);
    if (t !== null && (!best || t > best[0])) best = [t, event.timestamp];
  }
  if (best) return best[1];
  return raw.delivered_on || null; // a plain day ("2026-10-03")
}

function rawStatusText(raw) {
  // HA sorts oldest → newest and takes the last one (ties: the later one on the page).
  const ascending = (Array.isArray(raw.events) ? raw.events : [])
    .filter(e => e && typeof e === 'object')
    .map((e, i) => [parseIso(e.timestamp) ?? -Infinity, i, e])
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const newest = ascending.length ? ascending[ascending.length - 1][2] : null;
  if (newest?.message) return String(newest.message);
  return raw.order_status || raw.milestone || '';
}

function buildHistory(events) {
  const entries = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object' || !event.timestamp) continue;
    entries.push({ timestamp: String(event.timestamp), status: mapEventStatus(event.message), rawStatus: event.message || '' });
  }
  return sortHistory(entries, HISTORY_MAX_EVENTS);
}

const TODAY_RE = /\b(today|heute)\b|vandaag|aujourd|\bhoy\b|\boggi\b|\bidag\b|dzisiaj/i;
const TOMORROW_RE = /\btomorrow\b|\bmorgen\b|demain|mañana|domani|imorgon|\bjutro\b/i;

/** Homey addition: the expected delivery DAY from the order line ("Arriving today", "Arriving 12 October"). */
function expectedDay(raw, status) {
  if (![STATUS.IN_TRANSIT, STATUS.OUT_FOR_DELIVERY, STATUS.REGISTERED].includes(status)) return null;
  const text = String(raw.order_status || '');
  const [kind] = pages.classifyOrderText(text);
  if (![STATUS.IN_TRANSIT, STATUS.OUT_FOR_DELIVERY].includes(kind)) return null;
  const seen = /^\d{4}-\d{2}-\d{2}$/.test(raw.seen_on || '') ? raw.seen_on : null;
  if (!seen) return null;
  if (TODAY_RE.test(text)) return seen;
  if (TOMORROW_RE.test(text)) return pages.addDays(seen, 1);
  return pages.dayMonth(text, seen, { forward: true });
}

/** Raw shipment record → canonical parcel (see the porting spec for the shape). */
function normalize(raw, code = '', opts = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const status = Object.keys(r).length ? resolveStatus(r) : STATUS.UNKNOWN;
  const delivered = status === STATUS.DELIVERED;
  const plannedFrom = delivered ? null : expectedDay(r, status);
  const items = Array.isArray(r.items) ? r.items.filter(Boolean) : [];
  return {
    barcode: normalizeCode(barcodeOf(r) || code),
    sender: '',
    receiver: '',
    status,
    rawStatus: rawStatusText(r),
    statusCode: r.milestone || '',
    delivered,
    deliveredAt: delivered ? deliveredAt(r) : null,
    plannedFrom,
    plannedTo: null,
    windowKnown: false,
    pickup: status === STATUS.AT_PICKUP_POINT,
    pickupPoint: '',
    url: trackingUrl(r),
    weight: null,
    dimensions: null,
    history: opts.history === false ? null : buildHistory(r.events),
    direction: 'incoming',
    service: Object.keys(r).length ? carrierName(r) : '',
    origin: '',
    destination: '',
    pickupCode: '',
    pickupDeadline: null,
    item: items.join(', '),
    stopsUntilYou: null,
    orderId: r.order_id || '',
    trackingId: r.tracking_id || '',
    statusNote: r.order_status_note || '',
  };
}

/** Like ha-amazon's coordinator: an unknown line without a tracking id is not known to be a parcel. */
function isUnresolved(parcel, raw) { return parcel.status === STATUS.UNKNOWN && !raw?.tracking_id; }

module.exports = {
  AmazonClient, normalize, normalizeCode, resolveCountry, resolveStatus, mapEventStatus, isUnresolved, buildHistory,
  COUNTRIES, DEFAULT_COUNTRY, ORDERS_PATHS, MAX_TRACK_LOADS, DELIVERED_LOOKBACK_DAYS, REQUEST_PAUSE_MS,
  HOT_INTERVAL_MINUTES, MID_INTERVAL_MINUTES, IDLE_INTERVAL_MINUTES,
  auth, pages,
};
