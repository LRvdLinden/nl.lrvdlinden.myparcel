'use strict';

/*
 * FedEx tracking – port of ha-fedex (https://github.com/ha-parcel-integrations/ha-fedex),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 * Official FedEx developer API with the user's own client credentials.
 */

const { CarrierError, request, parseJson, retryAfter, isObject, toIso, sortHistory, formatDimensions } = require('./carrier-http');

const OAUTH_URL = 'https://apis.fedex.com/oauth/token';
const TRACKING_API_URL = 'https://apis.fedex.com/track/v1/trackingnumbers';
const C = 'FedEx';

const STATUS_MAP = {
  OC: 'registered', DO: 'registered', IP: 'in_transit', DS: 'in_transit', PD: 'problem', CA: 'problem',
  US: 'in_transit', TR: 'in_transit', DR: 'in_transit', PM: 'in_transit', MD: 'in_transit', CH: 'in_transit',
  AC: 'in_transit', OX: 'in_transit', CP: 'in_transit', EA: 'in_transit', DD: 'problem', SE: 'problem',
  AE: 'in_transit', AO: 'in_transit', DY: 'in_transit', AR: 'in_transit', AF: 'in_transit', DP: 'in_transit',
  CC: 'in_transit', HP: 'at_pickup_point', CD: 'problem', IN: 'registered', PU: 'in_transit', IT: 'in_transit',
  OD: 'out_for_delivery', DL: 'delivered', DE: 'problem',
  // Returns are not in ha-fedex's table; FedEx reports them as RS / RT.
  RS: 'returning', RT: 'returning',
};

function normalizeCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }

class FedExClient {
  constructor({ clientId, clientSecret, fetchFn = fetch }) {
    this.clientId = String(clientId || '').trim();
    this.clientSecret = String(clientSecret || '');
    this.fetch = fetchFn;
    this.accessToken = null;
    this.expiresAt = 0;
    this._tokenPromise = null;
  }

  async token({ stale = null } = {}) {
    if (this.accessToken && this.accessToken !== stale && this.expiresAt > Date.now()) return this.accessToken;
    if (this._tokenPromise) return this._tokenPromise;
    this._tokenPromise = (async () => {
      if (!this.clientId || !this.clientSecret) throw new CarrierError('Enter your FedEx Client ID and Client Secret.', { auth: true });
      const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret });
      const res = await request(OAUTH_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }, { carrier: C, fetchFn: this.fetch });
      const data = parseJson(await res.text());
      if (res.status === 401 || res.status === 403) throw new CarrierError(`FedEx rejected the API credentials (HTTP ${res.status})`, { status: res.status, auth: true });
      if (res.status !== 200) throw new CarrierError(`FedEx login failed (HTTP ${res.status})`, { status: res.status, retryAfter: retryAfter(res) });
      if (!isObject(data) || !data.access_token || typeof data.expires_in !== 'number') throw new CarrierError('FedEx returned an invalid login response');
      this.accessToken = data.access_token;
      this.expiresAt = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
      return this.accessToken;
    })().finally(() => { this._tokenPromise = null; });
    return this._tokenPromise;
  }

  /** One trackResult, or null when FedEx does not know the number (yet). */
  async track(code) {
    let stale = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.token({ stale });
      const res = await request(TRACKING_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-locale': 'en_US' },
        body: JSON.stringify({ includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber: code } }] }),
      }, { carrier: C, fetchFn: this.fetch });
      if (res.status === 401 && attempt === 0) { stale = token; continue; }
      if (res.status === 401 || res.status === 403) throw new CarrierError(`FedEx rejected the API credentials (HTTP ${res.status})`, { status: res.status, auth: true });
      if (res.status === 429) throw new CarrierError('FedEx rate limit reached', { status: 429, retryAfter: retryAfter(res) });
      const text = await res.text();
      if (res.status !== 200) throw new CarrierError(`FedEx tracking failed (HTTP ${res.status})`, { status: res.status });
      const body = parseJson(text);
      if (body === undefined) throw new CarrierError('FedEx returned an unreadable tracking response');
      const results = body?.output?.completeTrackResults;
      if (!Array.isArray(results) || !results.length) return null;
      const track = Array.isArray(results[0]?.trackResults) ? results[0].trackResults[0] : null;
      if (!isObject(track)) return null;
      // A real unknown number answers 200 with trackResults[0].error and no status.
      if (track.error && !track.latestStatusDetail) return null;
      return track;
    }
    return null;
  }
}

