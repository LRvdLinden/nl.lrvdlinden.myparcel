'use strict';

const STATUS = Object.freeze({
  REGISTERED: 'registered',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  AT_PICKUP_POINT: 'at_pickup_point',
  DELIVERED: 'delivered',
  RETURNING: 'returning',
  PROBLEM: 'problem',
  UNKNOWN: 'unknown',
});

const OBSERVATION_CODE_MAP = Object.freeze({
  A01: STATUS.REGISTERED, A03: STATUS.REGISTERED, M02: STATUS.REGISTERED,
  B01: STATUS.IN_TRANSIT, C02: STATUS.IN_TRANSIT, F01: STATUS.IN_TRANSIT,
  J01: STATUS.IN_TRANSIT, R01: STATUS.IN_TRANSIT, J04: STATUS.IN_TRANSIT,
  J21: STATUS.IN_TRANSIT, J31: STATUS.IN_TRANSIT, J32: STATUS.IN_TRANSIT,
  J30: STATUS.IN_TRANSIT, J39: STATUS.IN_TRANSIT, J40: STATUS.IN_TRANSIT,
  J46: STATUS.IN_TRANSIT, J44: STATUS.IN_TRANSIT, J55: STATUS.IN_TRANSIT,
  X01: STATUS.IN_TRANSIT, X02: STATUS.IN_TRANSIT, X03: STATUS.IN_TRANSIT,
  X04: STATUS.IN_TRANSIT, X08: STATUS.IN_TRANSIT, X19: STATUS.IN_TRANSIT,
  A21: STATUS.IN_TRANSIT, I07: STATUS.IN_TRANSIT,
  G01: STATUS.IN_TRANSIT, G05: STATUS.IN_TRANSIT, K01: STATUS.IN_TRANSIT,
  K70: STATUS.IN_TRANSIT, T04: STATUS.IN_TRANSIT,
  J05: STATUS.OUT_FOR_DELIVERY,
  I08: STATUS.AT_PICKUP_POINT, J02: STATUS.AT_PICKUP_POINT,
  J12: STATUS.AT_PICKUP_POINT, J23: STATUS.AT_PICKUP_POINT,
  A80: STATUS.DELIVERED, I01: STATUS.DELIVERED, I02: STATUS.DELIVERED,
  I05: STATUS.DELIVERED, I11: STATUS.DELIVERED, I12: STATUS.DELIVERED,
  Z01: STATUS.DELIVERED,
});

const OBSERVATION_META_CODES = new Set([
  'A04','A18','A19','A24','A25','A65','A94','A95','A96','A98','A20',
  'B03','J09','K33','K50','P21',
]);

const STATUS_PATTERNS = [
  ['ligt klaar bij postnl punt', STATUS.AT_PICKUP_POINT],
  ['afgeleverd op postnl punt', STATUS.AT_PICKUP_POINT],
  ['klaar bij postnl punt', STATUS.AT_PICKUP_POINT],
  ['teruggestuurd', STATUS.RETURNING],
  ['retour', STATUS.RETURNING],
  ['wordt vandaag bezorgd', STATUS.OUT_FOR_DELIVERY],
  ['onderweg naar het bezorgadres', STATUS.OUT_FOR_DELIVERY],
  ['onderweg naar de bezorger', STATUS.OUT_FOR_DELIVERY],
  ['aangemeld', STATUS.REGISTERED],
  ['verwacht', STATUS.REGISTERED],
  ['bezorgmoment is bijgewerkt', STATUS.IN_TRANSIT],
  ['lukt vandaag niet', STATUS.IN_TRANSIT],
  ['duurt de bezorging wat langer', STATUS.IN_TRANSIT],
  ['ontvangen', STATUS.IN_TRANSIT],
  ['gesorteerd', STATUS.IN_TRANSIT],
  ['onderweg', STATUS.IN_TRANSIT],
  ['klaar voor verzending', STATUS.IN_TRANSIT],
  ['je zending ligt op een sorteercentrum in land van bestemming', STATUS.IN_TRANSIT],
  ['de grens over', STATUS.IN_TRANSIT],
  ['aangekomen in het land van bestemming', STATUS.IN_TRANSIT],
  ['je zending is bezorgd bij de ontvanger', STATUS.DELIVERED],
  ['bezorgd', STATUS.DELIVERED],
  ['unknown', STATUS.UNKNOWN],
];

