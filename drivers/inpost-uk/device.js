'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { fetchTracking, normalizeTracking, InPostAccountClient, normalizePl, normalizeIt } = require('../../lib/inpost-tracking');
const { migrateTrackingList, simpleTrackingList } = require('../../lib/carrier-migrate');

const norm = v => String(v || '').trim().replace(/\s+/g, '').toUpperCase();

/** InPost – like ha-inpost: tracking codes in PL/IT/PT/GB/ES and an optional InPost account (PL/IT). */
class InPostDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'InPost',
    log: '[InPost]',
    storePrefix: 'inpost',
    widgetCarrier: 'inpost-uk',
    idleWhenNothingActive: true,
    capabilities: [
      'inpost_uk_parcel_count', 'inpost_uk_status', 'inpost_uk_tracking', 'inpost_uk_sender', 'inpost_uk_out_for_delivery_count',
      'inpost_uk_pickup_count', 'inpost_uk_pickup_point', 'inpost_uk_pickup_code', 'inpost_uk_delivered_count', 'inpost_uk_last_event',
      'myparcel_connection_status', 'inpost_uk_last_update',
    ],
    caps: {
      count: 'inpost_uk_parcel_count', status: 'inpost_uk_status', tracking: 'inpost_uk_tracking', sender: 'inpost_uk_sender',
      outCount: 'inpost_uk_out_for_delivery_count', pickupCount: 'inpost_uk_pickup_count', pickupPoint: 'inpost_uk_pickup_point',
      pickupCode: 'inpost_uk_pickup_code', deliveredCount: 'inpost_uk_delivered_count', lastEvent: 'inpost_uk_last_event',
      lastUpdate: 'inpost_uk_last_update', total: null, receiver: null, date: null, window: null, next: null, enRouteCount: null, outgoingCount: null,
    },
    cards: {
      newPackage: 'inpost_uk_new_package', statusChanged: 'inpost_uk_status_changed', delivered: 'inpost_uk_delivered',
      outForDelivery: 'inpost_uk_out_for_delivery', readyForPickup: 'inpost_uk_ready_for_pickup', problem: 'inpost_uk_package_problem',
      eventChanged: 'inpost_uk_package_event_changed',
    },
  };

  async onDhlInit() {
    this._account = null;
    this._raw = this.getStoreValue('inpost_raw_cache') || {};
    await migrateTrackingList(this);
    if (!this.getSetting('country')) await this.setSettings({ country: 'GB' }).catch(() => {});
  }

  async onDhlSettings(changed) { if (changed.includes('country')) this._raw = {}; }

  parseTracking(text) { return simpleTrackingList(text, norm); }

  normalizeTrackingCode(code) { return norm(code); }

  hasAccount() { return Boolean(this.getStoreValue('inpost_refresh_token')); }

  hasUsableConfiguration() { return true; }

  async updateAccount({ accessToken, refreshToken, market, phone }) {
    await this.setStoreValue('inpost_access_token', accessToken);
    await this.setStoreValue('inpost_refresh_token', refreshToken);
    await this.setStoreValue('inpost_market', market);
    await this.setStoreValue('inpost_phone', phone);
    await this.setStoreValue('inpost_auth_method', 'sso');
    this._account = null;
    await this.setStoreValue('authExpiredNotified', false);
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  _getAccount() {
    if (!this.hasAccount()) return null;
    if (!this._account) {
      this._account = new InPostAccountClient({
        market: this.getStoreValue('inpost_market') || 'PL',
        method: this.getStoreValue('inpost_auth_method') || 'sso',
        accessToken: this.getStoreValue('inpost_access_token'),
        refreshToken: this.getStoreValue('inpost_refresh_token'),
        onTokens: ({ accessToken, refreshToken }) => {
          this.setStoreValue('inpost_access_token', accessToken).catch(this.error);
          this.setStoreValue('inpost_refresh_token', refreshToken).catch(this.error);
        },
      });
    }
    return this._account;
  }

  async _fetchParcels() {
    const out = [];
    const account = this._getAccount();
    if (account) {
      try {
        const list = await account.parcels();
        for (const raw of list) out.push(account.market === 'IT' ? normalizeIt(raw) : normalizePl(raw));
      } catch (error) {
        if (error.auth) this._account = null;
        throw error;
      }
    }
    const country = this.getSetting('country') || 'GB';
    const keep = {};
    for (const entry of this.trackedEntries()) {
      if (out.some(p => p.barcode === entry.code) || this.wasDelivered(entry.code)) continue;
      const cached = this._raw[entry.code];
      if (this._parcels[entry.code]?.delivered && cached) { keep[entry.code] = cached; out.push(normalizeTracking(cached, { code: entry.code, country })); continue; }
      try {
        const raw = await fetchTracking(entry.code);
        if (raw) { keep[entry.code] = raw; out.push(normalizeTracking(raw, { code: entry.code, country })); } else if (cached) { keep[entry.code] = cached; out.push(normalizeTracking(cached, { code: entry.code, country })); } else out.push(normalizeTracking(null, { code: entry.code, country }));
      } catch (error) {
        if (error.status === 429) throw error;
        this.error('[InPost]', entry.code, error.message);
        if (cached) { keep[entry.code] = cached; out.push(normalizeTracking(cached, { code: entry.code, country })); } else throw error;
      }
    }
    this._raw = keep;
    await this.setStoreValue('inpost_raw_cache', keep).catch(this.error);
    return out;
  }

  async onAuthFailure() { this._account = null; }
}

module.exports = InPostDevice;
