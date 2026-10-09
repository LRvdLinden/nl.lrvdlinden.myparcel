'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { AmazonClient, normalize, normalizeCode, resolveCountry, isUnresolved, IDLE_INTERVAL_MINUTES } = require('../../lib/amazon-tracking');

const STORE = {
  refreshToken: 'amazon_refresh_token',
  serial: 'amazon_device_serial',
  apiHost: 'amazon_api_host',
  domain: 'amazon_domain',
  raw: 'amazon_raw_cache',
  aliases: 'amazon_barcode_aliases',
};
const DAY_MINUTES = 24 * 60;
const QUIET_END_MINUTES = 6 * 60;

/**
 * Amazon – like ha-amazon (experimental): account based, one device per Amazon storefront. Signs in once
 * through Amazon's own page (pasted "maplanding" address), keeps only the refresh token + device serial
 * in the store and imports the shipments of recent orders; no tracking codes to enter.
 */
class AmazonDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'Amazon',
    log: '[Amazon]',
    storePrefix: 'amazon',
    widgetCarrier: 'amazon',
    midMinutes: 45,
    capabilities: [
      'amazon_parcel_count', 'amazon_status', 'amazon_tracking', 'amazon_item', 'amazon_carrier', 'amazon_delivery_date', 'amazon_next_delivery',
      'amazon_out_for_delivery_count', 'amazon_pickup_count', 'amazon_delivered_count', 'amazon_last_event',
      'myparcel_connection_status', 'amazon_last_update',
    ],
    caps: {
      count: 'amazon_parcel_count', status: 'amazon_status', tracking: 'amazon_tracking', item: 'amazon_item', service: 'amazon_carrier',
      date: 'amazon_delivery_date', next: 'amazon_next_delivery', outCount: 'amazon_out_for_delivery_count', pickupCount: 'amazon_pickup_count',
      deliveredCount: 'amazon_delivered_count', lastEvent: 'amazon_last_event', lastUpdate: 'amazon_last_update',
      sender: null, receiver: null, window: null, enRouteCount: null, pickupPoint: null, outgoingCount: null, total: null,
      weight: null, dimensions: null, pickupCode: null,
    },
    cards: {
      newPackage: 'amazon_new_package', statusChanged: 'amazon_status_changed', eventChanged: 'amazon_package_event_changed',
      outForDelivery: 'amazon_out_for_delivery', readyForPickup: 'amazon_ready_for_pickup', delivered: 'amazon_delivered',
      problem: 'amazon_package_problem', deliveryUpdated: 'amazon_delivery_window_changed',
    },
  };

  async onDhlInit() {
    this._client = null;
    this._raw = this.getStoreValue(STORE.raw) || { final: {}, last: {} };
    // A password must never be kept: the sign-in is a pasted link (ha-amazon never takes a password).
    if (this.getSetting('account_password')) await this.setSettings({ account_password: '' }).catch(() => {});
  }

  async onDhlSettings(changed) {
    if (changed.includes('country')) {
      // Another storefront: other order pages, so the shipment cache starts over (the sign-in itself is account wide).
      this._client = null;
      this._raw = { final: {}, last: {} };
      await this.setStoreValue(STORE.raw, this._raw).catch(this.error);
    }
  }

  country() { return resolveCountry(this.getSetting('country') || this.getStoreValue(STORE.domain) || 'NL'); }

  hasAccount() { return Boolean(this.getStoreValue(STORE.refreshToken)); }

  hasUsableConfiguration() { return this.hasAccount(); }

  parseTracking() { return []; } // account only: shipments come from the orders page

  normalizeTrackingCode(code) { return normalizeCode(code); }

  /** New sign-in from the repair flow (refresh token from a fresh device registration). */
  async updateLogin({ refreshToken, serial, apiHost, domain }) {
    await this.setStoreValue(STORE.refreshToken, refreshToken);
    if (serial) await this.setStoreValue(STORE.serial, serial);
    if (apiHost) await this.setStoreValue(STORE.apiHost, apiHost);
    if (domain) await this.setStoreValue(STORE.domain, domain);
    this._client = null;
    await this.setStoreValue('authExpiredNotified', false);
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  _getClient() {
    const country = this.country();
    const token = this.getStoreValue(STORE.refreshToken);
    if (!this._client || this._client.domain !== country.domain || this._client.refreshToken !== token) {
      this._client = new AmazonClient({ country: country.code, refreshToken: token, apiHost: this.getStoreValue(STORE.apiHost) || null, state: this._raw });
    }
    return this._client;
  }

  async _fetchParcels() {
    if (!this.hasUsableConfiguration()) return null;
    const client = this._getClient();
    const aliases = { ...(this.getStoreValue(STORE.aliases) || {}) };
    let records;
    try {
      // A shipment already announced as delivered is never read again (the base keeps it visible).
      records = await client.getParcels({ skip: (key, record) => this.wasDelivered(normalize(record, '', { history: false }).barcode) });
    } catch (error) {
      if (error.auth) this._client = null;
      if (error.status === 503 && !error.retryAfter) error.retryAfter = Math.min(60 * (2 ** ((this._consecutive429 || 0) + 1)), 3600);
      throw error;
    }
    if (client.apiHost && client.apiHost !== this.getStoreValue(STORE.apiHost)) await this.setStoreValue(STORE.apiHost, client.apiHost).catch(this.error);

    const out = [];
    const nextAliases = {};
    let moved = false;
    for (const record of records) {
      const parcel = normalize(record, '');
      if (!parcel.barcode || isUnresolved(parcel, record)) continue;
      // A shipment first keyed on a stand-in gets its tracking id later: carry its memory over, so it is not "new" twice.
      const lineKey = record.line_item_id ? `L:${record.order_id}|${record.line_item_id}` : null;
      const before = aliases[record.key] || (lineKey && aliases[lineKey]);
      if (before && before !== parcel.barcode && this._memory[before] && !this._memory[parcel.barcode]) {
        this._memory[parcel.barcode] = this._memory[before];
        delete this._memory[before];
        if (this._parcels[before]) { this._parcels[parcel.barcode] = { ...this._parcels[before], tracking: parcel.barcode }; delete this._parcels[before]; }
        moved = true;
      }
      nextAliases[record.key] = parcel.barcode;
      if (lineKey) nextAliases[lineKey] = parcel.barcode;
      if (parcel.delivered && this.wasDelivered(parcel.barcode)) continue;
      out.push(parcel);
    }
    if (moved) await this.setStoreValue(this._storeMemory, this._memory).catch(this.error);
    this._raw = client.state;
    await this.setStoreValue(STORE.raw, client.state).catch(this.error);
    await this.setStoreValue(STORE.aliases, nextAliases).catch(this.error);
    return out;
  }

  /** ha-amazon idle tier: with nothing in flight the account is read every 2 h (each poll signs in again). */
  adjustDelay(delay, { afterError }) {
    if (afterError) return delay;
    if (Object.values(this._parcels || {}).some(p => !p.delivered)) return delay;
    const now = this._localMinutes(new Date());
    if (now < QUIET_END_MINUTES) return delay;
    const tier = IDLE_INTERVAL_MINUTES + this._staggerMinutes();
    if (now + tier >= DAY_MINUTES) return Math.max(delay, (DAY_MINUTES - now + this._staggerMinutes()) * 60000);
    return Math.max(delay, tier * 60000);
  }

  extraTokens(parcel) {
    return { delivery_carrier: parcel.service || '', order_id: parcel.orderId || '', item: parcel.item || '' };
  }

  async onAuthFailure() { this._client = null; }
}

module.exports = AmazonDevice;
