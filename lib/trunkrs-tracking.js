'use strict';

/*
 * Trunkrs tracking – port of ha-trunkrs (https://github.com/ha-parcel-integrations/ha-trunkrs),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 * Keyless consumer tracking API (reverse-engineered from parcel.trunkrs.nl): one parcel is addressed by
 * HTTP Basic auth with the Trunkrs number as username and the receiver's postcode as password.
 */

const { CarrierError, request, parseJson, retryAfter, isObject, str, sortHistory } = require('./carrier-http');

const API = 'https://api.trunkrs.app/v2';
const VERIFY_URL = `${API}/tracing/verify`;
const DETAILS_URL = `${API}/tracing/details`;
const TRACKING_URL = 'https://parcel.trunkrs.nl/';
const C = 'Trunkrs';
const HISTORY_MAX_EVENTS = 20;

/** Trunkrs delivers in the Netherlands; ha-trunkrs validates the hub postcode as a Dutch one. */
const COUNTRIES = {
  NL: { code: 'NL', label: { en: 'Netherlands', nl: 'Nederland' }, postcode: /^\d{4}[A-Z]{2}$/, postcodeExample: '1234AB', timeZone: 'Europe/Amsterdam' },
};

/** ha-trunkrs `_STATUS_MAP` – only observed values; anything else is `unknown` on purpose. */
const STATUS_MAP = {
  DATA_PROCESSED: 'registered',
  SHIPMENT_SORTED: 'in_transit',
  SHIPMENT_SORTED_AT_SUB_DEPOT: 'in_transit',
  SHIPMENT_ACCEPTED_BY_DRIVER: 'out_for_delivery',
  SHIPMENT_DELIVERED: 'delivered',
};
const STATE_DELIVERED = 'SHIPMENT_DELIVERED';
const STATUS_TEXT = {
  DATA_PROCESSED: 'Expected',
  SHIPMENT_SORTED: 'Sorted',
  SHIPMENT_SORTED_AT_SUB_DEPOT: 'Sorted at a sub-depot',
  SHIPMENT_ACCEPTED_BY_DRIVER: 'On its way',
  SHIPMENT_DELIVERED: 'Delivered',
};

/** Display translations of the event labels above (the English label stays the stored/compared value). */
const LABELS = {
  Expected: { en: 'Expected', nl: 'Verwacht', de: 'Erwartet', fr: 'Attendu', it: 'Previsto', sv: 'Förväntat', no: 'Forventet', es: 'Previsto', da: 'Forventet', ru: 'Ожидается', pl: 'Oczekiwana', ko: '예정', ar: 'متوقع' },
  Sorted: { en: 'Sorted', nl: 'Gesorteerd', de: 'Sortiert', fr: 'Trié', it: 'Smistato', sv: 'Sorterat', no: 'Sortert', es: 'Clasificado', da: 'Sorteret', ru: 'Отсортировано', pl: 'Posortowana', ko: '분류 완료', ar: 'تم الفرز' },
  'Sorted at a sub-depot': { en: 'Sorted at a sub-depot', nl: 'Gesorteerd bij een subdepot', de: 'In einem Unterdepot sortiert', fr: 'Trié dans un dépôt secondaire', it: 'Smistato in un deposito secondario', sv: 'Sorterat på en underdepå', no: 'Sortert på et underdepot', es: 'Clasificado en un subdepósito', da: 'Sorteret på et underdepot', ru: 'Отсортировано на субдепо', pl: 'Posortowana w oddziale', ko: '하위 물류센터에서 분류됨', ar: 'تم الفرز في مستودع فرعي' },
  'On its way': { en: 'On its way', nl: 'Onderweg', de: 'Unterwegs', fr: 'En route', it: 'In viaggio', sv: 'På väg', no: 'Underveis', es: 'En camino', da: 'Undervejs', ru: 'В пути', pl: 'W drodze', ko: '배송 중', ar: 'في الطريق' },
  Delivered: { en: 'Delivered', nl: 'Bezorgd', de: 'Zugestellt', fr: 'Livré', it: 'Consegnato', sv: 'Levererat', no: 'Levert', es: 'Entregado', da: 'Leveret', ru: 'Доставлено', pl: 'Doręczona', ko: '배송 완료', ar: 'تم التسليم' },
};
function labelText(homey, text) { return LABELS[text] ? require('./i18n').tr(homey, LABELS[text]) : text; }

