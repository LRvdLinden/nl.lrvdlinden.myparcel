'use strict';

/*
 * Amazon order pages – port of ha-amazon (https://github.com/ha-parcel-integrations/ha-amazon),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 * Ported from custom_components/amazon_orders/account/pages.py and account/vocabulary.py.
 *
 * Pure functions over the HTML of the signed-in orders page, the order-line ("pop") page and the
 * shipment-tracking ("ship-track") page. Embedded JSON state is preferred over visible text.
 */

const STATUS = {
  REGISTERED: 'registered', IN_TRANSIT: 'in_transit', OUT_FOR_DELIVERY: 'out_for_delivery', AT_PICKUP_POINT: 'at_pickup_point',
  DELIVERED: 'delivered', RETURNING: 'returning', PROBLEM: 'problem', UNKNOWN: 'unknown',
};
/** A line that must never count as incoming (cancelled, returned, refunded). */
const SKIP = 'skip';

/* ----------------------------------------------------------- one-shot warnings -- */

const NEW_ISSUE_URL = 'https://github.com/ha-parcel-integrations/ha-amazon/issues/new?template=unrecognised_status.yml';
const warned = new Set();
let logger = (...args) => console.log('[Amazon]', ...args); // eslint-disable-line no-console

function setLogger(fn) { if (typeof fn === 'function') logger = fn; }

/** Log a warning once per app session. Only vocabulary and structure – never a name, address or id. */
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  logger(`${message} Please report it: ${NEW_ISSUE_URL}`);
}

function mask(text) { return String(text || '').replace(/\d+/g, '#'); }

/* ------------------------------------------------------------------ vocabulary -- */

const CONFIRMED_TEXT = [
  ['delivered', STATUS.DELIVERED], ['arriving', STATUS.IN_TRANSIT], ['shipped', STATUS.IN_TRANSIT], ['dispatched', STATUS.IN_TRANSIT],
  ['cancelled', SKIP], ['return complete', SKIP], ['refund', SKIP],
];

const PLAUSIBLE_TEXT = [
  ['out for delivery', STATUS.OUT_FOR_DELIVERY], ['not yet dispatched', STATUS.REGISTERED],
  // nl
  ['bezorgd', STATUS.DELIVERED], ['verwacht', STATUS.IN_TRANSIT], ['aankomst', STATUS.IN_TRANSIT],
  ['wordt vandaag bezorgd', STATUS.OUT_FOR_DELIVERY], ['vandaag bezorgd', STATUS.OUT_FOR_DELIVERY], ['wordt bezorgd', STATUS.IN_TRANSIT],
  ['nog niet verzonden', STATUS.REGISTERED], ['verzonden', STATUS.IN_TRANSIT], ['geannuleerd', SKIP], ['retour', SKIP], ['terugbetaald', SKIP],
  // fr
  ['livré', STATUS.DELIVERED], ['arrivée prévue', STATUS.IN_TRANSIT], ['livraison prévue', STATUS.IN_TRANSIT], ['pas encore expédié', STATUS.REGISTERED],
  ['expédié', STATUS.IN_TRANSIT], ['en cours de livraison', STATUS.OUT_FOR_DELIVERY], ["livraison aujourd'hui", STATUS.OUT_FOR_DELIVERY],
  ['annulé', SKIP], ['retourné', SKIP], ['remboursé', SKIP],
  // de
  ['zugestellt', STATUS.DELIVERED], ['geliefert', STATUS.DELIVERED], ['ankunft', STATUS.IN_TRANSIT], ['zustellung am', STATUS.IN_TRANSIT],
  ['noch nicht versandt', STATUS.REGISTERED], ['versandt', STATUS.IN_TRANSIT], ['zustellung heute', STATUS.OUT_FOR_DELIVERY],
  ['wird heute zugestellt', STATUS.OUT_FOR_DELIVERY], ['storniert', SKIP], ['zurückgesendet', SKIP], ['erstattet', SKIP],
  // es
  ['entregado', STATUS.DELIVERED], ['llegará', STATUS.IN_TRANSIT], ['aún no enviado', STATUS.REGISTERED], ['enviado', STATUS.IN_TRANSIT],
  ['en reparto', STATUS.OUT_FOR_DELIVERY], ['llega hoy', STATUS.OUT_FOR_DELIVERY], ['cancelado', SKIP], ['devuelto', SKIP], ['reembolsado', SKIP],
  // it
  ['consegnato', STATUS.DELIVERED], ['arriverà', STATUS.IN_TRANSIT], ['consegna prevista', STATUS.IN_TRANSIT], ['non ancora spedito', STATUS.REGISTERED],
  ['spedito', STATUS.IN_TRANSIT], ['in consegna', STATUS.OUT_FOR_DELIVERY], ['annullato', SKIP], ['reso', SKIP], ['rimborsato', SKIP],
  // sv
  ['levererad', STATUS.DELIVERED], ['beräknad leverans', STATUS.IN_TRANSIT], ['anländer', STATUS.IN_TRANSIT], ['ännu inte skickad', STATUS.REGISTERED],
  ['skickad', STATUS.IN_TRANSIT], ['levereras idag', STATUS.OUT_FOR_DELIVERY], ['avbruten', SKIP],
  // pl
  ['dostarczono', STATUS.DELIVERED], ['dostawa dzisiaj', STATUS.OUT_FOR_DELIVERY], ['dostawa', STATUS.IN_TRANSIT], ['przyjdzie', STATUS.IN_TRANSIT],
  ['jeszcze nie wysłano', STATUS.REGISTERED], ['wysłano', STATUS.IN_TRANSIT], ['anulowano', SKIP],
];

