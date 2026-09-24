'use strict';
const Homey = require('homey');

const DRIVER_IDS = [
  'postnl', 'dhl-parcel', 'dpd', 'ups', 'budbee', 'homerr',
  'fedex', 'gls', 'inpost-uk', 'bpost', 'royal-mail', 'post-dhl-de',
];

const CARRIER_NAMES = {
  postnl: 'PostNL',
  'dhl-parcel': 'DHL',
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
    this._postInterval = this.homey.setInterval(() => this.syncPostNL('interval'), 5 * 60 * 1000);
    this._midnightInterval = this.homey.setInterval(() => this._midnightCheck(), 60 * 1000);
    this._connectionInterval = this.homey.setInterval(() => this.syncConnectionStates().catch(error => this.error(error)), 10 * 1000);
    this.homey.setTimeout(() => this.syncPostNL('startup'), 10 * 1000);
    this.homey.setTimeout(() => this.syncConnectionStates().catch(error => this.error(error)), 5 * 1000);
    this.log(`MyParcel ${Homey.manifest.version} initialized`);
  }

  async onUninit() {
    if (this._postInterval) this.homey.clearInterval(this._postInterval);
    if (this._midnightInterval) this.homey.clearInterval(this._midnightInterval);
    if (this._connectionInterval) this.homey.clearInterval(this._connectionInterval);
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
    for (const driverId of DRIVER_IDS) {
      let devices = [];
      try { devices = this.homey.drivers.getDriver(driverId).getDevices(); } catch (_) { continue; }
      for (const device of devices) await this._syncConnectionState(driverId, device);
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
