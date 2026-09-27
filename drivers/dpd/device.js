'use strict';

const Homey = require('homey');
const localizePackageStatus = require('../../lib/status-i18n.js');
const { DpdApi } = require('../../lib/dpd-api');

const DPD_CAPABILITIES = [
  'dpd_parcel_count',
  'dpd_total_count',
  'dpd_status',
  'dpd_tracking',
  'dpd_sender',
  'dpd_receiver',
  'dpd_delivery_date',
  'dpd_delivery_window',
  'dpd_delivery_point',
  'dpd_weight',
  'dpd_dimensions',
  'dpd_delivery_type',
  'dpd_last_event',
  'dpd_direction',
  'myparcel_connection_status',
  'dpd_last_update',
];

const DIRECTION_TEXT = {
  en: ['Incoming', 'Outgoing'], nl: ['Inkomend', 'Uitgaand'], de: ['Eingehend', 'Ausgehend'],
  fr: ['Entrant', 'Sortant'], it: ['In arrivo', 'In uscita'], sv: ['Inkommande', 'Utgående'],
  no: ['Innkommende', 'Utgående'], es: ['Entrante', 'Saliente'], da: ['Indgående', 'Udgående'],
  ru: ['Входящая', 'Исходящая'], pl: ['Przychodząca', 'Wychodząca'], ko: ['수신', '발신'],
  ar: ['وارد', 'صادر'],
};

const DELIVERY_TYPE_TEXT = {
  en: { HOME: 'Home delivery', PARCELSHOP: 'ParcelShop' },
  nl: { HOME: 'Thuisbezorging', PARCELSHOP: 'Pakketpunt' },
  de: { HOME: 'Hauszustellung', PARCELSHOP: 'Paketshop' },
  fr: { HOME: 'Livraison à domicile', PARCELSHOP: 'Point relais' },
  it: { HOME: 'Consegna a domicilio', PARCELSHOP: 'Punto di ritiro' },
  sv: { HOME: 'Hemleverans', PARCELSHOP: 'Utlämningsställe' },
  no: { HOME: 'Hjemlevering', PARCELSHOP: 'Hentested' },
  es: { HOME: 'Entrega a domicilio', PARCELSHOP: 'Punto de recogida' },
  da: { HOME: 'Hjemmelevering', PARCELSHOP: 'Afhentningssted' },
  ru: { HOME: 'Доставка на дом', PARCELSHOP: 'Пункт выдачи' },
  pl: { HOME: 'Dostawa do domu', PARCELSHOP: 'Punkt odbioru' },
  ko: { HOME: '자택 배송', PARCELSHOP: '수령 지점' },
  ar: { HOME: 'توصيل إلى المنزل', PARCELSHOP: 'نقطة استلام' },
};


const DPD_EVENT_STATUS = {
  ENA: 'ORDER_CREATED',
  ORI: 'IN_TRANSIT', ORW: 'IN_TRANSIT', HUI: 'IN_TRANSIT', HUS: 'IN_TRANSIT', HUW: 'IN_TRANSIT', HUZ: 'IN_TRANSIT',
  SPE: 'IN_TRANSIT', SPL: 'IN_TRANSIT', SPS: 'IN_TRANSIT', SPV: 'IN_TRANSIT', SPW: 'IN_TRANSIT', SPZ: 'IN_TRANSIT',
  DLI: 'IN_TRANSIT', DLS: 'IN_TRANSIT', DLW: 'IN_TRANSIT', DLZ: 'IN_TRANSIT', DLR: 'IN_TRANSIT', MSDLO: 'IN_TRANSIT',
  DLO: 'PARCEL_OUT_FOR_DELIVERY', DEHD: 'IN_TRANSIT', DEHDY: 'IN_TRANSIT', DOMSDLO: 'IN_TRANSIT', DOPKY: 'IN_TRANSIT',
  DODEI: 'AVAILABLE_FOR_COLLECTION',
  DEY: 'DELIVERED', DEYY: 'DELIVERED', DODEY: 'DELIVERED', DODEYY: 'DELIVERED',
  SPR: 'RETURN_TO_SENDER', DEN: 'RETURN_TO_SENDER', DODEN: 'RETURN_TO_SENDER', DODEH: 'RETURN_TO_SENDER',
  ENX: 'PROBLEM', ORX: 'PROBLEM', HUX: 'PROBLEM', SPX: 'PROBLEM', DLX: 'PROBLEM', DEX: 'PROBLEM', DODEX: 'PROBLEM',
};

