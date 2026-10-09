'use strict';

const DhlDeviceBase = require('../../lib/dhl-device-base');
const { t } = require('../../lib/messages-i18n');
const {
  DhlNlClient, normalizeNlAccount, nlIsActive, buildNlHistory, fetchGateway, normalizeGateway, isExpressAwb,
} = require('../../lib/dhl-tracking');

const STORE_HISTORY = 'dhl_history_cache_v1';

/** DHL (Netherlands) – My DHL account like ha-dhl-nl, plus tracking numbers without an account (api-gw.dhlparcel.nl). */
class DhlParcelDevice extends DhlDeviceBase {
  static config = {
    carrier: 'DHL',
    log: '[DHL]',
    storePrefix: 'dhl',
    widgetCarrier: 'dhl',
    midMinutes: 45,
    capabilities: [
      'dhl_parcel_count', 'dhl_status', 'dhl_tracking_number', 'dhl_sender', 'dhl_receiver', 'dhl_delivery_date',
      'dhl_delivery_window', 'dhl_next_delivery', 'dhl_out_for_delivery_count', 'dhl_en_route_pickup_count',
      'dhl_pickup_count', 'dhl_pickup_point', 'dhl_delivered_count', 'dhl_outgoing_count', 'dhl_last_event',
      'myparcel_connection_status', 'dhl_last_update',
    ],
    caps: {
      count: 'dhl_parcel_count', status: 'dhl_status', tracking: 'dhl_tracking_number', sender: 'dhl_sender',
      receiver: 'dhl_receiver', date: 'dhl_delivery_date', window: 'dhl_delivery_window', next: 'dhl_next_delivery',
      outCount: 'dhl_out_for_delivery_count', enRouteCount: 'dhl_en_route_pickup_count', pickupCount: 'dhl_pickup_count',
      pickupPoint: 'dhl_pickup_point', deliveredCount: 'dhl_delivered_count', outgoingCount: 'dhl_outgoing_count',
      lastEvent: 'dhl_last_event', lastUpdate: 'dhl_last_update', total: null,
    },
    cards: {
      newPackage: 'dhl_new_package',
      statusChanged: 'status_changed',
      delivered: 'shipment_delivered',
      outForDelivery: 'dhl_out_for_delivery',
      readyForPickup: 'dhl_ready_for_pickup',
      problem: 'dhl_package_problem',
      eventChanged: 'dhl_package_event_changed',
      outgoingStatus: 'dhl_outgoing_status_changed',
      outgoingDelivered: 'dhl_outgoing_delivered',
      // the delivery window trigger (dhl_delivery_window_changed) is fired by the app
    },
  };

  async onDhlInit() {
    this._client = null;
    this._history = this.getStoreValue(STORE_HISTORY) || {};
    await this._migrateLegacyCredentials();
    // 0.3.3 and older kept per-parcel state and the raw list here; the new memory seeds silently.
    for (const key of ['parcel_state', 'parcels']) if (this.getStoreValue(key) !== null && this.getStoreValue(key) !== undefined) await this.unsetStoreValue(key).catch(() => {});
  }

  async onDhlSettings(changedKeys) {
    if (changedKeys.includes('tracking_numbers')) {
      const codes = new Set(this.trackedEntries().map(entry => entry.code));
      for (const [code, parcel] of Object.entries(this._parcels)) if (parcel.source === 'gateway' && !codes.has(code)) delete this._parcels[code];
    }
  }

  hasAccountCredentials() { return Boolean(this.getStoreValue('email') && this.getStoreValue('password')); }

  hasUsableConfiguration() { return this.hasAccountCredentials() || this.trackedEntries().length > 0; }

  async _migrateLegacyCredentials() {
    if (this.hasAccountCredentials()) return;
    const email = this.homey.settings.get('parcel_email');
    const password = this.homey.settings.get('parcel_password');
    if (!email || !password) return;
    await this.setStoreValue('email', String(email).trim());
    await this.setStoreValue('password', String(password));
    await this.homey.settings.unset('parcel_email').catch(() => {});
    await this.homey.settings.unset('parcel_password').catch(() => {});
  }

