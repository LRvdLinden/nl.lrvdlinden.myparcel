'use strict';

/*
 * bpost tracking – port of ha-bpost (https://github.com/ha-parcel-integrations/ha-bpost),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 *  - keyless public tracker (track.bpost.cloud) per barcode + postal code,
 *  - My bpost account through the bpost mobile API (rotating token pair), incl. Mail Ahead letters.
 */

const { CarrierError, request, parseJson, retryAfter, isObject, str, toIso, sortHistory, zonedIso } = require('./carrier-http');

const C = 'bpost';
const TRACK_ITEMS = 'https://track.bpost.cloud/track/items';
const TRACK_ROUND = 'https://track.bpost.cloud/track/itemonroundstatus';
const ACCOUNT_API_URL = 'https://mybpost.bpost.cloud/prod_v2';
const ACCOUNT_APP_VERSION = '3.45.1';
const ACCOUNT_API_KEY = 'iBLz8oTy8K1KAnPZJLltU527bWmLt6XQ6y8RF5hT';
const BRUSSELS = 'Europe/Brussels';

const KNOWN_PROCESS_STEP_MAP = {
  IN_PREPARATION: 'registered', IN_PREPARATION_AWAITING_DROPOFF: 'registered', IN_PREPARATION_AWAITING_PICKUP: 'registered',
  IN_PREPARATION_AWAITING_PICKUPDROPOFF: 'registered', IN_PREPARATION_INTERNATIONAL: 'registered',
  IN_PREPARATION_INTERNATIONAL_AWAITING_DROPOFF: 'registered', IN_PREPARATION_INTERNATIONAL_AWAITING_PICKUP: 'registered',
  IN_PREPARATION_INTERNATIONAL_AWAITING_PICKUPDROPOFF: 'registered', PENDING_APPROVAL: 'registered', PREPARATION: 'registered',
  PREPARATION_AWAITING_DROPOFF: 'registered', PREPARATION_AWAITING_PICKUP: 'registered', PREPARATION_AWAITING_PICKUPDROPOFF: 'registered',
  STATUS_PENDING: 'registered', mpcPrinted: 'registered',
  AWAITING: 'in_transit', CUSTOMS: 'in_transit', CUSTOMS_PAYMENT_NOT_REQUIRED: 'in_transit', CUSTOMS_PAYMENT_SUCCESSFUL: 'in_transit',
  EXPECTED: 'in_transit', ON_THE_WAY: 'in_transit', PROCESSING: 'in_transit', PROCESSING_HOME: 'in_transit',
  PROCESSING_INTERNATIONAL: 'in_transit', PROCESSING_KARIBOO_POINT: 'in_transit', PROCESSING_OUTBOUND_ABROAD: 'in_transit',
  PROCESSING_OUTBOUND_ABROAD_PARCEL_LOCKER: 'in_transit', PROCESSING_OUTBOUND_ABROAD_POST_POINT: 'in_transit',
  PROCESSING_OUTBOUND_BPOST: 'in_transit', PROCESSING_PARCEL_LOCKER: 'in_transit', PROCESSING_PARCEL_LOCKER_AVISE: 'in_transit',
  PROCESSING_POST_OFFICE: 'in_transit', PROCESSING_POST_POINT: 'in_transit', PROCESSING_SECOND_PRESENTATION: 'in_transit',
  PROCESSING_SHOP: 'in_transit',
  ON_THE_WAY_TO_KARIBOO_POINT: 'out_for_delivery', ON_THE_WAY_TO_PARCEL_LOCKER: 'out_for_delivery', ON_THE_WAY_TO_PARCIFY_HUB: 'out_for_delivery',
  ON_THE_WAY_TO_POSTAL_OFFICE: 'out_for_delivery', ON_THE_WAY_TO_POST_OFFICE: 'out_for_delivery', ON_THE_WAY_TO_POST_POINT: 'out_for_delivery',
  ON_THE_WAY_TO_SHOP: 'out_for_delivery', ON_THE_WAY_TO_YOU: 'out_for_delivery', OUT_FOR_DELIVERY_HOME: 'out_for_delivery',
  OUT_FOR_DELIVERY_KARIBOO_POINT: 'out_for_delivery', OUT_FOR_DELIVERY_PARCIFY_HUB: 'out_for_delivery', OUT_FOR_DELIVERY_POST_OFFICE: 'out_for_delivery',
  OUT_FOR_DELIVERY_POST_POINT: 'out_for_delivery', out_for_delivery_onFoot: 'out_for_delivery', out_for_delivery_byBike: 'out_for_delivery',
  out_for_delivery_byCar: 'out_for_delivery', out_for_delivery_byEbike: 'out_for_delivery', out_for_delivery_byECar: 'out_for_delivery',
  AVAILABLE: 'at_pickup_point', AVAILABLE_ADVISED_POST_POINT: 'at_pickup_point', AVAILABLE_INTERNATIONAL_PARCEL_LOCKER: 'at_pickup_point',
  AVAILABLE_INTERNATIONAL_POST_POINT: 'at_pickup_point', AVAILABLE_IN_KARIBOO_POINT: 'at_pickup_point', AVAILABLE_IN_PARCEL_LOCKER: 'at_pickup_point',
  AVAILABLE_IN_PARCEL_LOCKER_INTERNATIONAL: 'at_pickup_point', AVAILABLE_IN_POST_OFFICE: 'at_pickup_point', AVAILABLE_IN_POST_POINT: 'at_pickup_point',
  AVAILABLE_IN_POST_POINT_INTERNATIONAL: 'at_pickup_point', AVAILABLE_IN_SHOP: 'at_pickup_point', AVAILABLE_KARIBOO_POINT: 'at_pickup_point',
  AVAILABLE_PARCEL_LOCKER: 'at_pickup_point', AVAILABLE_PARCEL_LOCKER_INTERNATIONAL: 'at_pickup_point', AVAILABLE_POST_OFFICE: 'at_pickup_point',
  AVAILABLE_POST_POINT: 'at_pickup_point', AVAILABLE_POST_POINT_INTERNATIONAL: 'at_pickup_point', AVAILABLE_SHOP: 'at_pickup_point',
  REDELIVERY_CAN_PICKUP_POST_POINT: 'at_pickup_point',
  DELIVERED: 'delivered', DELIVERED_AT_FORCED_NB: 'delivered', DELIVERED_AT_FORCED_SP: 'delivered', DELIVERED_AT_HOME: 'delivered',
  DELIVERED_AT_NEIGHBOUR: 'delivered', DELIVERED_IN_MAILBOX: 'delivered', DELIVERED_MANUALLY: 'delivered', DELIVERED_TO_KARIBOO: 'delivered',
  DELIVERED_TO_SAFEPLACE: 'delivered', PICKED_UP: 'delivered', PICKED_UP_AT_INTERNATIONAL_PARCEL_LOCKER: 'delivered',
  PICKED_UP_AT_INTERNATIONAL_POST_POINT: 'delivered', PICKED_UP_IN_KARIBOO_POINT: 'delivered', PICKED_UP_IN_PARCEL_LOCKER: 'delivered',
  PICKED_UP_IN_PARCEL_LOCKER_INTERNATIONAL: 'delivered', PICKED_UP_IN_POST_OFFICE: 'delivered', PICKED_UP_IN_POST_POINT: 'delivered',
  PICKED_UP_IN_POST_POINT_INTERNATIONAL: 'delivered', PICKED_UP_IN_SHOP: 'delivered',
  BTS_DELIVERED: 'delivered', DELIVERED_TO_SENDER: 'delivered', DELIVERED_TO_SENDER_RETURN: 'delivered', PICKED_UP_BY_SENDER: 'delivered', RETOUR_DELIVERED: 'delivered',
  BTS_AVAILABLE_PARCEL_LOCKER: 'returning', BTS_AVAILABLE_POST_POINT: 'returning', BTS_OUT_FOR_DELIVERY_HOME: 'returning',
  BTS_OUT_FOR_DELIVERY_KARIBOO_POINT: 'returning', BTS_OUT_FOR_DELIVERY_PARCEL_LOCKER: 'returning', BTS_OUT_FOR_DELIVERY_POST_OFFICE: 'returning',
  BTS_OUT_FOR_DELIVERY_POST_POINT: 'returning', ON_THE_WAY_TO_SENDER: 'returning', OUT_FOR_DELIVERY_SENDER: 'returning',
  RETOUR_AVAILABLE_POST_POINT: 'returning', RETOUR_OUT_FOR_DELIVERY_HOME: 'returning', RETOUR_OUT_FOR_DELIVERY_KARIBOO_POINT: 'returning',
  RETOUR_OUT_FOR_DELIVERY_POST_OFFICE: 'returning', RETOUR_OUT_FOR_DELIVERY_POST_POINT: 'returning', RETURN_TO_SENDER: 'returning',
  RETURN_TO_SENDER_INTERNATIONAL: 'returning',
  AWAITING_CUSTOMS_PAYMENT: 'problem', CUSTOMS_PAYMENT_CHALLENGED: 'problem', CUSTOMS_PAYMENT_EXPIRED: 'problem',
  CUSTOMS_PAYMENT_REFUSED: 'problem', EXCEPTION: 'problem', REDELIVERY_NO_PICKUP: 'problem',
};
const NAME_MAP = {
  ...Object.fromEntries(Object.entries(KNOWN_PROCESS_STEP_MAP).map(([k, v]) => [k.toLowerCase(), v])),
  delivered: 'delivered',
  delivered_kariboo_point: 'delivered',
};
const PREFIX_TABLE = (() => {
  const table = {};
  for (const [key, status] of Object.entries(NAME_MAP)) {
    const segs = key.split('_');
    for (let n = 1; n <= segs.length; n += 1) {
      const p = segs.slice(0, n).join('_');
      if (!(p in table)) table[p] = status;
    }
  }
  return table;
})();

