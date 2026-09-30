'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function eventTimestamp(event) {
  const value = firstValue(event?.timestamp, event?.localTimestamp, event?.dateTime, event?.date);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestEvent(raw) {
  const events = asArray(raw?.events);
  if (!events.length) return {};
  return [...events].sort((a, b) => eventTimestamp(b) - eventTimestamp(a))[0] || events[events.length - 1] || {};
}

function latestEventWithTimeframe(raw) {
  const events = asArray(raw?.events).filter(event =>
    event?.receivingTimeIndication
    || event?.plannedDeliveryTimeframe
    || event?.nextPlannedDeliveryTimeframe
    || event?.deliveryTimeframe
    || event?.deliveryWindow
  );
  if (!events.length) return {};
  return [...events].sort((a, b) => eventTimestamp(b) - eventTimestamp(a))[0] || events[events.length - 1] || {};
}

function parseTimeframe(value) {
  if (!value) return { from: '', to: '' };

  if (Array.isArray(value)) {
    return { from: String(value[0] || ''), to: String(value[1] || '') };
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return { from: '', to: '' };
    if (text.includes('/')) {
      const [from, to] = text.split('/', 2);
      return { from: String(from || '').trim(), to: String(to || '').trim() };
    }
    return { from: text, to: '' };
  }

  if (typeof value === 'object') {
    const nested = value.timeframe || value.deliveryTimeframe || value.plannedDeliveryTimeframe;
    if (nested && nested !== value) {
      const parsed = parseTimeframe(nested);
      if (parsed.from || parsed.to) return parsed;
    }
    const moment = firstValue(value.moment, value.dateTime, value.timestamp);
    return {
      from: String(firstValue(
        value.start, value.from, value.begin, value.startTime, value.fromTime,
        value.startDateTime, value.fromDateTime, value.earliest, moment
      ) || ''),
      to: String(firstValue(
        value.end, value.to, value.stop, value.endTime, value.toTime,
        value.endDateTime, value.toDateTime, value.latest, moment
      ) || ''),
    };
  }

  return { from: '', to: '' };
}

