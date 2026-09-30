'use strict';

const Homey = require('homey');
const { BolSessionClient } = require('../../lib/bol-session');

module.exports = class AmpereDevice extends Homey.Device {
  async onInit() {
    this._parcels = this.getStoreValue('ampere_snapshot') || [];
    this._refreshing = null;
    this._timer = this.homey.setInterval(() => this.refresh(false).catch(error => this.error(error)), 10 * 60 * 1000);
    this.homey.setTimeout(() => this.refresh(true).catch(error => this.error(error)), 3000);
  }

  async onDeleted() {
    if (this._timer) this.homey.clearInterval(this._timer);
  }

  async updateSession() {
    await this.setStoreValue('ampereAuthNotice', false);
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  async _authNotice() {
    if (this.getStoreValue('ampereAuthNotice')) return;
    await this.homey.notifications.createNotification({
      excerpt: 'Reconnect bol.com for Ampère in MyParcel. Open Bol.com Homey Login Helper 0.3.0, sign in again and paste the new session code via Repair.',
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
    let connected = false;
    let client = null;

    try {
      if (sessionCode) {
        client = new BolSessionClient({
          sessionCode,
          fetchFn: fetch,
          log: (...args) => this.log(...args),
          onBundleUpdated: async updatedCode => {
            if (updatedCode && updatedCode !== this._sessionCode()) await this.setSettings({ bol_session_bundle: updatedCode });
          },
        });
        const discovered = await client.discoverAmpereUrls();
        for (const url of discovered) urls.add(url);
        connected = true;
      }
      if (manualUrl) {
        urls.add(manualUrl);
        connected = true;
      }
      if (!connected) {
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
      await this.setStoreValue('ampereAuthNotice', false);
      await this.setAvailable().catch(() => {});

      const active = parcels.filter(parcel => !parcel.delivered);
      const latest = active[0] || parcels[0] || null;
      await this.setCapabilityValue('ampere_parcel_count', active.length);
      await this.setCapabilityValue('ampere_status', latest?.status || this.homey.__('common_status.connected'));
      await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.connected')).catch(() => {});
      await this.setCapabilityValue('ampere_last_update', new Date().toISOString());
      return true;
    } catch (error) {
      const authExpired = error?.code === 'AUTH_REAUTH_REQUIRED' || [401, 403].includes(Number(error?.statusCode));
      this.error('[AmpereDevice] refresh failed', error);
      if (authExpired) {
        await this._authNotice().catch(() => {});
        await this.setCapabilityValue('myparcel_connection_status', this.homey.__('common_status.disconnected')).catch(() => {});
        await this.setCapabilityValue('ampere_status', this.homey.__('common_status.disconnected')).catch(() => {});
        await this.setUnavailable('Reconnect bol.com with Bol.com Homey Login Helper 0.3.0').catch(() => {});
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
