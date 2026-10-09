'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const { DynalogicClient, normalizeCode, normalizePostcode, validPostcode, guessCountry, COUNTRIES, TEXT } = require('../../lib/dynalogic-tracking');
const { simpleTrackingList } = require('../../lib/carrier-migrate');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');
const { tr } = require('../../lib/i18n');

module.exports = class DynalogicDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        dynalogic_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        dynalogic_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        dynalogic_any_status_is: ({ device, status }) => device.hasStatus(status),
        dynalogic_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        dynalogic_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
      },
      autocomplete: { dynalogic_parcel_is_delivered: 'tracking', dynalogic_untrack_parcel: 'tracking' },
      actions: {
        dynalogic_refresh: ({ device }) => device.refresh(true).then(() => true),
        dynalogic_track_parcel: ({ device, tracking }) => device.trackParcel(tracking),
        dynalogic_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        dynalogic_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  _postcodeError(country) { return new Error(tr(this.homey, country === 'BE' ? TEXT.invalidPostcodeBE : TEXT.invalidPostcodeNL)); }

  /**
   * { trackingCodes, country, postalCode } → { lines, postcode, country }. Like the ha-dynalogic config/options flow:
   * the postcode is required, every code entered is checked against the carrier (404 → not found, outage → cannot connect).
   */
  async _check(data) {
    const postcode = normalizePostcode(data?.postalCode);
    const country = COUNTRIES[data?.country] ? data.country : guessCountry(postcode);
    if (!validPostcode(postcode, country)) throw this._postcodeError(country);
    const entries = simpleTrackingList(data?.trackingCodes, normalizeCode);
    const client = new DynalogicClient();
    for (const entry of entries) {
      const pc = normalizePostcode(entry.postcode) || postcode;
      if (entry.postcode && !validPostcode(pc)) throw this._postcodeError(guessCountry(pc));
      let order;
      try { order = await client.parcel(entry.code, pc); } catch (error) {
        this.error('[Dynalogic] verify', error.message);
        throw new Error(tr(this.homey, TEXT.cannotConnect));
      }
      if (!order) throw new Error(tr(this.homey, TEXT.notFound, { code: entry.code, postcode: pc }));
    }
    const lines = entries.map(e => [e.code, normalizePostcode(e.postcode)].filter(Boolean).join(' '));
    return { lines, postcode, country };
  }

  async onPair(session) {
    session.setHandler('connect', async data => {
      const { lines, postcode, country } = await this._check(data);
      return {
        device: {
          name: 'Dynalogic',
          data: { id: `dynalogic-${crypto.randomBytes(8).toString('hex')}` },
          settings: { tracking_numbers: lines.join('\n'), country, postal_code: postcode, delivered_days: 7 },
        },
      };
    });
  }

  async onRepair(session, repairDevice) {
    session.setHandler('connect', async data => {
      const { lines, postcode, country } = await this._check(data);
      const d = repairDevice;
      await d.setSettings({ country, postal_code: postcode, ...(lines.length ? { tracking_numbers: lines.join('\n') } : {}) });
      await d.setAvailable().catch(() => {});
      await d.refresh(true);
      return true;
    });
  }
};
