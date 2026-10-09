'use strict';

/** Small shared HTTP helpers for the carrier ports (FedEx, Budbee, Vinted Go, InPost, bpost, Ampère). */

const TIMEOUT_MS = 30000;

class CarrierError extends Error {
  constructor(message, { status = null, auth = false, retryAfter = null, notFound = false } = {}) {
    super(message);
    this.status = status;
    this.auth = auth;
    this.retryAfter = retryAfter;
    this.notFound = notFound;
  }
}

async function request(url, options = {}, { timeout = TIMEOUT_MS, carrier = 'Carrier', fetchFn = fetch } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    return await fetchFn(url, { ...options, signal: controller?.signal });
  } catch (error) {
    throw new CarrierError(`${carrier} is unreachable: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return undefined; }
}

function retryAfter(res) {
  const value = Number.parseFloat(res?.headers?.get?.('retry-after') || '');
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function str(value) { return value === undefined || value === null ? '' : String(value).trim(); }

/** Numbers are epoch milliseconds; strings pass through unchanged. */
function toIso(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : null;
  return String(value);
}

function parseTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  const time = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) || !/T\d{2}:\d{2}/.test(text) ? text : `${text}Z`);
  return Number.isFinite(time) ? time : null;
}

/** Oldest → newest, unparseable timestamps last, capped to the newest `max`. */
function sortHistory(entries, max = 20) {
  const dated = [];
  const loose = [];
  for (const entry of entries) {
    if (!entry) continue;
    const time = parseTime(entry.timestamp);
    if (time === null) loose.push(entry); else dated.push([time, entry]);
  }
  dated.sort((a, b) => a[0] - b[0]);
  return [...dated.map(([, entry]) => entry), ...loose].slice(-max);
}

/** Wall-clock "YYYY-MM-DDTHH:MM[:SS]" in an IANA zone → ISO string with that zone's offset. */
function zonedIso(local, timeZone) {
  const match = String(local || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const offsetAt = time => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(time));
    const get = type => Number(parts.find(p => p.type === type)?.value || 0);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - time;
  };
  let offset = offsetAt(guess);
  offset = offsetAt(guess - offset);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset) / 60000;
  const pad = n => String(n).padStart(2, '0');
  return `${y}-${mo}-${d}T${pad(h)}:${mi}:${pad(s)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function formatDimensions(l, w, h, unit = 'cm') {
  const fmt = n => String(Math.round(Number(n) * 10) / 10);
  return { length: Number(l), width: Number(w), height: Number(h), text: `${fmt(l)} x ${fmt(w)} x ${fmt(h)} ${unit}` };
}

module.exports = { CarrierError, request, parseJson, retryAfter, isObject, str, toIso, parseTime, sortHistory, zonedIso, formatDimensions, TIMEOUT_MS };
