'use strict';

const Homey = require('homey');
const { VintedGoClient } = require('../../lib/vintedgo-tracking');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');

module.exports = class HomerrDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        homerr_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        homerr_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        homerr_ready_for_pickup_now: ({ device }) => device.hasStatus(STATUS.AT_PICKUP_POINT),
        homerr_any_status_is: ({ device, status }) => device.hasStatus(status),
        homerr_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        homerr_outgoing_underway: ({ device }) => device.hasOutgoingUnderway(),
      },
      autocomplete: { homerr_parcel_is_delivered: 'tracking' },
      actions: {
        homerr_refresh: ({ device }) => device.refresh(true).then(() => true),
        homerr_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  _handlers(session, device = null) {
    let email = '';
    session.setHandler('start_login', async d => {
      email = String(d.email || device?.getSetting('email') || '').trim();
      if (!email) throw new Error('Enter your Vinted Go e-mail address.');
      await VintedGoClient.register(email);
      return true;
    });
    session.setHandler('finish_login', async d => {
      const client = new VintedGoClient();
      await client.confirm(d.token);
      const me = await client.me();
      const userId = String(me?.user_id || '');
      if (device) {
        const expected = String(device.getData()?.id || '').replace(/^homerr-/, '');
        if (userId && expected && /^\d+$/.test(expected) && expected !== userId) throw new Error('This is a different Vinted Go account than the one this device belongs to.');
        await device.updateLogin(client.refreshToken, email);
        return true;
      }
      return { device: { name: 'Vinted Go', data: { id: `homerr-${userId || email.toLowerCase()}` }, settings: { email, delivered_days: 7 }, store: { refresh_token: client.refreshToken } } };
    });
  }

  async onPair(session) { this._handlers(session); }

  async onRepair(session, device) { this._handlers(session, device); }
};
