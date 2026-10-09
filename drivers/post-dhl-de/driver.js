'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const API = require('../../lib/post-dhl-de-api');
const { STATUS, DhlDeSession, DhlDeClient, parseDeRedirect, parseTrackingList, formatTrackingList } = require('../../lib/dhl-tracking');
const { registerDhlFlowCards } = require('../../lib/dhl-flow');

function stable(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24); }

module.exports = class PostDhlDeDriver extends Homey.Driver {
  async onInit() {
    registerDhlFlowCards(this.homey, {
      conditions: {
        dhl_de_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        dhl_de_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        dhl_de_ready_for_pickup_now: ({ device }) => device.hasStatus(STATUS.AT_PICKUP_POINT),
        dhl_de_any_status_is: ({ device, status }) => device.hasStatus(status),
        dhl_de_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        dhl_de_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
        dhl_de_outgoing_underway: ({ device }) => device.hasOutgoingUnderway(),
      },
      autocomplete: { dhl_de_parcel_is_delivered: 'tracking', dhl_de_untrack_parcel: 'tracking' },
      actions: {
        dhl_de_refresh: ({ device }) => device.refresh(true).then(() => true),
        dhl_de_track_parcel: ({ device, tracking, direction }) => device.trackParcel(tracking, direction || 'incoming'),
        dhl_de_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        dhl_de_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  _handlers(session, device = null) {
    let pkce = null;
    let de = null;

    // Post & DHL app login (works from any country)
    session.setHandler('get_auth_url', async () => {
      pkce = API.createPkce();
      return { url: API.authUrl(pkce) };
    });
    const appLogin = async ({ callback } = {}) => {
      if (!pkce) throw new Error('Start the DHL login first.');
      const c = API.callback(callback);
      if (!c.code || c.state !== pkce.state) throw new Error('Invalid DHL login callback. Copy the complete address after signing in.');
      const api = new API();
      const tokens = await api.exchange(c.code, pkce.verifier);
      const info = await api.customer().catch(() => ({}));
      if (device) {
        await device.updateTokens(tokens, api.expiresAt);
        return { ok: true };
      }
      const key = String(info.postNumber || info.email || tokens.refreshToken || c.state);
      return {
        device: {
          name: 'Post & DHL Germany',
          data: { id: `post-dhl-de-${stable(key)}` },
          settings: { tracking_numbers: '', delivered_days: 7 },
          store: { login_mode: 'app', access_token: tokens.accessToken, refresh_token: tokens.refreshToken, expires_at: api.expiresAt, postnumber: info.postNumber || '' },
        },
      };
    };
    session.setHandler('login', appLogin);
    session.setHandler('repair', appLogin);

    // DHL.de login (ha-dhl) – needs a German IP address
    session.setHandler('get_dhlde_url', async () => {
      const s = new DhlDeSession();
      const { url, verifier, state } = await s.authorizationUrl();
      de = { session: s, verifier, state };
      return { url };
    });
    session.setHandler('login_dhlde', async ({ redirect, tracking } = {}) => {
      if (!de) throw new Error('Start the DHL.de login first.');
      const { code, state } = parseDeRedirect(redirect);
      if (!code) throw new Error('Paste the complete dhllogin://… address (it contains code=…).');
      if (state && state !== de.state) throw new Error('This sign-in belongs to an older attempt. Start the DHL.de login again.');
      const claims = await de.session.exchange(code, de.verifier);
      const refreshToken = de.session.refreshToken;
      await new DhlDeClient({ session: de.session }).getInbox(); // proves the account link and the German IP
      de = null;
      if (device) {
        await device.updateDhlDeLogin(refreshToken, claims.post_number);
        return { ok: true };
      }
      return {
        device: {
          name: 'Post & DHL Germany',
          data: { id: `post-dhl-de-${stable(claims.sub || claims.post_number || refreshToken)}` },
          settings: { tracking_numbers: formatTrackingList(parseTrackingList(tracking || '')), delivered_days: 7 },
          store: { login_mode: 'dhlde', dhl_de_refresh_token: refreshToken, postnumber: String(claims.post_number || '') },
        },
      };
    });
  }

  async onPair(session) { this._handlers(session); }

  async onRepair(session, device) { this._handlers(session, device); }
};
