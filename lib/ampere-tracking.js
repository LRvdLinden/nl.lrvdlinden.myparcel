'use strict';

/*
 * Ampère (bol.com) tracking – port of ha-ampere (https://github.com/ha-parcel-integrations/ha-ampere),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 * Each parcel is reached through a guest session: following the bol.com e-mail link (or the Ampère
 * key link found in the bol.com account) once sets a `tnt_sessions` cookie for a parcel token.
 */

const { CarrierError, request, parseJson, isObject, str, toIso, zonedIso } = require('./carrier-http');

const BASE_URL = 'https://bol.prd.amperebezorgt.nl';
const C = 'Ampère';
const AMSTERDAM = 'Europe/Amsterdam';

const STATUS_MAP = {
  'Pakket is aangemeld maar nog niet ontvangen door Ampère': 'registered',
  'Pakket is klaar voor bezorging': 'in_transit',
  'Pakket is gesorteerd': 'in_transit',
  'Bezorger is onderweg': 'out_for_delivery',
  'Pakket is bezorgd': 'delivered',
};

function mapStatus(text) {
  const t = str(text);
  if (!t) return 'unknown';
  if (STATUS_MAP[t]) return STATUS_MAP[t];
  // tolerant fallbacks for small wording changes
  if (/bezorgd/i.test(t) && !/wordt|vandaag/i.test(t)) return 'delivered';
  if (/bezorger is onderweg|onderweg naar/i.test(t)) return 'out_for_delivery';
  if (/gesorteerd|klaar voor bezorging|ontvangen/i.test(t)) return 'in_transit';
  if (/aangemeld/i.test(t)) return 'registered';
  if (/niet bezorgd|mislukt|retour/i.test(t)) return 'problem';
  return 'unknown';
}

