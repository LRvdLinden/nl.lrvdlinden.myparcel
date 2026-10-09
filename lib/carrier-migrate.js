'use strict';

/** Helpers shared by the carrier devices for settings that changed shape in 0.3.5. */

/** One code per line (or separated by , ;), optional "out" for parcels you sent yourself. */
function simpleTrackingList(text, normalize = v => String(v || '').trim().toUpperCase()) {
  const out = [];
  const seen = new Set();
  for (const line of String(text || '').split(/[\n,;]+/)) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const code = normalize(parts.shift());
    if (!code || seen.has(code)) continue;
    let direction = 'incoming';
    let postcode = '';
    for (const part of parts) {
      if (/^(out|uit|outgoing|uitgaand|sent|verzonden)$/i.test(part)) direction = 'outgoing';
      else postcode = `${postcode}${part}`.toUpperCase();
    }
    seen.add(code);
    out.push({ code, postcode, direction });
  }
  return out;
}

/** 0.3.4 and older kept the codes as JSON in an undeclared `tracking_numbers_json` setting. */
async function migrateTrackingList(device, toLine = v => (typeof v === 'string' ? v : [v?.barcode || v?.code, v?.postalCode || v?.postcode].filter(Boolean).join(' '))) {
  if (String(device.getSetting('tracking_numbers') || '').trim()) return;
  let list = [];
  try { list = JSON.parse(device.getSetting('tracking_numbers_json') || '[]'); } catch (_) { list = []; }
  if (!Array.isArray(list) || !list.length) return;
  const text = list.map(toLine).filter(Boolean).join('\n');
  if (text) await device.setSettings({ tracking_numbers: text }).catch(device.error);
}

module.exports = { simpleTrackingList, migrateTrackingList };