const AUTH_MESSAGES = {
  en: name => `Reconnect DPD – the credentials for ${name} no longer work. Open the device and repair the connection.`,
  nl: name => `DPD opnieuw koppelen – de inloggegevens voor ${name} werken niet meer. Open het apparaat en herstel de koppeling.`,
  de: name => `DPD erneut verbinden – Die Anmeldedaten für ${name} funktionieren nicht mehr. Öffne das Gerät und stelle die Verbindung wieder her.`,
  fr: name => `Reconnecter DPD – Les identifiants de ${name} ne fonctionnent plus. Ouvrez l’appareil et rétablissez la connexion.`,
  it: name => `Ricollega DPD – Le credenziali di ${name} non funzionano più. Apri il dispositivo e ripristina il collegamento.`,
  sv: name => `Anslut DPD igen – Inloggningsuppgifterna för ${name} fungerar inte längre. Öppna enheten och återställ anslutningen.`,
  no: name => `Koble til DPD på nytt – Påloggingsinformasjonen for ${name} fungerer ikke lenger. Åpne enheten og reparer tilkoblingen.`,
  es: name => `Volver a conectar DPD – Las credenciales de ${name} ya no funcionan. Abre el dispositivo y repara la conexión.`,
  da: name => `Forbind DPD igen – Loginoplysningerne til ${name} virker ikke længere. Åbn enheden og reparer forbindelsen.`,
  ru: name => `Повторно подключите DPD – Учетные данные ${name} больше не работают. Откройте устройство и восстановите подключение.`,
  pl: name => `Połącz DPD ponownie – Dane logowania dla ${name} już nie działają. Otwórz urządzenie i napraw połączenie.`,
  ko: name => `DPD 다시 연결 – ${name}의 로그인 정보가 더 이상 작동하지 않습니다. 기기를 열고 연결을 복구하세요.`,
  ar: name => `أعد ربط DPD – لم تعد بيانات تسجيل الدخول الخاصة بـ ${name} تعمل. افتح الجهاز وأصلح الاتصال.`,
};

function arr(value) { return Array.isArray(value) ? value : []; }
function pick(object, ...keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}
function objText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return String(pick(value, 'name', 'description', 'label', 'text', 'value', 'code') || '');
}
function trackingOf(parcel, fallback = '') {
  return String(pick(parcel, 'parcelNumber', 'parcelNo', 'barcode', 'trackingNumber', 'id') || fallback);
}
function statusOf(parcel) {
  const raw = pick(parcel, 'statusDescription', 'parcelStatus') || parcel?.status || '';
  return objText(raw) || 'UNKNOWN';
}
function eventTimestamp(event) {
  const direct = pick(event, 'dateTime', 'timestamp', 'eventDateAndTime', 'createdAt');
  if (direct) return String(direct);
  const date = pick(event, 'date', 'eventDate');
  const time = pick(event, 'time', 'eventTime');
  return date ? `${date}${time ? `T${time}` : ''}` : '';
}
function latestEvent(events) {
  const rows = arr(events).filter(item => item && typeof item === 'object');
  if (!rows.length) return null;
  return [...rows].sort((left, right) => {
    const a = Date.parse(eventTimestamp(left)) || 0;
    const b = Date.parse(eventTimestamp(right)) || 0;
    return b - a;
  })[0] || rows.at(-1);
}
function fmpHashcode(parcel) {
  const actions = parcel?.availableActions || {};
  const rows = arr(actions.FOLLOW_MY_PARCEL || actions.followMyParcel);
  return String(rows[0]?.hashcode || rows[0]?.hashCode || '');
}
function isoDay(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}
function clock(value) {
  const match = String(value || '').match(/(?:T|\s)?(\d{2}:\d{2})(?::\d{2})?/);
  return match ? match[1] : '';
}
function fullWindowPoint(date, time) {
  if (!time) return '';
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(String(time))) return String(time);
  const day = isoDay(date);
  return day ? `${day}T${String(time)}` : String(time);
}
function dimensionsText(value) {
  if (!value || typeof value !== 'object') return '';
  const length = pick(value, 'length', 'Length');
  const width = pick(value, 'width', 'Width');
  const height = pick(value, 'height', 'Height');
  if (length === '' || width === '' || height === '') return objText(value);
  return `${length} x ${width} x ${height} cm`;
}
function weightText(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') {
    const amount = pick(value, 'value', 'weight', 'amount');
    const unit = pick(value, 'unit', 'unitOfMeasure');
    return amount === '' ? '' : `${amount}${unit ? ` ${unit}` : ' kg'}`;
  }
  const text = String(value).trim();
  if (!text) return '';
  return /[a-z]/i.test(text) ? text : `${text} kg`;
}