function parseTime(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function observationTime(obs = {}) {
  return obs.observationDate || obs.dateTime || obs.timestamp || obs.timeStamp || '';
}

function observationDescription(obs = {}) {
  return String(obs.description || obs.message || obs.status || obs.eventDescription || '').trim();
}

function observationCode(obs = {}) {
  return String(obs.observationCode || obs.code || '').trim();
}

function extractObservations(colli = {}) {
  const analytics = colli.analyticsInfo && typeof colli.analyticsInfo === 'object' ? colli.analyticsInfo : {};
  const full = Array.isArray(analytics.allObservations) ? analytics.allObservations : [];
  if (full.length) return full;
  if (Array.isArray(colli.observations) && colli.observations.length) return colli.observations;
  if (Array.isArray(colli.events)) return colli.events;
  return [];
}

function orderObservations(observations = []) {
  return observations.map((obs, index) => ({
    index, timestamp: observationTime(obs), code: observationCode(obs),
    description: observationDescription(obs), raw: obs,
  })).filter(row => row.timestamp || row.code || row.description).sort((a, b) => {
    const at = parseTime(a.timestamp); const bt = parseTime(b.timestamp);
    if (at == null && bt == null) return a.index - b.index;
    if (at == null) return 1; if (bt == null) return -1; return at - bt;
  });
}

function mapObservationCode(code) {
  const key = String(code || '').trim();
  return key ? (OBSERVATION_CODE_MAP[key] || null) : null;
}

function buildHistory(observations = [], maxEvents = 20) {
  let lastStatus = STATUS.REGISTERED;
  return orderObservations(observations).map(row => {
    let status = mapObservationCode(row.code);
    if (status) lastStatus = status;
    else if (OBSERVATION_META_CODES.has(row.code)) status = lastStatus;
    return {
      timestamp: row.timestamp || '', status: status || null,
      raw_status: row.description || '', observation_code: row.code || '',
    };
  }).slice(-Math.max(1, Number(maxEvents) || 20));
}

function deriveCanonicalStatus({ delivered = false, observations = [], officialStatus = '' } = {}) {
  if (delivered) return STATUS.DELIVERED;
  const history = buildHistory(observations, 1000);
  const known = history.filter(row => row.status);
  if (known.length) return known[known.length - 1].status;
  const raw = String(officialStatus || '').trim().toLowerCase().replace(/-/g, ' ');
  if (!raw) return STATUS.UNKNOWN;
  for (const [pattern, status] of STATUS_PATTERNS) if (raw.includes(pattern)) return status;
  return STATUS.UNKNOWN;
}

function convertDimensions(native = null) {
  if (!native || typeof native !== 'object') return { weightKg: null, dimensions: null, text: '' };
  const weightG = Number(native.weight);
  const weightKg = Number.isFinite(weightG) ? weightG / 1000 : null;
  const depthMm = Number(native.depth); const widthMm = Number(native.width); const heightMm = Number(native.height);
  if (![depthMm, widthMm, heightMm].every(Number.isFinite)) return { weightKg, dimensions: null, text: '' };
  const dimensions = { length: depthMm / 10, width: widthMm / 10, height: heightMm / 10 };
  const text = `${Math.round(dimensions.length)} × ${Math.round(dimensions.width)} × ${Math.round(dimensions.height)} cm`;
  return { weightKg, dimensions: { ...dimensions, text }, text };
}

function historyText(history = []) {
  return (history || []).map(row => [row.timestamp, row.status, row.observation_code, row.raw_status].filter(Boolean).join(' · ')).join('\n');
}

module.exports = { STATUS, OBSERVATION_CODE_MAP, OBSERVATION_META_CODES, extractObservations, orderObservations, mapObservationCode, buildHistory, deriveCanonicalStatus, convertDimensions, historyText };
