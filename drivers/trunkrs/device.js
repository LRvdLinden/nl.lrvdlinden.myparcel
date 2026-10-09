'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { TrunkrsClient, normalize, normalizeCode, normalizePostcode, validPostcode, slim, TEXT } = require('../../lib/trunkrs-tracking');
const { migrateTrackingList, simpleTrackingList } = require('../../lib/carrier-migrate');
const { tr } = require('../../lib/i18n');

/**
 * Trunkrs – like ha-trunkrs: keyless consumer tracking, one Trunkrs number + the receiver's postcode per parcel.
 * The device postcode (setting postal_code) is the default; a line "<number> <postcode>" overrides it.
 */
class TrunkrsDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'Trunkrs',
    log: '[Trunkrs]',
    storePrefix: 'trunkrs',
    widgetCarrier: 'trunkrs',
    idleWhenNothingActive: true,
    capabilities: [
      'trunkrs_parcel_count', 'trunkrs_status', 'trunkrs_tracking', 'trunkrs_sender', 'trunkrs_receiver', 'trunkrs_delivery_date',
      'trunkrs_delivery_window', 'trunkrs_next_delivery', 'trunkrs_out_for_delivery_count', 'trunkrs_delivered_count',
      'trunkrs_last_event', 'myparcel_connection_status', 'trunkrs_last_update',
    ],
    caps: {
      count: 'trunkrs_parcel_count', status: 'trunkrs_status', tracking: 'trunkrs_tracking', sender: 'trunkrs_sender', receiver: 'trunkrs_receiver',
      date: 'trunkrs_delivery_date', window: 'trunkrs_delivery_window', next: 'trunkrs_next_delivery', outCount: 'trunkrs_out_for_delivery_count',
      deliveredCount: 'trunkrs_delivered_count', lastEvent: 'trunkrs_last_event', lastUpdate: 'trunkrs_last_update',
      enRouteCount: null, pickupCount: null, pickupPoint: null, outgoingCount: null, total: null,
    },
    cards: {
      newPackage: 'trunkrs_new_package', statusChanged: 'trunkrs_status_changed', eventChanged: 'trunkrs_package_event_changed',
      outForDelivery: 'trunkrs_out_for_delivery', delivered: 'trunkrs_delivered', problem: 'trunkrs_package_problem',
      deliveryUpdated: 'trunkrs_delivery_window_changed',
    },
  };

  async onDhlInit() {
    this._client = new TrunkrsClient();
    this._raw = this.getStoreValue('trunkrs_raw_cache') || {};
    await migrateTrackingList(this);
  }

  async onSettings(event) {
    const pc = normalizePostcode(event.newSettings?.postal_code);
    if (event.changedKeys.includes('postal_code') && pc && !validPostcode(pc)) throw new Error(tr(this.homey, TEXT.invalidPostcode));
    return super.onSettings(event);
  }

  parseTracking(text) { return simpleTrackingList(text, normalizeCode).map(e => ({ ...e, postcode: normalizePostcode(e.postcode) })); }

  normalizeTrackingCode(code) { return normalizeCode(code); }

  hasUsableConfiguration() { return true; }

  _postcode(entry) { return normalizePostcode(entry.postcode || this.getSetting('postal_code')); }

  /** Flow "track parcel": needs a valid postcode; a definite "unknown pair" from Trunkrs blocks it, an outage does not. */
  async validateTrackingCode(entry) {
    if (!entry.code) throw new Error(tr(this.homey, TEXT.invalidCode));
    const postcode = this._postcode(entry);
    if (!validPostcode(postcode)) throw new Error(tr(this.homey, TEXT.invalidPostcode));
    let known = null;
    try { known = await this._client.verify(entry.code, postcode); } catch (error) { this.error('[Trunkrs] verify', entry.code, error.message); }
    if (known === false) throw new Error(tr(this.homey, TEXT.unknownParcel, { code: entry.code, postcode }));
  }

  async _fetchParcels() {
    const entries = this.trackedEntries();
    const out = [];
    const keep = {};
    let failures = 0;
    let attempted = 0;
    for (const entry of entries) {
      if (this.wasDelivered(entry.code)) continue; // final: the base keeps it visible
      const postcode = this._postcode(entry);
      const opts = { postcode };
      const cached = this._raw[entry.code];
      const fromCache = () => { if (cached) { keep[entry.code] = cached; out.push(normalize(cached, entry.code, opts)); } else out.push(normalize(null, entry.code, opts)); };
      if (this._parcels[entry.code]?.delivered && cached) { fromCache(); continue; }
      if (!validPostcode(postcode)) { this.error('[Trunkrs]', entry.code, 'no valid postcode'); fromCache(); continue; }
      attempted += 1;
      try {
        const raw = await this._client.parcel(entry.code, postcode);
        if (raw) { const s = slim(raw); keep[entry.code] = s; out.push(normalize(s, entry.code, opts)); } else fromCache();
      } catch (error) {
        if (error.status === 429) throw error;
        if (error.auth) { this.error('[Trunkrs]', entry.code, 'rejected – check the number and postcode'); fromCache(); continue; } // per parcel, not a login
        failures += 1;
        this.error('[Trunkrs]', entry.code, error.message);
        if (cached) { keep[entry.code] = cached; out.push(normalize(cached, entry.code, opts)); }
      }
    }
    // Every request failed: keep the last known state (the base shows the "unreachable" warning and backs off).
    if (attempted && failures === attempted) throw new Error('Trunkrs is unreachable');
    this._raw = keep;
    await this.setStoreValue('trunkrs_raw_cache', keep).catch(this.error);
    return out;
  }

  _eventText(text) { return require('../../lib/trunkrs-tracking').labelText(this.homey, text); }
}

module.exports = TrunkrsDevice;
