'use strict';

/*
 * Dynalogic tracking – port of ha-dynalogic (https://github.com/ha-parcel-integrations/ha-dynalogic),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 * Keyless "track-middleware" API the vendor's own app uses. An order is read with its order number plus the
 * delivery postcode (the second factor that unlocks history and addressee). Netherlands and Belgium.
 */

const { CarrierError, request, parseJson, retryAfter, isObject, str, sortHistory, zonedIso } = require('./carrier-http');

const API = 'https://api.dynagroup.nl/track-middleware/v1';
const TRACKING_SITE_URL = 'https://track.mydynalogic.eu';
const C = 'Dynalogic';
const TIME_ZONE = 'Europe/Amsterdam'; // confirmed upstream against a real delivery; timestamps carry no offset
const HISTORY_MAX_EVENTS = 20;

/** Dynalogic delivers in the Netherlands and Belgium (same endpoint; only the postcode format differs). */
const COUNTRIES = {
  NL: { code: 'NL', label: { en: 'Netherlands', nl: 'Nederland', fr: 'Pays-Bas' }, postcode: /^[1-9][0-9]{3}[A-Z]{2}$/, postcodeExample: '1012AB', timeZone: TIME_ZONE },
  BE: { code: 'BE', label: { en: 'Belgium', nl: 'België', fr: 'Belgique' }, postcode: /^[1-9][0-9]{3}$/, postcodeExample: '1000', timeZone: 'Europe/Brussels' },
};

const KNOWN_RESULT_CODES = new Set([0, 1, 3, 9, 11, 14, 22, 25, 27, 32, 52, 73, 76, 78, 79, 86]);
const COMPLETE_RESULT_CODES = new Set([0]);
const KNOWN_SCENARIOS = new Set(['DEL_DEF', 'DEL_NB', 'DEL_FAIL', 'PU_DEF', 'PU_FAIL', 'SW_DEF', 'SW_FAIL', 'RS_DEF', 'RS_FAIL', 'DP_DEF', 'DP_FAIL', 'COR_DEF', 'COR_FAIL']);
const MIN_STEP = 1;
const MAX_STEP = 4;
const ACTIVITY_TEXT_KEYS = ['Description', 'ActivityDescription', 'Text', 'Name', 'Status', 'StatusDescription', 'ActivityCode', 'Code'];
const ADDRESSEE_NAME_KEYS = ['Name1', 'Company', 'Name', 'FullName', 'Addressee', 'ContactName', 'CompanyName'];

