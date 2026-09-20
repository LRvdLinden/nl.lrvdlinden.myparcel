'use strict';
const Homey = require('homey');
const { UpsApi } = require('../../lib/ups-api');

function trackingNumbers(settings) { try { const a = JSON.parse(settings.tracking_numbers_json || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
function activityOf(pkg) { const a = pkg?.activity; return Array.isArray(a) && a.length ? a[0] : {}; }
function parseShipment(data, fallbackTracking) {
  const ship = data?.trackResponse?.shipment?.[0] || data?.shipment?.[0] || data?.shipment || {};
  const pkg = (Array.isArray(ship.package) ? ship.package[0] : ship.package) || {};
  const act = activityOf(pkg);
  const status = pkg.currentStatus?.description || act.status?.description || ship.currentStatus?.description || 'Connected';
  const tracking = pkg.trackingNumber || ship.inquiryNumber || fallbackTracking;
  const deliveryDate = pkg.deliveryDate?.[0]?.date || pkg.deliveryTime?.endTime || '';
  const delivered = /delivered|bezorgd|zugestellt|livré|consegnato|entregado/i.test(String(status));
  return { id: tracking, tracking, sender: ship.shipmentAddress?.find?.(x => x.type === 'SHIPPER')?.name || 'UPS', status: String(status), deliveryDate, deliveryWindow: pkg.deliveryTime ? `${pkg.deliveryTime.startTime || ''}${pkg.deliveryTime.endTime ? ` - ${pkg.deliveryTime.endTime}` : ''}` : '', updatedAt: new Date().toISOString(), delivered, detailsUrl: `https://www.ups.com/track?tracknum=${encodeURIComponent(tracking)}` };
}
module.exports = class UpsDevice extends Homey.Device {
  async onInit() { this._packages = []; this._timer = this.homey.setInterval(() => this.refresh(false), 15 * 60 * 1000); this.homey.setTimeout(() => this.refresh(true), 3000); }
  async onDeleted() { if (this._timer) this.homey.clearInterval(this._timer); }
  async notifyAuth() { if (this.getStoreValue('authExpiredNotified') === true) return; await this.homey.notifications.createNotification({ excerpt: `Reconnect UPS – the credentials for ${this.getName()} have expired. Repair the UPS device.` }).catch(() => {}); await this.setStoreValue('authExpiredNotified', true); }
  async refresh() {
    const s = this.getSettings(); const nums = trackingNumbers(s);
    const api = new UpsApi({ clientId: s.client_id, clientSecret: s.client_secret, redirectUri: s.redirect_uri, accessToken: s.access_token, refreshToken: s.refresh_token });
    try {
      const rows = [];
      for (const n of nums) { try { rows.push(parseShipment(await api.track(n), n)); } catch (e) { if ([400, 401, 403].includes(e.status)) throw e; this.error(`UPS ${n}:`, e); } }
      if (api.accessToken !== s.access_token || api.refreshToken !== s.refresh_token) await this.setSettings({ access_token: api.accessToken, refresh_token: api.refreshToken });
      const previous=new Map((this._packages||[]).map(x=>[x.tracking,x])); this._packages = rows; for(const p of rows){const old=previous.get(p.tracking);const tokens={tracking:p.tracking||'',status:p.status||''};if(!old)await this.homey.flow.getDeviceTriggerCard('ups_new_package').trigger(this,tokens,{}).catch(()=>{});else if(old.status!==p.status)await this.homey.flow.getDeviceTriggerCard('ups_status_changed').trigger(this,{...tokens,previous_status:old.status||''},{}).catch(()=>{})}
      await this.setCapabilityValue('ups_parcel_count', rows.filter(x => !x.delivered).length);
      await this.setCapabilityValue('ups_status', rows[0]?.status || (nums.length ? 'Connected' : 'Connected – add tracking numbers during repair'));
      await this.setCapabilityValue('ups_last_update', new Date().toISOString());
      await this.setStoreValue('authExpiredNotified', false); await this.setAvailable(); return true;
    } catch (e) {
      if ([400, 401, 403].includes(e.status) || /oauth|token|auth|credential/i.test(e.message)) { await this.notifyAuth(); await this.setUnavailable('UPS authorization expired').catch(() => {}); }
      this.error(e); return false;
    }
  }
  getWidgetData() { return { parcels: this._packages || [], authenticated: this.getStoreValue('authExpiredNotified') !== true, carrier: 'ups' }; }
};