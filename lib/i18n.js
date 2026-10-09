'use strict';

/**
 * Runtime localisation helper. All user-facing runtime text lives in tables keyed by
 * Homey language code (en, nl, de, fr, it, sv, no, es, da, ru, pl, ko, ar) with English
 * as the base/fallback language; variables are filled by name ({carrier}), never by
 * concatenating translated fragments. Dates and numbers are formatted with Intl for the
 * user's language instead of hand-built strings.
 */
const LANGUAGES = ['en', 'nl', 'de', 'fr', 'it', 'sv', 'no', 'es', 'da', 'ru', 'pl', 'ko', 'ar'];
const LOCALES = { en: 'en-GB', nl: 'nl-NL', de: 'de-DE', fr: 'fr-FR', it: 'it-IT', sv: 'sv-SE', no: 'nb-NO', es: 'es-ES', da: 'da-DK', ru: 'ru-RU', pl: 'pl-PL', ko: 'ko-KR', ar: 'ar' };

function language(homey) {
  try {
    const l = String(homey?.i18n?.getLanguage?.() || 'en').toLowerCase().split(/[-_]/)[0];
    return LANGUAGES.includes(l) ? l : 'en';
  } catch (_) { return 'en'; }
}

function fill(text, vars = {}) {
  return String(text == null ? '' : text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

/** tr(homey, { en: 'Hello {name}', nl: 'Hallo {name}', … }, { name }) */
function tr(homey, table, vars = {}) {
  if (!table || typeof table !== 'object') return fill(table, vars);
  const l = language(homey);
  return fill(table[l] !== undefined ? table[l] : table.en, vars);
}

/** Plural-aware: table values may be { one, other } (CLDR categories). */
function trCount(homey, table, count, vars = {}) {
  const l = language(homey);
  const entry = table[l] !== undefined ? table[l] : table.en;
  if (entry && typeof entry === 'object') {
    let cat = 'other';
    try { cat = new Intl.PluralRules(LOCALES[l]).select(Number(count)); } catch (_) { /* default */ }
    return fill(entry[cat] !== undefined ? entry[cat] : entry.other, { count, ...vars });
  }
  return fill(entry, { count, ...vars });
}

function locale(homey) { return LOCALES[language(homey)]; }

function formatDate(homey, value, options = { day: 'numeric', month: 'short', year: 'numeric' }, timeZone) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try { return new Intl.DateTimeFormat(locale(homey), { ...options, ...(timeZone ? { timeZone } : {}) }).format(d); } catch (_) { return d.toISOString(); }
}

function formatNumber(homey, value, options = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  try { return new Intl.NumberFormat(locale(homey), options).format(n); } catch (_) { return String(n); }
}

/** Error with a localised message (for pairing/repair handlers and Flow cards). */
function localError(homey, table, vars) { return new Error(tr(homey, table, vars)); }

/** Display weight in kilograms ("1,2 kg", "1.2 kg", "١٫٢ كغ"); '' for unknown values. */
function formatWeight(homey, kg) {
  if (kg === null || kg === undefined || kg === '') return '';
  const n = Number(kg);
  if (!Number.isFinite(n)) return String(kg);
  try { return new Intl.NumberFormat(locale(homey), { style: 'unit', unit: 'kilogram', maximumFractionDigits: 3 }).format(n); } catch (_) { return `${n} kg`; }
}

/**
 * Display dimensions: { length, width, height } (cm) or a carrier text such as "34 x 25 x 5 cm";
 * numbers are re-formatted for the user's language, any other text is kept as written.
 */
function formatDimensions(homey, value) {
  if (!value) return '';
  if (typeof value === 'object') {
    const nums = [value.length, value.width, value.height].map(Number);
    if (nums.every(Number.isFinite)) return `${nums.map(n => formatNumber(homey, n, { maximumFractionDigits: 1 })).join(' × ')} cm`;
    return value.text ? formatDimensions(homey, String(value.text)) : '';
  }
  const text = String(value);
  const match = text.match(/^\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\s*$/i);
  if (!match) return text;
  const nums = match.slice(1, 4).map(v => formatNumber(homey, Number(v.replace(',', '.')), { maximumFractionDigits: 1 }));
  return `${nums.join(' × ')}${match[4] ? ` ${match[4].toLowerCase()}` : ''}`;
}

/** Country / region name in the user's language (ISO 3166 code such as 'NL'). */
function regionName(homey, code) {
  const value = String(code || '').toUpperCase();
  if (!value) return '';
  try { return new Intl.DisplayNames([locale(homey)], { type: 'region' }).of(value) || value; } catch (_) { return value; }
}

module.exports = {
  LANGUAGES, LOCALES, language, locale, tr, trCount, fill, formatDate, formatNumber, localError, formatWeight, formatDimensions, regionName,
};
