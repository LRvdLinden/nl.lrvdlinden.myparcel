'use strict';

const Homey = require('homey');
const { BolSessionClient } = require('../../lib/bol-session');

module.exports = class AmpereDevice extends Homey.Device {
  async onInit() {
    this._parcels = this.getStoreValue('ampere_snapshot') || [];
    this._refreshing = null;
    this._timer = this.homey.setInterval(() => this.refresh(false).catch(error => this.error(error)), 10 * 60 * 1000);

    // A freshly paired helper code has already been verified in the browser.
    // Do not make the device unavailable before the first Homey-side refresh has
    // even had a chance to use the helper-captured Ampère URLs.
    if (this._sessionCode() || this._manualUrl()) {
      await this.setAvailable().catch(() => {});
      await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.connected')).catch(() => {});
    }
    this.homey.setTimeout(() => this.refresh(true).catch(error => this.error(error)), 3000);
  }

  async onDeleted() {
    if (this._timer) this.homey.clearInterval(this._timer);
  }

  async updateSession() {
    await this.setStoreValue('ampereAuthNotice', false);
    await this.setStoreValue('ampereLiveAuthFailures', 0);
    await this.setAvailable().catch(() => {});
    await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.connected')).catch(() => {});
    return this.refresh(true);
  }

  async _authNotice() {
    if (this.getStoreValue('ampereAuthNotice')) return;
    await this.homey.notifications.createNotification({
      excerpt: 'Reconnect bol.com for Ampère in MyParcel. Open Bol.com Homey Login Helper 0.3.2, sign in again and paste the new session code via Repair.',
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

        // Helper 0.3.2 places Ampère links discovered in the authenticated
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
        if (client) parcels.push(await client.fetchAmpereParcel(url));
        else parcels.push({
          id: url,
          tracking: url.split('/').filter(Boolean).at(-1) || '',
          sender: 'bol.com',
          status: 'Ampère',
          deliveryDate: '',
          deliveryWindow: '',
          updatedAt: new Date().toISOString(),
          detailsUrl: url,
          delivered: false,
          carrier: 'ampere',
        });
      }

      parcels.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      this._parcels = parcels;
      await this.setStoreValue('ampere_snapshot', parcels);
      await this.setAvailable().catch(() => {});

      // Do not immediately invalidate a helper-verified browser session merely
      // because Homey's Node fetch is redirected/challenged by bol.com. Only use
      // that as a reconnect hint after repeated failures and when the helper did
      // not capture any Ampère URL at all.
      if (liveAuthError && !urls.size && sessionCode) {
        const failures = Number(this.getStoreValue('ampereLiveAuthFailures') || 0) + 1;
        await this.setStoreValue('ampereLiveAuthFailures', failures);
        this.log('[AmpereDevice] live bol.com refresh unavailable', failures, liveAuthError.message);
        if (failures >= 3) {
          await this._authNotice().catch(() => {});
          await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.disconnected')).catch(() => {});
        } else {
          await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.connected')).catch(() => {});
        }
      } else {
        await this.setStoreValue('ampereLiveAuthFailures', 0);
        await this.setStoreValue('ampereAuthNotice', false);
        await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.connected')).catch(() => {});
      }

      const active = parcels.filter(parcel => !parcel.delivered);
      const latest = active[0] || parcels[0] || null;
      await this.setCapabilityValue('ampere_parcel_count', active.length);
      await this.setCapabilityValue('ampere_status', latest?.status || this.homey.__('common_status.connected'));
      await this.setCapabilityValue('ampere_last_update', new Date().toISOString());
      return true;
    } catch (error) {
      this.error('[AmpereDevice] refresh failed', error);
      const invalidConfiguration = error?.code === 'AUTH_REAUTH_REQUIRED' && !sessionCode && !manualUrl;
      if (invalidConfiguration) {
        await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.disconnected')).catch(() => {});
        await this.setCapabilityValue('ampere_status', this.homey.__('common_status.disconnected')).catch(() => {});
        await this.setUnavailable('Connect bol.com with Bol.com Homey Login Helper 0.3.2').catch(() => {});
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
