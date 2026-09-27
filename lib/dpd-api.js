'use strict';

const KC = 'https://login.dpdgroup.com/auth/realms/login/protocol/openid-connect/token';
const BASE = 'https://www.dpdgroup.com/concept/webservice';
const BASIC = 'bXlEUEQgTW9iaWxlIEFwcDpaMVdzeTQ4RGpseWcweDdVWjhvWTlYdmZIT2xIbW4yTmpJdnYycmpVVjY3N1hDOGhiTGlkNHY2OWpCQzlvZnpU';
const UA = 'okhttp/4.12.0';

async function json(response) {
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch (_) { body = {}; }
  if (!response.ok) {
    const error = new Error(body.error_description || body.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

class DpdApi {
  constructor(email, password, bu = 'DPD-NL') {
    this.email = email;
    this.password = password;
    this.bu = bu;
    this.token = null;
  }

  async login() {
    let response = await fetch(KC, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': UA,
      },
      body: new URLSearchParams({
        client_id: 'MOBILE-APP-PROD',
        grant_type: 'password',
        scope: 'openid',
        username: this.email,
        password: this.password,
      }),
    });
    const keycloak = await json(response);
    if (!keycloak.access_token) {
      const error = new Error('DPD login failed');
      error.auth = true;
      throw error;
    }

    response = await fetch(`${BASE}/oauth/token?grant_type=client_credentials`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${BASIC}`,
        'content-type': 'application/json',
        'user-agent': UA,
      },
    });
    const guest = await json(response);

    response = await fetch(`${BASE}/users/login/consignee-sso?bu=${encodeURIComponent(this.bu)}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${guest.access_token}`,
        'content-type': 'text/plain',
        'user-agent': UA,
      },
      body: keycloak.access_token,
    });
    const account = await json(response);
    if (!account.access_token) {
      const error = new Error('DPD account token missing');
      error.auth = true;
      throw error;
    }
    this.token = account.access_token;
    return this.token;
  }

  async _authorizedFetch(url, options = {}, retry = true) {
    if (!this.token) await this.login();
    const headers = {
      ...(options.headers || {}),
      authorization: `Bearer ${this.token}`,
      'user-agent': UA,
    };
    let response = await fetch(url, { ...options, headers });
    if (retry && (response.status === 401 || response.status === 403)) {
      await this.login();
      response = await fetch(url, {
        ...options,
        headers: { ...headers, authorization: `Bearer ${this.token}` },
      });
    }
    return response;
  }

  async parcels() {
    const body = {
      incomingParcels: [],
      sendingParcels: [],
      confirmedParcels: null,
      shipmentCollections: [],
      confirmedShipmentCollections: null,
    };
    const response = await this._authorizedFetch(
      `${BASE}/v7/parcels?bu=${encodeURIComponent(this.bu)}&lang=en`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return json(response);
  }

  async parcelDetail(parcelNumber, { shipmentBUCode = '', parcelType = 'INCOMING' } = {}) {
    if (!parcelNumber) return null;
    const params = new URLSearchParams({
      parcelType,
      businessUnit: this.bu,
      lang: 'en',
      continueWithoutVerification: 'false',
    });
    if (shipmentBUCode) params.set('shipmentBUCode', shipmentBUCode);

    try {
      const response = await this._authorizedFetch(
        `${BASE}/v10/parcels/details/${encodeURIComponent(parcelNumber)}?${params.toString()}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
      );
      if (!response.ok) return null;
      return await json(response);
    } catch (_) {
      return null;
    }
  }

  async fmpDeliveryWindow(hashcode) {
    if (!hashcode) return null;
    try {
      const authResponse = await this._authorizedFetch(`${BASE}/fmp/authenticate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authMethod: 'HASHCODE', credentials: hashcode }),
      });
      if (!authResponse.ok) return null;
      const auth = await json(authResponse);
      if (!auth.access_token) return null;

      const shipmentResponse = await fetch(`${BASE}/v3/fmp/shipment?lang=en`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${auth.access_token}`,
          'content-type': 'application/json',
          'user-agent': UA,
        },
      });
      if (!shipmentResponse.ok) return null;
      const shipment = await json(shipmentResponse);
      return shipment && typeof shipment.deliveryDateAndTime === 'object'
        ? shipment.deliveryDateAndTime
        : null;
    } catch (_) {
      return null;
    }
  }
}

module.exports = { DpdApi };
