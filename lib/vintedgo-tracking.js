'use strict';

/*
 * Vinted Go (formerly Homerr) – port of ha-vinted-go (https://github.com/ha-parcel-integrations/ha-vinted-go),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 * Passwordless e-mail login; refresh tokens rotate and are handed to onRefreshToken immediately.
 */

const { CarrierError, request, parseJson, isObject, toIso, parseTime, sortHistory } = require('./carrier-http');

const BASE = 'https://carrier.vintedgo.com/members';
const C = 'Vinted Go';

const STATUS_MAP = {
  created: 'registered', tracking_code_created: 'registered',
  shipped: 'in_transit', hand_over: 'in_transit', in_depot: 'in_transit', left_depot: 'in_transit', in_transit: 'in_transit', redirected: 'in_transit',
  in_delivery: 'out_for_delivery',
  available_for_pickup: 'at_pickup_point', ready_for_pickup: 'at_pickup_point', ready_for_collection_at_merchant: 'at_pickup_point',
  delivered: 'delivered', concluded: 'delivered',
  disposed: 'problem', empty_locker_found: 'problem', lost: 'problem', pickup_failed: 'problem', cancelled: 'problem', pickup_cancelled: 'problem',
  return: 'returning', returned: 'delivered', return_return: 'returning', return_to_sender: 'returning', return_in_transit: 'returning',
  return_ready_for_pickup: 'at_pickup_point', return_delivered: 'delivered', return_lost: 'problem', return_disposed: 'problem',
  return_empty_locker_found: 'problem', return_cancelled: 'problem',
};

function extractToken(value) {
  const text = String(value || '').trim();
  if (text.includes('token=')) {
    try { const t = new URL(text).searchParams.get('token'); if (t) return t; } catch (_) { /* fall through */ }
    const m = text.match(/token=([^&\s]+)/);
    if (m) return m[1];
  }
  return text;
}

async function postJson(url, body) {
  const res = await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }, { carrier: C });
  return { status: res.status, body: parseJson(await res.text()) };
}

class VintedGoClient {
  constructor({ refreshToken = null, onRefreshToken = null } = {}) {
    this.refreshToken = refreshToken;
    this.sessionToken = null;
    this.onRefreshToken = onRefreshToken;
    this._refreshing = null;
  }

  static async register(email) {
    const { status } = await postJson(`${BASE}/registrations`, { email: String(email || '').trim() });
    if (status !== 200) throw new CarrierError(`Vinted Go could not send the login e-mail (HTTP ${status})`, { status });
  }

  async confirm(tokenOrLink) {
    const { status, body } = await postJson(`${BASE}/registrations/confirm`, { token: extractToken(tokenOrLink) });
    if ([400, 401, 404, 422].includes(status)) throw new CarrierError('This Vinted Go login link is no longer valid. Request a new e-mail.', { status, auth: true });
    if (status !== 200) throw new CarrierError(`Vinted Go login failed (HTTP ${status})`, { status });
    this._store(body);
  }

  _store(body) {
    if (!isObject(body) || !body.session_token || !body.refresh_token) throw new CarrierError('Vinted Go returned an incomplete login response');
    this.sessionToken = body.session_token;
    if (body.refresh_token !== this.refreshToken) {
      this.refreshToken = body.refresh_token;
      if (typeof this.onRefreshToken === 'function') this.onRefreshToken(this.refreshToken);
    }
  }