module.exports = class DpdDevice extends Homey.Device {
  async onInit() {
    this._packages = arr(this.getStoreValue('dpd_packages'));
    this._detailCache = new Map();
    this._busy = false;
    await this._ensureCapabilities();
    this._timer = this.homey.setInterval(() => this.refresh(false).catch(error => this.error(error)), 15 * 60 * 1000);
    this.homey.setTimeout(() => this.refresh(true).catch(error => this.error(error)), 3000);
  }

  async onDeleted() {
    if (this._timer) this.homey.clearInterval(this._timer);
  }

  async _ensureCapabilities() {
    for (const capability of DPD_CAPABILITIES) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability).catch(error => this.error(`Could not add ${capability}`, error));
      }
    }
  }

  _language() {
    const language = this.homey.i18n.getLanguage();
    return DIRECTION_TEXT[language] ? language : 'en';
  }

  _direction(outgoing) {
    return DIRECTION_TEXT[this._language()][outgoing ? 1 : 0];
  }

  _deliveryType(raw) {
    const key = String(raw || '').toUpperCase();
    return DELIVERY_TYPE_TEXT[this._language()][key] || objText(raw);
  }

  _formatDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return `${match[3]}-${match[2]}-${match[1]}`;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.homey.clock.getTimezone(), day: '2-digit', month: '2-digit', year: 'numeric',
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('day')}-${get('month')}-${get('year')}`;
  }

  _window(source, fmp) {
    const fmpDate = pick(fmp, 'deliveryDate', 'date');
    const range = fmp?.timeRange || fmp?.deliveryTimeRange || {};
    let date = String(fmpDate || pick(source, 'deliveryDate', 'plannedDeliveryDate', 'expectedDeliveryDate') || '');
    let from = pick(range, 'from', 'start') || pick(source, 'deliveryTimeFrom', 'deliveryWindowFrom');
    let to = pick(range, 'to', 'end') || pick(source, 'deliveryTimeTo', 'deliveryWindowTo');

    const legacy = pick(source, 'deliveryTimeRange', 'deliveryWindow');
    if ((!from || !to) && legacy && typeof legacy === 'object') {
      from = from || pick(legacy, 'from', 'start');
      to = to || pick(legacy, 'to', 'end');
    }
    if ((!from || !to) && typeof legacy === 'string') {
      const parts = legacy.split(/\s+[–—-]\s+/).map(item => item.trim()).filter(Boolean);
      if (parts.length > 1) {
        from = from || parts[0];
        to = to || parts[1];
      }
    }

    if (!date) date = isoDay(from) || isoDay(to);
    const start = fullWindowPoint(date, from);
    const end = fullWindowPoint(date, to);
    const startTime = clock(from || start);
    const endTime = clock(to || end);
    const window = startTime && endTime ? `${startTime} - ${endTime}` : (startTime || endTime || (typeof legacy === 'string' ? legacy : ''));
    return { date, start, end, window };
  }

  async _details(api, source, outgoing, previousStatus) {
    const tracking = trackingOf(source);
    if (!tracking) return null;
    const currentStatus = statusOf(source);
    const cached = this._detailCache.get(tracking);
    if (cached && previousStatus === currentStatus) return cached;

    const detail = await api.parcelDetail(tracking, {
      shipmentBUCode: String(source?.shipmentBUCode || ''),
      parcelType: outgoing ? 'OUTGOING' : 'INCOMING',
    });
    if (detail) this._detailCache.set(tracking, detail);
    return detail || cached || null;
  }

  async _normalize(api, source, outgoing, index, previous) {
    const tracking = trackingOf(source, String(index));
    const status = statusOf(source);
    const detail = await this._details(api, source, outgoing, previous?.status);
    const hashcode = fmpHashcode(source);
    const fmp = hashcode ? await api.fmpDeliveryWindow(hashcode) : null;
    const window = this._window(source, fmp);
    const detailEvent = latestEvent(detail?.parcelEvents || detail?.events);
    const statusBlock = source?.status && typeof source.status === 'object' ? source.status : {};
    const statusMoment = pick(statusBlock, 'eventDateAndTime', 'timestamp');
    const lastEventAt = eventTimestamp(detailEvent) || String(statusMoment || pick(source, 'lastEventAt', 'updatedAt') || '');
    const eventCode = String(pick(detailEvent || {}, 'eventType', 'code') || '').toUpperCase();
    const lastEvent = DPD_EVENT_STATUS[eventCode] || objText(pick(detailEvent || {}, 'eventTypeText', 'description', 'status')) || status;
    const deliveryTypeRaw = pick(statusBlock, 'deliveryType') || pick(source, 'deliveryType');
    const isParcelShop = String(deliveryTypeRaw || '').toUpperCase() === 'PARCELSHOP';
    const detailReceiver = objText(detail?.receiver);
    const deliveryPoint = isParcelShop
      ? (detailReceiver || objText(pick(detail || {}, 'deliveryPoint', 'pickupPoint')))
      : objText(pick(detail || {}, 'deliveryPoint', 'pickupPoint'));
    const receiver = isParcelShop ? '' : (detailReceiver || objText(pick(source, 'receiver', 'recipient', 'recipientName')));
    const weight = weightText(pick(detail || {}, 'weight') || pick(source, 'weight'));
    const dimensions = dimensionsText(pick(detail || {}, 'dimensions') || pick(source, 'dimensions'));
    const canonical = localizePackageStatus.canonicalKey(status);
    const delivered = canonical === 'delivered';
    const deliveryDate = String(window.date || (delivered ? isoDay(statusMoment || lastEventAt) : '') || '');
    const service = objText(pick(source, 'service', 'serviceName', 'parcelService')) || objText(pick(detail || {}, 'service', 'serviceName'));
    const product = objText(pick(source, 'product', 'productName', 'parcelProduct')) || objText(pick(detail || {}, 'product', 'productName'));
    const updatedAt = String(lastEventAt || statusMoment || new Date().toISOString());

    return {
      id: tracking,
      tracking,
      sender: objText(pick(source, 'sender', 'shipper')) || String(pick(source, 'shipperName', 'senderName') || 'DPD'),
      receiver,
      status,
      deliveryDate,
      deliveryWindow: window.window,
      deliveryWindowFrom: window.start,
      deliveryWindowTo: window.end,
      deliveryPoint,
      weight,
      dimensions,
      service,
      product,
      lastEvent,
      lastEventAt,
      eventAt: lastEventAt,
      updatedAt,
      createdAt: String(pick(source, 'createdAt', 'creationDate', 'orderDate') || ''),
      delivered,
      direction: this._direction(outgoing),
      shipmentType: this._deliveryType(deliveryTypeRaw),
      accessPoint: deliveryPoint,
      detailsUrl: tracking ? `https://www.dpdgroup.com/nl/mydpd/my-parcels/search?parcelNumber=${encodeURIComponent(tracking)}` : '',
    };
  }

  async notifyAuth() {
    if (this.getStoreValue('authExpiredNotified') === true) return;
    const language = this._language();
    const message = (AUTH_MESSAGES[language] || AUTH_MESSAGES.en)(this.getName());
    await this.homey.notifications.createNotification({ excerpt: message }).catch(() => {});
    await this.setStoreValue('authExpiredNotified', true);
  }

  _tokens(parcel) {
    return {
      tracking: parcel.tracking || '',
      status: localizePackageStatus(this.homey, parcel.status) || '',
      sender: parcel.sender || '',
      receiver: parcel.receiver || '',
      delivery_date: this._formatDate(parcel.deliveryDate),
      delivery_window: parcel.deliveryWindow || '',
      delivery_point: parcel.deliveryPoint || '',
      weight: parcel.weight || '',
      dimensions: parcel.dimensions || '',
      delivery_type: parcel.shipmentType || '',
      last_event: localizePackageStatus(this.homey, parcel.lastEvent) || parcel.lastEvent || '',
      direction: parcel.direction || '',
    };
  }

  async _triggerChanges(previous, current) {
    for (const parcel of current) {
      const old = previous.get(parcel.tracking);
      const tokens = this._tokens(parcel);
      if (!old) {
        await this.homey.flow.getDeviceTriggerCard('dpd_new_package').trigger(this, tokens, {}).catch(() => {});
        continue;
      }

      if (old.status !== parcel.status) {
        await this.homey.flow.getDeviceTriggerCard('dpd_status_changed').trigger(this, {
          ...tokens,
          previous_status: localizePackageStatus(this.homey, old.status) || '',
        }, {}).catch(() => {});
      }

      const deliveryChanged = (old.deliveryDate !== parcel.deliveryDate || old.deliveryWindow !== parcel.deliveryWindow)
        && Boolean(parcel.deliveryDate || parcel.deliveryWindow);
      if (deliveryChanged) {
        await this.homey.flow.getDeviceTriggerCard('dpd_delivery_updated').trigger(this, tokens, {}).catch(() => {});
      }

      if (parcel.delivered && !old.delivered) {
        await this.homey.flow.getDeviceTriggerCard('dpd_delivered').trigger(this, tokens, {}).catch(() => {});
      }
    }
  }

  async refresh() {
    if (this._busy) return false;
    this._busy = true;
    try {
      const settings = this.getSettings();
      const api = new DpdApi(settings.email, settings.password, settings.bu || 'DPD-NL');
      const data = await api.parcels();
      const incoming = arr(data.incomingShipments || data.incomingParcels || data.parcels);
      const outgoing = arr(data.sendingShipments || data.sendingParcels);
      const previous = new Map(arr(this._packages).map(parcel => [parcel.tracking, parcel]));

      const normalized = await Promise.all([
        ...incoming.map((source, index) => this._normalize(api, source, false, index, previous.get(trackingOf(source)))),
        ...outgoing.map((source, index) => this._normalize(api, source, true, incoming.length + index, previous.get(trackingOf(source)))),
      ]);
      normalized.sort((left, right) => {
        if (left.delivered !== right.delivered) return left.delivered ? 1 : -1;
        const a = Date.parse(left.deliveryWindowFrom || left.deliveryDate || left.updatedAt || '') || Number.MAX_SAFE_INTEGER;
        const b = Date.parse(right.deliveryWindowFrom || right.deliveryDate || right.updatedAt || '') || Number.MAX_SAFE_INTEGER;
        return a - b;
      });

      await this._triggerChanges(previous, normalized);
      this._packages = normalized;
      await this.setStoreValue('dpd_packages', normalized).catch(() => {});

      const active = normalized.filter(parcel => !parcel.delivered);
      const next = active[0] || normalized[0] || {};
      const values = {
        dpd_parcel_count: active.length,
        dpd_total_count: normalized.length,
        dpd_status: next.status ? localizePackageStatus(this.homey, next.status) : this.homey.app.getConnectionLabel(true),
        dpd_tracking: next.tracking || '',
        dpd_sender: next.sender || '',
        dpd_receiver: next.receiver || '',
        dpd_delivery_date: this._formatDate(next.deliveryDate),
        dpd_delivery_window: next.deliveryWindow || '',
        dpd_delivery_point: next.deliveryPoint || '',
        dpd_weight: next.weight || '',
        dpd_dimensions: next.dimensions || '',
        dpd_delivery_type: next.shipmentType || '',
        dpd_last_event: next.lastEvent ? (localizePackageStatus(this.homey, next.lastEvent) || next.lastEvent) : '',
        dpd_direction: next.direction || '',
        dpd_last_update: new Date().toISOString(),
      };
      for (const [capability, value] of Object.entries(values)) {
        if (this.hasCapability(capability)) await this.setCapabilityValue(capability, value).catch(error => this.error(capability, error));
      }

      await this.setStoreValue('authExpiredNotified', false);
      await this.setAvailable();
      return true;
    } catch (error) {
      if ([400, 401, 403].includes(error.status) || /login|auth|credential/i.test(error.message)) {
        await this.notifyAuth();
        await this.setUnavailable('DPD login expired').catch(() => {});
      } else {
        await this.setUnavailable(`DPD: ${error.message}`).catch(() => {});
      }
      this.error(error);
      return false;
    } finally {
      this._busy = false;
    }
  }

  getWidgetData() {
    return {
      parcels: arr(this._packages),
      authenticated: this.getStoreValue('authExpiredNotified') !== true,
      carrier: 'dpd',
    };
  }
};
