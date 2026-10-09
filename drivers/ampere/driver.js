'use strict';

const Homey = require('homey');
const { t, localizeSession } = require('../../lib/messages-i18n');
const crypto = require('crypto');
const { decodeBundle } = require('../../lib/bol-session');
const { exchangeLink, isTrackingLink } = require('../../lib/ampere-tracking');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');

function validateSessionCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  decodeBundle(raw);
  return raw;
}

async function validateLinks(homey, value) {
  const links = String(value || '').split(/\s+/).map(v => v.trim()).filter(Boolean);
  for (const link of links) {
    if (!isTrackingLink(link)) throw new Error(t(homey, 'ampere_link_use'));
  }
  if (links.length) await exchangeLink(links[0]);
  return links;
}

module.exports = class AmpereDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        ampere_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        ampere_delivery_window_known: ({ device }) => device.hasDeliveryWindow(),
        ampere_is_delivered: ({ device }) => device.isLatestDelivered(),
        ampere_is_connected: ({ device }) => device.isConnected(),
        ampere_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        ampere_any_status_is: ({ device, status }) => device.hasStatus(status),
        ampere_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        ampere_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
      },
      autocomplete: { ampere_parcel_is_delivered: 'tracking', ampere_untrack_parcel: 'tracking' },
      actions: {
        ampere_refresh: ({ device }) => device.refresh(true).then(() => true),
        ampere_track_parcel: ({ device, tracking }) => device.trackParcel(tracking),
        ampere_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        ampere_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  async onPair(session) {
    localizeSession(this.homey, session, 'Ampère');
    session.setHandler('create_ampere', async ({ sessionCode, url }) => {
      const bundle = validateSessionCode(sessionCode);
      const links = await validateLinks(this.homey, url);
      if (!bundle && !links.length) throw new Error(t(this.homey, 'ampere_code_or_link'));
      return {
        device: {
          name: 'Ampère',
          data: { id: `ampere-${crypto.createHash('sha256').update(bundle || links[0]).digest('hex').slice(0, 20)}` },
          settings: { bol_session_bundle: bundle, tracking_url: '', tracking_numbers: links.join('\n'), delivered_days: 7 },
        },
      };
    });
  }

  async onRepair(session, device) {
    localizeSession(this.homey, session, 'Ampère');
    session.setHandler('repair_ampere', async ({ sessionCode, url }) => {
      const bundle = validateSessionCode(sessionCode);
      const links = await validateLinks(this.homey, url);
      if (!bundle && !links.length) throw new Error(t(this.homey, 'ampere_code_or_link'));
      if (bundle) await device.setSettings({ bol_session_bundle: bundle });
      if (links.length) {
        const current = device.trackedEntries().map(e => e.code);
        await device.setSettings({ tracking_numbers: [...new Set([...current, ...links])].join('\n') });
      }
      await device.updateSession();
      return { ok: true };
    });
  }
};