// Longest prefix first, so "not yet dispatched" is never read as a shorter one (stable sort like Python's).
const TEXT = [...CONFIRMED_TEXT.map(([p, k]) => [p, k, true]), ...PLAUSIBLE_TEXT.map(([p, k]) => [p, k, false])]
  .sort((a, b) => b[0].length - a[0].length);
const STATUS_PREFIXES = TEXT.map(([prefix]) => prefix);

/** What an order-line status text means, and whether that wording is confirmed: [kind|null, confirmed]. */
function classifyOrderText(text) {
  const lowered = String(text || '').trim().toLowerCase();
  for (const [prefix, kind, confirmed] of TEXT) if (lowered.startsWith(prefix)) return [kind, confirmed];
  return [null, false];
}

function monthTable(table) {
  const out = {};
  table.split('|').forEach((names, index) => { for (const name of names.split(/\s+/).filter(Boolean)) out[name] = index + 1; });
  return out;
}
// English, German and French, including short forms.
const CONFIRMED_MONTHS = monthTable(
  'january jan januar janvier janv|february feb februar février févr fév|march mar märz mars|april apr avril avr|may mai|'
  + 'june jun juni juin|july jul juli juillet juil|august aug août|september septembre sep sept|october oct okt octobre|'
  + 'november novembre nov|december dec dez décembre déc',
);
// Italian, Spanish, Dutch, Swedish and Polish names (plausible). "augustus" (nl) added for Homey.
const PLAUSIBLE_MONTHS = monthTable(
  'gennaio enero januari januari stycznia|febbraio febrero februari lutego|marzo marzo maart mrt marca|aprile abril kwietnia|'
  + 'maggio mayo mei maj maja|giugno junio czerwca|luglio julio juli lipca|agosto agosto augusti augustus sierpnia|'
  + 'settembre septiembre września|ottobre octubre oktober października|novembre noviembre listopada|dicembre diciembre december grudnia',
);
const MONTHS = { ...PLAUSIBLE_MONTHS, ...CONFIRMED_MONTHS };

/* ------------------------------------------------------------------- helpers -- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function unescapeHtml(text) {
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const key = name.toLowerCase();
    return key in ENTITIES ? ENTITIES[key] : match;
  });
}

/** Plain calendar dates as "YYYY-MM-DD" strings (comparable as text). */
function ymd(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

/** Today's date in a time zone, as "YYYY-MM-DD". */
function todayIn(timeZone, now = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  } catch (_) { return new Date(now).toISOString().slice(0, 10); }
}

// "3 October", "3. Oktober", "3 de octubre", "3 Oct. 2026".
const DAY_MONTH_RE = /(\d{1,2})\.?\s+(?:de\s+)?(\p{L}+)\.?(?:\s+(?:de\s+)?(\d{4}))?/u;

/**
 * Resolve "3 October" (year optional) against a reference day. By default the date is in the past
 * (rolled back a year when it would land >2 days in the future); with `forward` it falls on or after
 * the reference.
 */
function dayMonth(text, reference, { forward = false } = {}) {
  const match = DAY_MONTH_RE.exec(String(text || ''));
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  const refYear = Number(reference.slice(0, 4));
  const year = match[3] ? Number(match[3]) : refYear;
  const found = ymd(year, month, Number(match[1]));
  if (!found) return null;
  if (match[3]) return found;
  if (forward && found < reference) return ymd(year + 1, month, Number(match[1]));
  if (!forward && found > addDays(reference, 2)) return ymd(year - 1, month, Number(match[1]));
  return found;
}

/* --------------------------------------------------------------- order lines -- */

