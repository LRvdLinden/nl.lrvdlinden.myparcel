'use strict';
const Homey = require('homey');
function normalizeUrl(value) {
  const raw = String(value || '').trim();
  let u;
  try { u = new URL(raw); } catch (_) { throw new Error('Enter a valid Ampère Track & Trace URL.'); }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'bol.prd.amperebezorgt.nl') throw new Error('Use an Ampère Track & Trace link from bol.prd.amperebezorgt.nl.');
  return u.toString();
}
module.exports = class AmpereDriver extends Homey.Driver {
  async onPair(session) {
    session.setHandler('create_ampere', async ({ url }) => {
      const trackingUrl = normalizeUrl(url);
      return { device: { name:'Ampère', data:{ id:`ampere-${Buffer.from(trackingUrl).toString('base64url').slice(0,40)}` }, settings:{ tracking_url:trackingUrl } } };
    });
  }
  async onRepair(session) {
    session.setHandler('repair_ampere', async ({ url }) => {
      const trackingUrl=normalizeUrl(url); const device=session.getDevice();
      await device.setSettings({tracking_url:trackingUrl}); await device.refresh(true); return {ok:true};
    });
  }
};