function prefixMatch(codeLower) {
  const segs = codeLower.split('_');
  for (let n = segs.length; n >= 1; n -= 1) {
    const s = PREFIX_TABLE[segs.slice(0, n).join('_')];
    if (s) return s;
  }
  return null;
}

function mapTrackingStatus(name, knownProcessStep) {
  if (knownProcessStep && KNOWN_PROCESS_STEP_MAP[knownProcessStep]) return KNOWN_PROCESS_STEP_MAP[knownProcessStep];
  if (!name) return 'unknown';
  return NAME_MAP[name] || NAME_MAP[String(name).toLowerCase()] || prefixMatch(String(name).toLowerCase()) || 'unknown';
}

function readableCode(code) {
  const text = str(code).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/* ------------------------------------------------------------- tracking -- */

async function fetchItem(barcode, postalCode) {
  const qs = `itemIdentifier=${encodeURIComponent(barcode)}&postalCode=${encodeURIComponent(postalCode || '')}`;
  const res = await request(`${TRACK_ITEMS}?${qs}`, {}, { carrier: C });
  const text = await res.text();
  if (res.status !== 200) throw new CarrierError(`bpost tracking failed (HTTP ${res.status})`, { status: res.status, retryAfter: retryAfter(res) });
  const body = parseJson(text);
  if (!isObject(body)) throw new CarrierError('bpost returned an unexpected tracking response');
  if ('error' in body) return null;
  const item = Array.isArray(body.items) && isObject(body.items[0]) ? { ...body.items[0] } : null;
  if (item && !item.actualDeliveryInformation?.actualDeliveryTime && item.expectedDeliveryTimeRange) {
    try {
      const r = await request(`${TRACK_ROUND}?${qs}`, {}, { carrier: C });
      const round = r.status === 200 ? parseJson(await r.text()) : null;
      if (isObject(round?.itemOnRoundStatus)) {
        item.itemOnRoundStatus = Object.fromEntries(Object.entries(round.itemOnRoundStatus).map(([k, v]) => [k, Array.isArray(v) && v.length ? v[0] : v]));
      }
    } catch (_) { /* best effort */ }
  }
  return item;
}

function weightKg(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n / 1000 : null;
}

function dimensionsCm(value) {
  let nums = [];
  if (isObject(value)) nums = ['length', 'width', 'height'].map(k => Number(String(value[k] || value[`${k}InCm`] || '').replace(',', '.')));
  else if (typeof value === 'string') nums = (value.match(/\d+(?:[.,]\d+)?/g) || []).slice(0, 3).map(n => Number(n.replace(',', '.')));
  if (nums.length !== 3 || !nums.every(n => Number.isFinite(n) && n > 0)) return null;
  const fmt = n => String(Number(n.toFixed(3)));
  return { length: nums[0], width: nums[1], height: nums[2], text: `${fmt(nums[0])} x ${fmt(nums[1])} x ${fmt(nums[2])} cm` };
}

function pickupPoint(dp) {
  if (!isObject(dp)) return { pickup: false, name: '', address: '' };
  const address = [[dp.street, dp.streetNumber].filter(Boolean).join(' '), [dp.postcode, dp.municipality].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return { pickup: true, name: str(dp.name), address };
}

function normalizeTracked(raw, { barcode, postalCode, lang = 'nl' }) {
  const r = isObject(raw) ? raw : {};
  const step = isObject(r.activeStep) ? r.activeStep : {};
  const status = mapTrackingStatus(step.name, step.knownProcessStep);
  const t = r.actualDeliveryInformation?.actualDeliveryTime;
  const delivered = Boolean(t);
  let deliveredAt = null;
  if (delivered && isObject(t) && t.day) deliveredAt = zonedIso(`${t.day}T${t.time || '00:00'}`, BRUSSELS);
  const eta = !delivered && isObject(r.expectedDeliveryTimeRange) ? r.expectedDeliveryTimeRange : null;
  const plannedFrom = eta ? toIso(eta.time1) : null;
  const plannedTo = eta ? toIso(eta.time2) : null;
  const pp = pickupPoint(r.deliveryPoint);
  const L = String(lang || 'en').toUpperCase();
  const label = step.label?.main?.[L] || step.label?.main?.EN || readableCode(step.knownProcessStep || step.name);
  const events = Array.isArray(r.events) ? r.events : [];
  return {
    barcode: str(barcode),
    sender: str(r.senderCommercialName || r.sender?.name),
    receiver: str(r.receiver?.name || r.announcedReceiver?.name),
    status: delivered ? 'delivered' : (status === 'delivered' ? 'out_for_delivery' : status),
    rawStatus: label,
    statusCode: str(step.knownProcessStep || step.name),
    delivered,
    deliveredAt,
    plannedFrom,
    plannedTo,
    windowKnown: Boolean(plannedFrom && plannedTo),
    pickup: pp.pickup || status === 'at_pickup_point',
    pickupPoint: pp.name,
    pickupAddress: pp.address,
    url: barcode && postalCode ? `https://track.bpost.cloud/btr/web/#/search?lang=${lang}&itemCode=${barcode}&postalCode=${postalCode}` : '',
    weight: weightKg(r.weightInGrams),
    dimensions: dimensionsCm(r.dimensionsInCm),
    history: sortHistory(events.filter(isObject).filter(e => e.date).map(e => ({
      timestamp: zonedIso(`${e.date}T${e.time || '00:00'}`, BRUSSELS),
      status: null,
      rawStatus: str(e.key?.[L]?.description || e.key?.EN?.description),
    }))),
    direction: 'incoming',
    product: str(r.productCategory || r.shipmentType),
    stopsUntilYou: Number.isFinite(Number(r.itemOnRoundStatus?.nrOfStopsUntilTarget)) ? Number(r.itemOnRoundStatus.nrOfStopsUntilTarget) : null,
    pending: !isObject(raw),
  };
}

/* -------------------------------------------------------------- account -- */

class BpostAccountClient {
  constructor({ accessToken = null, refreshToken = null, onTokens = null } = {}) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.onTokens = onTokens;
    this._refreshing = null;
  }

  _headers({ auth = true, statics = true } = {}) {
    const h = { 'x-api-key': ACCOUNT_API_KEY, 'Content-Type': 'application/json', os: 'android', osVersion: '14' };
    if (statics) Object.assign(h, { appVersion: ACCOUNT_APP_VERSION, appLang: 'en' });
    if (auth && this.accessToken) h.Authorization = this.accessToken; // raw token, no "Bearer"
    return h;
  }

  async _post(path, body, opts = {}) {
    const res = await request(`${ACCOUNT_API_URL}/${path}`, { method: 'POST', headers: this._headers(opts), body: JSON.stringify(body) }, { carrier: C });
    const text = await res.text();
    const data = parseJson(text);
    if (res.status === 401 || res.status === 403) {
      if (data?.code === 'APPVERSION_NOT_SUPPORTED' && opts.auth === false) throw new CarrierError('bpost no longer supports this app version; an update of MyParcel is needed', { status: res.status });
      if (path === 'users/login') throw new CarrierError('My bpost: e-mail address or password is incorrect', { status: res.status, auth: true });
      throw new CarrierError('The My bpost login has expired', { status: res.status, auth: true, reauth: true });
    }
    if (res.status === 429) throw new CarrierError('bpost rate limit reached', { status: 429, retryAfter: retryAfter(res) });
    if (res.status !== 200) throw new CarrierError(`My bpost request failed (HTTP ${res.status})`, { status: res.status });
    if (data === undefined) throw new CarrierError('My bpost returned an unreadable response');
    return data;
  }

  _tokens(payload) {
    const resp = payload?.response;
    if (!isObject(resp)) throw new CarrierError('My bpost returned no login response');
    const access = resp.accessToken || resp.token;
    const refresh = resp.refreshToken;
    if (typeof access !== 'string' || typeof refresh !== 'string') throw new CarrierError('My bpost returned no tokens');
    this.accessToken = access;
    this.refreshToken = refresh;
    if (typeof this.onTokens === 'function') this.onTokens({ accessToken: access, refreshToken: refresh });
  }

  async login(email, password) {
    this._tokens(await this._post('users/login', {
      userName: String(email || '').trim().toLowerCase(), password: String(password || ''), appLang: 'en', mandatoryConsent: true, optionalConsent: false,
    }, { auth: false }));
  }

  async refresh() {
    if (this._refreshing) return this._refreshing;
    this._refreshing = (async () => {
      if (!this.refreshToken) throw new CarrierError('Not signed in to My bpost', { auth: true });
      this._tokens(await this._post('users/refreshtoken', { refreshToken: this.refreshToken }, { auth: false, statics: false }));
    })().finally(() => { this._refreshing = null; });
    return this._refreshing;
  }

  async _withRefresh(fn) {
    try { return await fn(); } catch (error) {
      if (!error.auth) throw error;
      await this.refresh();
      return fn();
    }
  }

  async parcels() {
    const list = await this._withRefresh(() => this._post('parcel/getparcelslist', { appLang: 'en' }));
    if (!isObject(list)) throw new CarrierError('My bpost returned an unexpected parcel list');
    if (list.dbError === 'Err_1005') return [];
    const response = 'response' in list ? list.response : list;
    const items = Array.isArray(response?.items) ? response.items : [];
    const summaries = items.filter(i => isObject(i) && i.itemCode);
    if (!summaries.length) return [];
    const detail = (await this._post('parcel/getparcelsv3', {
      appLang: 'en', isFirstPageCall: true,
      items: summaries.map(i => ({ itemCode: i.itemCode, Status: i.Status ?? null, LatestEventTimestamp: i.LatestEventTimestamp ?? null })),
    }))?.response;
    if (!isObject(detail)) throw new CarrierError('My bpost returned no parcel details');
    const out = [];
    for (const group of Object.values(isObject(detail.active) ? detail.active : {})) if (Array.isArray(group)) out.push(...group.filter(isObject));
    if (Array.isArray(detail.history)) out.push(...detail.history.filter(isObject));
    return out;
  }

  async letters() {
    const day = offset => {
      const d = new Date(Date.now() - offset * 86400000);
      return new Intl.DateTimeFormat('en-CA', { timeZone: BRUSSELS, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    };
    const payload = await this._withRefresh(() => this._post('mmt/retrieveImages', { appLang: 'en', fromDate: day(29), toDate: day(0) }));
    const images = payload?.response?.images;
    if (images === null || images === undefined) return [];
    if (!isObject(images)) throw new CarrierError('My bpost returned unexpected letters');
    const letters = {};
    for (const [date, entries] of Object.entries(images)) {
      if (!Array.isArray(entries)) continue;
      for (const raw of entries) {
        if (!isObject(raw) || !raw.itemId) continue;
        letters[String(raw.itemId)] = {
          id: String(raw.itemId), date, plannedDelivery: raw.plannedDistributionDate || null,
          sender: isObject(raw.sender) ? str(raw.sender.name) : '', imageUrl: str(raw.imageUrl), imageRefId: str(raw.imageRefId),
        };
      }
    }
    return Object.values(letters).sort((a, b) => `${b.plannedDelivery || b.date}${b.id}`.localeCompare(`${a.plannedDelivery || a.date}${a.id}`));
  }
}

function accountTs(v) {
  if (!isObject(v) || !(v.day || v.date)) return null;
  return zonedIso(`${v.day || v.date}T${v.time || '00:00'}`, BRUSSELS);
}

function normalizeAccount(raw, { lang = 'nl' } = {}) {
  const barcode = [raw.itemCode, raw.senderBarcode, raw.itemId].find(v => typeof v === 'string' && v) || '';
  let code = raw.currentStatus || raw.parcelMainStatus || raw.status || '';
  if (!code) {
    const step = (Array.isArray(raw.deliverySteps) ? raw.deliverySteps : []).find(s => isObject(s) && s.status === 'active');
    code = step ? (step.knownProcessStep || step.name) : (raw.parcelActiveStatus || '');
  }
  code = str(code);
  const status = KNOWN_PROCESS_STEP_MAP[code] || 'unknown';
  const deliveredAt = accountTs(raw.actualDeliveryTime);
  const delivered = Boolean(deliveredAt) || status === 'delivered';
  const eta = isObject(raw.eta) && raw.eta.day ? raw.eta : null;
  const plannedFrom = !delivered && eta ? accountTs({ day: eta.day, time: eta.time1 || '00:00' }) : null;
  const plannedTo = !delivered && eta ? accountTs({ day: eta.day, time: eta.time2 || '23:59:59' }) : null;
  const pp = pickupPoint(raw.deliveryPoint);
  const details = isObject(raw.viewParcelDetails) ? raw.viewParcelDetails : null;
  const outgoing = ['SENDER', 'SHIPPER', 'OUTGOING'].includes(String(raw.userType || '').toUpperCase());
  return {
    barcode,
    sender: str(raw.sender?.name),
    receiver: str(raw.receiver?.name),
    status: delivered ? 'delivered' : status,
    rawStatus: readableCode(code),
    statusCode: code,
    delivered,
    deliveredAt,
    plannedFrom,
    plannedTo,
    windowKnown: Boolean(eta && (eta.time1 || eta.time2)),
    pickup: pp.pickup || status === 'at_pickup_point',
    pickupPoint: pp.name,
    pickupAddress: pp.address,
    url: barcode ? `https://track.bpost.cloud/btr/web/#/search?lang=${encodeURIComponent(lang)}&itemCode=${encodeURIComponent(barcode)}` : '',
    weight: weightKg(raw.weightInGrams) ?? (details ? weightKg(details.weightInGrams) : null),
    dimensions: dimensionsCm(raw.dimensionsInCm) || (details ? dimensionsCm(details.dimensionsInCm) : null),
    history: (Array.isArray(raw.events) ? raw.events : []).filter(isObject).map(e => ({ timestamp: accountTs(e), status: null, rawStatus: readableCode(String(e.key || '').replace(/[.-]/g, '_')) }))
      .filter(e => e.timestamp).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).slice(-20),
    direction: outgoing ? 'outgoing' : 'incoming',
    product: str(raw.serviceProvider),
  };
}

module.exports = { fetchItem, normalizeTracked, BpostAccountClient, normalizeAccount, mapTrackingStatus, KNOWN_PROCESS_STEP_MAP };
