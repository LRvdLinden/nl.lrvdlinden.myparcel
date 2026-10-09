'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const { FedExClient, normalizeCode } = require('../../lib/fedex-tracking');
const { simpleTrackingList } = require('../../lib/carrier-migrate');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');

module.exports = class FedExDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        fedex_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        fedex_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        fedex_ready_for_pickup_now: ({ device }) => device.hasStatus(STATUS.AT_PICKUP_POINT),
        fedex_any_status_is: ({ device, status }) => device.hasStatus(status),
        fedex_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        fedex_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
      },
      autocomplete: { fedex_parcel_is_delivered: 'tracking', fedex_untrack_parcel: 'tracking' },
      actions: {
        fedex_refresh: ({ device }) => device.refresh(true).then(() => true),
        fedex_track_parcel: ({ device, tracking }) => device.trackParcel(tracking),
        fedex_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        fedex_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  async _validate(clientId, clientSecret) {
    const client = new FedExClient({ clientId, clientSecret });
    await client.token();
  }

  async onPair(session) {
    session.setHandler('login', async d => {
      const clientId = String(d.clientId || '').trim();
      const clientSecret = String(d.clientSecret || '');
      if (!clientId || !clientSecret) throw new Error('Client ID and Client Secret are required.');
      await this._validate(clientId, clientSecret);
      const codes = simpleTrackingList(d.trackingNumbers, normalizeCode).map(e => e.code);
      return {
        device: {
          name: 'FedEx',
          data: { id: `fedex-${crypto.createHash('sha1').update(clientId).digest('hex').slice(0, 16)}` },
          settings: { client_id: clientId, client_secret: clientSecret, tracking_numbers: codes.join('\n'), delivered_days: 7 },
        },
      };
    });
  }

  async onRepair(session) {
    session.setHandler('repair', async d => {
      const dev = session.getDevice();
      const clientId = String(d.clientId || dev.getSetting('client_id') || '').trim();
      const clientSecret = String(d.clientSecret || dev.getSetting('client_secret') || '');
      await this._validate(clientId, clientSecret);
      const codes = simpleTrackingList(d.trackingNumbers, normalizeCode).map(e => e.code);
      if (codes.length) await dev.setSettings({ tracking_numbers: codes.join('\n') });
      await dev.updateCredentials(clientId, clientSecret);
      return true;
    });
  }
};
