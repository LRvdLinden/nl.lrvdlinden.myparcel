'use strict';

const localizePackageStatus = require('./status-i18n');

// Timeline in the MyParcel Bezorging widget: 1 registered · 2 sorting · 3 underway · 4 delivered.
const STAGE = {
  announced: 1, unknown: 1,
  accepted: 2, picked: 2, transit: 2, customs: 2, delayed: 2, exception: 2, returning: 2, returned: 2, cancelled: 2,
  out: 3, ready: 3, attempt: 3,
  delivered: 4,
};

function dayKey(value, timeZone) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
    const get = type => (parts.find(part => part.type === type) || {}).value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch (_) {
    return new Date(time).toISOString().slice(0, 10);
  }
}

/**
 * Canonical status key (status-i18n) for a widget parcel.
 * Uses the carrier's own canonical status first (PostNL canonicalStatus, GLS/DPD status codes) and never
 * reports "delivered" for a parcel whose delivered flag is false ("Je pakket wordt vandaag bezorgd").
 */
function statusKey(parcel = {}) {
  if (parcel.delivered === true) return 'delivered';
  let key = '';
  for (const candidate of [parcel.canonicalStatus, parcel.status, parcel.statusRaw, parcel.lastEvent]) {
    if (!candidate) continue;
    key = localizePackageStatus.canonicalKey(candidate);
    if (key) break;
  }
  if (key === 'delivered' && parcel.delivered === false) {
    const text = `${parcel.status || ''} ${parcel.lastEvent || ''}`.toLowerCase();
    key = /vandaag|today|heute|aujourd|oggi|idag|i dag|hoy|сегодня|dzisiaj|오늘|اليوم/.test(text) ? 'out' : 'transit';
  }
  return key;
}

function statusLabel(homey, parcel = {}) {
  const key = statusKey(parcel);
  if (key) {
    const text = homey?.__?.(`package_status.${key}`);
    if (text && text !== `package_status.${key}`) return text;
  }
  return localizePackageStatus(homey, parcel.status || '') || String(parcel.status || '');
}

function stage(parcel = {}, timeZone = 'UTC') {
  const key = statusKey(parcel);
  let value = STAGE[key] || 0;
  if (!value) {
    // Unrecognised carrier text: fall back to what we know about the parcel.
    value = parcel.deliveryWindowFrom || parcel.deliveryWindowTo ? 2 : 1;
  }
  if (value === 2 && key !== 'exception' && !/^return|cancel/.test(key)) {
    const today = dayKey(new Date().toISOString(), timeZone);
    const due = dayKey(parcel.deliveryWindowFrom || parcel.deliveryDate, timeZone);
    if (today && due === today) value = 3;
  }
  return value;
}

/** Carrier event text stays as written; only bare status codes (in_transit, DELIVERED) get translated. */
function eventText(homey, value) {
  const raw = String(value ?? '').trim();
  if (!raw || /\s/.test(raw)) return raw;
  return localizePackageStatus(homey, raw) || raw;
}

module.exports = { statusKey, statusLabel, stage, dayKey, eventText };