function decode(text) {
  return String(text || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ');
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function extractAll(html, id) {
  return [...String(html).matchAll(new RegExp(`data-test-id="${esc(id)}"[^>]*>\\s*([^<]*?)\\s*<`, 'g'))].map(m => decode(m[1]).trim()).filter(Boolean);
}
function extractFirst(html, id) { return extractAll(html, id)[0] || ''; }

function setCookieValues(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(/,(?=\s*[A-Za-z0-9_.-]+=)/) : [];
}

/** Ampère links that can start a guest session (bol.com mail links and Ampère key/parcel links). */
function isTrackingLink(value) {
  return /^https?:\/\/(link\.bol\.com\/|bol\.prd\.amperebezorgt\.nl\/)/i.test(str(value));
}

/** Follow the link's redirects by hand and collect the session cookie → { cookie, parcelToken }. */
async function exchangeLink(link) {
  let url = str(link);
  if (!isTrackingLink(url)) throw new CarrierError('Paste the tracking link from the bol.com e-mail (https://link.bol.com/t/…).');
  const jar = {};
  let res;
  for (let hop = 0; hop < 10; hop += 1) {
    const host = new URL(url).host;
    const cookie = Object.entries(jar[host] || {}).map(([k, v]) => `${k}=${v}`).join('; ');
    res = await request(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 MyParcel-Homey', ...(cookie ? { Cookie: cookie } : {}) } }, { carrier: C });
    for (const line of setCookieValues(res)) {
      const [pair] = String(line).split(';');
      const i = pair.indexOf('=');
      if (i > 0) { jar[host] = jar[host] || {}; jar[host][pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); }
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) { url = new URL(location, url).toString(); continue; }
    break;
  }
  if ([400, 401, 403, 404, 410].includes(res.status)) throw new CarrierError('This Ampère link is no longer valid', { status: res.status, auth: true });
  if (res.status !== 200) throw new CarrierError(`Ampère could not be reached (HTTP ${res.status})`, { status: res.status });
  const token = (url.match(/\/nl\/parcel\/([^/?#]+)/) || [])[1];
  if (!token) throw new CarrierError('The Ampère link did not lead to a parcel');
  const cookie = Object.values(jar).map(c => c.tnt_sessions).find(Boolean);
  if (!cookie) throw new CarrierError('Ampère did not start a session for this link');
  return { cookie, parcelToken: token };
}

async function fetchParcel({ cookie, parcelToken }) {
  const headers = { Cookie: `tnt_sessions=${cookie}`, 'User-Agent': 'Mozilla/5.0 MyParcel-Homey' };
  const res = await request(`${BASE_URL}/nl/parcel/${encodeURIComponent(parcelToken)}`, { headers }, { carrier: C });
  const html = await res.text();
  if (res.status === 401 || res.status === 403) throw new CarrierError('The Ampère session has expired', { status: res.status, auth: true });
  if (res.status !== 200) throw new CarrierError(`Ampère request failed (HTTP ${res.status})`, { status: res.status });
  const ids = new Set([...html.matchAll(/data-test-id="([^"]+)"/g)].map(m => m[1]));
  if (ids.has('error-title') || ids.has('error-message')) throw new CarrierError('The Ampère session has expired', { auth: true });
  let window = {};
  try {
    const p = await request(`${BASE_URL}/api/progress?sid=${encodeURIComponent(parcelToken)}`, { headers }, { carrier: C });
    const data = p.status === 200 ? parseJson(await p.text())?.data : null;
    if (isObject(data) && isObject(data.deliveryWindow)) window = data.deliveryWindow;
  } catch (_) { /* best effort */ }
  return {
    parcel_token: parcelToken,
    barcode: extractFirst(html, 'barcode-value'),
    company_name: extractFirst(html, 'company-name-value'),
    receiver_name: extractFirst(html, 'receiver-name'),
    banner_status_text: extractFirst(html, 'status-text'),
    history_status_texts: extractAll(html, 'history-entry-status'),
    history_times: extractAll(html, 'history-entry-time'),
    delivery_window: window,
  };
}

const DUTCH_MONTHS = { jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

/** "Wo 12 aug 21:16" (Amsterdam time, no year) → ISO with offset. */
function parseHistoryTimestamp(text, now = new Date()) {
  const m = str(text).match(/^[A-Za-z]{2}\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const month = DUTCH_MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const pad = n => String(n).padStart(2, '0');
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: AMSTERDAM, year: 'numeric' }).format(now));
  const build = y => zonedIso(`${y}-${pad(month)}-${pad(m[1])}T${pad(m[3])}:${m[4]}`, AMSTERDAM);
  let iso = build(year);
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  if (Date.parse(iso) > now.getTime() + 86400000) iso = build(year - 1);
  return iso;
}

function normalize(raw, { url = '' } = {}) {
  const history = Array.isArray(raw.history_status_texts) ? raw.history_status_texts : [];
  const times = Array.isArray(raw.history_times) ? raw.history_times : [];
  const rawStatus = history[0] || raw.banner_status_text || '';
  const status = mapStatus(rawStatus);
  const delivered = status === 'delivered';
  const w = isObject(raw.delivery_window) ? raw.delivery_window : {};
  const plannedFrom = delivered ? null : (w.from ? toIso(String(w.from)) : null);
  const plannedTo = delivered ? null : (w.to ? toIso(String(w.to)) : null);
  const n = Math.min(history.length, times.length);
  const events = [];
  for (let i = n - 1; i >= 0; i -= 1) events.push({ timestamp: parseHistoryTimestamp(times[i]), status: mapStatus(history[i]), rawStatus: history[i] });
  return {
    barcode: str(raw.barcode || raw.parcel_token),
    sender: str(raw.company_name) || 'bol.com',
    receiver: str(raw.receiver_name),
    status,
    rawStatus,
    statusCode: '',
    delivered,
    deliveredAt: delivered && times.length ? parseHistoryTimestamp(times[0]) : null,
    plannedFrom,
    plannedTo,
    windowKnown: Boolean(plannedFrom && plannedTo),
    pickup: false,
    pickupPoint: '',
    url,
    weight: null,
    dimensions: null,
    history: events.slice(-20),
    direction: 'incoming',
  };
}

module.exports = { exchangeLink, fetchParcel, normalize, isTrackingLink, parseHistoryTimestamp, mapStatus, STATUS_MAP };
