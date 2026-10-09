#!/usr/bin/env node
'use strict';

/*
 * Localisation check for the runtime JS (app.js, the existing carrier drivers and lib/*.js).
 *   node tools/i18n-check-runtime.js            → exits 1 and lists problems, 0 when clean
 *
 * Checks
 *  1. two-language switches   getLanguage() === 'nl' ? … : …, _lang() === 'de', language === 'nl' …
 *  2. translation tables      every object literal with an `en` key has all 13 languages, and no
 *                             language is a plain copy of the English text (brand names excepted)
 *  3. user-facing literals    Error messages, warnings, notifications, unavailable texts and capability
 *                             values written as English/Dutch literals. In the carrier libraries an
 *                             English source message is fine when lib/messages-i18n.js translates it
 *                             (ERROR_PATTERNS); log-only errors carry an `i18n-ignore` comment.
 *  4. hand-built display locales such as 'nl-NL' ternaries.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LANGS = ['en', 'nl', 'de', 'fr', 'it', 'sv', 'no', 'es', 'da', 'ru', 'pl', 'ko', 'ar'];
const DRIVERS = ['ampere', 'bpost', 'budbee', 'dhl-express', 'dhl-parcel', 'dpd', 'fedex', 'gls', 'homerr', 'inpost-uk', 'post-dhl-de', 'postnl', 'royal-mail', 'ups'];
// Owned elsewhere (new carriers) – not checked here.
const SKIP_LIB = /^(trunkrs|dynalogic|dragonfly|mondial-relay|amazon)-|^i18n\.js$/;

// Identical to English on purpose: real words that are the same in that language, or product names.
const SAME_AS_ENGLISH = new Set([
  'Problem', 'PostNL Point', 'Status', 'Budbee Box',
]);

function files() {
  const out = ['app.js'];
  for (const d of DRIVERS) for (const f of ['device.js', 'driver.js']) {
    const p = path.join('drivers', d, f);
    if (fs.existsSync(path.join(ROOT, p))) out.push(p);
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'lib')).sort()) if (f.endsWith('.js') && !SKIP_LIB.test(f)) out.push(path.join('lib', f));
  return out;
}

const problems = [];
let tablesChecked = 0;
const report = (file, line, msg) => problems.push(`${file}:${line}  ${msg}`);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* 1. two-language switches ------------------------------------------------ */
const SWITCH = /(getLanguage\(\)|_lang\(\)|\b_nl\(\)|\blang(?:uage)?\b)\s*===?\s*['"](?:nl|en|de|fr)['"]/g;

/* 2. tables ---------------------------------------------------------------- */
function enclosingObject(text, index) {
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    const c = text[i];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) return i; depth--; }
  }
  return -1;
}
function matchingBrace(text, start) {
  let depth = 0; let quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function strings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}
