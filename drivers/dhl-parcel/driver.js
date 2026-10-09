'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const { DhlNlClient, parseTrackingList, formatTrackingList, STATUS } = require('../../lib/dhl-tracking');
const { registerDhlFlowCards } = require('../../lib/dhl-flow');

module.exports = class DHLParcelDriver extends Homey.Driver {
  async onInit() {
    registerDhlFlowCards(this.homey, {
      conditions: {
        is_delivered: ({ device }) => device.allDelivered(),
        dhl_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        dhl_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        dhl_ready_for_pickup_now: ({ device }) => device.hasStatus(STATUS.AT_PICKUP_POINT),
        dhl_any_status_is: ({ device, status }) => device.hasStatus(status),
        dhl_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        dhl_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
        dhl_outgoing_underway: ({ device }) => device.hasOutgoingUnderway(),
      },
      autocomplete: { dhl_parcel_is_delivered: 'tracking', dhl_untrack_parcel: 'tracking' },
      actions: {
        refresh_shipment: ({ device }) => device.refresh(true).then(() => true),
        dhl_track_parcel: ({ device, tracking, direction }) => device.trackParcel(tracking, direction || 'incoming'),
        dhl_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        dhl_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  async _validate({ email, password, tracking }) {
    const mail = String(email || '').trim();
    const pass = String(password || '');
    const entries = parseTrackingList(tracking || '');
    if (!mail && !pass && !entries.length) throw new Error(this.homey.i18n.getLanguage() === 'nl'
      ? 'Vul je My DHL-account in, of minstens één trackingnummer.'
      : 'Enter your My DHL account, or at least one tracking number.');
    if (mail || pass) {
      const client = new DhlNlClient({ email: mail, password: pass });
      await client.login();
      await client.getParcels();
    }
    return { email: mail, password: pass, entries };
  }

  async onPair(session) {
    session.setHandler('login_dhl', async (data = {}) => {
      const { email, password, entries } = await this._validate(data);
      const key = email ? email.toLowerCase() : `tracking-${crypto.randomBytes(6).toString('hex')}`;
      const stable = crypto.createHash('sha256').update(key).digest('hex').slice(0, 24);
      return {
        device: {
          name: email ? 'DHL' : 'DHL Track & Trace',
          data: { id: `dhl-parcel-${stable}` },
          settings: { tracking_numbers: formatTrackingList(entries), delivered_days: 7 },
          store: { email, password, authExpiredNotified: false },
        },
      };
    });
  }

  async onRepair(session, device) {
    session.setHandler('repair_login', async ({ email, password } = {}) => {
      const result = await this._validate({ email, password, tracking: device.getSetting('tracking_numbers') || '' });
      await device.updateCredentials(result.email, result.password);
      return { ok: true };
    });
  }
};
