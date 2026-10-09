'use strict';

const Homey = require('homey');
const { t, localizeSession } = require('../../lib/messages-i18n');
const { language } = require('../../lib/i18n');
const crypto = require('crypto');
const { authorizationUrl, parseCallback, exchangeCode, ACCOUNT_MARKETS, COUNTRIES } = require('../../lib/inpost-tracking');
const { simpleTrackingList } = require('../../lib/carrier-migrate');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');

const norm = v => String(v || '').trim().replace(/\s+/g, '').toUpperCase();

module.exports = class InPostDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        inpost_uk_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        inpost_uk_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        inpost_uk_ready_for_pickup_now: ({ device }) => device.hasStatus(STATUS.AT_PICKUP_POINT),
        inpost_uk_any_status_is: ({ device, status }) => device.hasStatus(status),
        inpost_uk_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        inpost_uk_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
      },
      autocomplete: { inpost_uk_parcel_is_delivered: 'tracking', inpost_uk_untrack_parcel: 'tracking' },
      actions: {
        inpost_uk_refresh: ({ device }) => device.refresh(true).then(() => true),
        inpost_uk_track_parcel: ({ device, tracking }) => device.trackParcel(tracking),
        inpost_uk_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        inpost_uk_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  _handlers(session, device = null) {
    localizeSession(this.homey, session, 'InPost');
    let oauth = null;
    const tracking = async data => {
      const codes = simpleTrackingList(data.trackingCodes, norm).map(e => e.code);
      const country = COUNTRIES.includes(String(data.country || '').toUpperCase()) ? String(data.country).toUpperCase() : 'GB';
      if (!codes.length) throw new Error(t(this.homey, 'enter_at_least_one', { carrier: 'InPost' }));
      if (device) {
        await device.setSettings({ tracking_numbers: codes.join('\n'), country });
        await device.refresh(true);
        return true;
      }
      return { device: { name: `InPost ${country === 'GB' ? 'UK' : country}`, data: { id: `inpost-uk-${crypto.randomBytes(8).toString('hex')}` }, settings: { tracking_numbers: codes.join('\n'), country, delivered_days: 7 } } };
    };
    session.setHandler('connect', tracking);
    session.setHandler('account_url', async ({ market } = {}) => {
      const m = ACCOUNT_MARKETS.includes(String(market || '').toUpperCase()) ? String(market).toUpperCase() : 'PL';
      oauth = { market: m, ...authorizationUrl(m, language(this.homey)) };
      return { url: oauth.url };
    });
    session.setHandler('account_login', async ({ callback, trackingCodes } = {}) => {
      if (!oauth) throw new Error(t(this.homey, 'start_first', { service: 'InPost' }));
      const code = parseCallback(callback, oauth.state);
      const result = await exchangeCode(code, oauth.verifier, oauth.market);
      oauth = null;
      if (device) {
        const phone = device.getStoreValue('inpost_phone');
        if (phone && phone !== result.phone) throw new Error(t(this.homey, 'different_account', { carrier: 'InPost' }));
        await device.updateAccount(result);
        return true;
      }
      const codes = simpleTrackingList(trackingCodes, norm).map(e => e.code);
      return {
        device: {
          name: `InPost ${result.market}`,
          data: { id: `inpost-account-${result.market}-${result.phone}` },
          settings: { tracking_numbers: codes.join('\n'), country: result.market, delivered_days: 7 },
          store: { inpost_access_token: result.accessToken, inpost_refresh_token: result.refreshToken, inpost_market: result.market, inpost_phone: result.phone, inpost_auth_method: 'sso' },
        },
      };
    });
  }

  async onPair(session) { this._handlers(session); }

  async onRepair(session, device) { this._handlers(session, device); }
};
