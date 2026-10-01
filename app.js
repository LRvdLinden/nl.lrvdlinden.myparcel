'use strict';
const Homey = require('homey');
const fs = require('fs');
const path = require('path');
const localizePackageStatus = require('./lib/status-i18n.js');

const DRIVER_IDS = [
  'postnl', 'dhl-parcel', 'dpd', 'ups', 'budbee', 'homerr',
  'fedex', 'gls', 'inpost-uk', 'bpost', 'royal-mail', 'post-dhl-de', 'ampere', 'dhl-express',
];

const CARRIER_NAMES = {
  postnl: 'PostNL',
  'dhl-parcel': 'DHL',
  'dhl-express': 'DHL Express',
  dpd: 'DPD',
  ups: 'UPS',
  budbee: 'Budbee',
  homerr: 'Homerr / Vinted Go',
  fedex: 'FedEx',
  gls: 'GLS',
  'inpost-uk': 'InPost UK',
  bpost: 'bpost',
  'royal-mail': 'Royal Mail',
  'post-dhl-de': 'Post & DHL Germany',
  ampere: 'Ampère',
};

const DELIVERY_WINDOW_FLOWS = {
  postnl: { trigger: 'postnl_delivery_window_changed', condition: 'postnl_delivery_window_known' },
  'dhl-parcel': { trigger: 'dhl_delivery_window_changed', condition: 'dhl_delivery_window_known' },
  'dhl-express': { trigger: 'dhl_express_delivery_updated', condition: 'dhl_express_delivery_window_known' },
  dpd: { trigger: 'dpd_delivery_window_changed', condition: 'dpd_delivery_window_known' },
  ups: { trigger: 'ups_delivery_window_changed', condition: 'ups_delivery_window_known' },
  budbee: { trigger: 'budbee_delivery_window_changed', condition: 'budbee_delivery_window_known' },
  gls: { trigger: 'gls_delivery_window_changed', condition: 'gls_delivery_window_known' },
  bpost: { trigger: 'bpost_delivery_window_changed', condition: 'bpost_delivery_window_known' },
  'post-dhl-de': { trigger: 'dhl_de_delivery_window_changed', condition: 'dhl_de_delivery_window_known' },
};

const CONNECTION_CAPABILITIES = {
  postnl: 'postnl_status',
  bpost: 'bpost_account_status',
  ups: 'ups_account_status',
  'post-dhl-de': 'dhl_de_account_status',
};

const CONNECTION_TEXT = {
  en: ['Connected', 'Not connected'],
  nl: ['Verbonden', 'Niet verbonden'],
  de: ['Verbunden', 'Nicht verbunden'],
  fr: ['Connecté', 'Non connecté'],
  it: ['Connesso', 'Non connesso'],
  sv: ['Ansluten', 'Inte ansluten'],
  no: ['Tilkoblet', 'Ikke tilkoblet'],
  es: ['Conectado', 'No conectado'],
  da: ['Forbundet', 'Ikke forbundet'],
  ru: ['Подключено', 'Не подключено'],
  pl: ['Połączono', 'Nie połączono'],
  ko: ['연결됨', '연결되지 않음'],
  ar: ['متصل', 'غير متصل'],
};


