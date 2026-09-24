'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const API = require('../../lib/dhl-parcel-api');

module.exports = class DHLParcelDriver extends Homey.Driver {
  async onInit() {
    this.homey.flow.getConditionCard('is_delivered').registerRunListener(async ({ device }) => Boolean(device && await device.isDelivered()));
    this.homey.flow.getActionCard('refresh_shipment').registerRunListener(async ({ device }) => {
      if (!device) throw new Error('No DHL device selected.');
      await device.refresh(true);
      return true;
    });
  }

  async _validateCredentials(email, password) {
    const api = new API({ fetch, email, password, log: (...args) => this.log('[PairAuth]', ...args) });
    await api.login();
    const parcels = await api.getParcels();
    return { api, parcels };
  }

  _deviceForAccount(email, password, parcels = []) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) throw new Error('A DHL account email address is required.');
    const stable = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
    const lang = this.homey.i18n.getLanguage();
    return {
      name: 'DHL',
      data: { id: `dhl-parcel-${stable}` },
      store: {
        email: String(email || '').trim(),
        password: String(password || ''),
        parcels: Array.isArray(parcels) ? parcels : [],
        parcel_state: {},
        authExpiredNotified: false,
      },
    };
  }

  async onPair(session) {
    session.setHandler('login_dhl', async ({ email, password } = {}) => {
      const result = await this._validateCredentials(email, password);
      return { device: this._deviceForAccount(email, password, result.parcels) };
    });
  }

  async onRepair(session, device) {
    session.setHandler('repair_login', async ({ email, password } = {}) => {
      await this._validateCredentials(email, password);
      await device.updateCredentials(email, password);
      return { ok: true };
    });
  }
};
