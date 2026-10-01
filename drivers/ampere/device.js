'use strict';

const Homey = require('homey');
const { BolSessionClient } = require('../../lib/bol-session');
const localizePackageStatus = require('../../lib/status-i18n');

module.exports = class AmpereDevice extends Homey.Device {
  async onInit() {
    await this._ensureCapabilities();

    // Remove stale false positives from earlier 0.2.x/0.3.0 builds immediately.
    // A Dutch PostNL 3S barcode must never remain inside the Ampère device.
    const stored = Array.isArray(this.getStoreValue('ampere_snapshot')) ? this.getStoreValue('ampere_snapshot') : [];
    this._parcels = stored.filter(parcel => {
      const tracking = String(parcel?.tracking || parcel?.id || '').toUpperCase();
      return parcel?.carrier === 'ampere' && !/^3S[A-Z0-9]{8,}$/.test(tracking);
    });
    if (this._parcels.length !== stored.length) {
      await this.setStoreValue('ampere_snapshot', this._parcels).catch(error => this.error('Could not clean Ampère snapshot', error));
    }

    this._refreshing = null;
    this._timer = this.homey.setInterval(() => this.refresh(false).catch(error => this.error(error)), 10 * 60 * 1000);

    if (this._sessionCode() || this._manualUrl()) {
      await this.setAvailable().catch(() => {});
      await this.setStoreValue('ampereConnected', true);
      await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.connected')).catch(() => {});
    }
    this.homey.setTimeout(() => this.refresh(true).catch(error => this.error(error)), 3000);
  }

  async onDeleted() {
    if (this._timer) this.homey.clearInterval(this._timer);
  }

  async _ensureCapabilities() {
    const capabilities = [
      'ampere_parcel_count',
      'ampere_total_count',
      'ampere_status',
      'ampere_tracking',
      'ampere_sender',
      'ampere_delivery_date',
      'ampere_delivery_window',
      'ampere_window_start',
      'ampere_window_end',
      'ampere_delivered',
      'ampere_details_url',
      'myparcel_connection_status',
      'ampere_last_update',
    ];
    for (const capability of capabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability).catch(error => this.error(`Could not add ${capability}`, error));
      }
    }
  }

  _formatDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnly && !/[T ]\d{2}:\d{2}/.test(raw)) return `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      if (dateOnly) return `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`;
      return raw;
    }
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.homey.clock.getTimezone(),
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('day')}-${get('month')}-${get('year')}`;
  }

  _formatTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const timeOnly = raw.match(/^(\d{1,2}):(\d{2})/);
    if (timeOnly && !/[T ]/.test(raw)) return `${String(timeOnly[1]).padStart(2, '0')}:${timeOnly[2]}`;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.homey.clock.getTimezone(),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('hour')}:${get('minute')}`;
  }

  _deliveryWindow(parcel) {
    if (!parcel) return '';
    const from = this._formatTime(parcel.deliveryWindowFrom);
    const to = this._formatTime(parcel.deliveryWindowTo);
    if (from || to) return [from, to].filter(Boolean).join(' - ');
    return String(parcel.deliveryWindow || '').trim();
  }

  _latestParcel() {
    const parcels = Array.isArray(this._parcels) ? this._parcels : [];
    return parcels.find(parcel => !parcel.delivered) || parcels[0] || null;
  }

  _flowTokens(parcel, parcels = this._parcels || []) {
    const active = parcels.filter(item => !item.delivered);
    return {
      carrier: 'Ampère',
      tracking: String(parcel?.tracking || parcel?.id || ''),
      sender: String(parcel?.sender || 'bol.com'),
      status: localizePackageStatus(this.homey, parcel?.status || '') || String(parcel?.status || ''),
      delivery_date: this._formatDate(parcel?.deliveryDate),
      delivery_window: this._deliveryWindow(parcel),
      window_start: this._formatTime(parcel?.deliveryWindowFrom),
      window_end: this._formatTime(parcel?.deliveryWindowTo),
      delivered: Boolean(parcel?.delivered),
      track_url: String(parcel?.detailsUrl || ''),
      active_count: active.length,
      total_count: parcels.length,
      last_update: this._formatDateTime(new Date()),
    };
  }

  async _triggerChanges(previous, current) {
    for (const parcel of current) {
      const key = String(parcel.tracking || parcel.id || '');
      const old = previous.get(key);
      const tokens = this._flowTokens(parcel, current);

      if (!old) {
        await this.homey.flow.getDeviceTriggerCard('ampere_new_package').trigger(this, tokens, {}).catch(() => {});
        continue;
      }

      if (String(old.status || '') !== String(parcel.status || '')) {
        await this.homey.flow.getDeviceTriggerCard('ampere_status_changed').trigger(this, {
          previous_status: localizePackageStatus(this.homey, old.status || '') || String(old.status || ''),
          ...tokens,
        }, {}).catch(() => {});
      }

      const deliveryChanged = (
        String(old.deliveryDate || '') !== String(parcel.deliveryDate || '')
        || String(old.deliveryWindow || '') !== String(parcel.deliveryWindow || '')
        || String(old.deliveryWindowFrom || '') !== String(parcel.deliveryWindowFrom || '')
        || String(old.deliveryWindowTo || '') !== String(parcel.deliveryWindowTo || '')
      ) && Boolean(parcel.deliveryDate || parcel.deliveryWindow || parcel.deliveryWindowFrom || parcel.deliveryWindowTo);

      if (deliveryChanged) {
        await this.homey.flow.getDeviceTriggerCard('ampere_delivery_updated').trigger(this, tokens, {}).catch(() => {});
      }

      const windowChanged = (
        String(old.deliveryWindow || '') !== String(parcel.deliveryWindow || '')
        || String(old.deliveryWindowFrom || '') !== String(parcel.deliveryWindowFrom || '')
        || String(old.deliveryWindowTo || '') !== String(parcel.deliveryWindowTo || '')
      ) && Boolean(parcel.deliveryWindow || parcel.deliveryWindowFrom || parcel.deliveryWindowTo);

      if (windowChanged) {
        await this.homey.flow.getDeviceTriggerCard('ampere_delivery_window_changed').trigger(this, tokens, {}).catch(() => {});
      }

      if (parcel.delivered && !old.delivered) {
        await this.homey.flow.getDeviceTriggerCard('ampere_delivered').trigger(this, tokens, {}).catch(() => {});
      }
    }
  }

  hasPackagesUnderway() {
    return (this._parcels || []).some(parcel => !parcel.delivered);
  }

  hasDeliveryWindow() {
    const parcel = this._latestParcel();
    return Boolean(parcel && (parcel.deliveryWindow || parcel.deliveryWindowFrom || parcel.deliveryWindowTo));
  }

  isLatestDelivered() {
    return Boolean(this._latestParcel()?.delivered);
  }

  isConnected() {
    return this.getStoreValue('ampereConnected') === true;
  }

  async updateSession() {
    await this.setStoreValue('ampereAuthNotice', false);
    await this.setStoreValue('ampereLiveAuthFailures', 0);
    await this.setAvailable().catch(() => {});
    await this.setStoreValue('ampereConnected', true);
    await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.connected')).catch(() => {});
    return this.refresh(true);
  }

  async _authNotice() {
    if (this.getStoreValue('ampereAuthNotice')) return;
    await this.homey.notifications.createNotification({
      excerpt: 'Reconnect bol.com for Ampère in MyParcel. Open Bol.com Homey Login Helper 0.3.1, sign in again and paste the new session code via Repair.',
    }).catch(() => {});
    await this.setStoreValue('ampereAuthNotice', true);
  }

  _manualUrl() {
    const url = String(this.getSetting('tracking_url') || '').trim();
    return /^https:\/\/bol\.prd\.amperebezorgt\.nl(?:\/|$)/i.test(url) ? url : '';
  }

  _sessionCode() {
    return String(this.getSetting('bol_session_bundle') || '').trim();
  }

  _formatDateTime(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const timeZone = this.homey.clock.getTimezone();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
  }

  async refresh(force = false) {
    if (this._refreshing && !force) return this._refreshing;
    this._refreshing = this._refresh().finally(() => { this._refreshing = null; });
    return this._refreshing;
  }

  async _refresh() {
    const sessionCode = this._sessionCode();
    const manualUrl = this._manualUrl();
    const urls = new Set();
    let configured = false;
    let client = null;
    let liveAuthError = null;

    try {
      const previous = new Map((this._parcels || []).map(parcel => [String(parcel.tracking || parcel.id || ''), parcel]));
      if (sessionCode) {
        configured = true;
        client = new BolSessionClient({
          sessionCode,
          fetchFn: fetch,
          log: (...args) => this.log(...args),
          onBundleUpdated: async updatedCode => {
            if (updatedCode && updatedCode !== this._sessionCode()) await this.setSettings({ bol_session_bundle: updatedCode });
          },
        });

        // Helper 0.3.1 places Ampère links discovered in the authenticated
        // bol.com orders page directly in the bundle. Use those first. A
        // server-side replay of the consumer browser session is best-effort only.
        const discovery = await client.discoverAmpereUrls({ tolerateAuthFailure: true });
        for (const url of discovery.urls || []) urls.add(url);
        liveAuthError = discovery.liveError || null;
      }

      if (manualUrl) {
        configured = true;
        urls.add(manualUrl);
      }

      if (!configured) {
        const error = new Error('Bol.com session code or Ampère Track & Trace URL required.');
        error.code = 'AUTH_REAUTH_REQUIRED';
        throw error;
      }

      const parcels = [];
      for (const url of [...urls].slice(0, 25)) {
        // Every candidate must be verified as an actual Ampère shipment.
        // This prevents bol.com/PostNL orders from leaking into the Ampère device.
        const verifier = client || new BolSessionClient({
          sessionCode: sessionCode || this._sessionCode(),
          fetchFn: fetch,
          log: (...args) => this.log(...args),
        });
        const parcel = await verifier.fetchAmpereParcel(url);
        if (parcel && parcel.carrier === 'ampere') parcels.push(parcel);
      }

      parcels.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      await this._triggerChanges(previous, parcels);
      this._parcels = parcels;
      await this.setStoreValue('ampere_snapshot', parcels);
      await this.setAvailable().catch(() => {});

      // A bol.com consumer browser session may be accepted in Chrome but rejected
      // when replayed by Homey's Node runtime (anti-bot/login challenge). That is
      // not proof that the captured session is invalid. Keep the device available
      // and connected; helper-captured Ampère URLs remain the authoritative source.
      if (liveAuthError && sessionCode) {
        const failures = Number(this.getStoreValue('ampereLiveAuthFailures') || 0) + 1;
        await this.setStoreValue('ampereLiveAuthFailures', failures);
        this.log('[AmpereDevice] live bol.com replay unavailable; keeping verified helper session', failures, liveAuthError.message);
      } else {
        await this.setStoreValue('ampereLiveAuthFailures', 0);
      }
      await this.setStoreValue('ampereAuthNotice', false);
      await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.connected')).catch(() => {});

      const active = parcels.filter(parcel => !parcel.delivered);
      const latest = active[0] || parcels[0] || null;
      const values = {
        ampere_parcel_count: active.length,
        ampere_total_count: parcels.length,
        ampere_status: latest?.status ? (localizePackageStatus(this.homey, latest.status) || latest.status) : this.homey.__('common_status.connected'),
        ampere_tracking: String(latest?.tracking || latest?.id || ''),
        ampere_sender: String(latest?.sender || ''),
        ampere_delivery_date: this._formatDate(latest?.deliveryDate),
        ampere_delivery_window: this._deliveryWindow(latest),
        ampere_window_start: this._formatTime(latest?.deliveryWindowFrom),
        ampere_window_end: this._formatTime(latest?.deliveryWindowTo),
        ampere_delivered: Boolean(latest?.delivered),
        ampere_details_url: String(latest?.detailsUrl || ''),
        ampere_last_update: this._formatDateTime(new Date()),
      };
      for (const [capability, value] of Object.entries(values)) {
        if (this.hasCapability(capability)) await this.setCapabilityValue(capability, value).catch(error => this.error(capability, error));
      }
      await this.setStoreValue('ampereConnected', true);
      return true;
    } catch (error) {
      this.error('[AmpereDevice] refresh failed', error);
      const invalidConfiguration = error?.code === 'AUTH_REAUTH_REQUIRED' && !sessionCode && !manualUrl;
      if (invalidConfiguration) {
        await this.setStoreValue('ampereConnected', false);
        await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.disconnected')).catch(() => {});
        await this.setCapabilityValue('ampere_status', this.homey.__('common_status.disconnected')).catch(() => {});
        await this.setUnavailable('Connect bol.com with Bol.com Homey Login Helper 0.3.1').catch(() => {});
      } else {
        // Keep an already paired device available on transient web/API failures.
        await this.setAvailable().catch(() => {});
      }
      return false;
    }
  }

  getWidgetData() {
    return {
      parcels: this._parcels || [],
      authenticated: this.getCapabilityValue('myparcel_connection_status') === this.homey.__('common_status.connected'),
      carrier: 'ampere',
    };
  }
};