/** User-facing texts (lib/i18n.js tables). */
const TEXT = {
  invalidCode: {
    en: 'Enter a valid Trunkrs number.', nl: 'Vul een geldig Trunkrs-nummer in.', de: 'Gib eine gültige Trunkrs-Nummer ein.',
    fr: 'Saisissez un numéro Trunkrs valide.', it: 'Inserisci un numero Trunkrs valido.', sv: 'Ange ett giltigt Trunkrs-nummer.',
    no: 'Skriv inn et gyldig Trunkrs-nummer.', es: 'Introduce un número de Trunkrs válido.', da: 'Indtast et gyldigt Trunkrs-nummer.',
    ru: 'Введите действительный номер Trunkrs.', pl: 'Wpisz prawidłowy numer Trunkrs.', ko: '올바른 Trunkrs 번호를 입력하세요.', ar: 'أدخل رقم Trunkrs صالحًا.',
  },
  invalidPostcode: {
    en: 'Enter a valid Dutch postcode, for example 1234AB.', nl: 'Vul een geldige Nederlandse postcode in, bijvoorbeeld 1234AB.',
    de: 'Gib eine gültige niederländische Postleitzahl ein, zum Beispiel 1234AB.', fr: 'Saisissez un code postal néerlandais valide, par exemple 1234AB.',
    it: 'Inserisci un codice postale olandese valido, ad esempio 1234AB.', sv: 'Ange ett giltigt nederländskt postnummer, till exempel 1234AB.',
    no: 'Skriv inn et gyldig nederlandsk postnummer, for eksempel 1234AB.', es: 'Introduce un código postal neerlandés válido, por ejemplo 1234AB.',
    da: 'Indtast et gyldigt hollandsk postnummer, for eksempel 1234AB.', ru: 'Введите действительный нидерландский почтовый индекс, например 1234AB.',
    pl: 'Wpisz prawidłowy holenderski kod pocztowy, na przykład 1234AB.', ko: '올바른 네덜란드 우편번호를 입력하세요(예: 1234AB).',
    ar: 'أدخل رمزًا بريديًا هولنديًا صالحًا، مثل 1234AB.',
  },
  unknownParcel: {
    en: 'Trunkrs does not know parcel {code} with postcode {postcode}. Check the number and the postcode.',
    nl: 'Trunkrs kent pakket {code} met postcode {postcode} niet. Controleer het nummer en de postcode.',
    de: 'Trunkrs kennt die Sendung {code} mit der Postleitzahl {postcode} nicht. Prüfe die Nummer und die Postleitzahl.',
    fr: 'Trunkrs ne connaît pas le colis {code} avec le code postal {postcode}. Vérifiez le numéro et le code postal.',
    it: 'Trunkrs non conosce il pacco {code} con il codice postale {postcode}. Controlla il numero e il codice postale.',
    sv: 'Trunkrs känner inte till paketet {code} med postnumret {postcode}. Kontrollera numret och postnumret.',
    no: 'Trunkrs kjenner ikke til pakken {code} med postnummeret {postcode}. Kontroller nummeret og postnummeret.',
    es: 'Trunkrs no conoce el paquete {code} con el código postal {postcode}. Comprueba el número y el código postal.',
    da: 'Trunkrs kender ikke pakken {code} med postnummeret {postcode}. Kontrollér nummeret og postnummeret.',
    ru: 'Trunkrs не знает посылку {code} с почтовым индексом {postcode}. Проверьте номер и индекс.',
    pl: 'Trunkrs nie zna przesyłki {code} z kodem pocztowym {postcode}. Sprawdź numer i kod pocztowy.',
    ko: 'Trunkrs에서 우편번호 {postcode}의 소포 {code}을(를) 찾을 수 없습니다. 번호와 우편번호를 확인하세요.',
    ar: 'لا تعرف Trunkrs الطرد {code} بالرمز البريدي {postcode}. تحقق من الرقم والرمز البريدي.',
  },
};

/** ha-trunkrs `normalize_trunkrs_nr` (trim + upper case); separators are dropped as well. */
function normalizeCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }

function normalizePostcode(value) { return String(value || '').replace(/\s+/g, '').toUpperCase(); }

function validPostcode(value, country = 'NL') { return (COUNTRIES[country] || COUNTRIES.NL).postcode.test(normalizePostcode(value)); }

function basicAuth(code, postcode) {
  return `Basic ${Buffer.from(`${code}:${normalizePostcode(postcode)}`, 'utf8').toString('base64')}`;
}

class TrunkrsClient {
  constructor({ fetchFn = fetch } = {}) { this.fetchFn = fetchFn; }

  async _get(url, code, postcode) {
    return request(url, { headers: { Accept: 'application/json', Authorization: basicAuth(code, postcode) } }, { carrier: C, fetchFn: this.fetchFn });
  }

  /** true when Trunkrs knows the number+postcode pair (any 2xx), false on 401/403; throws otherwise. */
  async verify(code, postcode) {
    const res = await this._get(VERIFY_URL, code, postcode);
    if (res.status >= 200 && res.status < 300) return true;
    if (res.status === 401 || res.status === 403) return false;
    if (res.status === 429) throw new CarrierError('Trunkrs rate limit reached', { status: 429, retryAfter: retryAfter(res) });
    throw new CarrierError(`Trunkrs request failed (HTTP ${res.status})`, { status: res.status });
  }