function brandOnly(s) {
  // Only placeholders, digits, punctuation and product names → identical text is fine.
  return !String(s).replace(/\{\w+\}/g, '').replace(/\b(PostNL|DHL|DPD|GLS|UPS|FedEx|InPost|Budbee|bpost|Vinted Go|Royal Mail|Ampère|MyParcel|Homey|Packstation|ServicePoint|Track & Trace|ParcelShop|Click & Drop|API|ID|URL|HTTP|bol\.com)\b/g, '').replace(/[\s\d\W_]/g, '');
}
function checkTables(file, text) {
  const seen = new Set();
  const re = /(?:^|[\s{,])["']?en["']?\s*:/g;
  let m;
  while ((m = re.exec(text))) {
    const start = enclosingObject(text, m.index + m[0].length - 1);
    if (start < 0 || seen.has(start)) continue;
    seen.add(start);
    const end = matchingBrace(text, start);
    if (end < 0) continue;
    let table;
    try { table = Function(`"use strict"; return (${text.slice(start, end + 1)});`)(); } catch (_) { continue; }
    if (!table || typeof table !== 'object' || !('en' in table)) continue;
    const keys = Object.keys(table);
    if (!keys.some(k => k !== 'en' && LANGS.includes(k))) continue; // not a language table (e.g. { en: 0 } index maps)
    tablesChecked += 1;
    const line = lineOf(text, start);
    const missing = LANGS.filter(l => !(l in table));
    if (missing.length) report(file, line, `translation table misses: ${missing.join(', ')}`);
    const en = strings(table.en);
    for (const l of LANGS) {
      if (l === 'en' || !(l in table)) continue;
      const values = strings(table[l]);
      values.forEach((v, i) => {
        if (v === en[i] && !brandOnly(v) && !SAME_AS_ENGLISH.has(v)) report(file, line, `${l} is an English copy: "${v}"`);
      });
    }
  }
}

/* 3. literals -------------------------------------------------------------- */
let translateMessage = null;
try { ({ translateMessage } = require(path.join(ROOT, 'lib', 'messages-i18n'))); } catch (error) { problems.push(`lib/messages-i18n.js cannot be loaded: ${error.message}`); }
const fakeHomey = { i18n: { getLanguage: () => 'nl' } };

function literalAt(text, index) {
  const q = text[index];
  if (!['"', "'", '`'].includes(q)) return null;
  let out = '';
  for (let i = index + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { out += text[i + 1]; i++; continue; }
    if (c === q) return out;
    if (q === '`' && c === '$' && text[i + 1] === '{') {
      let depth = 0; let j = i + 1;
      for (; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}') { depth--; if (!depth) break; } }
      out += '500'; i = j; continue;
    }
    out += c;
  }
  return null;
}
const lineText = (text, index) => text.slice(text.lastIndexOf('\n', index) + 1, text.indexOf('\n', index) === -1 ? text.length : text.indexOf('\n', index));
const words = s => /[A-Za-zÀ-ÿ]{3,}\s+[A-Za-zÀ-ÿ]{2,}/.test(s);

function checkLiterals(file, text) {
  const isLib = file.startsWith('lib');
  const ERR = /new\s+\w*Error\(\s*(?=['"`])/g;
  let m;
  while ((m = ERR.exec(text))) {
    const msg = literalAt(text, m.index + m[0].length);
    if (msg === null || !words(msg)) continue;
    const line = lineText(text, m.index);
    if (/i18n-ignore/.test(line)) continue;
    if (translateMessage && translateMessage(fakeHomey, msg)) {
      if (isLib || /i18n: translated by messages-i18n/.test(line)) continue;
    }
    report(file, lineOf(text, m.index), `untranslated error message: "${msg}"`);
  }
  const CALLS = /(setWarning|setUnavailable|_set|setCapabilityValue)\(([^()]*?,\s*)?(?=['"`])|excerpt\s*:\s*(?=['"`])|title\s*:\s*(?=['"`])|name\s*:\s*(?=['"`][A-Z][a-z]+ [a-z])/g;
  while ((m = CALLS.exec(text))) {
    if (m[1] && /^(_set|setCapabilityValue)$/.test(m[1]) && !m[2]) continue;
    const msg = literalAt(text, m.index + m[0].length);
    if (msg === null || !words(msg) || brandOnly(msg)) continue;
    if (/i18n-ignore/.test(lineText(text, m.index))) continue;
    report(file, lineOf(text, m.index), `untranslated user-facing text: "${msg}"`);
  }
}

/* 4. display locales ------------------------------------------------------- */
const LOCALE_TERNARY = /\?\s*['"](nl-NL|de-DE|fr-FR)['"]\s*:/g;

for (const file of files()) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let m;
  SWITCH.lastIndex = 0;
  while ((m = SWITCH.exec(text))) report(file, lineOf(text, m.index), `two-language switch: ${lineText(text, m.index).trim().slice(0, 120)}`);
  LOCALE_TERNARY.lastIndex = 0;
  while ((m = LOCALE_TERNARY.exec(text))) report(file, lineOf(text, m.index), `hand-picked display locale: ${m[0]}`);
  checkTables(file, text);
  checkLiterals(file, text);
}

if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\n${problems.length} localisation problem(s).`);
  process.exit(1);
}
console.log(`i18n check: ${files().length} files, ${tablesChecked} translation tables clean (13 languages, no two-language switches, no untranslated user-facing literals).`);