/** User-facing texts (lib/i18n.js tables). */
const TEXT = {
  invalidCode: {
    en: 'Enter a valid Dynalogic order number.', nl: 'Vul een geldig Dynalogic-ordernummer in.', de: 'Gib eine gültige Dynalogic-Auftragsnummer ein.',
    fr: 'Saisissez un numéro de commande Dynalogic valide.', it: 'Inserisci un numero d’ordine Dynalogic valido.', sv: 'Ange ett giltigt Dynalogic-ordernummer.',
    no: 'Skriv inn et gyldig Dynalogic-ordrenummer.', es: 'Introduce un número de pedido de Dynalogic válido.', da: 'Indtast et gyldigt Dynalogic-ordrenummer.',
    ru: 'Введите действительный номер заказа Dynalogic.', pl: 'Wpisz prawidłowy numer zlecenia Dynalogic.', ko: '올바른 Dynalogic 주문 번호를 입력하세요.',
    ar: 'أدخل رقم طلب Dynalogic صالحًا.',
  },
  invalidPostcodeNL: {
    en: 'Enter a valid Dutch postcode, for example 1012AB.', nl: 'Vul een geldige Nederlandse postcode in, bijvoorbeeld 1012AB.',
    de: 'Gib eine gültige niederländische Postleitzahl ein, zum Beispiel 1012AB.', fr: 'Saisissez un code postal néerlandais valide, par exemple 1012AB.',
    it: 'Inserisci un codice postale olandese valido, ad esempio 1012AB.', sv: 'Ange ett giltigt nederländskt postnummer, till exempel 1012AB.',
    no: 'Skriv inn et gyldig nederlandsk postnummer, for eksempel 1012AB.', es: 'Introduce un código postal neerlandés válido, por ejemplo 1012AB.',
    da: 'Indtast et gyldigt hollandsk postnummer, for eksempel 1012AB.', ru: 'Введите действительный нидерландский почтовый индекс, например 1012AB.',
    pl: 'Wpisz prawidłowy holenderski kod pocztowy, na przykład 1012AB.', ko: '올바른 네덜란드 우편번호를 입력하세요(예: 1012AB).',
    ar: 'أدخل رمزًا بريديًا هولنديًا صالحًا، مثل 1012AB.',
  },
  invalidPostcodeBE: {
    en: 'Enter a valid Belgian postcode, for example 1000.', nl: 'Vul een geldige Belgische postcode in, bijvoorbeeld 1000.',
    de: 'Gib eine gültige belgische Postleitzahl ein, zum Beispiel 1000.', fr: 'Saisissez un code postal belge valide, par exemple 1000.',
    it: 'Inserisci un codice postale belga valido, ad esempio 1000.', sv: 'Ange ett giltigt belgiskt postnummer, till exempel 1000.',
    no: 'Skriv inn et gyldig belgisk postnummer, for eksempel 1000.', es: 'Introduce un código postal belga válido, por ejemplo 1000.',
    da: 'Indtast et gyldigt belgisk postnummer, for eksempel 1000.', ru: 'Введите действительный бельгийский почтовый индекс, например 1000.',
    pl: 'Wpisz prawidłowy belgijski kod pocztowy, na przykład 1000.', ko: '올바른 벨기에 우편번호를 입력하세요(예: 1000).',
    ar: 'أدخل رمزًا بريديًا بلجيكيًا صالحًا، مثل 1000.',
  },
  notFound: {
    en: 'Dynalogic does not know order number {code} with postcode {postcode}. Check the number and the delivery postcode, or try again later if the order is new.',
    nl: 'Dynalogic kent ordernummer {code} met postcode {postcode} niet. Controleer het nummer en de bezorgpostcode, of probeer het later opnieuw als de order nieuw is.',
    de: 'Dynalogic kennt die Auftragsnummer {code} mit der Postleitzahl {postcode} nicht. Prüfe die Nummer und die Lieferpostleitzahl oder versuche es später erneut, wenn der Auftrag neu ist.',
    fr: 'Dynalogic ne connaît pas le numéro de commande {code} avec le code postal {postcode}. Vérifiez le numéro et le code postal de livraison, ou réessayez plus tard si la commande est récente.',
    it: 'Dynalogic non conosce il numero d’ordine {code} con il codice postale {postcode}. Controlla il numero e il codice postale di consegna, oppure riprova più tardi se l’ordine è nuovo.',
    sv: 'Dynalogic känner inte till ordernumret {code} med postnumret {postcode}. Kontrollera numret och leveranspostnumret, eller försök igen senare om ordern är ny.',
    no: 'Dynalogic kjenner ikke til ordrenummeret {code} med postnummeret {postcode}. Kontroller nummeret og leveringspostnummeret, eller prøv igjen senere hvis ordren er ny.',
    es: 'Dynalogic no conoce el número de pedido {code} con el código postal {postcode}. Comprueba el número y el código postal de entrega, o vuelve a intentarlo más tarde si el pedido es nuevo.',
    da: 'Dynalogic kender ikke ordrenummeret {code} med postnummeret {postcode}. Kontrollér nummeret og leveringspostnummeret, eller prøv igen senere, hvis ordren er ny.',
    ru: 'Dynalogic не знает номер заказа {code} с почтовым индексом {postcode}. Проверьте номер и индекс доставки или повторите попытку позже, если заказ новый.',
    pl: 'Dynalogic nie zna numeru zlecenia {code} z kodem pocztowym {postcode}. Sprawdź numer i kod pocztowy dostawy lub spróbuj ponownie później, jeśli zlecenie jest nowe.',
    ko: 'Dynalogic에서 우편번호 {postcode}의 주문 번호 {code}을(를) 찾을 수 없습니다. 번호와 배송 우편번호를 확인하거나, 새 주문이라면 나중에 다시 시도하세요.',
    ar: 'لا تعرف Dynalogic رقم الطلب {code} بالرمز البريدي {postcode}. تحقق من الرقم والرمز البريدي للتسليم، أو حاول مرة أخرى لاحقًا إذا كان الطلب جديدًا.',
  },
  cannotConnect: {
    en: 'Dynalogic cannot be reached right now. Try again later.', nl: 'Dynalogic is nu niet bereikbaar. Probeer het later opnieuw.',
    de: 'Dynalogic ist gerade nicht erreichbar. Versuche es später erneut.', fr: 'Dynalogic est injoignable pour le moment. Réessayez plus tard.',
    it: 'Dynalogic non è raggiungibile al momento. Riprova più tardi.', sv: 'Dynalogic går inte att nå just nu. Försök igen senare.',
    no: 'Dynalogic kan ikke nås akkurat nå. Prøv igjen senere.', es: 'No se puede contactar con Dynalogic en este momento. Inténtalo más tarde.',
    da: 'Dynalogic kan ikke nås lige nu. Prøv igen senere.', ru: 'Dynalogic сейчас недоступен. Повторите попытку позже.',
    pl: 'Dynalogic jest teraz niedostępny. Spróbuj ponownie później.', ko: '지금은 Dynalogic에 연결할 수 없습니다. 나중에 다시 시도하세요.',
    ar: 'تعذر الوصول إلى Dynalogic الآن. حاول مرة أخرى لاحقًا.',
  },
};

