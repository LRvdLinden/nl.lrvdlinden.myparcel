'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { BudbeeClient, normalize, normalizeCode, labelText } = require('../../lib/budbee-tracking');
const { migrateTrackingList, simpleTrackingList } = require('../../lib/carrier-migrate');

/** Budbee – like ha-budbee: public tracking per code, door deliveries and Budbee Box lockers. */
class BudbeeDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'Budbee',
    log: '[Budbee]',
    storePrefix: 'budbee',
    widgetCarrier: 'budbee',
    idleWhenNothingActive: true,
    capabilities: [
      'budbee_parcel_count', 'budbee_status', 'budbee_tracking', 'budbee_sender', 'budbee_delivery_date', 'budbee_delivery_window',
      'budbee_next_delivery', 'budbee_out_for_delivery_count', 'budbee_en_route_pickup_count', 'budbee_pickup_count', 'budbee_pickup_point',
      'budbee_delivered_count', 'budbee_outgoing_count', 'budbee_last_event', 'myparcel_connection_status', 'budbee_last_update',
    ],
    caps: {
      count: 'budbee_parcel_count', status: 'budbee_status', tracking: 'budbee_tracking', sender: 'budbee_sender', date: 'budbee_delivery_date',
      window: 'budbee_delivery_window', next: 'budbee_next_delivery', outCount: 'budbee_out_for_delivery_count', enRouteCount: 'budbee_en_route_pickup_count',
      pickupCount: 'budbee_pickup_count', pickupPoint: 'budbee_pickup_point', deliveredCount: 'budbee_delivered_count', outgoingCount: 'budbee_outgoing_count',
      lastEvent: 'budbee_last_event', lastUpdate: 'budbee_last_update', total: null, receiver: null,
    },
    cards: {
      newPackage: 'budbee_new_package', statusChanged: 'budbee_status_changed', delivered: 'budbee_delivered', outForDelivery: 'budbee_out_for_delivery',
      readyForPickup: 'budbee_ready_for_pickup', problem: 'budbee_package_problem', eventChanged: 'budbee_package_event_changed',
      outgoingStatus: 'budbee_outgoing_status_changed', outgoingDelivered: 'budbee_outgoing_delivered',
      // budbee_delivery_window_changed is fired by the app
    },
  };

  async onDhlInit() {
    this._client = new BudbeeClient();
    this._raw = this.getStoreValue('budbee_raw_cache') || {};
    await migrateTrackingList(this);
  }

  parseTracking(text) { return simpleTrackingList(text, normalizeCode); }

  normalizeTrackingCode(code) { return normalizeCode(code); }

  hasUsableConfiguration() { return true; }

  /** Budbee event labels (English source in lib/budbee-tracking) in the user's language. */
  _eventText(text) { return labelText(this.homey, text); }

  async _fetchParcels() {
    const entries = this.trackedEntries();
    const codes = new Set(entries.map(e => e.code));
    for (const code of Object.keys(this._client.meta)) if (!codes.has(code)) this._client.forget(code);
    const out = [];
    const keep = {};
    let failures = 0;
    for (const entry of entries) {
      if (this.wasDelivered(entry.code)) continue;
      const cached = this._raw[entry.code];
      if (this._parcels[entry.code]?.delivered && cached) { keep[entry.code] = cached; out.push(normalize(cached, entry.code)); continue; }
      try {
        const raw = await this._client.parcel(entry.code);
        if (raw) { keep[entry.code] = raw; out.push(normalize(raw, entry.code)); } else if (cached) { keep[entry.code] = cached; out.push(normalize(cached, entry.code)); } else out.push(normalize(null, entry.code));
      } catch (error) {
        failures += 1;
        this.error('[Budbee]', entry.code, error.message);
        if (cached) { keep[entry.code] = cached; out.push(normalize(cached, entry.code)); }
      }
    }
    if (failures && failures === entries.length && !out.length) throw new Error('Budbee is unreachable'); // i18n: translated by messages-i18n (carrier_unreachable)
    this._raw = keep;
    await this.setStoreValue('budbee_raw_cache', keep).catch(this.error);
    return out;
  }
}

module.exports = BudbeeDevice;