  async updateCredentials(email, password) {
    await this.setStoreValue('email', String(email || '').trim());
    await this.setStoreValue('password', String(password || ''));
    await this.setStoreValue('authExpiredNotified', false);
    this._client = null;
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  async validateTrackingCode(entry) {
    if (isExpressAwb(entry.code)) {
      throw new Error(t(this.homey, 'awb_wrong_device'));
    }
  }

  _getClient() {
    const email = this.getStoreValue('email');
    const password = this.getStoreValue('password');
    if (!email || !password) return null;
    if (!this._client || this._client.email !== String(email).trim() || this._client.password !== password) {
      this._client = new DhlNlClient({ email, password });
    }
    return this._client;
  }

  async _fetchParcels() {
    const client = this._getClient();
    const entries = this.trackedEntries();
    if (!client && !entries.length) return null;
    const out = [];
    const seenHistory = {};

    const days = Math.max(1, Number(this.getSetting('delivered_days') || 7));
    if (client) {
      const [parcels, sent] = await Promise.all([client.getParcels(), client.getSentShipments()]);
      for (const raw of parcels) {
        const direction = raw?.isReturn === true ? 'outgoing' : 'incoming';
        const parcel = normalizeNlAccount(raw, { direction });
        if (!parcel.barcode) continue;
        // History only when a parcel is new or its status changed (ha-dhl-nl), incoming parcels only.
        const cacheKey = `${parcel.statusCode}|${parcel.category}`;
        let cached = this._history[parcel.barcode];
        const deliveredAt = Date.parse(parcel.deliveredAt || '');
        const oldDelivery = parcel.delivered && (!Number.isFinite(deliveredAt) || Date.now() - deliveredAt > days * 86400000);
        if (direction === 'incoming' && (!cached || cached.key !== cacheKey) && (nlIsActive(raw) || (parcel.delivered && !oldDelivery))) {
          const trace = await client.getTrackTrace(parcel.barcode, parcel.postcode, parcel.parcelId);
          const history = buildNlHistory(trace);
          cached = { key: cacheKey, history: history || cached?.history || null };
        }
        if (cached) {
          seenHistory[parcel.barcode] = cached;
          parcel.history = cached.history;
        }
        out.push(parcel);
      }
      for (const raw of sent) {
        if (raw?.type && raw.type !== 'outgoing') continue;
        const parcel = normalizeNlAccount(raw, { direction: 'outgoing' });
        if (parcel.barcode && !out.some(p => p.barcode === parcel.barcode)) out.push(parcel);
      }
      this._history = seenHistory;
      await this.setStoreValue(STORE_HISTORY, seenHistory).catch(this.error);
    }

    const extra = entries.filter(entry => !out.some(p => p.barcode === entry.code) && !this.wasDelivered(entry.code));
    if (extra.length) {
      const found = await fetchGateway(extra.map(entry => entry.code));
      for (const entry of extra) {
        const raw = found[entry.code];
        if (raw) out.push(normalizeGateway(raw, { direction: entry.direction, postcode: entry.postcode }));
        else if (this._parcels[entry.code]) out.push({ ...this._parcels[entry.code] }); // keep last known data
        else out.push({ source: 'gateway', barcode: entry.code, status: 'registered', rawStatus: '', delivered: false, direction: entry.direction, history: [], pending: true });
      }
    }
    return out;
  }

  async onAuthFailure() { this._client = null; }

  async onRefreshed() {
    const connected = this.hasUsableConfiguration();
    if (this.hasCapability('myparcel_connection_status')) {
      await this.setCapabilityValue('myparcel_connection_status', this.homey.app?.getConnectionLabel?.(connected) ?? '').catch(() => {});
    }
  }

  extraTokens(parcel, tokens) {
    return { service: parcel.product || tokens.service || 'DHL' };
  }
}

module.exports = DhlParcelDevice;