/** ha-dynalogic `normalize_tracking_code`: upper case, everything but A-Z0-9 dropped. */
function normalizeCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }

function normalizePostcode(value) { return String(value || '').replace(/\s+/g, '').toUpperCase(); }

/** Validates against the chosen market; without one, any Dutch or Belgian postcode passes (ha-dynalogic POSTCODE_RE). */
function validPostcode(value, country) {
  const pc = normalizePostcode(value);
  if (COUNTRIES[country]) return COUNTRIES[country].postcode.test(pc);
  return Object.values(COUNTRIES).some(c => c.postcode.test(pc));
}

/** NL postcodes end in letters, BE ones are four digits – used when no country was chosen. */
function guessCountry(postcode) { return /^[0-9]{4}$/.test(normalizePostcode(postcode)) ? 'BE' : 'NL'; }

function fullUrl(code, postcode) {
  return `${API}/transportorder/full/ordernumber/${encodeURIComponent(code)}/zipcode/${encodeURIComponent(normalizePostcode(postcode).toLowerCase())}`;
}

class DynalogicClient {
  constructor({ fetchFn = fetch } = {}) { this.fetchFn = fetchFn; }

  /** Transport order, or null on a 404 (unknown order, postcode not belonging to it, or not created yet). */
  async parcel(code, postcode) {
    const res = await request(fullUrl(code, postcode), { headers: { Accept: 'application/json' } }, { carrier: C, fetchFn: this.fetchFn });
    if (res.status === 404) return null;
    if (res.status === 429) throw new CarrierError('Dynalogic rate limit reached', { status: 429, retryAfter: retryAfter(res) });
    const text = await res.text();
    if (res.status !== 200) throw new CarrierError(`Dynalogic request failed (HTTP ${res.status})`, { status: res.status });
    const body = parseJson(text);
    if (body === undefined) throw new CarrierError('Dynalogic returned an unreadable response');
    if (!isObject(body)) throw new CarrierError('Dynalogic returned an unexpected response');
    return body;
  }
}

function toInt(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  return /^\s*-?\d+\s*$/.test(String(value)) ? Number.parseInt(String(value), 10) : null;
}

/** ha-dynalogic `map_parcel_status` over Scenario / ActiveStep / TransportResultCode. */
function mapStatus(scenario, activeStep, resultCode) {
  let sc = scenario === null || scenario === undefined ? null : String(scenario).trim().toUpperCase();
  if (sc !== null && (!sc || !KNOWN_SCENARIOS.has(sc))) sc = null;
  const code = toInt(resultCode);
  let step = toInt(activeStep);
  if (step !== null && (step < MIN_STEP || step > MAX_STEP)) step = null;
  if (sc === null && step === null) return 'unknown';
  if (sc && sc.endsWith('_FAIL')) return 'problem';
  if (sc === 'RS_DEF') return 'returning';
  if (code !== null && COMPLETE_RESULT_CODES.has(code) && step === MAX_STEP) return 'delivered';
  if (step === null) return 'unknown';
  if (step >= 3) return 'out_for_delivery';
  if (step === 2) return 'in_transit';
  return 'registered';
}

/** "DEL_DEF/4/0" – the carrier's own status triple. */
function rawTriple(scenario, step, code) {
  const parts = [scenario, step, code];
  if (parts.every(p => p === null || p === undefined)) return '';
  return parts.map(p => (p === null || p === undefined ? '?' : String(p))).join('/');
}

/** Naive ISO (fractional seconds of any length) or compact YYYYMMDDHHmmss, both Amsterdam time; an offset is kept. */
function toIsoTimestamp(value) {
  const text = str(value);
  if (!text) return null;
  let m = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (m) return zonedIso(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, TIME_ZONE);
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return Number.isFinite(Date.parse(text)) ? text : null;
  m = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2}(?::\d{2})?)(?:\.(\d+))?$/);
  if (m) {
    const iso = zonedIso(`${m[1]}T${m[2]}`, TIME_ZONE);
    // keep milliseconds: activities written in the same second are only ordered by them
    return iso && m[3] ? iso.replace(/([+-]\d{2}:\d{2})$/, `.${m[3].slice(0, 3).padEnd(3, '0')}$1`) : iso;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return zonedIso(text, TIME_ZONE);
  return null;
}

