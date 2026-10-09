'use strict';

const DhlDeviceBase = require('../../lib/dhl-device-base');
const { t } = require('../../lib/messages-i18n');
const API = require('../../lib/post-dhl-de-api');
const { DhlDeSession, DhlDeClient, normalizeDeInbox, normalizeDeApp, deNeedsEnrichment, deIsNotFound } = require('../../lib/dhl-tracking');

function list(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['shipments', 'items', 'currentShipments', 'sendungen']) if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

const MAIL_STATUS = {
  en: 'Letter announcement not available', nl: 'Briefaankondiging niet beschikbaar', de: 'Briefankündigung nicht verfügbar',
  fr: 'Annonce de courrier indisponible', it: 'Avviso lettere non disponibile', sv: 'Brevavisering är inte tillgänglig',
  no: 'Brevvarsling er ikke tilgjengelig', es: 'Aviso de cartas no disponible', da: 'Brevvarsling er ikke tilgængelig',
  ru: 'Уведомление о письмах недоступно', pl: 'Awizo listów niedostępne', ko: '우편물 사전 알림을 사용할 수 없음', ar: 'إشعار الرسائل غير متاح',
};

/**
 * Post & DHL Germany – two logins:
 *  - "app":   the Post & DHL app login (app.dhl.de), works from any country (default for existing devices),
 *  - "dhlde": the DHL.de login used by ha-dhl (login.dhl.de + www.dhl.de), needs a German IP address;
 *             also supports extra tracking numbers.
 * Both are normalised with ha-dhl's DE status logic (progress ladder, Packstation, returns, outgoing).
 */
class PostDhlDeDevice extends DhlDeviceBase {
  static config = {
    carrier: 'Post & DHL',
    log: '[Post & DHL]',
    storePrefix: 'dhl_de',
    widgetCarrier: 'dhl-de',
    midMinutes: 30,
    firstDelay: 5000,
    capabilities: [
      'dhl_de_parcel_count', 'dhl_de_status', 'dhl_de_tracking', 'dhl_de_sender', 'dhl_de_delivery_date', 'dhl_de_delivery_window',
      'dhl_de_next_delivery', 'dhl_de_out_for_delivery_count', 'dhl_de_pickup_count', 'dhl_de_pickup_point', 'dhl_de_delivered_count',
      'dhl_de_outgoing_count', 'dhl_de_last_event', 'dhl_de_mail_count', 'dhl_de_postnumber', 'dhl_de_account_status',
      'dhl_de_mail_status', 'dhl_de_last_update',
    ],
    caps: {
      count: 'dhl_de_parcel_count', status: 'dhl_de_status', tracking: 'dhl_de_tracking', sender: 'dhl_de_sender',
      date: 'dhl_de_delivery_date', window: 'dhl_de_delivery_window', next: 'dhl_de_next_delivery',
      outCount: 'dhl_de_out_for_delivery_count', pickupCount: 'dhl_de_pickup_count', pickupPoint: 'dhl_de_pickup_point',
      deliveredCount: 'dhl_de_delivered_count', outgoingCount: 'dhl_de_outgoing_count', lastEvent: 'dhl_de_last_event',
      lastUpdate: 'dhl_de_last_update', receiver: null, total: null, enRouteCount: null,
    },
    cards: {
      newPackage: 'dhl_de_new_package',
      statusChanged: 'dhl_de_status_changed',
      delivered: 'dhl_de_delivered',
      outForDelivery: 'dhl_de_out_for_delivery',
      readyForPickup: 'dhl_de_ready_for_pickup',
      problem: 'dhl_de_package_problem',
      eventChanged: 'dhl_de_package_event_changed',
      outgoingStatus: 'dhl_de_outgoing_status_changed',
      outgoingDelivered: 'dhl_de_outgoing_delivered',
      // dhl_de_delivery_window_changed is fired by the app
    },
  };

  async onDhlInit() {
    this._session = null;
    // 0.3.3 stored the raw (sometimes un-normalised) shipment list here and could crash on start.
    if (this.getStoreValue('snapshot')) await this.unsetStoreValue('snapshot').catch(() => {});
  }

  _mode() { return this.getStoreValue('login_mode') === 'dhlde' ? 'dhlde' : 'app'; }

  hasUsableConfiguration() {
    return this._mode() === 'dhlde' ? Boolean(this.getStoreValue('dhl_de_refresh_token')) : Boolean(this.getStoreValue('refresh_token') || this.getStoreValue('access_token'));
  }

  /* --------------------------------------------------------------- auth -- */

