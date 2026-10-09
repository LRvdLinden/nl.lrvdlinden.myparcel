'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const DHLExpressAccountApi = require('../../lib/dhl-express-account');
const { decodeBundle } = require('../../lib/dhl-express-session');
const { STATUS, parseTrackingList, formatTrackingList, isExpressAwb } = require('../../lib/dhl-tracking');
const { registerDhlFlowCards } = require('../../lib/dhl-flow');

function stableId(value) { return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex').slice(0, 24); }

module.exports = class DHLExpressDriver extends Homey.Driver {
  async onInit() {
    registerDhlFlowCards(this.homey, {
      conditions: {
        dhl_express_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        dhl_express_is_connected: ({ device }) => device.isConnected(),
        dhl_express_delivery_window_known: ({ device }) => device.hasDeliveryWindow(),
        dhl_express_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        dhl_express_any_status_is: ({ device, status }) => device.hasStatus(status),
        dhl_express_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        dhl_express_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
        dhl_express_outgoing_underway: ({ device }) => device.hasOutgoingUnderway(),
      },
      autocomplete: { dhl_express_parcel_is_delivered: 'tracking', dhl_express_untrack_parcel: 'tracking' },
      actions: {
        dhl_express_refresh: ({ device }) => device.refresh(true).then(() => true),
        dhl_express_track_parcel: ({ device, tracking, direction }) => device.trackParcel(tracking, direction || 'incoming'),
        dhl_express_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        dhl_express_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  _nl() { return this.homey.i18n.getLanguage() === 'nl'; }

  async _validateDirect(email, password, otp = '') {
    const api = new DHLExpressAccountApi({ fetch, email, password, otp, log: (...args) => this.log('[DHLExpressPair]', ...args) });
    await api.login();
    await api.getParcels();
  }

  _awbList(text) {
    const entries = parseTrackingList(text || '');
    const wrong = entries.filter(entry => !isExpressAwb(entry.code));
    if (wrong.length) {
      throw new Error(this._nl()
        ? `Geen DHL Express-luchtvrachtbriefnummer (10 cijfers): ${wrong.map(e => e.code).join(', ')}`
        : `Not a DHL Express air waybill (10 digits): ${wrong.map(e => e.code).join(', ')}`);
    }
    return entries;
  }

  async onPair(session) {
    session.setHandler('track_awb', async ({ tracking } = {}) => {
      const entries = this._awbList(tracking);
      if (!entries.length) throw new Error(this._nl() ? 'Vul minstens één luchtvrachtbriefnummer in.' : 'Enter at least one air waybill number.');
      return {
        device: {
          name: 'DHL Express',
          data: { id: `dhl-express-awb-${crypto.randomBytes(8).toString('hex')}` },
          settings: { tracking_numbers: formatTrackingList(entries), delivered_days: 7 },
          store: { auth_mode: 'tracking', connected: true },
        },
      };
    });

    session.setHandler('login_dhl_express', async ({ email, password, otp, tracking } = {}) => {
      const normalized = String(email || '').trim().toLowerCase();
      if (!normalized || !password) throw new Error(this._nl() ? 'Vul je DHL Express e-mailadres en wachtwoord in.' : 'Enter your DHL Express e-mail address and password.');
      const entries = this._awbList(tracking);
      await this._validateDirect(normalized, password, otp || '');
      return {
        device: {
          name: 'DHL Express',
          data: { id: `dhl-express-${stableId(normalized)}` },
          settings: { tracking_numbers: formatTrackingList(entries), delivered_days: 7 },
          store: { auth_mode: 'direct', email: normalized, password: String(password), otp: '', connected: true },
        },
      };
    });

    session.setHandler('connect_helper', async ({ sessionCode, tracking } = {}) => {
      const code = String(sessionCode || '').trim();
      decodeBundle(code);
      const entries = this._awbList(tracking);
      return {
        device: {
          name: 'DHL Express',
          data: { id: `dhl-express-helper-${stableId(code)}` },
          settings: { tracking_numbers: formatTrackingList(entries), delivered_days: 7 },
          store: { auth_mode: 'helper', session_bundle: code, connected: false },
        },
      };
    });
  }

  async onRepair(session, device) {
    session.setHandler('login_dhl_express', async ({ email, password, otp } = {}) => {
      const normalized = String(email || '').trim().toLowerCase();
      await this._validateDirect(normalized, password, otp || '');
      await device.updateDirectCredentials(normalized, password);
      return { ok: true };
    });
    session.setHandler('connect_helper', async ({ sessionCode } = {}) => {
      const code = String(sessionCode || '').trim();
      decodeBundle(code);
      await device.updateHelperSession(code);
      return { ok: true };
    });
  }
};