const DELIVERY_TOKEN_TEXT = {
  en: { image: 'MyParcel delivery image', carrier: 'Delivery carrier', status: 'Delivery status', sender: 'Delivery sender', tracking: 'Delivery tracking number', date: 'Delivery date', window: 'Delivery window' },
  nl: { image: 'MyParcel bezorging afbeelding', carrier: 'Bezorgvervoerder', status: 'Bezorgstatus', sender: 'Afzender bezorging', tracking: 'Trackingnummer bezorging', date: 'Bezorgdatum', window: 'Bezorgvenster' },
  de: { image: 'MyParcel Zustellbild', carrier: 'Zustelldienst', status: 'Zustellstatus', sender: 'Absender der Zustellung', tracking: 'Sendungsnummer', date: 'Zustelldatum', window: 'Zustellzeitfenster' },
  fr: { image: 'Image de livraison MyParcel', carrier: 'Transporteur', status: 'Statut de livraison', sender: 'Expéditeur', tracking: 'Numéro de suivi', date: 'Date de livraison', window: 'Créneau de livraison' },
  it: { image: 'Immagine consegna MyParcel', carrier: 'Corriere', status: 'Stato consegna', sender: 'Mittente', tracking: 'Numero di tracciamento', date: 'Data di consegna', window: 'Finestra di consegna' },
  sv: { image: 'MyParcel leveransbild', carrier: 'Transportör', status: 'Leveransstatus', sender: 'Avsändare', tracking: 'Spårningsnummer', date: 'Leveransdatum', window: 'Leveransfönster' },
  no: { image: 'MyParcel leveringsbilde', carrier: 'Transportør', status: 'Leveringsstatus', sender: 'Avsender', tracking: 'Sporingsnummer', date: 'Leveringsdato', window: 'Leveringsvindu' },
  es: { image: 'Imagen de entrega MyParcel', carrier: 'Transportista', status: 'Estado de entrega', sender: 'Remitente', tracking: 'Número de seguimiento', date: 'Fecha de entrega', window: 'Franja de entrega' },
  da: { image: 'MyParcel leveringsbillede', carrier: 'Transportør', status: 'Leveringsstatus', sender: 'Afsender', tracking: 'Sporingsnummer', date: 'Leveringsdato', window: 'Leveringsvindue' },
  ru: { image: 'Изображение доставки MyParcel', carrier: 'Перевозчик', status: 'Статус доставки', sender: 'Отправитель', tracking: 'Номер отслеживания', date: 'Дата доставки', window: 'Интервал доставки' },
  pl: { image: 'Obraz dostawy MyParcel', carrier: 'Przewoźnik', status: 'Status dostawy', sender: 'Nadawca', tracking: 'Numer śledzenia', date: 'Data dostawy', window: 'Okno dostawy' },
  ko: { image: 'MyParcel 배송 이미지', carrier: '배송사', status: '배송 상태', sender: '발송인', tracking: '운송장 번호', date: '배송 날짜', window: '배송 시간대' },
  ar: { image: 'صورة توصيل MyParcel', carrier: 'شركة الشحن', status: 'حالة التوصيل', sender: 'المرسل', tracking: 'رقم التتبع', date: 'تاريخ التوصيل', window: 'نافذة التوصيل' },
};

const DISCONNECTED_MESSAGES = {
  en: (carrier, name) => `MyParcel – ${carrier} is not connected for ${name}. Open the device and repair the connection.`,
  nl: (carrier, name) => `MyParcel – ${carrier} is niet verbonden voor ${name}. Open het apparaat en herstel de koppeling.`,
  de: (carrier, name) => `MyParcel – ${carrier} ist für ${name} nicht verbunden. Öffne das Gerät und stelle die Verbindung wieder her.`,
  fr: (carrier, name) => `MyParcel – ${carrier} n’est pas connecté pour ${name}. Ouvrez l’appareil et rétablissez la connexion.`,
  it: (carrier, name) => `MyParcel – ${carrier} non è connesso per ${name}. Apri il dispositivo e ripristina il collegamento.`,
  sv: (carrier, name) => `MyParcel – ${carrier} är inte ansluten för ${name}. Öppna enheten och återställ anslutningen.`,
  no: (carrier, name) => `MyParcel – ${carrier} er ikke tilkoblet for ${name}. Åpne enheten og reparer tilkoblingen.`,
  es: (carrier, name) => `MyParcel – ${carrier} no está conectado para ${name}. Abre el dispositivo y repara la conexión.`,
  da: (carrier, name) => `MyParcel – ${carrier} er ikke forbundet for ${name}. Åbn enheden og reparer forbindelsen.`,
  ru: (carrier, name) => `MyParcel – ${carrier} не подключён для ${name}. Откройте устройство и восстановите подключение.`,
  pl: (carrier, name) => `MyParcel – ${carrier} nie jest połączony dla ${name}. Otwórz urządzenie i napraw połączenie.`,
  ko: (carrier, name) => `MyParcel – ${name}의 ${carrier} 연결이 끊어졌습니다. 기기를 열고 연결을 복구하세요.`,
  ar: (carrier, name) => `MyParcel – ‏${carrier} غير متصل للجهاز ${name}. افتح الجهاز وأصلح الاتصال.`,
};