function datePart(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function timePart(value) {
  const text = String(value || '').trim();
  const match = text.match(/(?:T|\s)(\d{2}:\d{2})(?::\d{2})?/i) || text.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
  return match ? match[1] : '';
}

function timeframeFromRaw(raw) {
  const event = latestEventWithTimeframe(raw);
  const candidates = [
    // My DHL's account parcel response exposes the same window used by the
    // official app in receivingTimeIndication (start/end or a single moment).
    raw?.receivingTimeIndication,
    raw?.delivery?.receivingTimeIndication,
    event?.receivingTimeIndication,
    event?.plannedDeliveryTimeframe,
    event?.deliveryTimeframe,
    event?.deliveryWindow,
    raw?.plannedDeliveryTimeframe,
    raw?.deliveryTimeframe,
    raw?.delivery?.timeframe,
    raw?.delivery?.deliveryTimeframe,
    raw?.deliveryWindow,
    event?.nextPlannedDeliveryTimeframe,
    raw?.nextPlannedDeliveryTimeframe,
  ];

  for (const candidate of candidates) {
    const parsed = parseTimeframe(candidate);
    if (parsed.from || parsed.to) return parsed;
  }

  // DHL changes the nesting between account/app versions. Search the raw
  // shipment for the well-known timeframe field names as a final fallback.
  for (const candidate of deepFindValues(raw, ['receivingTimeIndication','plannedDeliveryTimeframe','deliveryTimeframe','deliveryWindow','timeframe','plannedTimeframe'])) {
    const parsed = parseTimeframe(candidate);
    if (parsed.from || parsed.to) return parsed;
  }

  return {
    from: String(firstValue(
      raw?.deliveryTimeFrom, raw?.plannedDeliveryTimeFrom, raw?.delivery?.from,
      raw?.receivingTimeIndication?.start, raw?.receivingTimeIndication?.moment
    ) || ''),
    to: String(firstValue(
      raw?.deliveryTimeTo, raw?.plannedDeliveryTimeTo, raw?.delivery?.to,
      raw?.receivingTimeIndication?.end, raw?.receivingTimeIndication?.moment
    ) || ''),
  };
}


function deepFindValues(root, wanted, maxDepth = 7) {
  const names = new Set(wanted.map(key => String(key).toLowerCase()));
  const found = [];
  const seen = new Set();
  function walk(value, depth) {
    if (!value || depth > maxDepth || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1); return; }
    for (const [key, child] of Object.entries(value)) {
      if (names.has(String(key).toLowerCase()) && child !== undefined && child !== null) found.push(child);
      walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return found;
}

function objectText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') return String(firstValue(value.name, value.companyName, value.displayName, value.label, value.title, value.description, value.value) || '').trim();
  return '';
}

function deepText(root, keys) {
  for (const value of deepFindValues(root, keys)) {
    const text = objectText(value);
    if (text) return text;
  }
  return '';
}

function extractShipment(data, tracking = '') {
  const candidates = [
    data?.shipments,
    data?.parcels,
    data?.items,
    data?.data?.shipments,
    data?.data?.parcels,
    data?.data?.items,
  ];
  const list = candidates.find(Array.isArray);
  if (list) {
    if (!tracking) return list[0] || null;
    return list.find(item => String(firstValue(item?.barcode, item?.trackingCode, item?.trackingNumber, item?.id, item?.key)) === String(tracking)) || list[0] || null;
  }
  if (data && typeof data === 'object') return data;
  return null;
}

class DhlParcelAccountApi {
  constructor({ fetch, email, password, log = () => {} }) {
    this.fetch = fetch;
    this.email = String(email || '').trim();
    this.password = String(password || '');
    this.log = log;
    this.cookies = new Map();
    this.loggedIn = false;
    this.baseUrl = 'https://my.dhlecommerce.nl';
  }

  _cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  _captureCookies(res) {
    let values = [];
    if (typeof res.headers.getSetCookie === 'function') values = res.headers.getSetCookie();
    if (!values.length) {
      const raw = res.headers.get('set-cookie');
      if (raw) values = raw.split(/,(?=\s*[^;,=]+=[^;,]+)/g);
    }
    for (const line of values) {
      const first = String(line).split(';', 1)[0];
      const idx = first.indexOf('=');
      if (idx > 0) this.cookies.set(first.slice(0, idx).trim(), first.slice(idx + 1).trim());
    }
  }

  _xsrfToken() {
    for (const key of ['XSRF-TOKEN', 'xsrf-token', 'X-XSRF-TOKEN']) {
      const value = this.cookies.get(key);
      if (value) {
        try { return decodeURIComponent(value); } catch (_) { return value; }
      }
    }
    return '';
  }

  async _request(path, options = {}) {
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'MyParcel Homey/0.2.4',
      Origin: this.baseUrl,
      Referer: `${this.baseUrl}/`,
      ...(options.headers || {}),
    };
    const cookie = this._cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const xsrf = this._xsrfToken();
    if (xsrf) headers['x-xsrf-token'] = xsrf;

    const res = await this.fetch(`${this.baseUrl}${path}`, { ...options, headers });
    this._captureCookies(res);
    return res;
  }

  async login() {
    if (!this.email || !this.password) throw new Error('Vul je Mijn DHL e-mailadres en wachtwoord in.');

    this.cookies.clear();
    const res = await this._request('/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Mijn DHL login mislukt (HTTP ${res.status})${text ? `: ${text.slice(0, 120)}` : ''}`);
    }

    this.loggedIn = true;
    return true;
  }

  async _getParcelDetails(tracking) {
    if (!tracking) return null;
    const key = encodeURIComponent(tracking);
    const paths = [
      `/receiver-parcel-api/track-trace?key=${key}`,
      `/receiver-parcel-api/parcels/${key}`,
      `/receiver-parcel-api/parcel/${key}`,
    ];
    for (const path of paths) {
      try {
        const res = await this._request(path, { method: 'GET' });
        if (!res.ok) { this.log(`[DHL] detail lookup ${path} returned HTTP ${res.status}`); continue; }
        const data = await res.json();
        const shipment = extractShipment(data, tracking);
        if (shipment) return shipment;
      } catch (error) {
        this.log(`[DHL] detail lookup ${path} failed: ${error.message}`);
      }
    }
    return null;
  }

  async getParcels({ retry = true } = {}) {
    if (!this.loggedIn || !this.cookies.size) await this.login();

    const candidates = [
      '/receiver-parcel-api/parcels?tab=incoming',
      '/receiver-parcel-api/parcels',
    ];

    let lastError;
    for (const path of candidates) {
      const res = await this._request(path, { method: 'GET' });
      if (res.status === 401 || res.status === 403) {
        lastError = new Error(`Mijn DHL sessie geweigerd (HTTP ${res.status})`);
        break;
      }
      if (!res.ok) {
        lastError = new Error(`Mijn DHL pakketten ophalen mislukt (HTTP ${res.status})`);
        continue;
      }
      const data = await res.json();
      const rawParcels = Array.isArray(data) ? data : (Array.isArray(data?.parcels) ? data.parcels : (Array.isArray(data?.items) ? data.items : []));
      const parcels = rawParcels.map(parcel => this.normalizeParcel(parcel));

      // The account parcel list often only contains a summary. The delivery
      // timeframe lives in the track & trace events, so enrich active parcels
      // when the summary does not expose a window/date.
      for (let index = 0; index < parcels.length; index += 1) {
        const parcel = parcels[index];
        if (parcel.delivered || !parcel.tracking) continue;
        const needsDetail = !parcel.deliveryDate || !parcel.deliveryWindow || !parcel.sender || !parcel.service || !parcel.lastEvent;
        if (!needsDetail) continue;
        const detail = await this._getParcelDetails(parcel.tracking);
        if (!detail) continue;
        const enriched = this.normalizeParcel({ ...rawParcels[index], ...detail });
        parcels[index] = {
          ...parcel,
          ...enriched,
          sender: enriched.sender || parcel.sender,
          deliveryDate: enriched.deliveryDate || parcel.deliveryDate,
          deliveryWindow: enriched.deliveryWindow || parcel.deliveryWindow,
          deliveryWindowFrom: enriched.deliveryWindowFrom || parcel.deliveryWindowFrom || '',
          deliveryWindowTo: enriched.deliveryWindowTo || parcel.deliveryWindowTo || '',
          raw: { summary: rawParcels[index], detail },
        };
      }

      return parcels;
    }

    if (retry) {
      this.loggedIn = false;
      await this.login();
      return this.getParcels({ retry: false });
    }
    throw lastError || new Error('Mijn DHL pakketten konden niet worden opgehaald.');
  }

  normalizeParcel(raw) {
    const currentEvent = latestEvent(raw);
    const tracking = String(firstValue(raw?.barcode, raw?.trackingCode, raw?.trackingNumber, raw?.id, raw?.key) || '');
    const sender = firstValue(raw?.sender?.name, raw?.shipper?.name, raw?.senderName, raw?.shipperName, raw?.merchant?.name, raw?.shop?.name, raw?.reference, deepText(raw, ['senderName','shipperName','consignorName','merchantName','shopName','sender','shipper','consignor','merchant']));
    const category = String(firstValue(raw?.category, raw?.status?.category, currentEvent?.category, raw?.currentStatus, raw?.status?.status, raw?.status?.code, raw?.status?.description, typeof raw?.status === 'string' ? raw.status : '', currentEvent?.status, 'UNKNOWN'));

    const timeframe = timeframeFromRaw(raw);
    const explicitDate = firstValue(
      raw?.deliveryDate, raw?.plannedDeliveryDate, raw?.delivery?.date, raw?.expectedDeliveryDate,
      raw?.receivingTimeIndication?.start, raw?.receivingTimeIndication?.moment,
      deepText(raw, ['deliveryDate','plannedDeliveryDate','expectedDeliveryDate','deliveryDay','plannedDeliveryDay'])
    );
    // Keep the original DHL date/time values intact here. The Homey device
    // knows the configured Homey timezone and converts these values for
    // capabilities, Flow tokens and widgets. Stripping an ISO timestamp to
    // HH:mm at API level would lose its Z/offset information.
    const deliveryDate = String(explicitDate || timeframe.from || timeframe.to || '');
    const deliveryWindowFrom = String(timeframe.from || '');
    const deliveryWindowTo = String(timeframe.to || '');
    const fromTime = timePart(deliveryWindowFrom);
    const toTime = timePart(deliveryWindowTo);
    const windowFrom = fromTime || (deliveryWindowFrom && !datePart(deliveryWindowFrom) ? deliveryWindowFrom : '');
    const windowTo = toTime || (deliveryWindowTo && !datePart(deliveryWindowTo) ? deliveryWindowTo : '');
    const deliveryWindow = windowFrom && windowTo && windowFrom !== windowTo
      ? `${windowFrom} – ${windowTo}`
      : (windowFrom || windowTo || '');

    const updatedAt = firstValue(
      currentEvent?.timestamp,
      currentEvent?.localTimestamp,
      raw?.updatedAt,
      raw?.lastUpdated,
      raw?.timestamp,
      raw?.status?.timestamp,
      raw?.createdAt,
      new Date().toISOString(),
    );
    const delivered = category.toUpperCase() === 'DELIVERED' || Boolean(raw?.deliveredAt || raw?.delivery?.deliveredAt);
    const detailsUrl = String(firstValue(raw?.detailsUrl, raw?.detailUrl, raw?.trackingUrl, raw?.trackTraceUrl, raw?.url,
      tracking ? `https://www.dhlecommerce.nl/nl/consument/track-en-trace?piececode=${encodeURIComponent(tracking)}` : '') || '');
    const service = String(firstValue(raw?.service?.name, raw?.serviceName, raw?.product?.name, raw?.productName, raw?.shipmentType) || '');
    const deliveryPoint = String(firstValue(raw?.deliveryPoint?.name, raw?.servicePoint?.name, raw?.pickupPoint?.name, raw?.delivery?.location?.name) || '');
    const lastEvent = String(firstValue(currentEvent?.description, currentEvent?.statusDescription, currentEvent?.status, currentEvent?.category, deepText(raw, ['statusDescription','eventDescription','description'])) || category);
    const lastEventAt = String(firstValue(currentEvent?.timestamp, currentEvent?.localTimestamp, currentEvent?.dateTime, currentEvent?.date, updatedAt) || '');
    const receiver = deepText(raw, ['receiverName','recipientName','consigneeName','receiver','recipient','consignee']);
    const weight = deepText(raw, ['weight','parcelWeight','shipmentWeight']);
    const product = deepText(raw, ['productName','product','productCode']);
    const partner = deepText(raw, ['partnerName','partner','deliveryPartner','carrierName']);
    const accessPoint = deepText(raw, ['accessPointName','servicePointName','pickupPointName','accessPoint','servicePoint','pickupPoint']);
    const shipmentType = deepText(raw, ['shipmentType','parcelType','type']);
    const direction = deepText(raw, ['direction','shipmentDirection']);
    const shipFrom = deepText(raw, ['origin','fromAddress','senderAddress']);
    const shipTo = deepText(raw, ['destination','toAddress','receiverAddress','recipientAddress']);

    return {
      tracking,
      reference: String(firstValue(raw?.reference, raw?.shipmentReference, raw?.customerReference) || ''),
      sender: String(sender || ''),
      status: category,
      category,
      deliveryDate,
      deliveryWindow,
      deliveryWindowFrom,
      deliveryWindowTo,
      updatedAt,
      createdAt: String(firstValue(raw?.createdAt, raw?.creationDateTime, raw?.created, '') || ''),
      delivered,
      detailsUrl,
      service,
      deliveryPoint,
      lastEvent,
      lastEventAt,
      receiver, weight, product, partner, accessPoint, shipmentType, direction, shipFrom, shipTo,
      raw,
    };
  }
}

module.exports = DhlParcelAccountApi;
