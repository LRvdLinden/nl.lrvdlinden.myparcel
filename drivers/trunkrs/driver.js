'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const { TrunkrsClient, normalizeCode, normalizePostcode, validPostcode, TEXT } = require('../../lib/trunkrs-tracking');
const { simpleTrackingList } = require('../../lib/carrier-migrate');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');
const { tr } = require('../../lib/i18n');

module.exports = class TrunkrsDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        trunkrs_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        trunkrs_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        trunkrs_any_status_is: ({ device, status }) => device.hasStatus(status),
        trunkrs_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        trunkrs_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
      },
      autocomplete: { trunkrs_parcel_is_delivered: 'tracking', trunkrs_untrack_parcel: 'tracking' },
      actions: {
        trunkrs_refresh: ({ device }) => device.refresh(true).then(() => true),
        trunkrs_track_parcel: ({ device, tracking }) => device.trackParcel(tracking),
        trunkrs_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        trunkrs_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  /** { trackingCodes, postalCode } → { lines, postcode }. Codes are optional (like the ha-trunkrs hub); the postcode is required. */
  async _check(data) {
    const postcode = normalizePostcode(data?.postalCode);
    if (!validPostcode(postcode)) throw new Error(tr(this.homey, TEXT.invalidPostcode));
    const entries = simpleTrackingList(data?.trackingCodes, normalizeCode);
    for (const entry of entries) {
      const pc = normalizePostcode(entry.postcode) || postcode;
      if (!validPostcode(pc)) throw new Error(tr(this.homey, TEXT.invalidPostcode));
      // Only a definite "no" blocks; an unreachable Trunkrs must not stop a parcel the user knows is valid.
      const known = await new TrunkrsClient().verify(entry.code, pc).catch(error => { this.error('[Trunkrs] verify', error.message); return null; });
      if (known === false) throw new Error(tr(this.homey, TEXT.unknownParcel, { code: entry.code, postcode: pc }));
    }
    const lines = entries.map(e => [e.code, normalizePostcode(e.postcode)].filter(Boolean).join(' '));
    return { lines, postcode };
  }

  async onPair(session) {
    session.setHandler('connect', async data => {
      const { lines, postcode } = await this._check(data);
      return {
        device: {
          name: 'Trunkrs',
          data: { id: `trunkrs-${crypto.randomBytes(8).toString('hex')}` },
          settings: { tracking_numbers: lines.join('\n'), postal_code: postcode, delivered_days: 7 },
        },
      };
    });
  }

  async onRepair(session, repairDevice) {
    session.setHandler('connect', async data => {
      const { lines, postcode } = await this._check(data);
      const d = repairDevice;
      await d.setSettings({ postal_code: postcode, ...(lines.length ? { tracking_numbers: lines.join('\n') } : {}) });
      await d.setAvailable().catch(() => {});
      await d.refresh(true);
      return true;
    });
  }
};
