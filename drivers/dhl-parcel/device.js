const localizePackageStatus = require('../../lib/status-i18n.js');
'use strict';

const Homey = require('homey');
const API = require('../../lib/dhl-parcel-api');

module.exports = class DHLParcelDevice extends Homey.Device {
  async onInit() {
    this._busy = false;
    this._api = null;
    this._previous = this.getStoreValue('parcel_state') || {};
    this._flowStatusChanged = this.homey.flow.getDeviceTriggerCard('status_changed');
    this._flowDelivered = this.homey.flow.getDeviceTriggerCard('shipment_delivered');

    await this._migrateLegacyCredentials();
    await this._ensureCapabilities();
    if (this.hasAccountCredentials()) await this.refresh(true).catch(err => this.error(err));
    this._interval = this.homey.setInterval(() => this.refresh(false).catch(err => this.error(err)), 5 * 60 * 1000);
  }

  async onDeleted() {
    if (this._interval) this.homey.clearInterval(this._interval);
  }

  hasAccountCredentials() {
    return Boolean(this.getStoreValue('email') && this.getStoreValue('password'));
  }

  async _migrateLegacyCredentials() {
    if (this.hasAccountCredentials()) return;
    const email = this.homey.settings.get('parcel_email');
    const password = this.homey.settings.get('parcel_password');
    if (!email || !password) return;
    await this.setStoreValue('email', String(email).trim());
    await this.setStoreValue('password', String(password));
    await this.setStoreValue('authExpiredNotified', false);
    this.log('[Migration] moved legacy app-level DHL credentials to this device');
    await this.homey.settings.unset('parcel_email').catch(() => {});
    await this.homey.settings.unset('parcel_password').catch(() => {});
  }

  async updateCredentials(email, password) {
    await this.setStoreValue('email', String(email || '').trim());
    await this.setStoreValue('password', String(password || ''));
    await this.setStoreValue('authExpiredNotified', false);
    this._api = null;
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  async _ensureCapabilities() {
    const caps = ['dhl_parcel_count', 'dhl_status', 'dhl_tracking_number', 'dhl_sender', 'dhl_delivery_date', 'dhl_delivery_window', 'myparcel_connection_status', 'dhl_last_update'];
    for (const cap of caps) if (!this.hasCapability(cap)) await this.addCapability(cap);
  }

  _getApi() {
    const email = this.getStoreValue('email');
    const password = this.getStoreValue('password');
    if (!email || !password) {
      const error = new Error(this.homey.__('errors.not_authenticated') || 'Mijn DHL-account is niet gekoppeld.');
      error.code = 'AUTH_REAUTH_REQUIRED';
      throw error;
    }
    if (!this._api || this._api.email !== email || this._api.password !== password) {
      this._api = new API({ fetch, email, password, log: (...args) => this.log(...args) });
    }
    return this._api;
  }

  _active(parcels) { return parcels.filter(p => !p.delivered); }

  _sortParcels(parcels) {
    return [...parcels].sort((a, b) => {
      const ad = Date.parse(a.deliveryDate || a.updatedAt || 0) || Number.MAX_SAFE_INTEGER;
      const bd = Date.parse(b.deliveryDate || b.updatedAt || 0) || Number.MAX_SAFE_INTEGER;
      return ad - bd;
    });
  }

  _formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '-');
    return new Intl.DateTimeFormat(this.homey.i18n.getLanguage() || 'en', {
      timeZone: this.homey.clock.getTimezone(), dateStyle: 'short', timeStyle: 'medium',
    }).format(date);
  }

  _hasExplicitTimezone(value) {
    return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value || '').trim());
  }

  _formatDeliveryDate(value) {
    const text = String(value || '').trim();
    if (!text) return '-';

    // Date-only DHL values represent the delivery day directly and must not
    // shift because JavaScript parses YYYY-MM-DD as UTC.
    const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`;

    // A full timestamp carrying Z/UTC or an explicit offset is converted to
    // the timezone configured on Homey.
    if (this._hasExplicitTimezone(text)) {
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: this.homey.clock.getTimezone(), day: '2-digit', month: '2-digit', year: 'numeric',
        }).formatToParts(date);
        const get = type => parts.find(part => part.type === type)?.value || '';
        return `${get('day')}-${get('month')}-${get('year')}`;
      }
    }

    // If DHL sends a local timestamp without zone information, keep its date
    // component instead of assuming the Homey runtime timezone.
    const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.homey.clock.getTimezone(), day: '2-digit', month: '2-digit', year: 'numeric',
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('day')}-${get('month')}-${get('year')}`;
  }

  _formatHomeyTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';

    if (this._hasExplicitTimezone(text)) {
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) {
        return new Intl.DateTimeFormat('en-GB', {
          timeZone: this.homey.clock.getTimezone(), hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(date);
      }
    }

    // Timestamp without an explicit timezone: DHL already supplied a local
    // clock value, so preserve it rather than silently treating it as UTC.
    const match = text.match(/(?:T|\s)(\d{2}:\d{2})(?::\d{2})?/i) || text.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
    return match ? match[1] : text;
  }

  _formatDeliveryWindow(parcelOrValue) {
    if (parcelOrValue && typeof parcelOrValue === 'object') {
      const from = this._formatHomeyTime(parcelOrValue.deliveryWindowFrom);
      const to = this._formatHomeyTime(parcelOrValue.deliveryWindowTo);
      if (from && to) return from === to ? from : `${from} - ${to}`;
      if (from || to) return from || to;
      return this._formatDeliveryWindow(parcelOrValue.deliveryWindow);
    }

    const text = String(parcelOrValue || '').trim();
    if (!text) return '-';

    // Also support stored data from an earlier 0.2.1 build. When the complete
    // ISO timestamps are still present, convert both ends to Homey time.
    const isoParts = text.split(/\s+[–—-]\s+/).filter(Boolean);
    if (isoParts.length === 2 && isoParts.some(part => this._hasExplicitTimezone(part))) {
      const from = this._formatHomeyTime(isoParts[0]);
      const to = this._formatHomeyTime(isoParts[1]);
      return from && to ? `${from} - ${to}` : (from || to || '-');
    }

    return text.replace(/\s*[–—]\s*/g, ' - ');
  }

  _flowTokens(parcel, previousStatus = '', activeCount = 0) {
    return {
      service: 'DHL Parcel', status: localizePackageStatus(this.homey, parcel.status || 'UNKNOWN'), previous_status: localizePackageStatus(this.homey, previousStatus || ''),
      tracking: String(parcel.tracking || ''), sender: String(parcel.sender || '-'),
      delivery_date: this._formatDeliveryDate(parcel.deliveryDate), delivery_window: this._formatDeliveryWindow(parcel),
      last_update: this._formatDate(parcel.updatedAt), delivered: Boolean(parcel.delivered), active_parcels: Number(activeCount || 0),
    };
  }

  async refresh(force = false) {
    if (this._busy) return this.getStoreValue('parcels') || [];
    if (!this.hasAccountCredentials()) {
      if (force) throw new Error(this.homey.__('errors.not_authenticated') || 'Mijn DHL-account is niet gekoppeld.');
      return this.getStoreValue('parcels') || [];
    }
    this._busy = true;
    try {
      const parcels = await this._getApi().getParcels();
      const active = this._sortParcels(this._active(parcels));
      const next = active[0] || this._sortParcels(parcels)[0] || null;

      await this.setCapabilityValue('dhl_parcel_count', active.length).catch(() => {});
      await this.setCapabilityValue('dhl_status', next ? localizePackageStatus(this.homey, next.status) : (this.homey.__('status.no_active') || 'No active shipments')).catch(() => {});
      await this.setCapabilityValue('dhl_tracking_number', next?.tracking || '-').catch(() => {});
      await this.setCapabilityValue('dhl_sender', next?.sender || '-').catch(() => {});
      await this.setCapabilityValue('dhl_delivery_date', next ? this._formatDeliveryDate(next.deliveryDate) : '-').catch(() => {});
      await this.setCapabilityValue('dhl_delivery_window', next ? this._formatDeliveryWindow(next) : '-').catch(() => {});
      await this.setCapabilityValue('dhl_last_update', this._formatDate(new Date())).catch(() => {});

      const current = {};
      for (const parcel of parcels) {
        if (!parcel.tracking) continue;
        current[parcel.tracking] = { status: String(parcel.status || ''), delivered: parcel.delivered, sender: parcel.sender, deliveryDate: parcel.deliveryDate, deliveryWindow: parcel.deliveryWindow, deliveryWindowFrom: parcel.deliveryWindowFrom, deliveryWindowTo: parcel.deliveryWindowTo };
        const old = this._previous[parcel.tracking];
        if (old && old.status !== parcel.status) {
          await this._flowStatusChanged.trigger(this, this._flowTokens(parcel, old.status, active.length), {}).catch(() => {});
        }
        if ((!old || !old.delivered) && parcel.delivered) {
          await this._flowDelivered.trigger(this, this._flowTokens(parcel, old?.status || '', active.length), {}).catch(() => {});
        }
      }

      this._previous = current;
      await this.setStoreValue('parcel_state', current);
      await this.setStoreValue('parcels', parcels);
      await this.setStoreValue('delivered', active.length === 0 && parcels.length > 0);
      await this.setStoreValue('last_update', new Date().toISOString());
      await this.setStoreValue('authExpiredNotified', false);
      await this.setAvailable();
      return parcels;
    } catch (err) {
      const authExpired = /401|403|login|sessie|session|wachtwoord|password|unauthor/i.test(String(err?.message || ''));
      if (authExpired && this.getStoreValue('authExpiredNotified') !== true) {
        const language = this.homey.i18n.getLanguage();
        const messages = {
          nl: `DHL opnieuw koppelen – De inloggegevens van ${this.getName()} werken niet meer. Open het apparaat en herstel de koppeling.`,
          de: `DHL erneut verbinden – Die Anmeldedaten für ${this.getName()} funktionieren nicht mehr. Öffne das Gerät und stelle die Verbindung wieder her.`,
          fr: `Reconnecter DHL – Les identifiants de ${this.getName()} ne fonctionnent plus. Ouvrez l’appareil et rétablissez la connexion.`,
          it: `Ricollega DHL – Le credenziali di ${this.getName()} non funzionano più. Apri il dispositivo e ripristina il collegamento.`,
          sv: `Anslut DHL igen – Inloggningsuppgifterna för ${this.getName()} fungerar inte längre. Öppna enheten och återställ anslutningen.`,
          no: `Koble til DHL på nytt – Påloggingsinformasjonen for ${this.getName()} fungerer ikke lenger. Åpne enheten og reparer tilkoblingen.`,
          es: `Volver a conectar DHL – Las credenciales de ${this.getName()} ya no funcionan. Abre el dispositivo y repara la conexión.`,
          da: `Forbind DHL igen – Loginoplysningerne til ${this.getName()} virker ikke længere. Åbn enheden og reparer forbindelsen.`,
          ru: `Повторно подключите DHL – Учетные данные ${this.getName()} больше не работают. Откройте устройство и восстановите подключение.`,
          pl: `Połącz DHL ponownie – Dane logowania dla ${this.getName()} już nie działają. Otwórz urządzenie i napraw połączenie.`,
          ko: `DHL 다시 연결 – ${this.getName()}의 로그인 정보가 더 이상 작동하지 않습니다. 기기를 열고 연결을 복구하세요.`,
          ar: `أعد ربط DHL – لم تعد بيانات تسجيل الدخول الخاصة بـ ${this.getName()} تعمل. افتح الجهاز وأصلح الاتصال.`,
          en: `Reconnect DHL – The credentials for ${this.getName()} no longer work. Open the device and repair the connection.`,
        };
        await this.homey.notifications.createNotification({ excerpt: messages[language] || messages.en }).catch(() => {});
        await this.setStoreValue('authExpiredNotified', true);
      }
      await this.setUnavailable(err.message).catch(() => {});
      throw err;
    } finally {
      this._busy = false;
    }
  }

  async isDelivered() {
    const parcels = this.getStoreValue('parcels') || [];
    return parcels.length > 0 && parcels.every(p => p.delivered);
  }

  getWidgetData() {
    const parcels = Array.isArray(this.getStoreValue('parcels')) ? this.getStoreValue('parcels') : [];
    const normalized = parcels.map(parcel => ({
      tracking: String(parcel?.tracking || ''), sender: String(parcel?.sender || ''),
      status: String(parcel?.status || parcel?.category || 'UNKNOWN'), deliveryDate: String(parcel?.deliveryDate || ''),
      deliveryWindow: this._formatDeliveryWindow(parcel), deliveryWindowFrom: String(parcel?.deliveryWindowFrom || ''), deliveryWindowTo: String(parcel?.deliveryWindowTo || ''),
      updatedAt: String(parcel?.updatedAt || ''), delivered: Boolean(parcel?.delivered), detailsUrl: String(parcel?.detailsUrl || ''),
      service: String(parcel?.service || ''), deliveryPoint: String(parcel?.deliveryPoint || ''), lastEvent: String(parcel?.lastEvent || ''), lastEventAt: String(parcel?.lastEventAt || parcel?.updatedAt || ''),
      receiver: String(parcel?.receiver || ''), weight: String(parcel?.weight || ''), product: String(parcel?.product || ''), partner: String(parcel?.partner || ''),
      accessPoint: String(parcel?.accessPoint || ''), shipmentType: String(parcel?.shipmentType || ''), direction: String(parcel?.direction || ''),
      shipFrom: String(parcel?.shipFrom || ''), shipTo: String(parcel?.shipTo || ''),
    }));
    normalized.sort((a, b) => {
      if (a.delivered !== b.delivered) return a.delivered ? 1 : -1;
      const ad = Date.parse(a.deliveryDate || a.updatedAt || '') || Number.MAX_SAFE_INTEGER;
      const bd = Date.parse(b.deliveryDate || b.updatedAt || '') || Number.MAX_SAFE_INTEGER;
      return ad - bd;
    });
    return {
      connected: this.hasAccountCredentials(), available: this.getAvailable(), parcels: normalized,
      activeCount: normalized.filter(parcel => !parcel.delivered).length, updatedAt: this.getStoreValue('last_update') || null,
    };
  }
};
