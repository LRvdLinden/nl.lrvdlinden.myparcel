'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { DynalogicClient, normalize, normalizeCode, normalizePostcode, validPostcode, guessCountry, slim, COUNTRIES, TEXT } = require('../../lib/dynalogic-tracking');
const { migrateTrackingList, simpleTrackingList } = require('../../lib/carrier-migrate');
const { tr } = require('../../lib/i18n');

/**
 * Dynalogic – like ha-dynalogic: keyless track-middleware, order number + delivery postcode, Netherlands and Belgium.
 * The device postcode (setting postal_code, format per setting country) is the default; "<order> <postcode>" overrides it.
 */
class DynalogicDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'Dynalogic',
    log: '[Dynalogic]',
    storePrefix: 'dynalogic',
    widgetCarrier: 'dynalogic',
    idleWhenNothingActive: true,
    capabilities: [
      'dynalogic_parcel_count', 'dynalogic_status', 'dynalogic_tracking', 'dynalogic_sender', 'dynalogic_receiver', 'dynalogic_delivery_date',
      'dynalogic_delivery_window', 'dynalogic_next_delivery', 'dynalogic_out_for_delivery_count', 'dynalogic_delivered_count',
      'dynalogic_last_event', 'myparcel_connection_status', 'dynalogic_last_update',
    ],
    caps: {
      count: 'dynalogic_parcel_count', status: 'dynalogic_status', tracking: 'dynalogic_tracking', sender: 'dynalogic_sender', receiver: 'dynalogic_receiver',
      date: 'dynalogic_delivery_date', window: 'dynalogic_delivery_window', next: 'dynalogic_next_delivery', outCount: 'dynalogic_out_for_delivery_count',
      deliveredCount: 'dynalogic_delivered_count', lastEvent: 'dynalogic_last_event', lastUpdate: 'dynalogic_last_update',
      enRouteCount: null, pickupCount: null, pickupPoint: null, outgoingCount: null, total: null,
    },
    cards: {
      newPackage: 'dynalogic_new_package', statusChanged: 'dynalogic_status_changed', eventChanged: 'dynalogic_package_event_changed',
      outForDelivery: 'dynalogic_out_for_delivery', delivered: 'dynalogic_delivered', problem: 'dynalogic_package_problem',
    },
  };

  async onDhlInit() {
    this._client = new DynalogicClient();
    this._raw = this.getStoreValue('dynalogic_raw_cache') || {};
    await migrateTrackingList(this);
    if (!COUNTRIES[this.getSetting('country')]) {
      const pc = this.getSetting('postal_code');
      await this.setSettings({ country: pc ? guessCountry(pc) : 'NL' }).catch(this.error);
    }
  }

  _country(settings = null) {
    const c = settings ? settings.country : this.getSetting('country');
    return COUNTRIES[c] ? c : 'NL';
  }

  _postcodeError(country) { return new Error(tr(this.homey, country === 'BE' ? TEXT.invalidPostcodeBE : TEXT.invalidPostcodeNL)); }

  async onSettings(event) {
    const country = this._country(event.newSettings || {});
    const pc = normalizePostcode(event.newSettings?.postal_code);
    if ((event.changedKeys.includes('postal_code') || event.changedKeys.includes('country')) && pc && !validPostcode(pc, country)) throw this._postcodeError(country);
    return super.onSettings(event);
  }

  parseTracking(text) { return simpleTrackingList(text, normalizeCode).map(e => ({ ...e, postcode: normalizePostcode(e.postcode) })); }

  normalizeTrackingCode(code) { return normalizeCode(code); }

  hasUsableConfiguration() { return true; }

  _postcode(entry) { return normalizePostcode(entry.postcode || this.getSetting('postal_code')); }

  /** A per-line postcode may be for either market (a parcel to a different address); the device default follows `country`. */
  _postcodeValid(entry, postcode) { return entry.postcode ? validPostcode(postcode) : validPostcode(postcode, this._country()); }

  /** Flow "track parcel": shape check only, like ha-dynalogic's service (a fresh order may not exist at the carrier yet). */
  async validateTrackingCode(entry) {
    if (!entry.code) throw new Error(tr(this.homey, TEXT.invalidCode));
    const postcode = this._postcode(entry);
    if (!this._postcodeValid(entry, postcode)) throw this._postcodeError(entry.postcode ? guessCountry(postcode) : this._country());
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
      const opts = { country: entry.postcode ? guessCountry(postcode) : this._country() };
      const cached = this._raw[entry.code];
      const fromCache = () => { if (cached) { keep[entry.code] = cached; out.push(normalize(cached, entry.code, opts)); } else out.push(normalize(null, entry.code, opts)); };
      if (this._parcels[entry.code]?.delivered && cached) { fromCache(); continue; }
      if (!this._postcodeValid(entry, postcode)) { this.error('[Dynalogic]', entry.code, 'no valid postcode'); fromCache(); continue; }
      attempted += 1;
      try {
        const raw = await this._client.parcel(entry.code, postcode);
        if (raw) { const s = slim(raw); keep[entry.code] = s; out.push(normalize(s, entry.code, opts)); } else fromCache(); // 404: not (yet) known
      } catch (error) {
        if (error.status === 429) throw error;
        failures += 1;
        this.error('[Dynalogic]', entry.code, error.message);
        if (cached) { keep[entry.code] = cached; out.push(normalize(cached, entry.code, opts)); }
      }
    }
    // Every request failed: keep the last known state (the base shows the "unreachable" warning and backs off).
    if (attempted && failures === attempted) throw new Error('Dynalogic is unreachable');
    this._raw = keep;
    await this.setStoreValue('dynalogic_raw_cache', keep).catch(this.error);
    return out;
  }
}

module.exports = DynalogicDevice;
