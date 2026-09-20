'use strict';

const AUTHORIZE_URL = 'https://onlinetools.ups.com/security/v1/oauth/authorize';
const TOKEN_URL = 'https://onlinetools.ups.com/security/v1/oauth/token';
const REFRESH_URL = 'https://onlinetools.ups.com/security/v1/oauth/refresh';
const TRACK_URL = 'https://onlinetools.ups.com/api/track/v1/details';

class UpsApiError extends Error {
  constructor(message, status = 0, body = null) {
    super(message);
    this.name = 'UpsApiError';
    this.status = status;
    this.body = body;
  }
}

function basic(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
}

async function jsonOrText(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch (_) { return { text }; }
}

class UpsApi {
  constructor({ clientId, clientSecret, redirectUri, accessToken, refreshToken }) {
    this.clientId = clientId || '';
    this.clientSecret = clientSecret || '';
    this.redirectUri = redirectUri || '';
    this.accessToken = accessToken || '';
    this.refreshToken = refreshToken || '';
  }

  authorizationUrl(state) {
    const u = new URL(AUTHORIZE_URL);
    u.searchParams.set('client_id', this.clientId);
    u.searchParams.set('redirect_uri', this.redirectUri);
    u.searchParams.set('response_type', 'code');
    if (state) u.searchParams.set('state', state);
    return u.toString();
  }

  async exchangeCode(code) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic(this.clientId, this.clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    const data = await jsonOrText(res);
    if (!res.ok || !data.access_token) throw new UpsApiError(data.error_description || data.response?.errors?.[0]?.message || 'UPS authorization failed', res.status, data);
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token || this.refreshToken;
    return data;
  }

  async refresh() {
    if (!this.refreshToken) throw new UpsApiError('UPS refresh token is missing', 401);
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken });
    const res = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic(this.clientId, this.clientSecret)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    const data = await jsonOrText(res);
    if (!res.ok || !data.access_token) throw new UpsApiError(data.error_description || 'UPS token refresh failed', res.status, data);
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token || this.refreshToken;
    return data;
  }

  async track(trackingNumber, locale = 'en_US') {
    const run = async () => {
      const url = `${TRACK_URL}/${encodeURIComponent(trackingNumber)}?locale=${encodeURIComponent(locale)}&returnSignature=false`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
          transId: `homey-${Date.now()}`.slice(0, 32),
          transactionSrc: 'MyParcelHomey',
        },
      });
      const data = await jsonOrText(res);
      return { res, data };
    };
    let { res, data } = await run();
    if (res.status === 401) {
      await this.refresh();
      ({ res, data } = await run());
    }
    if (!res.ok) throw new UpsApiError(data.response?.errors?.[0]?.message || `UPS Track HTTP ${res.status}`, res.status, data);
    return data;
  }
}

module.exports = { UpsApi, UpsApiError };