  async refresh() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      if (!this.refreshToken) throw new CarrierError('Not signed in to Vinted Go', { auth: true });
      const { status, body } = await postJson(`${BASE}/sessions/refresh`, { refresh_token: this.refreshToken });
      if ([400, 401, 403, 404, 422].includes(status)) throw new CarrierError('The Vinted Go login has expired', { status, auth: true });
      if (status !== 200) throw new CarrierError(`Vinted Go session refresh failed (HTTP ${status})`, { status });
      this._store(body);
    })().finally(() => { this._refreshing = null; });
    return this._refreshing;
  }

  async _get(url) {
    if (!this.sessionToken) await this.refresh();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await request(url, { headers: { Authorization: `Bearer ${this.sessionToken}`, Accept: 'application/json' } }, { carrier: C });
      if (res.status === 401 && attempt === 0) { await this.refresh(); continue; }
      const text = await res.text();
      if (res.status === 401) throw new CarrierError('The Vinted Go login has expired', { status: 401, auth: true });
      if (res.status !== 200) throw new CarrierError(`Vinted Go request failed (HTTP ${res.status})`, { status: res.status });
      const body = parseJson(text);
      if (body === undefined) throw new CarrierError('Vinted Go returned an unreadable response');
      return body;
    }
    return null;
  }

  async me() { return this._get(`${BASE}/users/me`); }

  async shipments() {
    const body = await this._get(`${BASE}/shipments`);
    if (!Array.isArray(body)) throw new CarrierError('Vinted Go returned an unexpected shipment list');
    return body.filter(isObject);
  }

  /** Public timeline; never throws (null when not scanned yet or on any error). */
  async timeline(code) {
    try {
      const res = await request(`${BASE}/public/v1/tracking_events/${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } }, { carrier: C });
      if (res.status !== 200) return null;
      const body = parseJson(await res.text());
      return isObject(body) ? body : null;
    } catch (_) { return null; }
  }
}

function latestEvent(events) {
  let best = null;
  let bestTime = -Infinity;
  for (const ev of events) {
    if (!isObject(ev)) continue;
    const t = parseTime(ev.timestamp) ?? -Infinity;
    if (!best || t > bestTime) { best = ev; bestTime = t; }
  }
  return best;
}

function glsUrl(raw, events) {
  const point = raw.point;
  if (!isObject(point) || !String(point.name || '').toUpperCase().includes('GLS')) return '';
  const sorted = events.filter(isObject).sort((a, b) => (parseTime(b.timestamp) ?? -Infinity) - (parseTime(a.timestamp) ?? -Infinity));
  for (const ev of sorted) {
    const m = String(ev.message || '').match(/(?<!\d)(\d{12})(?!\d)/);
    if (m) return `https://gls-group.com/GROUP/en/parcel-tracking?match=${m[1]}`;
  }
  return '';
}

function normalize(raw, { country = 'nl' } = {}) {
  const events = Array.isArray(raw.tracking_events) ? raw.tracking_events : [];
  const current = latestEvent(events);
  let status;
  if (current && current.group) status = STATUS_MAP[current.group] || 'unknown';
  else status = raw.resolution === 'delivered' ? 'delivered' : 'unknown';
  const delivered = status === 'delivered';
  const code = String(raw.tracking_code || '');
  const point = isObject(raw.point) ? raw.point : null;
  const pointAddress = point ? [point.address, [point.postal_code, point.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const direction = raw.contact_type === 'sender' ? 'outgoing' : 'incoming';
  return {
    barcode: code,
    sender: direction === 'incoming' ? String(raw.content_title || '') : '',
    receiver: '',
    status,
    rawStatus: current ? String(current.message || current.group || '') : String(raw.shipment_state || ''),
    statusCode: current?.group || '',
    delivered,
    deliveredAt: delivered ? toIso(current ? current.timestamp : raw.last_tracking_event_at) : null,
    plannedFrom: null,
    plannedTo: null,
    windowKnown: false,
    pickup: status === 'at_pickup_point' || Boolean(point),
    pickupPoint: point ? String(point.name || '') : '',
    pickupAddress: pointAddress,
    pickupCode: status === 'at_pickup_point' ? String(raw.resolved_pick_up_code || '') : '',
    pickupDeadline: status === 'at_pickup_point' ? toIso(raw.pick_up_expires_at) : null,
    item: String(raw.content_title || ''),
    url: glsUrl(raw, events) || (code ? `https://vintedgo.com/en/tracking/${code}?country=${country}&region=europe` : ''),
    weight: null,
    dimensions: null,
    history: sortHistory(events.filter(isObject).map(ev => ({
      timestamp: toIso(ev.timestamp),
      status: ev.group ? (STATUS_MAP[ev.group] || null) : null,
      rawStatus: String(ev.message || ev.group || ''),
    })).filter(e => e.timestamp)),
    direction,
    closed: raw.status_group === 'completed' && !delivered,
  };
}

module.exports = { VintedGoClient, normalize, extractToken, STATUS_MAP };
