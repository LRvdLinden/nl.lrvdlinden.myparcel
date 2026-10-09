'use strict';

const Homey = require('homey');
const { t, localizeSession } = require('../../lib/messages-i18n');
const crypto = require('crypto');
const { BpostAccountClient } = require('../../lib/bpost-tracking');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');

function rows(text) {
  return String(text || '').split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => line.replace(/\|/g, ' ').replace(/\s+/g, ' '));
}

module.exports = class BpostDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        bpost_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        bpost_account_connected: ({ device }) => device.isConnected(),
        bpost_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        bpost_ready_for_pickup_now: ({ device }) => device.hasStatus(STATUS.AT_PICKUP_POINT),
        bpost_any_status_is: ({ device, status }) => device.hasStatus(status),
        bpost_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        bpost_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
        bpost_outgoing_underway: ({ device }) => device.hasOutgoingUnderway(),
      },
      autocomplete: { bpost_parcel_is_delivered: 'tracking', bpost_untrack_parcel: 'tracking' },
      actions: {
        bpost_refresh: ({ device }) => device.refresh(true).then(() => true),
        bpost_track_parcel: ({ device, tracking }) => device.trackParcel(tracking),
        bpost_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        bpost_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  async _login(email, password) {
    const mail = String(email || '').trim().toLowerCase();
    if (!mail || !password) throw new Error(t(this.homey, 'enter_email_password', { account: 'My bpost' }));
    const tokens = {};
    const client = new BpostAccountClient({ onTokens: t => Object.assign(tokens, t) });
    await client.login(mail, password);
    return { email: mail, tokens };
  }

  _handlers(session, device = null) {
    localizeSession(this.homey, session, 'bpost');
    session.setHandler('connect', async ({ email, password } = {}) => {
      const { email: mail, tokens } = await this._login(email, password);
      if (device) { await device.updateAccount(mail, tokens); return true; }
      return {
        device: {
          name: 'bpost',
          data: { id: `bpost-account-${crypto.createHash('sha1').update(mail).digest('hex').slice(0, 20)}` },
          settings: { account_email: mail, account_password: '', postal_code: '', tracking_numbers: '', delivered_days: 7 },
          store: { bpost_access_token: tokens.accessToken, bpost_refresh_token: tokens.refreshToken },
        },
      };
    });
    session.setHandler('manual_connect', async ({ trackingCodes, postalCode } = {}) => {
      const list = rows(trackingCodes);
      if (!list.length) throw new Error(t(this.homey, 'enter_at_least_one', { carrier: 'bpost' }));
      if (device) { await device.setSettings({ tracking_numbers: list.join('\n'), ...(postalCode ? { postal_code: String(postalCode).trim() } : {}) }); await device.refresh(true); return true; }
      return {
        device: {
          name: 'bpost',
          data: { id: `bpost-manual-${crypto.randomBytes(8).toString('hex')}` },
          settings: { account_email: '', account_password: '', postal_code: String(postalCode || '').trim(), tracking_numbers: list.join('\n'), delivered_days: 7 },
        },
      };
    });
  }

  async onPair(session) { this._handlers(session); }

  async onRepair(session, device) { this._handlers(session, device); }
};