function orderData(raw) { return isObject(raw?.OrderData) ? raw.OrderData : {}; }

function activities(raw) { const a = orderData(raw).Activities; return Array.isArray(a) ? a : []; }

function activityText(activity) {
  for (const key of ACTIVITY_TEXT_KEYS) {
    const v = activity[key];
    if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) return String(v).trim();
  }
  return '';
}

function buildHistory(raw) {
  const out = [];
  for (const a of activities(raw)) {
    if (!isObject(a)) continue;
    const timestamp = toIsoTimestamp(a.ExecutedDateTime);
    if (!timestamp) continue;
    out.push({ timestamp, status: null, rawStatus: activityText(a) }); // activities carry no mappable status
  }
  return sortHistory(out, HISTORY_MAX_EVENTS);
}

function sender(raw) { return str(orderData(raw).CustomerName); }

function receiver(raw) {
  const v = orderData(raw).Addressee;
  if (typeof v === 'string') return v.trim();
  if (!isObject(v)) return '';
  for (const key of ADDRESSEE_NAME_KEYS) if (typeof v[key] === 'string' && v[key].trim()) return v[key].trim();
  return '';
}

function latestActivity(raw) {
  let best = null;
  for (const a of activities(raw)) {
    const ts = isObject(a) ? toIsoTimestamp(a.ExecutedDateTime) : null;
    const t = ts ? Date.parse(ts) : NaN;
    if (Number.isFinite(t) && (!best || t > best[0])) best = [t, ts];
  }
  return best ? best[1] : null;
}

/** Only what normalize() reads – the addressee's address, phone numbers and the driver are not stored. */
function slim(raw) {
  if (!isObject(raw)) return raw;
  const od = orderData(raw);
  const name = receiver(raw);
  return {
    TrackAndTraceNumber: raw.TrackAndTraceNumber, Scenario: raw.Scenario, ActiveStep: raw.ActiveStep, TransportResultCode: raw.TransportResultCode,
    DetailCaption: raw.DetailCaption, DetailTextLine2: raw.DetailTextLine2, OrderStatusForAddressee: raw.OrderStatusForAddressee,
    OrderData: {
      CustomerName: od.CustomerName, OrderTypeDescription: od.OrderTypeDescription, Addressee: name ? { Name1: name } : null,
      Activities: activities(raw).filter(isObject).map(a => ({ ExecutedDateTime: a.ExecutedDateTime, Description: activityText(a) })),
    },
  };
}

/** ha-dynalogic `normalize_parcel`. The barcode is the order number the user entered (stable before data exists). */
function normalize(raw, code, opts = {}) {
  const pending = !isObject(raw) || (raw.Scenario === undefined && raw.ActiveStep === undefined && raw.TransportResultCode === undefined && !raw.OrderData);
  const r = pending ? {} : raw;
  const barcode = normalizeCode(code || r.TrackAndTraceNumber);
  const status = mapStatus(r.Scenario, r.ActiveStep, r.TransportResultCode);
  const delivered = status === 'delivered';
  const triple = rawTriple(r.Scenario, r.ActiveStep, r.TransportResultCode);
  return {
    barcode,
    sender: sender(r),
    receiver: receiver(r),
    status,
    rawStatus: str(r.DetailCaption) || triple,
    statusCode: triple,
    delivered,
    deliveredAt: delivered ? latestActivity(r) : null,
    // No structured delivery-window field has been observed yet (only prose inside an activity).
    plannedFrom: null,
    plannedTo: null,
    windowKnown: false,
    pickup: false,
    pickupPoint: '',
    url: '', // e-mailed links carry an encrypted token; no order-number deep link exists
    weight: null,
    dimensions: null,
    history: pending ? [] : buildHistory(r),
    direction: 'incoming',
    service: '',
    origin: '',
    destination: opts.country && COUNTRIES[opts.country] ? opts.country : '',
    pickupCode: '',
    pickupDeadline: null,
    item: '',
    stopsUntilYou: null,
    pending,
  };
}

module.exports = {
  DynalogicClient, normalize, normalizeCode, normalizePostcode, validPostcode, guessCountry, mapStatus, toIsoTimestamp, buildHistory, slim, fullUrl,
  COUNTRIES, TEXT, TRACKING_SITE_URL, KNOWN_RESULT_CODES,
};