module.exports = class MyParcelApp extends Homey.App {
  async onInit() {
    this._connectionStatusChanged = this.homey.flow.getDeviceTriggerCard('connection_status_changed');
    this._deliveryWindowTriggers = {};
    for (const [driverId, cards] of Object.entries(DELIVERY_WINDOW_FLOWS)) {
      this._deliveryWindowTriggers[driverId] = this.homey.flow.getDeviceTriggerCard(cards.trigger);
      this.homey.flow.getConditionCard(cards.condition).registerRunListener(async args => {
        return this._hasKnownDeliveryWindow(args.device, driverId);
      });
    }
    this._postInterval = this.homey.setInterval(() => this.syncPostNL('interval'), 5 * 60 * 1000);
    this._midnightInterval = this.homey.setInterval(() => this._midnightCheck(), 60 * 1000);
    this._connectionInterval = this.homey.setInterval(() => this.syncConnectionStates().catch(error => this.error(error)), 30 * 1000);
    this._deliveryWindowInterval = this.homey.setInterval(() => this.syncDeliveryWindows().catch(error => this.error(error)), 30 * 1000);
    await this._initMyParcelDeliveryTokens();
    this._myParcelDeliveryTokenInterval = this.homey.setInterval(() => this.syncMyParcelDeliveryTokens().catch(error => this.error(error)), 60 * 1000);
    this.homey.setTimeout(() => this.syncMyParcelDeliveryTokens().catch(error => this.error(error)), 7 * 1000);
    this.homey.setTimeout(() => this.syncPostNL('startup'), 10 * 1000);
    this.homey.setTimeout(() => this.syncConnectionStates().catch(error => this.error(error)), 5 * 1000);
    this.homey.setTimeout(() => this.syncDeliveryWindows().catch(error => this.error(error)), 8 * 1000);
    this.log(`MyParcel ${Homey.manifest.version} initialized`);
  }

  async onUninit() {
    if (this._postInterval) this.homey.clearInterval(this._postInterval);
    if (this._midnightInterval) this.homey.clearInterval(this._midnightInterval);
    if (this._connectionInterval) this.homey.clearInterval(this._connectionInterval);
    if (this._deliveryWindowInterval) this.homey.clearInterval(this._deliveryWindowInterval);
    if (this._myParcelDeliveryTokenInterval) this.homey.clearInterval(this._myParcelDeliveryTokenInterval);
  }

  getConnectionLabel(connected) {
    const lang = this.homey.i18n.getLanguage();
    const pair = CONNECTION_TEXT[lang] || CONNECTION_TEXT.en;
    return pair[connected ? 0 : 1];
  }

  getPostNLDevices() {
    try { return this.homey.drivers.getDriver('postnl').getDevices(); } catch (_) { return []; }
  }

  getDHLDevices() {
    try { return this.homey.drivers.getDriver('dhl-parcel').getDevices(); } catch (_) { return []; }
  }

  async syncPostNL(reason = 'manual') {
    await Promise.allSettled(this.getPostNLDevices().map(device => device.sync({ reason, force: reason !== 'interval' })));
  }

  _connectionCapability(driverId) {
    return CONNECTION_CAPABILITIES[driverId] || 'myparcel_connection_status';
  }

  _parseJsonArray(value) {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  _hasUsableConfiguration(driverId, device) {
    const settings = device.getSettings?.() || {};
    switch (driverId) {
      case 'postnl':
        return typeof device.hasAccountCredentials === 'function' ? device.hasAccountCredentials() : Boolean(device.api?.hasCredentials?.());
      case 'dhl-parcel':
        return typeof device.hasAccountCredentials === 'function' ? device.hasAccountCredentials() : true;
      case 'dhl-express':
        return Boolean(settings.session_bundle);
      case 'ups':
        try { return Boolean(JSON.parse(settings.ups_session_bundle || 'null')); } catch (_) { return false; }
      case 'post-dhl-de':
        return Boolean(device.getStoreValue?.('access_token'));
      case 'bpost':
        return Boolean((settings.account_email && settings.account_password) || this._parseJsonArray(settings.tracking_numbers_json).length);
      case 'dpd':
        return Boolean(settings.email && settings.password);
      case 'homerr':
        return Boolean(settings.refresh_token);
      case 'fedex':
        return Boolean(settings.client_id && settings.client_secret);
      case 'gls':
        return Boolean(settings.username && settings.password);
      case 'royal-mail':
        return Boolean(settings.api_key);
      default:
        return true;
    }
  }

  _alreadyAuthNotified(device) {
    return [
      'authExpiredNotified', 'bpostAuthNotice', 'upsAuthNotice',
    ].some(key => device.getStoreValue?.(key) === true);
  }

  async _syncConnectionState(driverId, device) {
    const capability = this._connectionCapability(driverId);
    if (!device.hasCapability(capability)) await device.addCapability(capability);

    const available = device.getAvailable?.() !== false;
    const configured = this._hasUsableConfiguration(driverId, device);
    const connected = Boolean(available && configured);
    const status = this.getConnectionLabel(connected);
    const previous = device.getStoreValue?.('myparcel_connection_state');

    await device.setCapabilityValue(capability, status).catch(error => this.error(`[Connection] ${driverId}`, error));

    if (previous !== connected) {
      await this._connectionStatusChanged.trigger(device, {
        connected,
        connection_status: status,
        carrier: CARRIER_NAMES[driverId] || driverId,
      }, {}).catch(error => this.error(`[Connection trigger] ${driverId}`, error));

      if (!connected) {
        const alreadyNotified = device.getStoreValue?.('myparcelConnectionNotified') === true || this._alreadyAuthNotified(device);
        if (!alreadyNotified) {
          const lang = this.homey.i18n.getLanguage();
          const message = (DISCONNECTED_MESSAGES[lang] || DISCONNECTED_MESSAGES.en)(CARRIER_NAMES[driverId] || driverId, device.getName());
          await this.homey.notifications.createNotification({ excerpt: message }).catch(error => this.error(`[Connection notification] ${driverId}`, error));
        }
        await device.setStoreValue('myparcelConnectionNotified', true).catch(() => {});
      } else {
        await device.setStoreValue('myparcelConnectionNotified', false).catch(() => {});
      }
      await device.setStoreValue('myparcel_connection_state', connected).catch(() => {});
    }
  }

  async syncConnectionStates() {
    if (this._syncConnectionBusy) return;
    this._syncConnectionBusy = true;
    try {
      for (const driverId of DRIVER_IDS) {
        let devices = [];
        try { devices = this.homey.drivers.getDriver(driverId).getDevices(); } catch (_) { continue; }
        for (const device of devices) await this._syncConnectionState(driverId, device);
      }
    } finally {
      this._syncConnectionBusy = false;
    }
  }

  _deliveryWindowParcels(device) {
    try {
      const data = device?.getWidgetData?.() || {};
      const rows = Array.isArray(data.parcels) ? data.parcels : (Array.isArray(data.packages) ? data.packages : []);
      return rows.filter(parcel => parcel && typeof parcel === 'object');
    } catch (_) { return []; }
  }

  _parcelIsDelivered(parcel) {
    if (parcel?.delivered === true) return true;
    const status = String(parcel?.status || parcel?.category || '');
    return /delivered|bezorgd|zugestellt|livré|consegnato|levererad|levert|entregado|leveret|доставлен|dostarcz|배송\s*완료|تم\s*التسليم/i.test(status);
  }

  _windowParts(parcel) {
    const explicitStart = String(parcel?.deliveryWindowFrom || parcel?.windowStart || '').trim();
    const explicitEnd = String(parcel?.deliveryWindowTo || parcel?.windowEnd || '').trim();
    const raw = String(parcel?.deliveryWindow || '').trim();
    if (explicitStart || explicitEnd) return { start: explicitStart, end: explicitEnd, raw };
    const parts = raw.split(/\s+[–—-]\s+/).map(value => value.trim()).filter(Boolean);
    return { start: parts[0] || '', end: parts[1] || '', raw };
  }

  _formatHomeyTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const date = new Date(text);
    if (!Number.isNaN(date.getTime()) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: this.homey.clock.getTimezone(), hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(date);
    }
    const match = text.match(/(?:T|\s)(\d{2}:\d{2})(?::\d{2})?/i) || text.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
    return match ? match[1] : text;
  }

  _formatDeliveryDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const isoDay = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
    if (isoDay && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return `${isoDay[3]}-${isoDay[2]}-${isoDay[1]}`;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.homey.clock.getTimezone(), day: '2-digit', month: '2-digit', year: 'numeric',
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('day')}-${get('month')}-${get('year')}`;
  }

  _normalizeWindow(parcel) {
    const { start, end, raw } = this._windowParts(parcel);
    const startTime = this._formatHomeyTime(start);
    const endTime = this._formatHomeyTime(end);
    let window = '';
    if (startTime && endTime) window = startTime === endTime ? startTime : `${startTime} - ${endTime}`;
    else if (startTime || endTime) window = startTime || endTime;
    else window = raw ? this._formatHomeyTime(raw) : '';
    const deliveryDate = this._formatDeliveryDate(parcel?.deliveryDate || start || end || '');
    return { window: String(window || '').trim(), start: startTime, end: endTime, deliveryDate };
  }

  _hasKnownDeliveryWindow(device, driverId) {
    if (!device || !DELIVERY_WINDOW_FLOWS[driverId]) return false;
    return this._deliveryWindowParcels(device).some(parcel => {
      if (this._parcelIsDelivered(parcel)) return false;
      return Boolean(this._normalizeWindow(parcel).window);
    });
  }

  async _deliveryWindowTokens(driverId, parcel, device = null) {
    let normalized = this._normalizeWindow(parcel);
    if (driverId === 'postnl' && device?.api) {
      const start = parcel?.deliveryWindowFrom ? device.api.formatDeliveryWindowTime(parcel.deliveryWindowFrom) : '';
      const end = parcel?.deliveryWindowTo ? device.api.formatDeliveryWindowTime(parcel.deliveryWindowTo) : '';
      const window = String(parcel?.deliveryWindow || device.api.formatWindow(parcel?.deliveryWindowFrom, parcel?.deliveryWindowTo) || '').trim();
      const deliveryDate = device.api.formatDeliveryWindowDateDMY(parcel?.deliveryDate || parcel?.deliveryWindowFrom || parcel?.deliveryWindowTo || '');
      normalized = { window, start, end, deliveryDate };
    }
    const tokens = {
      carrier: CARRIER_NAMES[driverId] || driverId,
      tracking: String(parcel?.tracking || parcel?.barcode || parcel?.id || parcel?.key || ''),
      sender: String(parcel?.sender || parcel?.title || ''),
      delivery_date: normalized.deliveryDate,
      delivery_window: normalized.window,
      window_start: normalized.start,
      window_end: normalized.end,
      status: localizePackageStatus(this.homey, parcel?.status || parcel?.category || '') || '',
    };
    if (driverId === 'postnl' && device?.getPackageDeliveryImage) {
      const packageImage = await device.getPackageDeliveryImage(parcel).catch(() => null);
      tokens.package_status_text = tokens.status;
      tokens.package_window_text = tokens.delivery_window;
      tokens.package_delivery_date = tokens.delivery_date;
      tokens.package_sender = tokens.sender;
      tokens.package_tracking = tokens.tracking;
      tokens.package_image_available = Boolean(packageImage);
      if (packageImage) tokens.package_image = packageImage;
    }
    return tokens;
  }

  async _syncDeviceDeliveryWindows(driverId, device) {
    const parcels = this._deliveryWindowParcels(device).filter(parcel => !this._parcelIsDelivered(parcel));
    const previous = device.getStoreValue?.('myparcel_delivery_window_state_v1');
    const current = {};
    const trigger = this._deliveryWindowTriggers?.[driverId];

    for (const parcel of parcels) {
      const tokens = await this._deliveryWindowTokens(driverId, parcel, device);
      if (!tokens.delivery_window) continue;
      const key = tokens.tracking || String(parcel?.id || parcel?.key || parcel?.sender || 'parcel');
      const signature = `${tokens.delivery_date}|${tokens.delivery_window}`;
      current[key] = signature;
      if (previous && previous[key] !== signature && trigger) {
        await trigger.trigger(device, tokens, {}).catch(error => this.error(`[Delivery window trigger] ${driverId}`, error));
      }
    }

    await device.setStoreValue?.('myparcel_delivery_window_state_v1', current).catch(() => {});
  }

  async syncDeliveryWindows() {
    if (this._syncDeliveryBusy) return;
    this._syncDeliveryBusy = true;
    try {
    for (const driverId of Object.keys(DELIVERY_WINDOW_FLOWS)) {
      let devices = [];
      try { devices = this.homey.drivers.getDriver(driverId).getDevices(); } catch (_) { continue; }
      for (const device of devices) await this._syncDeviceDeliveryWindows(driverId, device);
    }
    } finally {
      this._syncDeliveryBusy = false;
    }
  }

  async _initMyParcelDeliveryTokens() {
    const lang = this.homey.i18n.getLanguage();
    const t = DELIVERY_TOKEN_TEXT[lang] || DELIVERY_TOKEN_TEXT.en;
    const defs = {
      image: { id: 'myparcel_delivery_image', type: 'image' },
      carrier: { id: 'myparcel_delivery_carrier', type: 'string' },
      status: { id: 'myparcel_delivery_status', type: 'string' },
      sender: { id: 'myparcel_delivery_sender', type: 'string' },
      tracking: { id: 'myparcel_delivery_tracking', type: 'string' },
      date: { id: 'myparcel_delivery_date', type: 'string' },
      window: { id: 'myparcel_delivery_window', type: 'string' },
    };
    this._myParcelDeliveryTokens = {};
    for (const [key, def] of Object.entries(defs)) {
      this._myParcelDeliveryTokens[key] = await this.homey.flow.createToken(def.id, { type: def.type, title: t[key] });
    }
    this._myParcelDeliveryImageCache = new Map();
  }

  _allActiveDeliveries() {
    const rows = [];
    for (const driverId of DRIVER_IDS) {
      let devices = [];
      try { devices = this.homey.drivers.getDriver(driverId).getDevices(); } catch (_) { continue; }
      for (const device of devices) {
        const data = device.getWidgetData?.() || {};
        const parcels = Array.isArray(data.packages) ? data.packages : (Array.isArray(data.parcels) ? data.parcels : []);
        for (const parcel of parcels) {
          if (!parcel || this._parcelIsDelivered(parcel)) continue;
          const normalized = this._normalizeWindow(parcel);
          rows.push({
            driverId, device, parcel, normalized,
            carrier: CARRIER_NAMES[driverId] || driverId,
            tracking: String(parcel.tracking || parcel.barcode || parcel.shipmentNumber || parcel.id || parcel.key || ''),
            sender: String(parcel.sender || parcel.title || parcel.sourceDisplayName || ''),
            status: localizePackageStatus(this.homey, parcel.status || parcel.category || '') || String(parcel.status || ''),
          });
        }
      }
    }
    const stamp = row => {
      for (const value of [row.parcel.deliveryWindowFrom, row.parcel.deliveryDate, row.parcel.updatedAt, row.parcel.createdAt]) {
        const parsed = Date.parse(value || '');
        if (Number.isFinite(parsed)) return parsed;
      }
      return Number.MAX_SAFE_INTEGER;
    };
    return rows.sort((a, b) => stamp(a) - stamp(b));
  }

  async _getMyParcelDeliveryImage(active) {
    const lang = DELIVERY_TOKEN_TEXT[this.homey.i18n.getLanguage()] ? this.homey.i18n.getLanguage() : 'en';
    const key = `${lang}:${active ? 'active' : 'empty'}`;
    if (this._myParcelDeliveryImageCache?.has(key)) return this._myParcelDeliveryImageCache.get(key);
    const filePath = path.join(__dirname, 'widgets', 'myparcel-bezorging', 'public', 'van.svg');
    const buffer = await fs.promises.readFile(filePath);
    const image = await this.homey.images.createImage();
    image.setStream(async stream => {
      stream.contentType = 'image/svg+xml';
      stream.filename = `myparcel-delivery-${lang}-${active ? 'active' : 'empty'}.svg`;
      stream.end(buffer);
      return stream;
    });
    this._myParcelDeliveryImageCache?.set(key, image);
    return image;
  }

  async syncMyParcelDeliveryTokens() {
    if (!this._myParcelDeliveryTokens || this._syncMyParcelTokensBusy) return;
    this._syncMyParcelTokensBusy = true;
    try {
    const next = this._allActiveDeliveries()[0] || null;
    const values = next ? {
      carrier: next.carrier,
      status: next.status,
      sender: next.sender,
      tracking: next.tracking,
      date: next.normalized.deliveryDate,
      window: next.normalized.window,
    } : { carrier: '', status: '', sender: '', tracking: '', date: '', window: '' };
    await Promise.all(Object.entries(values).map(([key, value]) => this._myParcelDeliveryTokens[key].setValue(value).catch(error => this.error(`[MyParcel delivery token] ${key}`, error))));
    const image = await this._getMyParcelDeliveryImage(Boolean(next));
    await this._myParcelDeliveryTokens.image.setValue(image).catch(error => this.error('[MyParcel delivery token] image', error));
    } finally {
      this._syncMyParcelTokensBusy = false;
    }
  }

  async _midnightCheck() {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.homey.clock.getTimezone(), hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const [hour, minute] = formatter.format(new Date()).split(':').map(Number);
    if (hour === 0 && [1, 6, 11, 16, 21, 31, 46].includes(minute)) await this.syncPostNL('midnight');
  }
};
