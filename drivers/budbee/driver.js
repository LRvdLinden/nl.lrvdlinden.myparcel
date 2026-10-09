'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const { BudbeeClient, normalizeCode } = require('../../lib/budbee-tracking');
const { simpleTrackingList } = require('../../lib/carrier-migrate');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');

module.exports = class BudbeeDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        budbee_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        budbee_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        budbee_ready_for_pickup_now: ({ device }) => device.hasStatus(STATUS.AT_PICKUP_POINT),
        budbee_any_status_is: ({ device, status }) => device.hasStatus(status),
        budbee_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        budbee_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
        budbee_outgoing_underway: ({ device }) => device.hasOutgoingUnderway(),
      },
      autocomplete: { budbee_parcel_is_delivered: 'tracking', budbee_untrack_parcel: 'tracking' },
      actions: {
        budbee_refresh: ({ device }) => device.refresh(true).then(() => true),
        budbee_track_parcel: ({ device, tracking }) => device.trackParcel(tracking),
        budbee_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        budbee_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  _codes(text) {
    const codes = simpleTrackingList(text, normalizeCode).map(e => e.code);
    if (!codes.length) throw new Error(this.homey.i18n.getLanguage() === 'nl' ? 'Vul minstens één Budbee-trackingcode in.' : 'Enter at least one Budbee tracking code.');
    return codes;
  }

  async onPair(session) {
    session.setHandler('connect', async data => {
      const codes = this._codes(data.trackingCodes);
      // Budbee may not know a fresh code yet; only reject codes it explicitly refuses.
      await new BudbeeClient().parcel(codes[0]).catch(error => { if (/HTTP 4\d\d/.test(error.message) && !/404/.test(error.message)) throw error; });
      return { device: { name: 'Budbee', data: { id: `budbee-${crypto.randomBytes(8).toString('hex')}` }, settings: { tracking_numbers: codes.join('\n'), delivered_days: 7 } } };
    });
  }

  async onRepair(session) {
    session.setHandler('connect', async data => {
      const codes = this._codes(data.trackingCodes);
      const d = session.getDevice();
      await d.setSettings({ tracking_numbers: codes.join('\n') });
      await d.setAvailable().catch(() => {});
      await d.refresh(true);
      return true;
    });
  }
};
