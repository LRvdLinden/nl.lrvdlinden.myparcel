'use strict';
const Homey = require('homey');
const crypto = require('crypto');
const { UpsApi } = require('../../lib/ups-api');

function extractCode(value) {
  const text = String(value || '').trim();
  try { const u = new URL(text); return { code: u.searchParams.get('code') || '', state: u.searchParams.get('state') || '' }; }
  catch (_) { return { code: text, state: '' }; }
}
function parseTracking(value) {
  return [...new Set(String(value || '').split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean))];
}

module.exports = class UpsDriver extends Homey.Driver {
  async onInit() {
    this.homey.flow.getConditionCard('ups_packages_underway').registerRunListener(async ({ device }) => (device.getCapabilityValue('ups_parcel_count') || 0) > 0);
    this.homey.flow.getActionCard('ups_refresh').registerRunListener(async ({ device }) => device.refresh(true));
  }

  async onPair(session) {
    let pending = null;
    session.setHandler('prepare_auth', async data => {
      const clientId = String(data.clientId || '').trim();
      const clientSecret = String(data.clientSecret || '').trim();
      const redirectUri = String(data.redirectUri || '').trim();
      if (!clientId || !clientSecret || !redirectUri) throw new Error('Client ID, Client Secret and Redirect URI are required.');
      const state = crypto.randomBytes(18).toString('hex');
      const api = new UpsApi({ clientId, clientSecret, redirectUri });
      pending = { clientId, clientSecret, redirectUri, state, tracking: parseTracking(data.trackingNumbers) };
      return { url: api.authorizationUrl(state), state };
    });
    session.setHandler('finish_auth', async data => {
      if (!pending) throw new Error('Start the UPS login first.');
      const parsed = extractCode(data.callback || data.code);
      if (!parsed.code) throw new Error('No UPS authorization code found in the callback.');
      if (parsed.state && parsed.state !== pending.state) throw new Error('UPS OAuth state does not match. Start the login again.');
      const api = new UpsApi(pending);
      const tokens = await api.exchangeCode(parsed.code);
      const id = `ups-${crypto.createHash('sha1').update(`${pending.clientId}:${Date.now()}`).digest('hex').slice(0, 16)}`;
      return { device: {
        name: 'UPS My Choice',
        data: { id },
        settings: {
          client_id: pending.clientId,
          client_secret: pending.clientSecret,
          redirect_uri: pending.redirectUri,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || '',
          tracking_numbers_json: JSON.stringify(pending.tracking),
        },
        capabilities: ['ups_parcel_count', 'ups_status', 'ups_last_update'],
      }};
    });
  }

  async onRepair(session) {
    let pending = null;
    session.setHandler('prepare_auth', async data => {
      const d = session.getDevice(); const s = d.getSettings();
      const clientId = String(data.clientId || s.client_id || '').trim();
      const clientSecret = String(data.clientSecret || s.client_secret || '').trim();
      const redirectUri = String(data.redirectUri || s.redirect_uri || '').trim();
      if (!clientId || !clientSecret || !redirectUri) throw new Error('Client ID, Client Secret and Redirect URI are required.');
      const state = crypto.randomBytes(18).toString('hex');
      pending = { clientId, clientSecret, redirectUri, state, tracking: parseTracking(data.trackingNumbers || JSON.parse(s.tracking_numbers_json || '[]').join('\n')) };
      return { url: new UpsApi(pending).authorizationUrl(state), state };
    });
    session.setHandler('finish_auth', async data => {
      if (!pending) throw new Error('Start the UPS login first.');
      const parsed = extractCode(data.callback || data.code);
      if (!parsed.code) throw new Error('No UPS authorization code found.');
      if (parsed.state && parsed.state !== pending.state) throw new Error('UPS OAuth state does not match.');
      const api = new UpsApi(pending); const tokens = await api.exchangeCode(parsed.code); const d = session.getDevice();
      await d.setSettings({ client_id: pending.clientId, client_secret: pending.clientSecret, redirect_uri: pending.redirectUri, access_token: tokens.access_token, refresh_token: tokens.refresh_token || '', tracking_numbers_json: JSON.stringify(pending.tracking) });
      await d.setAvailable(); await d.refresh(true); return true;
    });
  }
};