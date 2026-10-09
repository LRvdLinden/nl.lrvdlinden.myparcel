const localizePackageStatus = require('../../lib/status-i18n.js');
'use strict';
const Homey = require('homey');
const { RoyalMailApi } = require('../../lib/royal-mail-api');
const { formatDate } = require('../../lib/i18n');
const { t } = require('../../lib/messages-i18n');

function first(o, ...keys) {
  for (const key of keys) if (o && o[key] !== undefined && o[key] !== null && o[key] !== '') return o[key];
  return '';
}
function statusOf(o) {
  const s = first(o, 'status', 'orderStatus', 'statusDescription', 'orderStatusDescription');
  return typeof s === 'object' ? String(first(s, 'name', 'description', 'status') || 'Unknown') : String(s || 'Unknown');
}
function trackingOf(o) {
  const postage = o?.postageDetails || o?.shippingDetails || {};
  return String(first(o,'trackingNumber','tracking','shipmentTrackingNumber')
    || first(postage,'trackingNumber','tracking','shipmentTrackingNumber') || '');
}
function toParcel(o) {
  const status = statusOf(o);
  const tracking = trackingOf(o);
  const id = String(first(o,'orderIdentifier','orderId','orderReference') || tracking);
  const recipient = o?.recipient || o?.recipientDetails || {};
  const name = first(recipient,'name','fullName','companyName');
  const created = first(o,'createdDateTime','createdOn','createdAt','orderDate','despatchDate');
  const delivered = /delivered|cancelled|canceled|despatched by other courier/i.test(status);
  const updatedAt = first(o,'updatedDateTime','updatedAt','modifiedDateTime') || created || new Date().toISOString();
  return {
    id, tracking, reference: id,
    sender: 'Royal Mail', receiver: String(name || ''),
    status,
    deliveryDate: first(o,'despatchDate','plannedDespatchDate','shippingDate') || '',
    deliveryWindow: '',
    createdAt: String(created || ''),
    lastEvent: status, lastEventAt: String(updatedAt), updatedAt,
    delivered,
    detailsUrl: tracking ? `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(tracking)}` : '',
  };
}

module.exports = class RoyalMailDevice extends Homey.Device {
  async onInit() {
    this._packages = [];
    this._timer = this.homey.setInterval(() => this.refresh(false), 15 * 60 * 1000);
    this.homey.setTimeout(() => this.refresh(true), 3000);
  }
  async onDeleted() { if (this._timer) this.homey.clearInterval(this._timer); }

  async notifyAuth() {
    if (this.getStoreValue('authExpiredNotified') === true) return;
    await this.homey.notifications.createNotification({
      excerpt: t(this.homey, 'auth_notification', { carrier: 'Royal Mail', name: this.getName() }),
    }).catch(() => {});
    await this.setStoreValue('authExpiredNotified', true);
  }

  async refresh() {
    const s = this.getSettings();
    const api = new RoyalMailApi({ apiKey: s.api_key });
    try {
      const orders = await api.orders({ days: s.discovery_days || 30, pageSize: 100 });
      const rows = orders.map(toParcel).filter(p => p.id);

      const previous = new Map((this._packages || []).map(p => [p.id, p]));
      this._packages = rows;

      for (const p of rows) {
        const old = previous.get(p.id);
        const tokens = { tracking: p.tracking || p.id, status: localizePackageStatus(this.homey, p.status) || '' };
        if (!old) {
          await this.homey.flow.getDeviceTriggerCard('royal_mail_new_package').trigger(this, tokens, {}).catch(() => {});
        } else if (old.status !== p.status) {
          await this.homey.flow.getDeviceTriggerCard('royal_mail_status_changed')
            .trigger(this, { ...tokens, previous_status: localizePackageStatus(this.homey, old.status) || '' }, {}).catch(() => {});
        }
      }

      const active = rows.filter(p => !p.delivered).length;
      await this.setCapabilityValue('royal_mail_parcel_count', active);
      await this.setCapabilityValue('royal_mail_status', rows[0]?.status ? localizePackageStatus(this.homey, rows[0].status) : t(this.homey, 'no_recent_orders'));
      await this.setCapabilityValue('royal_mail_last_update', formatDate(this.homey, new Date(), { dateStyle: 'short', timeStyle: 'short' }, this.homey.clock.getTimezone()));
      await this.setStoreValue('authExpiredNotified', false);
      await this.setAvailable();
      return true;
    } catch (e) {
      if ([401,403].includes(e.status)) {
        await this.notifyAuth();
        await this.setUnavailable(t(this.homey, 'auth_unavailable', { carrier: 'Royal Mail' })).catch(() => {});
      }
      this.error(e);
      return false;
    }
  }

  getWidgetData() {
    return {
      parcels: this._packages || [],
      authenticated: this.getStoreValue('authExpiredNotified') !== true,
      carrier: 'royal-mail',
    };
  }
};