  /** Parsed /tracing/details payload, null for an empty/unknown parcel; 401/403 → auth error (wrong number/postcode). */
  async parcel(code, postcode) {
    const res = await this._get(DETAILS_URL, code, postcode);
    if (res.status === 401 || res.status === 403) throw new CarrierError(`Trunkrs rejected ${code} – check the number and postcode`, { status: res.status, auth: true });
    if (res.status === 404) return null;
    if (res.status === 429) throw new CarrierError('Trunkrs rate limit reached', { status: 429, retryAfter: retryAfter(res) });
    const text = await res.text();
    if (res.status !== 200) throw new CarrierError(`Trunkrs request failed (HTTP ${res.status})`, { status: res.status });
    const body = parseJson(text); // content type is not verified upstream: parse leniently
    return isObject(body) ? body : null;
  }
}

/** Only what normalize() reads – no addresses, coordinates, driver ids or audit logs in the store. */
function slim(raw) {
  if (!isObject(raw)) return raw;
  const pick = (obj, keys) => (isObject(obj) ? Object.fromEntries(keys.filter(k => k in obj).map(k => [k, obj[k]])) : obj);
  return {
    trunkrsNr: raw.trunkrsNr, senderName: raw.senderName, merchantName: raw.merchantName, recipientName: raw.recipientName, product: raw.product,
    currentState: pick(raw.currentState, ['stateName', 'setAt', 'reasonCode']),
    deliveryAttempts: Array.isArray(raw.deliveryAttempts) ? raw.deliveryAttempts.map(a => pick(a, ['stateName', 'setAt', 'reasonCode'])) : [],
    timeSlot: pick(raw.timeSlot, ['low', 'high', 'from', 'to']),
  };
}

function mapStatus(state) { return state ? (STATUS_MAP[state] || 'unknown') : 'unknown'; }

function label(state) { return STATUS_TEXT[state] || state || ''; }

/** ha-trunkrs `build_history`: deliveryAttempts[] (the driver-identifying auditLogs are deliberately skipped). */
function buildHistory(raw) {
  const out = [];
  for (const a of Array.isArray(raw.deliveryAttempts) ? raw.deliveryAttempts : []) {
    if (!isObject(a) || !a.setAt) continue;
    out.push({ timestamp: String(a.setAt), status: a.stateName ? mapStatus(a.stateName) : null, rawStatus: label(a.stateName) });
  }
  // Without any attempt yet, the current state still is the latest event (keeps "last event" meaningful).
  const state = isObject(raw.currentState) ? raw.currentState : {};
  if (state.stateName && state.setAt && !out.some(e => e.timestamp === String(state.setAt))) {
    out.push({ timestamp: String(state.setAt), status: mapStatus(state.stateName), rawStatus: label(state.stateName) });
  }
  return sortHistory(out, HISTORY_MAX_EVENTS);
}

function trackingUrl(code, postcode) {
  const pc = normalizePostcode(postcode);
  return pc ? `${TRACKING_URL}${code}/${pc}` : TRACKING_URL;
}

/** ha-trunkrs `normalize_parcel`; `opts.postcode` builds the deep link. */
function normalize(raw, code, opts = {}) {
  const barcode = normalizeCode(code || raw?.trunkrsNr);
  const pending = !isObject(raw) || !Object.keys(raw).length;
  const r = pending ? {} : raw;
  const state = isObject(r.currentState) ? r.currentState : {};
  const stateName = str(state.stateName);
  const status = mapStatus(stateName);
  const delivered = stateName === STATE_DELIVERED;
  const slot = isObject(r.timeSlot) ? r.timeSlot : {};
  // Narrow live prediction (from/to) first, the wide promised slot (low/high) as fallback; cleared once delivered.
  const plannedFrom = delivered ? null : (slot.from || slot.low || null);
  const plannedTo = delivered ? null : (slot.to || slot.high || null);
  return {
    barcode,
    sender: str(r.senderName || r.merchantName),
    receiver: str(r.recipientName),
    status,
    rawStatus: label(stateName),
    statusCode: stateName,
    delivered,
    deliveredAt: delivered && state.setAt ? String(state.setAt) : null,
    plannedFrom,
    plannedTo,
    windowKnown: Boolean(plannedFrom && plannedTo),
    pickup: false,
    pickupPoint: '',
    url: barcode ? trackingUrl(barcode, opts.postcode) : '',
    weight: null,
    dimensions: null,
    history: pending ? [] : buildHistory(r),
    direction: 'incoming',
    service: str(r.product),
    origin: '',
    destination: '',
    pickupCode: '',
    pickupDeadline: null,
    item: '',
    stopsUntilYou: null,
    pending,
  };
}

module.exports = {
  TrunkrsClient, normalize, normalizeCode, normalizePostcode, validPostcode, slim, mapStatus, buildHistory,
  COUNTRIES, STATUS_MAP, TEXT, VERIFY_URL, DETAILS_URL, TRACKING_URL, labelText, LABELS };