function locationText(loc) {
  const l = isObject(loc) ? loc : {};
  return [l.city, l.stateOrProvinceCode, l.countryCode].filter(Boolean).map(String).join(', ');
}

function mapStatus(code) { return code ? (STATUS_MAP[code] || 'unknown') : 'unknown'; }

function weightKg(list) {
  let lb = null;
  for (const item of Array.isArray(list) ? list : []) {
    const value = Number.parseFloat(item?.value);
    if (!Number.isFinite(value)) continue;
    if (item.unit === 'KG') return value;
    if (item.unit === 'LB') lb = value;
  }
  return lb === null ? null : Math.round(lb * 0.45359237 * 1000) / 1000;
}

function dimensions(list) {
  let inches = null;
  for (const item of Array.isArray(list) ? list : []) {
    const [l, w, h] = [item?.length, item?.width, item?.height].map(Number);
    if (![l, w, h].every(Number.isFinite)) continue;
    if (item.units === 'CM') return formatDimensions(l, w, h);
    if (item.units === 'IN') inches = [l, w, h];
  }
  return inches ? formatDimensions(...inches.map(n => Math.round(n * 2.54 * 10) / 10)) : null;
}

function normalize(raw, code) {
  const r = isObject(raw) ? raw : { trackingNumber: code };
  const barcode = normalizeCode(r.trackingNumberInfo?.trackingNumber || r.trackingNumber || code);
  const detail = isObject(r.latestStatusDetail) ? r.latestStatusDetail : {};
  const statusCode = detail.code || detail.derivedCode || r.statusCode || '';
  const status = mapStatus(statusCode);
  const delivered = status === 'delivered';
  let deliveredAt = null;
  if (delivered) {
    deliveredAt = toIso(r.deliveryDetails?.actualDeliveryTimestamp || r.actualDeliveryTimestamp)
      || toIso((r.dateAndTimes || []).find(d => d?.type === 'ACTUAL_DELIVERY')?.dateTime);
  }
  const w = r.estimatedDeliveryTimeWindow || r.estimatedDelivery || {};
  const inner = isObject(w.window) && Object.keys(w.window).length ? w.window : w;
  let plannedFrom = delivered ? null : toIso(inner.begins || w.from);
  let plannedTo = delivered ? null : toIso(inner.ends || w.to);
  if (plannedFrom && plannedTo && Date.parse(plannedFrom) === Date.parse(plannedTo)) plannedTo = null;
  if (!delivered && !plannedFrom) {
    const eta = (r.dateAndTimes || []).find(d => d?.type === 'ESTIMATED_DELIVERY');
    if (eta?.dateTime) plannedFrom = toIso(eta.dateTime);
  }
  const pickup = status === 'at_pickup_point';
  const scans = Array.isArray(r.scanEvents) ? r.scanEvents : [];
  const history = sortHistory(scans.filter(isObject).map(ev => ({
    timestamp: toIso(ev.date || ev.timestamp),
    status: ev.eventType ? (STATUS_MAP[ev.eventType] || null) : null,
    rawStatus: ev.eventDescription || ev.description || ev.eventType || '',
    location: locationText(ev.scanLocation),
  })).filter(e => e.timestamp));
  const weight = weightKg(r.packageDetails?.weightAndDimensions?.weight);
  return {
    barcode,
    sender: locationText(r.shipperInformation?.address),
    receiver: locationText(r.recipientInformation?.address),
    status,
    rawStatus: detail.statusByLocale || detail.description || statusCode || '',
    statusCode,
    delivered,
    deliveredAt,
    plannedFrom,
    plannedTo,
    windowKnown: Boolean(plannedFrom && plannedTo),
    pickup,
    pickupPoint: pickup ? locationText(detail.scanLocation) : '',
    url: barcode ? `https://www.fedex.com/fedextrack/?trknbr=${barcode}` : '',
    weight,
    dimensions: dimensions(r.packageDetails?.weightAndDimensions?.dimensions),
    history,
    direction: 'incoming',
    service: r.serviceDetail?.description || r.serviceDetail?.type || '',
    origin: locationText(r.shipperInformation?.address),
    destination: locationText(r.recipientInformation?.address),
    lastLocation: locationText(detail.scanLocation),
    pending: !isObject(raw),
  };
}

module.exports = { FedExClient, normalize, normalizeCode, STATUS_MAP };
