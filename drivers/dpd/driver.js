'use strict';

const Homey = require('homey');
const {
  COUNTRIES, COUNTRY_BY_CODE, backendFor, STATUS,
  DpdGeneralClient, DpdDeClient, DpdPlClient, normalizePolishPhone,
} = require('../../lib/dpd-tracking');

const { language, regionName } = require('../../lib/i18n');
const { t, localizeSession, localizeListener } = require('../../lib/messages-i18n');

// DPD business units → ISO country (names come from Intl in the user's language).
const BU_REGION = { 'DPD-UK': 'GB', BRT: 'IT', 'CHR-PT': 'PT' };

function countryName(homey, country) {
  const region = BU_REGION[country.code] || String(country.code).replace(/^DPD-/, '');
  const name = regionName(homey, region) || country.name[0];
  return country.code === 'BRT' ? `${name} (BRT)` : name;
}

module.exports = class DpdDriver extends Homey.Driver {
  async onInit() {
    const condition = id => this.homey.flow.getConditionCard(id);
    condition('dpd_packages_underway').registerRunListener(async ({ device }) => (device.getCapabilityValue('dpd_parcel_count') || 0) > 0);
    condition('dpd_out_for_delivery_now').registerRunListener(async ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY));
    condition('dpd_ready_for_pickup_now').registerRunListener(async ({ device }) => device.hasStatus(STATUS.AT_PICKUP_POINT));
    condition('dpd_any_status_is').registerRunListener(async ({ device, status }) => device.hasStatus(status));
    condition('dpd_outgoing_underway').registerRunListener(async ({ device }) => device.hasOutgoingUnderway());
    const delivered = condition('dpd_parcel_is_delivered');
    delivered.registerRunListener(async ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''));
    delivered.registerArgumentAutocompleteListener('tracking', async (query, args) => (args.device ? args.device.autocompleteParcels(query) : []));
    this.homey.flow.getActionCard('dpd_refresh').registerRunListener(localizeListener(this.homey, async ({ device }) => device.refresh(true), 'DPD'));
  }

  _countries() {
    return COUNTRIES.map(country => ({ id: country.code, name: countryName(this.homey, country), backend: country.backend }));
  }

  _language() { return language(this.homey); }

  /** Validate credentials for e-mail/password countries; returns the settings to store. */
  async _login({ country, email, password }) {
    const bu = COUNTRY_BY_CODE[country] ? country : 'DPD-NL';
    const mail = String(email || '').trim();
    const pass = String(password || '');
    if (!mail || !pass) throw new Error(t(this.homey, 'enter_email_password', { account: 'DPD' }));
    const client = backendFor(bu) === 'de'
      ? new DpdDeClient({ email: mail, password: pass })
      : new DpdGeneralClient({ email: mail, password: pass, bu });
    await client.login();
    return { bu, email: mail, password: pass, hardwareId: client.hardwareId || null };
  }

  _registerHandlers(session, { device = null } = {}) {
    localizeSession(this.homey, session, 'DPD');
    session.setHandler('countries', async () => ({
      countries: this._countries(),
      language: this._language(),
      current: device ? { country: device.getSetting('bu') || 'DPD-NL', email: device.getSetting('email') || '', phone: device.getSetting('phone') || '' } : null,
    }));

    session.setHandler('login', async data => {
      const result = await this._login(data);
      if (device) {
        const changed = device.getSetting('bu') !== result.bu;
        await device.setSettings({ bu: result.bu, email: result.email, password: result.password });
        if (result.hardwareId) await device.setStoreValue('dpd_de_hardware_id', result.hardwareId).catch(() => {});
        await this._afterRepair(device, changed);
        return { ok: true };
      }
      return {
        device: {
          name: result.bu === 'DPD-NL' ? 'DPD' : `DPD ${result.bu.replace(/^DPD-/, '')}`,
          data: { id: `dpd-${result.email.toLowerCase()}${result.bu === 'DPD-NL' ? '' : `-${result.bu.toLowerCase()}`}` },
          settings: { bu: result.bu, email: result.email, password: result.password, phone: '', delivered_days: 7 },
          store: result.hardwareId ? { dpd_de_hardware_id: result.hardwareId } : {},
        },
      };
    });

    session.setHandler('pl_send_sms', async ({ phone }) => {
      const number = await DpdPlClient.sendSms(phone);
      return { phone: number };
    });

    session.setHandler('pl_verify', async ({ phone, code }) => {
      const number = normalizePolishPhone(phone);
      if (!number) throw new Error(t(this.homey, 'polish_phone'));
      const client = new DpdPlClient();
      const refreshToken = await client.register(number, code);
      if (device) {
        const changed = device.getSetting('bu') !== 'DPD-PL';
        await device.setSettings({ bu: 'DPD-PL', phone: number, email: '', password: '' });
        await device.setStoreValue('dpd_pl_refresh_token', refreshToken);
        await this._afterRepair(device, changed);
        return { ok: true };
      }
      return {
        device: {
          name: 'DPD Polska',
          data: { id: `dpd-pl-${number}` },
          settings: { bu: 'DPD-PL', email: '', password: '', phone: number, delivered_days: 7 },
          store: { dpd_pl_refresh_token: refreshToken },
        },
      };
    });
  }

  async _afterRepair(device, countryChanged) {
    if (countryChanged) await device.resetParcels();
    device._client = null;
    device._clientKey = '';
    await device.setStoreValue('authExpiredNotified', false).catch(() => {});
    await device.setAvailable().catch(() => {});
    device.refresh(true).catch(error => this.error(error));
  }

  async onPair(session) {
    this._registerHandlers(session);
  }

  async onRepair(session, device) {
    this._registerHandlers(session, { device });
  }
};
