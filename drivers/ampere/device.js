'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { BolSessionClient } = require('../../lib/bol-session');
const { exchangeLink, fetchParcel, normalize, isTrackingLink } = require('../../lib/ampere-tracking');

const DISCOVERY_EVERY_MS = 3 * 3600 * 1000;
const STORE_SESSIONS = 'ampere_sessions_v1';
const STORE_DISCOVERED = 'ampere_discovered_v1';
const STORE_RAW = 'ampere_raw_cache_v1';

/**
 * Ampère (bol.com) – status like ha-ampere (guest session from the e-mail / key link, data-test-id scraping,
 * /api/progress window, silent re-exchange when the session expires), while keeping MyParcel's automatic
 * discovery of Ampère parcels from the bol.com account through the helper code.
 */
class AmpereDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'Ampère',
    log: '[Ampère]',
    storePrefix: 'ampere',
    widgetCarrier: 'ampere',
    capabilities: [
      'ampere_parcel_count', 'ampere_total_count', 'ampere_status', 'ampere_tracking', 'ampere_sender', 'ampere_receiver',
      'ampere_delivery_date', 'ampere_delivery_window', 'ampere_window_start', 'ampere_window_end', 'ampere_next_delivery',
      'ampere_out_for_delivery_count', 'ampere_delivered_count', 'ampere_last_event', 'ampere_delivered', 'ampere_details_url',
      'myparcel_connection_status', 'ampere_last_update',
    ],
    caps: {
      count: 'ampere_parcel_count', total: 'ampere_total_count', status: 'ampere_status', tracking: 'ampere_tracking', sender: 'ampere_sender',
      receiver: 'ampere_receiver', date: 'ampere_delivery_date', window: 'ampere_delivery_window', next: 'ampere_next_delivery',
      outCount: 'ampere_out_for_delivery_count', deliveredCount: 'ampere_delivered_count', lastEvent: 'ampere_last_event',
      lastUpdate: 'ampere_last_update', pickupCount: null, enRouteCount: null, outgoingCount: null, pickupPoint: null,
    },
    cards: {
      newPackage: 'ampere_new_package', statusChanged: 'ampere_status_changed', delivered: 'ampere_delivered',
      outForDelivery: 'ampere_out_for_delivery', problem: 'ampere_package_problem', eventChanged: 'ampere_package_event_changed',
      deliveryUpdated: ['ampere_delivery_updated', 'ampere_delivery_window_changed'],
    },
  };

  async onDhlInit() {
    this._sessions = this.getStoreValue(STORE_SESSIONS) || {};
    this._discovered = this.getStoreValue(STORE_DISCOVERED) || { at: 0, links: [] };
    this._raw = this.getStoreValue(STORE_RAW) || {};
    // 0.3.4 and older kept a fuzzy snapshot (and could hold PostNL parcels); the new memory seeds silently.
    if (this.getStoreValue('ampere_snapshot')) await this.unsetStoreValue('ampere_snapshot').catch(() => {});
    const legacyUrl = String(this.getSetting('tracking_url') || '').trim();
    if (legacyUrl && isTrackingLink(legacyUrl) && !String(this.getSetting('tracking_numbers') || '').includes(legacyUrl)) {
      const list = [String(this.getSetting('tracking_numbers') || '').trim(), legacyUrl].filter(Boolean).join('\n');
      await this.setSettings({ tracking_numbers: list, tracking_url: '' }).catch(this.error);
    }
  }

  async onDhlSettings(changed) {
    if (changed.includes('bol_session_bundle')) this._discovered = { at: 0, links: [] };
  }

  /** Lines are tracking links (kept as written). */
  parseTracking(text) {
    const seen = new Set();
    return String(text || '').split(/\s+/).map(v => v.trim()).filter(v => isTrackingLink(v) && !seen.has(v) && seen.add(v))
      .map(link => ({ code: link, postcode: '', direction: 'incoming' }));
  }

  normalizeTrackingCode(code) { return String(code || '').trim(); }

  _sessionCode() { return String(this.getSetting('bol_session_bundle') || '').trim(); }

  hasAccount() { return Boolean(this._sessionCode()); }

  hasUsableConfiguration() { return this.hasAccount() || this.trackedEntries().length > 0; }

  isConnected() { return this.hasUsableConfiguration() && this.getStoreValue('authExpiredNotified') !== true; }

  async validateTrackingCode(entry) {
    if (!isTrackingLink(entry.code)) throw new Error('Paste the tracking link from the bol.com e-mail (https://link.bol.com/t/…).');
    await exchangeLink(entry.code); // proves the link works before it is stored
  }

  async untrackParcel(input) {
    const value = String(input || '').trim();
    const link = this._parcels[value]?.link || value;
    await this.setSettings({ tracking_numbers: this.trackedEntries().filter(e => e.code !== link).map(e => e.code).join('\n') });
    if (this._busy) await this._busy.catch(() => {});
    for (const [code, parcel] of Object.entries(this._parcels)) if (parcel.link === link || code === value) delete this._parcels[code];
    delete this._sessions[link];
    await this.setStoreValue(STORE_SESSIONS, this._sessions).catch(this.error);
    await this.setStoreValue(this._storeParcels, this._parcels).catch(this.error);
    await this._updateCapabilities().catch(this.error);
    return true;
  }

  async updateSession() { this._discovered = { at: 0, links: [] }; await this.setStoreValue('authExpiredNotified', false); await this.setAvailable().catch(() => {}); return this.refresh(true); }

  async _discover() {
    if (!this.hasAccount() || Date.now() - Number(this._discovered.at || 0) < DISCOVERY_EVERY_MS) return this._discovered.links || [];
    const client = new BolSessionClient({
      sessionCode: this._sessionCode(),
      fetchFn: fetch,
      log: (...args) => this.log(...args),
      onBundleUpdated: async updated => { if (updated && updated !== this._sessionCode()) await this.setSettings({ bol_session_bundle: updated }); },
    });
    try {
      const { urls } = await client.discoverAmpereUrls({ tolerateAuthFailure: true });
      this._discovered = { at: Date.now(), links: [...new Set(urls)].slice(-40) };
    } catch (error) {
      this.error('[Ampère] bol.com discovery failed:', error.message);
      if (error.code === 'AUTH_REAUTH_REQUIRED') { const e = new Error('The bol.com helper session has expired'); e.auth = true; throw e; }
      this._discovered = { at: Date.now(), links: this._discovered.links || [] };
    }
    await this.setStoreValue(STORE_DISCOVERED, this._discovered).catch(this.error);
    return this._discovered.links;
  }

  async _session(link, { renew = false } = {}) {
    const known = this._sessions[link];
    if (known?.notAmpere) return null;
    if (known && !renew) return known;
    try {
      const { cookie, parcelToken } = await exchangeLink(link);
      this._sessions[link] = { cookie, parcelToken, barcode: known?.barcode || '' };
    } catch (error) {
      if (/did not lead to a parcel|did not start a session/.test(error.message) || error.auth) {
        // not (or no longer) an Ampère parcel: remember, so it is not retried every poll
        this._sessions[link] = { ...(known || {}), notAmpere: !known?.barcode, expired: Boolean(known?.barcode) };
        return null;
      }
      throw error;
    }
    return this._sessions[link];
  }

  async _fetchParcels() {
    if (!this.hasUsableConfiguration()) return null;
    const manual = this.trackedEntries().map(e => e.code);
    const discovered = await this._discover();
    const links = [...new Set([...manual, ...discovered])];
    const out = [];
    let failures = 0;
    for (const link of links) {
      const known = this._sessions[link];
      if (known?.notAmpere) continue;
      const barcode = known?.barcode || '';
      if (barcode && this.wasDelivered(barcode)) continue;
      const cached = this._raw[link];
      if (barcode && this._parcels[barcode]?.delivered && cached) { out.push({ ...normalize(cached, { url: link }), link }); continue; }
      try {
        let session = await this._session(link);
        if (!session) { if (cached) out.push({ ...normalize(cached, { url: link }), link }); continue; }
        let raw;
        try {
          raw = await fetchParcel(session);
        } catch (error) {
          if (!error.auth) throw error;
          session = await this._session(link, { renew: true }); // silent re-exchange, like ha-ampere
          if (!session) throw error;
          raw = await fetchParcel(session);
        }
        if (!raw.barcode && !raw.banner_status_text && !raw.history_status_texts.length) throw new Error('Ampère page without parcel data');
        this._raw[link] = raw;
        if (raw.barcode) this._sessions[link] = { ...this._sessions[link], barcode: raw.barcode };
        out.push({ ...normalize(raw, { url: link }), link });
      } catch (error) {
        failures += 1;
        this.error('[Ampère]', error.message);
        // keep the last known data: an error must never make a parcel "new" again
        if (cached) out.push({ ...normalize(cached, { url: link }), link });
      }
    }
    for (const key of Object.keys(this._raw)) if (!links.includes(key)) delete this._raw[key];
    for (const key of Object.keys(this._sessions)) if (!links.includes(key)) delete this._sessions[key];
    await this.setStoreValue(STORE_RAW, this._raw).catch(this.error);
    await this.setStoreValue(STORE_SESSIONS, this._sessions).catch(this.error);
    if (links.length && failures === links.length && !out.length) throw new Error('Ampère is unreachable');
    return out;
  }

  async updateExtraCapabilities({ focus, text }) {
    await this._set('ampere_window_start', text(focus?.windowKnown ? this._time(focus.plannedFrom) : ''));
    await this._set('ampere_window_end', text(focus?.windowKnown ? this._time(focus.plannedTo) : ''));
    await this._set('ampere_delivered', Boolean(focus?.delivered));
    await this._set('ampere_details_url', text(focus?.url));
  }

  async onRefreshed() {
    const label = this.homey.app?.getConnectionLabel?.(this.isConnected());
    if (label) await this._set('myparcel_connection_status', label);
  }

  hasDeliveryWindow() { return Object.values(this._parcels || {}).some(p => !p.delivered && p.plannedFrom); }

  isLatestDelivered() {
    const latest = this._sortedParcels()[0];
    return Boolean(latest && latest.delivered);
  }
}

module.exports = AmpereDevice;
