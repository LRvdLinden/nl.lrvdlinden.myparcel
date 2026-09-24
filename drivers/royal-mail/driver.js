'use strict';
const Homey = require('homey');
const crypto = require('crypto');
const { RoyalMailApi } = require('../../lib/royal-mail-api');

module.exports = class RoyalMailDriver extends Homey.Driver {
  async onInit() {
    this.homey.flow.getConditionCard('royal_mail_packages_underway')
      .registerRunListener(async ({ device }) => (device.getCapabilityValue('royal_mail_parcel_count') || 0) > 0);
    this.homey.flow.getActionCard('royal_mail_refresh')
      .registerRunListener(async ({ device }) => device.refresh(true));
  }

  async onPair(session) {
    session.setHandler('connect', async ({ apiKey }) => {
      const key = String(apiKey || '').trim();
      if (!key) throw new Error('Enter the Royal Mail Click & Drop API key.');
      const api = new RoyalMailApi({ apiKey: key });
      await api.version();
      await api.orders({ days: 7, pageSize: 1 });
      const id = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
      return { device: {
        name: 'Royal Mail',
        data: { id: `royal-mail-${id}` },
        settings: { api_key: key, discovery_days: 30 },
        capabilities: ['royal_mail_parcel_count','royal_mail_status','royal_mail_last_update'],
      }};
    });
  }

  async onRepair(session) {
    session.setHandler('connect', async ({ apiKey }) => {
      const device = session.getDevice();
      const key = String(apiKey || device.getSettings().api_key || '').trim();
      const api = new RoyalMailApi({ apiKey: key });
      await api.version();
      await api.orders({ days: 7, pageSize: 1 });
      await device.setSettings({ api_key: key });
      await device.setStoreValue('authExpiredNotified', false);
      await device.setAvailable();
      await device.refresh(true);
      return true;
    });
  }
};
