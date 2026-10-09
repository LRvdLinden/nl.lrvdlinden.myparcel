'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { fetchItem, normalizeTracked, BpostAccountClient, normalizeAccount } = require('../../lib/bpost-tracking');
const { migrateTrackingList, simpleTrackingList } = require('../../lib/carrier-migrate');

const norm = v => String(v || '').trim().replace(/\s+/g, '');

/** bpost – like ha-bpost: My bpost mobile API (tokens, parcels in and out, Mail Ahead) plus barcodes + postal code. */
class BpostDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'bpost',
    log: '[bpost]',
    storePrefix: 'bpost',
    widgetCarrier: 'bpost',
    idleWhenNothingActive: true,
    capabilities: [
      'bpost_parcel_count', 'bpost_total_count', 'bpost_status', 'bpost_tracking', 'bpost_sender', 'bpost_receiver', 'bpost_delivery_date',
      'bpost_delivery_window', 'bpost_next_delivery', 'bpost_delivery_point', 'bpost_out_for_delivery_count', 'bpost_en_route_pickup_count',
      'bpost_pickup_count', 'bpost_delivered_count', 'bpost_outgoing_count', 'bpost_weight', 'bpost_dimensions', 'bpost_product',
      'bpost_partner', 'bpost_last_event', 'bpost_letter_count', 'bpost_last_letter', 'bpost_account_status', 'bpost_last_update',
    ],
    caps: {
      count: 'bpost_parcel_count', total: 'bpost_total_count', status: 'bpost_status', tracking: 'bpost_tracking', sender: 'bpost_sender',
      receiver: 'bpost_receiver', date: 'bpost_delivery_date', window: 'bpost_delivery_window', next: 'bpost_next_delivery',
      pickupPoint: 'bpost_delivery_point', outCount: 'bpost_out_for_delivery_count', enRouteCount: 'bpost_en_route_pickup_count',
      pickupCount: 'bpost_pickup_count', deliveredCount: 'bpost_delivered_count', outgoingCount: 'bpost_outgoing_count',
      weight: 'bpost_weight', dimensions: 'bpost_dimensions', service: 'bpost_product', lastEvent: 'bpost_last_event', lastUpdate: 'bpost_last_update',
    },
    cards: {
      newPackage: 'bpost_new_package', statusChanged: 'bpost_status_changed', delivered: 'bpost_delivered', outForDelivery: 'bpost_out_for_delivery',
      readyForPickup: 'bpost_ready_for_pickup', problem: 'bpost_package_problem', eventChanged: 'bpost_package_event_changed',
      deliveryUpdated: 'bpost_delivery_updated', outgoingStatus: 'bpost_outgoing_status_changed', outgoingDelivered: 'bpost_outgoing_delivered',
      // bpost_delivery_window_changed is fired by the app
    },
  };

  async onDhlInit() {
    this._account = null;
    this._raw = this.getStoreValue('bpost_raw_cache') || {};
    this._letters = this.getStoreValue('bpost_letters') || null;
    await migrateTrackingList(this, v => [v?.barcode, v?.postalCode].filter(Boolean).join(' '));
  }

  async onDhlSettings(changed) {
    if (changed.some(k => ['account_email', 'account_password'].includes(k))) this._account = null;
  }

  parseTracking(text) { return simpleTrackingList(String(text || '').replace(/\|/g, ' '), norm); }

  normalizeTrackingCode(code) { return norm(code); }

  hasAccount() { return Boolean(this.getStoreValue('bpost_refresh_token') || (this.getSetting('account_email') && this.getSetting('account_password'))); }

  hasUsableConfiguration() { return this.hasAccount() || this.trackedEntries().length > 0; }

  isConnected() { return this.hasUsableConfiguration() && this.getStoreValue('authExpiredNotified') !== true; }

  async updateAccount(email, tokens) {
    await this.setSettings({ account_email: email, account_password: '' }).catch(() => {});
    await this.setStoreValue('bpost_access_token', tokens.accessToken);
    await this.setStoreValue('bpost_refresh_token', tokens.refreshToken);
    this._account = null;
    await this.setStoreValue('authExpiredNotified', false);
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  async _getAccount() {
    if (this._account) return this._account;
    const client = new BpostAccountClient({
      accessToken: this.getStoreValue('bpost_access_token'),
      refreshToken: this.getStoreValue('bpost_refresh_token'),
      onTokens: ({ accessToken, refreshToken }) => {
        this.setStoreValue('bpost_access_token', accessToken).catch(this.error);
        this.setStoreValue('bpost_refresh_token', refreshToken).catch(this.error);
      },
    });
    // 0.3.4 kept the password; sign in once to get tokens, then forget it (like ha-bpost).
    if (!client.refreshToken) {
      const email = this.getSetting('account_email');
      const password = this.getSetting('account_password');
      if (!email || !password) return null;
      await client.login(email, password);
      await this.setSettings({ account_password: '' }).catch(() => {});
    }
    this._account = client;
    return client;
  }

  _bpostLang() { const l = this._lang(); return ['nl', 'fr', 'en'].includes(l) ? l : 'en'; }

  async _fetchParcels() {
    const out = [];
    const account = this.hasAccount() ? await this._getAccount().catch(error => { this._account = null; throw error; }) : null;
    if (account) {
      try {
        for (const raw of await account.parcels()) {
          const parcel = normalizeAccount(raw, { lang: this._bpostLang() });
          if (parcel.barcode) out.push(parcel);
        }
      } catch (error) {
        if (error.auth) this._account = null;
        throw error;
      }
      await this._refreshLetters(account);
    }
    const defaultPostcode = String(this.getSetting('postal_code') || '').trim();
    const keep = {};
    for (const entry of this.trackedEntries()) {
      if (out.some(p => p.barcode === entry.code) || this.wasDelivered(entry.code)) continue;
      const postcode = entry.postcode || defaultPostcode;
      const cached = this._raw[entry.code];
      if (this._parcels[entry.code]?.delivered && cached) { keep[entry.code] = cached; out.push(normalizeTracked(cached, { barcode: entry.code, postalCode: postcode, lang: this._bpostLang() })); continue; }
      try {
        const raw = await fetchItem(entry.code, postcode);
        const use = raw || cached || null;
        if (use) keep[entry.code] = use;
        out.push({ ...normalizeTracked(use, { barcode: entry.code, postalCode: postcode, lang: this._bpostLang() }), direction: entry.direction });
      } catch (error) {
        if (error.status === 429) throw error;
        this.error('[bpost]', entry.code, error.message);
        if (cached) { keep[entry.code] = cached; out.push(normalizeTracked(cached, { barcode: entry.code, postalCode: postcode, lang: this._bpostLang() })); }
      }
    }
    this._raw = keep;
    await this.setStoreValue('bpost_raw_cache', keep).catch(this.error);
    return out;
  }

  async _refreshLetters(account) {
    let letters;
    try { letters = await account.letters(); } catch (error) {
      if (error.auth) throw error;
      this.error('[bpost] Mail Ahead failed:', error.message);
      return;
    }
    const known = this._letters ? new Set(this._letters.map(l => l.id)) : null;
    if (known) {
      for (const letter of letters.filter(l => !known.has(l.id))) {
        await this.homey.flow.getDeviceTriggerCard('bpost_letter_announced').trigger(this, {
          sender: letter.sender || '', date: this._date(letter.plannedDelivery || letter.date), image_url: letter.imageUrl || '', letter_count: letters.length,
        }, {}).catch(error => this.error('[bpost] letter trigger', error.message));
      }
    }
    this._letters = letters.map(({ id, date, plannedDelivery, sender, imageUrl }) => ({ id, date, plannedDelivery, sender, imageUrl }));
    await this.setStoreValue('bpost_letters', this._letters).catch(this.error);
  }

  async updateExtraCapabilities({ text }) {
    const letters = this._letters || [];
    await this._set('bpost_letter_count', letters.length);
    const last = letters[0];
    await this._set('bpost_last_letter', text(last ? `${this._date(last.plannedDelivery || last.date)} ${last.sender || ''}`.trim() : ''));
    await this._set('bpost_partner', text(''));
  }

  async onRefreshed() {
    const label = this.homey.app?.getConnectionLabel?.(this.isConnected());
    if (label) await this._set('bpost_account_status', label);
  }

  async onAuthFailure() {
    this._account = null;
    const label = this.homey.app?.getConnectionLabel?.(false);
    if (label) await this._set('bpost_account_status', label);
  }

  extraTokens(parcel) {
    return { delivery_point: parcel.pickupPoint || '', product: parcel.product || '', partner: '' };
  }

  getWidgetData() {
    const data = super.getWidgetData();
    return { ...data, letters: this._letters || [] };
  }
}

module.exports = BpostDevice;
