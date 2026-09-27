'use strict';

const Homey = require('homey');
const { DpdApi } = require('../../lib/dpd-api');

const CAPABILITIES = [
  'dpd_parcel_count',
  'dpd_total_count',
  'dpd_status',
  'dpd_tracking',
  'dpd_sender',
  'dpd_receiver',
  'dpd_delivery_date',
  'dpd_delivery_window',
  'dpd_delivery_point',
  'dpd_weight',
  'dpd_dimensions',
  'dpd_delivery_type',
  'dpd_last_event',
  'dpd_direction',
  'myparcel_connection_status',
  'dpd_last_update',
];

module.exports = class DpdDriver extends Homey.Driver {
  async onInit() {
    this.homey.flow.getConditionCard('dpd_packages_underway').registerRunListener(
      async ({ device }) => (device.getCapabilityValue('dpd_parcel_count') || 0) > 0,
    );
    this.homey.flow.getActionCard('dpd_refresh').registerRunListener(async ({ device }) => device.refresh(true));
  }

  async onPair(session) {
    session.setHandler('login', async ({ email, password }) => {
      const api = new DpdApi(email, password);
      await api.login();
      return {
        device: {
          name: 'DPD',
          data: { id: `dpd-${email.toLowerCase()}` },
          settings: { email, password, bu: 'DPD-NL' },
          capabilities: CAPABILITIES,
        },
      };
    });
  }

  async onRepair(session) {
    session.setHandler('login', async ({ email, password }) => {
      const api = new DpdApi(email, password);
      await api.login();
      const device = session.getDevice();
      await device.setSettings({ email, password, bu: 'DPD-NL' });
      await device.setAvailable();
      await device.refresh(true);
      return true;
    });
  }
};
