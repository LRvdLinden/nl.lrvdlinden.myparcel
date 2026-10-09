'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { FedExClient, normalize, normalizeCode } = require('../../lib/fedex-tracking');
const { migrateTrackingList, simpleTrackingList } = require('../../lib/carrier-migrate');

/** FedEx – like ha-fedex: official API with your own credentials, tracking numbers in the settings. */
class FedExDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'FedEx',
    log: '[FedEx]',
    storePrefix: 'fedex',
    widgetCarrier: 'fedex',
    idleWhenNothingActive: true,
    capabilities: [
      'fedex_parcel_count', 'fedex_status', 'fedex_tracking', 'fedex_sender', 'fedex_receiver', 'fedex_delivery_date',
      'fedex_delivery_window', 'fedex_next_delivery', 'fedex_out_for_delivery_count', 'fedex_pickup_count', 'fedex_pickup_point',
      'fedex_delivered_count', 'fedex_last_event', 'fedex_service', 'fedex_weight', 'fedex_dimensions',
      'myparcel_connection_status', 'fedex_last_update',
    ],
    caps: {
      count: 'fedex_parcel_count', status: 'fedex_status', tracking: 'fedex_tracking', sender: 'fedex_sender', receiver: 'fedex_receiver',
      date: 'fedex_delivery_date', window: 'fedex_delivery_window', next: 'fedex_next_delivery', outCount: 'fedex_out_for_delivery_count',
      pickupCount: 'fedex_pickup_count', pickupPoint: 'fedex_pickup_point', deliveredCount: 'fedex_delivered_count', lastEvent: 'fedex_last_event',
      service: 'fedex_service', weight: 'fedex_weight', dimensions: 'fedex_dimensions', lastUpdate: 'fedex_last_update',
      total: null, enRouteCount: null, outgoingCount: null,
    },
    cards: {
      newPackage: 'fedex_new_package', statusChanged: 'fedex_status_changed', delivered: 'fedex_delivered', outForDelivery: 'fedex_out_for_delivery',
      readyForPickup: 'fedex_ready_for_pickup', problem: 'fedex_package_problem', eventChanged: 'fedex_package_event_changed', deliveryUpdated: 'fedex_delivery_updated',
    },
  };

  async onDhlInit() {
    this._client = null;
    this._raw = this.getStoreValue('fedex_raw_cache') || {};
    await migrateTrackingList(this);
    for (const key of ['access_token', 'expires_at']) if (this.getSetting(key)) await this.setSettings({ [key]: '' }).catch(() => {});
  }

  async onDhlSettings(changed) { if (changed.some(k => ['client_id', 'client_secret'].includes(k))) this._client = null; }

  parseTracking(text) { return simpleTrackingList(text, normalizeCode); }

  normalizeTrackingCode(code) { return normalizeCode(code); }

  hasUsableConfiguration() { return Boolean(this.getSetting('client_id') && this.getSetting('client_secret')); }

  async updateCredentials(clientId, clientSecret) {
    await this.setSettings({ client_id: clientId, client_secret: clientSecret });
    this._client = null;
    await this.setStoreValue('authExpiredNotified', false);
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  _getClient() {
    const id = this.getSetting('client_id');
    const secret = this.getSetting('client_secret');
    if (!this._client || this._client.clientId !== id || this._client.clientSecret !== secret) this._client = new FedExClient({ clientId: id, clientSecret: secret });
    return this._client;
  }

  async _fetchParcels() {
    if (!this.hasUsableConfiguration()) return null;
    const entries = this.trackedEntries();
    const client = this._getClient();
    const out = [];
    const keep = {};
    let failures = 0;
    for (const entry of entries) {
      if (this.wasDelivered(entry.code)) continue;
      if (this._parcels[entry.code]?.delivered && this._raw[entry.code]) { out.push(normalize(this._raw[entry.code], entry.code)); keep[entry.code] = this._raw[entry.code]; continue; }
      try {
        const raw = await client.track(entry.code);
        if (raw) { this._raw[entry.code] = raw; keep[entry.code] = raw; out.push(normalize(raw, entry.code)); } else if (this._raw[entry.code]) { keep[entry.code] = this._raw[entry.code]; out.push(normalize(this._raw[entry.code], entry.code)); } else out.push(normalize(null, entry.code));
      } catch (error) {
        if (error.auth || error.status === 429) throw error;
        failures += 1;
        if (this._raw[entry.code]) { keep[entry.code] = this._raw[entry.code]; out.push(normalize(this._raw[entry.code], entry.code)); }
        this.error('[FedEx]', entry.code, error.message);
      }
    }
    if (entries.length && failures === entries.length && !out.length) throw new Error('FedEx is unreachable');
    this._raw = keep;
    await this.setStoreValue('fedex_raw_cache', keep).catch(this.error);
    return out;
  }

  async onAuthFailure() { this._client = null; }
}

module.exports = FedExDevice;
