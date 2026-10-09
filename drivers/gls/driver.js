'use strict';

const Homey = require('homey');
const {
  COUNTRIES, STATUS, parseTrackingList, formatTrackingList, normalizePostcode, validatePostcode,
} = require('../../lib/gls-tracking');
const i18n = require('../../lib/gls-i18n');
const { localizeSession, localizeListener } = require('../../lib/messages-i18n');

const COUNTRY_ORDER = ['NL', 'BE', 'DE', 'AT', 'CH', 'LU', 'FR', 'IT', 'DK', 'FI', 'IE', 'PL', 'CZ', 'SK', 'HU', 'SI', 'HR', 'RS', 'US', 'CA'];

module.exports = class GlsDriver extends Homey.Driver {
  async onInit() {
    const condition = id => this.homey.flow.getConditionCard(id);
    const action = id => this.homey.flow.getActionCard(id);
    const autocomplete = async (query, args) => (args.device ? args.device.autocompleteParcels(query) : []);

    condition('gls_packages_underway').registerRunListener(async ({ device }) => (device.getCapabilityValue('gls_parcel_count') || 0) > 0);
    condition('gls_out_for_delivery_now').registerRunListener(async ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY));
    condition('gls_ready_for_pickup_now').registerRunListener(async ({ device }) => device.hasStatus(STATUS.AT_PICKUP_POINT));
    condition('gls_any_status_is').registerRunListener(async ({ device, status }) => device.hasStatus(status));
    const delivered = condition('gls_parcel_is_delivered');
    delivered.registerRunListener(async ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''));
    delivered.registerArgumentAutocompleteListener('tracking', autocomplete);
    condition('gls_is_tracking').registerRunListener(async ({ device, tracking }) => device.isTracking(tracking));

    action('gls_refresh').registerRunListener(localizeListener(this.homey, async ({ device }) => device.refresh(true), 'GLS'));
    action('gls_track_parcel').registerRunListener(localizeListener(this.homey, async ({ device, tracking }) => device.addTracking(tracking), 'GLS'));
    const untrack = action('gls_untrack_parcel');
    untrack.registerRunListener(async ({ device, tracking }) => device.removeTracking(tracking?.id || tracking?.name || ''));
    untrack.registerArgumentAutocompleteListener('tracking', autocomplete);
    action('gls_remove_delivered').registerRunListener(async ({ device }) => device.removeDelivered());
  }

  _countries() {
    return COUNTRY_ORDER.map(code => ({
      id: code,
      name: i18n.countryName(this.homey, code),
      example: COUNTRIES[code].postcode_example,
    }));
  }

  _validate(data) {
    const country = COUNTRIES[data?.country] ? data.country : 'NL';
    const postcode = normalizePostcode(data?.postcode);
    if (!validatePostcode(country, postcode)) {
      throw new Error(i18n.text(this.homey, 'invalid_postcode', {
        country: i18n.countryName(this.homey, country),
        example: COUNTRIES[country].postcode_example,
      }));
    }
    const rows = parseTrackingList(data?.tracking || '');
    for (const row of rows) {
      if (row.postcode && !validatePostcode(country, row.postcode)) {
        throw new Error(i18n.text(this.homey, 'invalid_postcode_row', { tracking: row.parcelNo, country: i18n.countryName(this.homey, country), example: COUNTRIES[country].postcode_example }));
      }
    }
    return { country, postcode, tracking: formatTrackingList(rows) };
  }

  async onPair(session) {
    localizeSession(this.homey, session, 'GLS');
    session.setHandler('countries', async () => ({ countries: this._countries(), language: i18n.lang(this.homey) }));
    session.setHandler('create', async data => {
      const { country, postcode, tracking } = this._validate(data);
      return {
        name: `GLS ${postcode}`,
        data: { id: `gls-${country}-${postcode}` },
        settings: {
          country,
          postal_code: postcode,
          tracking_numbers: tracking,
          remove_delivered_after_days: 7,
        },
      };
    });
  }

  async onRepair(session, device) {
    localizeSession(this.homey, session, 'GLS');
    session.setHandler('countries', async () => ({
      countries: this._countries(),
      language: i18n.lang(this.homey),
      current: {
        country: device.getSetting('country') || 'NL',
        postcode: device.getSetting('postal_code') || '',
        tracking: device.getSetting('tracking_numbers') || '',
      },
    }));
    session.setHandler('save', async data => {
      const { country, postcode, tracking } = this._validate(data);
      if (country !== device.getSetting('country')) await device.resetParcels();
      await device.setSettings({ country, postal_code: postcode, tracking_numbers: tracking });
      await device.setStoreValue('authExpiredNotified', false).catch(() => {});
      await device.setAvailable().catch(() => {});
      device.refresh(true).catch(error => this.error(error));
      return true;
    });
  }
};
