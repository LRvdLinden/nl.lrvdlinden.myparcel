'use strict';
const Homey = require('homey');
const crypto = require('crypto');
const { BudbeeApi } = require('../../lib/budbee-api');
function parseCodes(v) { return [...new Set(String(v || '').split(/[\s,;]+/).map(x => x.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean))]; }
module.exports = class BudbeeDriver extends Homey.Driver {
  async onInit() { this.homey.flow.getConditionCard('budbee_packages_underway').registerRunListener(async ({ device }) => (device.getCapabilityValue('budbee_parcel_count') || 0) > 0); this.homey.flow.getActionCard('budbee_refresh').registerRunListener(async ({ device }) => device.refresh(true)); }
  async onPair(session) {
    session.setHandler('connect', async data => { const codes = parseCodes(data.trackingCodes); if (!codes.length) throw new Error('Enter at least one Budbee tracking/order number.'); const api = new BudbeeApi(); const first = await api.parcel(codes[0]); if (!first) throw new Error('Budbee does not know this tracking/order number yet.'); return { device: { name: 'Budbee', data: { id: `budbee-${crypto.randomBytes(8).toString('hex')}` }, settings: { tracking_numbers_json: JSON.stringify(codes) }, capabilities: ['budbee_parcel_count', 'budbee_status', 'budbee_last_update'] } }; });
  }
  async onRepair(session) { session.setHandler('connect', async data => { const codes = parseCodes(data.trackingCodes); if (!codes.length) throw new Error('Enter at least one Budbee tracking/order number.'); const d = session.getDevice(); await d.setSettings({ tracking_numbers_json: JSON.stringify(codes) }); await d.setAvailable(); await d.refresh(true); return true; }); }
};
