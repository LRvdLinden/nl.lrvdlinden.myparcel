'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { DragonflyClient, normalize, normalizeCode, countryOf, brandFor } = require('../../lib/dragonfly-tracking');
const { migrateTrackingList, simpleTrackingList } = require('../../lib/carrier-migrate');

/**
 * Dragonfly Shipping (NL, AU) / Intelcom (CA) – like ha-dragonfly: public tracking per code, no account,
 * no postcode. One country backend per device (`country` setting). Door deliveries only; a
 * `last_mile_pickup` task (driver collects from you) and codes marked " out" count as outgoing.
 */
class DragonflyDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'Dragonfly',
    log: '[Dragonfly]',
    storePrefix: 'dragonfly',
    widgetCarrier: 'dragonfly',
    idleWhenNothingActive: true,
    capabilities: [
      'dragonfly_parcel_count', 'dragonfly_status', 'dragonfly_tracking', 'dragonfly_sender', 'dragonfly_delivery_date',
      'dragonfly_delivery_window', 'dragonfly_next_delivery', 'dragonfly_out_for_delivery_count', 'dragonfly_delivered_count',
      'dragonfly_outgoing_count', 'dragonfly_last_event', 'myparcel_connection_status', 'dragonfly_last_update',
    ],
    caps: {
      count: 'dragonfly_parcel_count', status: 'dragonfly_status', tracking: 'dragonfly_tracking', sender: 'dragonfly_sender', receiver: null,
      date: 'dragonfly_delivery_date', window: 'dragonfly_delivery_window', next: 'dragonfly_next_delivery', outCount: 'dragonfly_out_for_delivery_count',
      enRouteCount: null, pickupCount: null, pickupPoint: null, deliveredCount: 'dragonfly_delivered_count', outgoingCount: 'dragonfly_outgoing_count',
      lastEvent: 'dragonfly_last_event', lastUpdate: 'dragonfly_last_update', total: null,
    },
    cards: {
      newPackage: 'dragonfly_new_package', statusChanged: 'dragonfly_status_changed', eventChanged: 'dragonfly_package_event_changed',
      outForDelivery: 'dragonfly_out_for_delivery', delivered: 'dragonfly_delivered', problem: 'dragonfly_package_problem',
      outgoingStatus: 'dragonfly_outgoing_status_changed', outgoingDelivered: 'dragonfly_outgoing_delivered',
      deliveryUpdated: 'dragonfly_delivery_window_changed',
    },
  };

  /** Same config, but the carrier name follows the country: "Intelcom" in Canada, "Dragonfly" elsewhere. */
  get cfg() {
    const base = this.constructor.config;
    const carrier = brandFor(this._country());
    if (!this._cfgCache || this._cfgCache.carrier !== carrier) this._cfgCache = { ...base, carrier, log: `[${carrier}]` };
    return this._cfgCache;
  }

  _country() {
    try { return countryOf(this.getSetting('country')); } catch (_) { return 'NL'; }
  }

  async onDhlInit() {
    this._client = null;
    this._raw = this.getStoreValue('dragonfly_raw_cache') || {};
    await migrateTrackingList(this);
  }

  async onDhlSettings(changed) {
    if (changed.includes('country')) {
      // Tracking codes are keyed to one backend: data from the old country must not linger.
      this._client = null;
      this._raw = {};
      await this.setStoreValue('dragonfly_raw_cache', {}).catch(this.error);
    }
  }

  parseTracking(text) { return simpleTrackingList(text, normalizeCode); }

  normalizeTrackingCode(code) { return normalizeCode(code); }

  hasUsableConfiguration() { return true; }

  extraTokens() { return { country: this._country() }; }

  _getClient() {
    const country = this._country();
    if (!this._client || this._client.country !== country) this._client = new DragonflyClient({ country });
    return this._client;
  }

  async _fetchParcels() {
    const entries = this.trackedEntries();
    const client = this._getClient();
    const opts = { country: client.country, lang: this._lang() };
    const out = [];
    const keep = {};
    let failures = 0;
    let fetched = 0;
    for (const entry of entries) {
      if (this.wasDelivered(entry.code)) continue; // a delivered parcel's payload never changes again
      const cached = this._raw[entry.code];
      const norm = raw => normalize(raw, entry.code, { ...opts, direction: entry.direction });
      if (this._parcels[entry.code]?.delivered && cached) { keep[entry.code] = cached; out.push(norm(cached)); continue; }
      fetched += 1;
      try {
        const raw = await client.parcel(entry.code);
        if (raw) { keep[entry.code] = raw; out.push(norm(raw)); } else if (cached) { keep[entry.code] = cached; out.push(norm(cached)); } else out.push(norm(null));
      } catch (error) {
        if (error.status === 429) throw error;
        failures += 1;
        this.error(this.cfg.log, entry.code, error.message);
        if (cached) { keep[entry.code] = cached; out.push(norm(cached)); }
      }
    }
    // Every fetch failed: like HA, a poll served entirely from cache is not a successful update. The base keeps the
    // last known parcels and shows the "temporarily unreachable" warning; the raw cache stays untouched.
    if (fetched && failures === fetched) throw new Error(`${this.cfg.carrier} is unreachable for all tracked parcels`);
    this._raw = keep;
    await this.setStoreValue('dragonfly_raw_cache', keep).catch(this.error);
    return out;
  }
}

module.exports = DragonflyDevice;