const TILE_RE = /<a class="item-card__link" href="([^"]*)" aria-label="([^"]*)"/g;
const PLACED_RE = /Order placed (\d{1,2} [A-Za-z]+ \d{4})(?:, ([\s\S]*))?$/;
const ORDER_ID_RE = /\d{3}-\d{7}-\d{7}/;

function query(href) {
  const out = {};
  try {
    for (const [key, value] of new URL(href, 'https://www.amazon.invalid').searchParams) {
      const k = key.toLowerCase();
      if (value !== '' && !(k in out)) out[k] = value;
    }
  } catch (_) { /* no query */ }
  return out;
}

/** "<title>, <status>[, <note>]" without "Order placed": the status is the first segment opening with known wording. */
function splitUnanchoredLabel(label) {
  const segments = label.split(', ');
  for (let i = 1; i < segments.length; i += 1) {
    if (STATUS_PREFIXES.some(prefix => segments[i].toLowerCase().startsWith(prefix))) {
      return [segments.slice(0, i).join(', '), segments[i], segments.slice(i + 1).join(', ')];
    }
  }
  return [label, '', ''];
}

function shipmentKey(tile) { return tile.shipmentId || `${tile.orderId}-${tile.lineItemId || tile.position}`; }

/** Identity of the shipment an order line belongs to (order | shipment | package). */
function tileKey(tile) { return [tile.orderId, shipmentKey(tile), tile.packageId].join('|'); }

function tileDelivered(tile) { return classifyOrderText(tile.statusText)[0] === STATUS.DELIVERED; }

/** Every order line on an orders page, in page order. `today` is "YYYY-MM-DD". */
function parseOrderTiles(page, today) {
  const tiles = [];
  const matches = [...String(page || '').matchAll(TILE_RE)];
  matches.forEach((match, position) => {
    const href = unescapeHtml(match[1]);
    const label = unescapeHtml(match[2]);
    const q = query(href);
    let orderId = q.orderid || '';
    if (!orderId) orderId = (href.match(ORDER_ID_RE) || [''])[0];
    if (!orderId) return;
    // The aria-label is the one place every tile layout agrees on: "<title>, Order placed <date>, <status>[, <note>]".
    const placed = PLACED_RE.exec(label);
    const placedOn = placed ? dayMonth(placed[1], today) : null;
    let title = label.split(', Order placed')[0];
    let statusText;
    let note;
    if (placed) {
      const tail = placed[2] || '';
      const cut = tail.indexOf(', ');
      statusText = cut >= 0 ? tail.slice(0, cut) : tail;
      note = cut >= 0 ? tail.slice(cut + 2) : '';
    } else {
      [title, statusText, note] = splitUnanchoredLabel(label);
    }
    const [kind, confirmed] = classifyOrderText(statusText);
    if (kind !== null && !confirmed) {
      warnOnce(`plausible-line=${mask(statusText)}`, `The Amazon order-line text "${mask(statusText)}" was read as ${kind} from wording that is not confirmed yet; please confirm it is right.`);
    }
    if (kind === SKIP) return;
    let deliveredOn = null;
    if (kind === STATUS.DELIVERED) deliveredOn = placedOn ? dayMonth(statusText, placedOn, { forward: true }) : dayMonth(statusText, today);
    tiles.push({
      orderId,
      lineItemId: q.lineitemid || '',
      shipmentId: q.shipmentid || '',
      packageId: q.packageid || '1',
      popPath: href,
      title,
      statusText: statusText.trim(),
      statusNote: note || null,
      placedOn,
      deliveredOn,
      position,
    });
  });
  return tiles;
}

/* ------------------------------------------------------- pop / ship-track page -- */

const TRACK_LINK_RE = /href="([^"]*\/ship-track\?[^"]*)"/;
const CARRIER_RE = /Delivery By ([A-Za-z0-9_]+)/;
const CARRIER_HEADER_RE = /(?:pt-delivery-card-wrapper"><div><h3|tracking-event-carrier-header">\s*<h2)[^>]*>\s*([^<]*?)\s*<\/h[23]>/;
const TRACKING_ID_RE = /Tracking ID:\s*([A-Za-z0-9-]+)/;
const STATE_RE = /<script[^>]*page-state[^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/;
const EVENT_PART_RE = /<span class="tracking-event-(date|time|message|location)">([^<]*)<\/span>/g;
const PASSWORD_FIELD_RE = /<input[^>]+type="password"/i;
const STATE_DROP = new Set(['hereMapsApiKey']); // third-party map key, not parcel data

/** Whether a page is a sign-in form instead of the requested content. */
function looksSignedOut(page) { return PASSWORD_FIELD_RE.test(String(page || '')); }

/** The ship-track path on an order-line page, if it has one. */
function parseTrackLink(page) {
  const match = TRACK_LINK_RE.exec(String(page || ''));
  return match ? unescapeHtml(match[1]) : null;
}

function pageState(page) {
  const match = STATE_RE.exec(page);
  if (!match) return {};
  let state;
  try { state = JSON.parse(match[1]); } catch (_) { return {}; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {};
  const out = {};
  for (const [key, value] of Object.entries(state)) if (!STATE_DROP.has(key)) out[key] = value;
  return out;
}

function validZone(name) {
  if (!name) return null;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: name }); return name; } catch (_) { return null; } // eslint-disable-line no-new
}

/** "10:36 am" (as HA) – Homey also accepts a 24-hour "10:36" from non-English pages. */
function parseClock(text) {
  const t = String(text || '').trim().toUpperCase();
  let m = /^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/.exec(t);
  if (m) {
    let h = Number(m[1]);
    if (h < 1 || h > 12 || Number(m[2]) > 59) return null;
    if (m[3] === 'P' && h !== 12) h += 12;
    if (m[3] === 'A' && h === 12) h = 0;
    return [h, Number(m[2])];
  }
  m = /^(\d{1,2})[:.h](\d{2})$/.exec(t);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return [Number(m[1]), Number(m[2])];
  return null;
}

function pad(n) { return String(n).padStart(2, '0'); }

/** Wall-clock day+time in a zone → ISO with offset; without a known zone the time stays naive (as HA). */
function localIso(day, clock, zone, zonedIso) {
  const [h, mi] = clock || [0, 0];
  const local = `${day}T${pad(h)}:${pad(mi)}:00`;
  return zone ? zonedIso(local, zone) || local : local;
}

/** The timeline: date headers, then time / message / location per event. */
function parseEvents(page, zone, today, zonedIso) {
  const events = [];
  let currentDay = null;
  let pending = null;
  for (const match of String(page || '').matchAll(EVENT_PART_RE)) {
    const kind = match[1];
    const text = unescapeHtml(match[2]).trim();
    if (kind === 'date') currentDay = dayMonth(text, today);
    else if (kind === 'time') pending = { day: currentDay, clock: parseClock(text) };
    else if (pending && kind === 'message') pending.message = text;
    else if (pending && kind === 'location') {
      pending.location = text || null;
      events.push(pending);
      pending = null;
    }
  }
  return events
    .filter(event => event.day && event.message)
    .map(event => ({ timestamp: localIso(event.day, event.clock, zone, zonedIso), message: event.message, location: event.location }));
}

/** A ship-track page → { trackingId, carrierCode, carrierHeader, timezone, events, state }. */
function parseTrackPage(page, today, { zonedIso, fallbackZone = null } = {}) {
  const text = String(page || '');
  const state = pageState(text);
  const header = CARRIER_HEADER_RE.exec(text);
  const carrierHeader = header && header[1] ? header[1] : null;
  const carrier = CARRIER_RE.exec(carrierHeader || text);
  const trackingMatch = TRACKING_ID_RE.exec(text);
  const trackingId = state.trackingId || (trackingMatch ? trackingMatch[1] : null);
  const timezone = typeof state.timezone === 'string' ? state.timezone : null;
  // HA leaves timestamps naive without a valid page zone; Homey falls back to the storefront's zone.
  const zone = validZone(timezone) || validZone(fallbackZone);
  return {
    trackingId: trackingId ? String(trackingId) : null,
    carrierCode: carrier ? carrier[1] : null,
    carrierHeader,
    timezone,
    events: parseEvents(text, zone, today, zonedIso),
    state,
  };
}

/** The raw shipment record the parcel mapping works on; `tiles` are the order lines of one shipment. */
function buildRecord(domain, tiles, trackPath, track) {
  const lead = tiles[0];
  const trackingId = track ? track.trackingId : null;
  const progress = (track && track.state && track.state.progressTracker) || {};
  return {
    domain,
    order_id: lead.orderId,
    shipment_id: shipmentKey(lead),
    package_id: lead.packageId,
    line_item_id: lead.lineItemId || null, // Homey: links a not-yet-dispatched line to its later shipment
    barcode_source: trackingId ? 'tracking_id' : 'shipment_key',
    tracking_id: trackingId,
    carrier_code: track ? track.carrierCode : null,
    carrier_header: track ? track.carrierHeader : null,
    order_status: lead.statusText || null,
    order_status_note: lead.statusNote,
    delivered_on: lead.deliveredOn || null,
    milestone: (progress && progress.lastReachedMilestone) || null,
    events: track ? track.events : [],
    items: tiles.map(tile => tile.title),
    pop_path: lead.popPath,
    track_path: trackPath,
    page_state: track ? track.state : {},
  };
}

module.exports = {
  STATUS, SKIP, MONTHS, STATUS_PREFIXES, NEW_ISSUE_URL,
  setLogger, warnOnce, mask, classifyOrderText, unescapeHtml, dayMonth, todayIn, addDays,
  parseOrderTiles, tileKey, tileDelivered, shipmentKey, looksSignedOut, parseTrackLink, parseTrackPage, parseClock, buildRecord,
};