  _api() {
    return new API({
      accessToken: this.getStoreValue('access_token'),
      refreshToken: this.getStoreValue('refresh_token'),
      expiresAt: this.getStoreValue('expires_at') || 0,
      onTokens: tokens => {
        this.setStoreValue('access_token', tokens.accessToken).catch(this.error);
        this.setStoreValue('refresh_token', tokens.refreshToken).catch(this.error);
        this.setStoreValue('expires_at', tokens.expiresAt).catch(this.error);
      },
    });
  }

  _deClient() {
    if (!this._session) {
      this._session = new DhlDeSession({
        refreshToken: this.getStoreValue('dhl_de_refresh_token'),
        onRefreshToken: token => this.setStoreValue('dhl_de_refresh_token', token).catch(this.error),
      });
    }
    return new DhlDeClient({ session: this._session });
  }

  async updateTokens(tokens, expiresAt) {
    await this.setStoreValue('login_mode', 'app');
    await this.setStoreValue('access_token', tokens.accessToken);
    await this.setStoreValue('refresh_token', tokens.refreshToken);
    await this.setStoreValue('expires_at', expiresAt);
    await this.setStoreValue('authExpiredNotified', false);
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  async updateDhlDeLogin(refreshToken, postNumber) {
    await this.setStoreValue('login_mode', 'dhlde');
    await this.setStoreValue('dhl_de_refresh_token', refreshToken);
    if (postNumber) await this.setStoreValue('postnumber', String(postNumber));
    await this.setStoreValue('authExpiredNotified', false);
    this._session = null;
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  async validateTrackingCode() {
    if (this._mode() !== 'dhlde') {
      throw new Error(t(this.homey, 'dhlde_extra'));
    }
  }

  /* ------------------------------------------------------------ fetching -- */

  async _fetchParcels() {
    if (!this.hasUsableConfiguration()) return null;
    if (this._mode() === 'dhlde') {
      const client = this._deClient();
      let inbox;
      try {
        inbox = await client.getInbox();
      } catch (error) {
        if (error.auth) this._session = null;
        throw error;
      }
      const out = [];
      for (let element of inbox) {
        // ha-dhl: stubs get a by-number lookup, "not found" elements are not parcels.
        if (deNeedsEnrichment(element) && element.id) {
          const known = this._parcels[String(element.id).toUpperCase()];
          if (known?.delivered) { out.push(known); continue; }
          element = await client.getByNumber(element.id).catch(error => { if (error.auth) throw error; return null; }) || element;
        }
        if (deIsNotFound(element)) continue;
        const parcel = normalizeDeInbox(element);
        if (parcel.barcode) out.push(parcel);
      }
      for (const entry of this.trackedEntries()) {
        if (out.some(p => p.barcode === entry.code) || this.wasDelivered(entry.code)) continue;
        const known = this._parcels[entry.code];
        if (known?.delivered) { out.push(known); continue; }
        try {
          const raw = await client.getByNumber(entry.code);
          if (raw) {
            const parcel = normalizeDeInbox(raw);
            out.push({ ...parcel, barcode: entry.code, direction: entry.direction });
            continue;
          }
        } catch (error) {
          if (error.auth) throw error;
        }
        out.push(known && !known.pending ? known : { source: 'dhlde', barcode: entry.code, status: 'registered', rawStatus: '', delivered: false, direction: entry.direction, history: [], pending: true });
      }
      return out;
    }

    const api = this._api();
    let raw;
    try {
      raw = await api.shipments();
    } catch (error) {
      if (error.status === 401 || error.status === 403) error.auth = true;
      throw error;
    }
    if (!this.getStoreValue('postnumber')) {
      const info = await api.customer().catch(() => ({}));
      if (info?.postNumber) await this.setStoreValue('postnumber', String(info.postNumber)).catch(() => {});
    }
    return list(raw).map(normalizeDeApp).filter(p => p.barcode);
  }

  async onRefreshed() { await this._accountCapabilities(true); }

  async onAuthFailure() { this._session = null; await this._accountCapabilities(false); }

  async _accountCapabilities(connected) {
    await this._set('dhl_de_mail_count', 0);
    await this._set('dhl_de_postnumber', String(this.getStoreValue('postnumber') || DhlDeviceBase.EMPTY));
    await this._set('dhl_de_mail_status', this._t(MAIL_STATUS));
    const label = this.homey.app?.getConnectionLabel?.(connected);
    if (label) await this._set('dhl_de_account_status', label);
  }

  getWidgetData() {
    const data = super.getWidgetData();
    return { ...data, letters: [], mailStatus: 'endpoint_pending', authenticated: this.hasUsableConfiguration() && this.getStoreValue('authExpiredNotified') !== true };
  }
}

module.exports = PostDhlDeDevice;
