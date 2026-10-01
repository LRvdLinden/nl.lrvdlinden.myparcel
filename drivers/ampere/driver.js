'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const { decodeBundle } = require('../../lib/bol-session');

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let u;
  try { u = new URL(raw); } catch (_) { throw new Error('Enter a valid Ampère Track & Trace URL.'); }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'bol.prd.amperebezorgt.nl') {
    throw new Error('Use an Ampère Track & Trace link from bol.prd.amperebezorgt.nl.');
  }
  return u.toString();
}

function validateSessionCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  decodeBundle(raw);
  return raw;
}

function makeId(sessionCode, trackingUrl) {
  const seed = sessionCode || trackingUrl;
  return `ampere-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20)}`;
}

module.exports = class AmpereDriver extends Homey.Driver {
  async onInit() {
    const safeRegister = (type, id, listener) => {
      try {
        const card = type === 'condition'
          ? this.homey.flow.getConditionCard(id)
          : this.homey.flow.getActionCard(id);
        card.registerRunListener(listener);
      } catch (error) {
        this.error(`Could not register Ampère Flow card ${id}`, error);
      }
    };

    safeRegister('condition', 'ampere_packages_underway', async ({ device }) => Boolean(device?.hasPackagesUnderway()));
    safeRegister('condition', 'ampere_delivery_window_known', async ({ device }) => Boolean(device?.hasDeliveryWindow()));
    safeRegister('condition', 'ampere_is_delivered', async ({ device }) => Boolean(device?.isLatestDelivered()));
    safeRegister('condition', 'ampere_is_connected', async ({ device }) => Boolean(device?.isConnected()));
    safeRegister('action', 'ampere_refresh', async ({ device }) => {
      if (!device) throw new Error('No Ampère device selected.');
      await device.refresh(true);
      return true;
    });
  }

  async onPair(session) {
    session.setHandler('create_ampere', async ({ sessionCode, url }) => {
      const bolSessionBundle = validateSessionCode(sessionCode);
      const trackingUrl = normalizeUrl(url);
      if (!bolSessionBundle && !trackingUrl) throw new Error('Paste the bol.com session code from helper 0.3.1 or enter an Ampère Track & Trace URL.');
      return {
        device: {
          name: 'Ampère',
          data: { id: makeId(bolSessionBundle, trackingUrl) },
          settings: { bol_session_bundle: bolSessionBundle, tracking_url: trackingUrl },
        },
      };
    });
  }

  async onRepair(session) {
    session.setHandler('repair_ampere', async ({ sessionCode, url }) => {
      const bolSessionBundle = validateSessionCode(sessionCode);
      const trackingUrl = normalizeUrl(url);
      if (!bolSessionBundle && !trackingUrl) throw new Error('Paste the bol.com session code from helper 0.3.1 or enter an Ampère Track & Trace URL.');
      const device = session.getDevice();
      const settings = {};
      if (bolSessionBundle) settings.bol_session_bundle = bolSessionBundle;
      if (trackingUrl) settings.tracking_url = trackingUrl;
      await device.setSettings(settings);
      if (typeof device.updateSession === 'function') await device.updateSession();
      else await device.refresh(true);
      return { ok: true };
    });
  }
};
