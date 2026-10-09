'use strict';

/*
 * Budbee tracking – port of ha-budbee (https://github.com/ha-parcel-integrations/ha-budbee),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 * Public, keyless consumer tracking API; the tracking code is the only credential.
 */

const { CarrierError, request, parseJson, isObject, toIso } = require('./carrier-http');

const API = 'https://tracking.budbee.com/api';
const C = 'Budbee';

const STATUS_MAP_DELIVERY = {
  NotStarted: 'registered', OnRouteCollection: 'in_transit', Collected: 'in_transit', CrossDocked: 'in_transit',
  OnRouteDelivery: 'out_for_delivery', Delivered: 'delivered', Miss: 'problem', Backordered: 'problem',
  CollectedShippingLabel: 'in_transit', ReturnedToTerminal: 'in_transit', ReturnedToMerchant: 'returning',
};
// Locker orders: "Delivered" = waiting IN the locker, "PickedUp" = collected.
const STATUS_MAP_BOX = {
  NotStarted: 'registered', Pending: 'registered', Collected: 'in_transit', CollectedShippingLabel: 'in_transit',
  DroppedOff: 'in_transit', Delivered: 'at_pickup_point', PickedUp: 'delivered', Undelivered: 'problem',
  ReturnedToTerminal: 'in_transit', ReturnedToMerchant: 'returning',
};
const STATUS_TEXT = {
  NotStarted: 'Registered', Pending: 'Registered', OnRouteCollection: 'On its way to Budbee', Collected: 'Collected by Budbee',
  CrossDocked: 'At the Budbee terminal', OnRouteDelivery: 'Courier on the way', Delivered: 'Delivered', Miss: 'Delivery missed',
  Backordered: 'Delayed', CollectedShippingLabel: 'Label collected', ReturnedToTerminal: 'Back at the Budbee terminal',
  ReturnedToMerchant: 'Returned to the shop', DroppedOff: 'Dropped off in a locker', PickedUp: 'Picked up', Undelivered: 'Not delivered',
};

function normalizeCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }

async function getJson(url, { notFoundStatus = null } = {}) {
  const res = await request(url, { headers: { Accept: 'application/json' } }, { carrier: C });
  if (notFoundStatus && res.status === notFoundStatus) return null;
  const text = await res.text();
  if (res.status !== 200) throw new CarrierError(`Budbee request failed (HTTP ${res.status})`, { status: res.status });
  const body = parseJson(text);
  if (body === undefined) throw new CarrierError('Budbee returned an unreadable response');
  return body;
}

function unwrap(body) {
  if (!isObject(body)) throw new CarrierError('Budbee returned an unexpected response');
  if (body.errorCode === 'ORDER_NOT_FOUND') return null;
  if (body.errorCode) throw new CarrierError(`Budbee: ${body.errorCode}`);
  if (body.status === 'FAILED') throw new CarrierError(`Budbee: ${body.errorMsg || 'FAILED'}`);
  return isObject(body.payload) ? body.payload : null;
}

class BudbeeClient {
  constructor() { this.meta = {}; }

  forget(code) { delete this.meta[code]; }

  /** Parcel payload with `meta` merged in, or null when Budbee does not know the code (yet). */
  async parcel(code) {
    let meta = this.meta[code];
    if (!meta) {
      meta = unwrap(await getJson(`${API}/v3/orders/${encodeURIComponent(code)}/meta`));
      if (!meta) return null;
      this.meta[code] = meta;
    }
    const readBox = async () => {
      const body = await getJson(`${API}/box/${encodeURIComponent(code)}`, { notFoundStatus: 404 });
      if (body !== null && !isObject(body)) throw new CarrierError('Budbee returned an unexpected locker response');
      return body;
    };
    const readOrder = async () => {
      const payload = unwrap(await getJson(`${API}/v3/orders/${encodeURIComponent(code)}`));
      if (!payload) return null;
      return isObject(payload.conspectus) ? payload.conspectus : payload;
    };
    let raw;
    if (meta.type === 'BOX') raw = await readBox();
    else if (meta.type === 'DELIVERY') raw = await readOrder();
    else raw = (await readBox()) || (await readOrder());
    return raw ? { ...raw, meta } : null;
  }
}

function unmasked(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return !text || /^\*+$/.test(text) ? '' : text;
}

function lockerName(raw) {
  const candidates = [raw.lockerAddress];
  if (isObject(raw.lockerAttributes)) candidates.push(raw.lockerAttributes.address);
  for (const a of candidates) {
    if (!isObject(a)) continue;
    const name = unmasked(a.name);
    if (name) return name;
    const street = unmasked(a.street);
    const city = unmasked(a.city);
    if (street || city) return [street, city].filter(Boolean).join(', ');
  }
  return '';
}

function normalize(raw, code) {
  const r = isObject(raw) ? raw : { token: code };
  const type = r.meta?.type === 'BOX' || r.meta?.type === 'DELIVERY' ? r.meta.type : (isObject(r.status) ? 'DELIVERY' : 'BOX');
  const rawStatus = isObject(r.status) ? String(r.status.state || '') : String(r.status || '');
  const map = type === 'BOX' ? STATUS_MAP_BOX : STATUS_MAP_DELIVERY;
  const status = rawStatus ? (map[rawStatus] || 'unknown') : 'unknown';
  const delivered = status === 'delivered';
  const outgoing = (isObject(r.consignment) && ['RETURN', 'ON_DEMAND_PICKUP'].includes(r.consignment.type)) || rawStatus === 'CollectedShippingLabel';
  let plannedFrom = null;
  let plannedTo = null;
  if (!delivered) {
    if (type === 'BOX') plannedFrom = toIso(r.eta || r.etaInformation?.eta); // a locker ETA is a single moment
    else {
      plannedFrom = toIso(r.consignment?.start);
      plannedTo = toIso(r.consignment?.stop);
      if (plannedFrom && plannedTo && Date.parse(plannedFrom) === Date.parse(plannedTo)) plannedTo = null;
    }
  }
  const barcode = normalizeCode(r.token || code);
  const locker = lockerName(r);
  let label = STATUS_TEXT[rawStatus] || rawStatus;
  if (type === 'BOX' && rawStatus === 'Delivered') label = 'Ready in the Budbee Box';
  return {
    barcode,
    sender: unmasked(r.merchant?.name),
    receiver: unmasked(r.consumer?.name),
    status,
    rawStatus: label,
    statusCode: rawStatus,
    delivered,
    deliveredAt: delivered ? toIso(type === 'BOX' ? r.deliveredAt : r.status?.date) : null,
    plannedFrom,
    plannedTo,
    windowKnown: Boolean(plannedFrom && plannedTo),
    pickup: status === 'at_pickup_point' || type === 'BOX',
    pickupPoint: locker,
    pickupDeadline: type === 'BOX' && status === 'at_pickup_point' ? toIso(r.latestPickupDate) : null,
    url: barcode ? `https://track.budbee.com/${barcode}` : '',
    weight: null,
    dimensions: null,
    history: rawStatus ? [{ timestamp: toIso(isObject(r.status) ? r.status.date : (r.deliveredAt || r.createdAt)), status, rawStatus: label }].filter(e => e.timestamp) : [],
    direction: outgoing ? 'outgoing' : 'incoming',
    deliveryType: type === 'BOX' ? 'locker' : 'home',
    remainingStops: Number(r.eta?.remainingStopCount ?? NaN),
    pending: !isObject(raw),
  };
}

module.exports = { BudbeeClient, normalize, normalizeCode, STATUS_MAP_BOX, STATUS_MAP_DELIVERY };
