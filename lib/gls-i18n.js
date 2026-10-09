'use strict';

// Generated from the MyParcel GLS translation table (13 languages).
const STATUS_TEXT = {
  "registered": {
    "en": "Registered",
    "nl": "Aangemeld",
    "de": "Angekündigt",
    "fr": "Annoncé",
    "it": "Registrato",
    "sv": "Registrerad",
    "no": "Registrert",
    "es": "Registrado",
    "da": "Registreret",
    "ru": "Зарегистрирована",
    "pl": "Zarejestrowana",
    "ko": "접수됨",
    "ar": "مسجّل"
  },
  "in_transit": {
    "en": "In transit",
    "nl": "Onderweg",
    "de": "Unterwegs",
    "fr": "En transit",
    "it": "In transito",
    "sv": "På väg",
    "no": "Underveis",
    "es": "En tránsito",
    "da": "Undervejs",
    "ru": "В пути",
    "pl": "W drodze",
    "ko": "배송 중",
    "ar": "قيد النقل"
  },
  "out_for_delivery": {
    "en": "Out for delivery",
    "nl": "Onderweg voor bezorging",
    "de": "In Zustellung",
    "fr": "En cours de livraison",
    "it": "In consegna",
    "sv": "Ute för leverans",
    "no": "Ute for levering",
    "es": "En reparto",
    "da": "Ude til levering",
    "ru": "Передана курьеру",
    "pl": "W doręczeniu",
    "ko": "배송 출발",
    "ar": "خرج للتوصيل"
  },
  "at_pickup_point": {
    "en": "Ready for pickup",
    "nl": "Klaar om op te halen",
    "de": "Abholbereit",
    "fr": "Prêt à être retiré",
    "it": "Pronto per il ritiro",
    "sv": "Redo att hämtas",
    "no": "Klar for henting",
    "es": "Listo para recoger",
    "da": "Klar til afhentning",
    "ru": "Готова к выдаче",
    "pl": "Gotowa do odbioru",
    "ko": "픽업 준비 완료",
    "ar": "جاهز للاستلام"
  },
  "delivered": {
    "en": "Delivered",
    "nl": "Bezorgd",
    "de": "Zugestellt",
    "fr": "Livré",
    "it": "Consegnato",
    "sv": "Levererad",
    "no": "Levert",
    "es": "Entregado",
    "da": "Leveret",
    "ru": "Доставлена",
    "pl": "Doręczona",
    "ko": "배송 완료",
    "ar": "تم التسليم"
  },
  "returning": {
    "en": "Returning to sender",
    "nl": "Retour naar afzender",
    "de": "Rücksendung an Absender",
    "fr": "Retour à l'expéditeur",
    "it": "In restituzione al mittente",
    "sv": "Returneras till avsändaren",
    "no": "Returneres til avsender",
    "es": "Devolviendo al remitente",
    "da": "Returneres til afsender",
    "ru": "Возврат отправителю",
    "pl": "Zwrot do nadawcy",
    "ko": "발송인에게 반송 중",
    "ar": "يعود إلى المرسل"
  },
  "problem": {
    "en": "Problem",
    "nl": "Probleem",
    "de": "Problem",
    "fr": "Problème",
    "it": "Problema",
    "sv": "Problem",
    "no": "Problem",
    "es": "Problema",
    "da": "Problem",
    "ru": "Проблема",
    "pl": "Problem",
    "ko": "문제",
    "ar": "مشكلة"
  },
  "unknown": {
    "en": "Not yet known at GLS",
    "nl": "Nog niet bekend bij GLS",
    "de": "Noch nicht bei GLS bekannt",
    "fr": "Pas encore connu chez GLS",
    "it": "Non ancora noto a GLS",
    "sv": "Ännu inte känt hos GLS",
    "no": "Ikke kjent hos GLS ennå",
    "es": "Aún no conocido por GLS",
    "da": "Endnu ikke kendt hos GLS",
    "ru": "Пока неизвестна в GLS",
    "pl": "Jeszcze nieznana w GLS",
    "ko": "GLS에 아직 등록되지 않음",
    "ar": "غير معروف لدى GLS بعد"
  }
};

const TEXT = {
  "no_parcels": {
    "en": "No GLS parcels",
    "nl": "Geen GLS-pakketten",
    "de": "Keine GLS-Pakete",
    "fr": "Aucun colis GLS",
    "it": "Nessun pacco GLS",
    "sv": "Inga GLS-paket",
    "no": "Ingen GLS-pakker",
    "es": "No hay paquetes GLS",
    "da": "Ingen GLS-pakker",
    "ru": "Нет посылок GLS",
    "pl": "Brak paczek GLS",
    "ko": "GLS 택배 없음",
    "ar": "لا توجد طرود GLS"
  },
  "setup_needed": {
    "en": "Enter a valid postal code in the device settings",
    "nl": "Vul een geldige postcode in bij de apparaatinstellingen",
    "de": "Gültige Postleitzahl in den Geräteeinstellungen eingeben",
    "fr": "Saisissez un code postal valide dans les réglages de l’appareil",
    "it": "Enter a valid postal code in the device settings",
    "sv": "Enter a valid postal code in the device settings",
    "no": "Enter a valid postal code in the device settings",
    "es": "Enter a valid postal code in the device settings",
    "da": "Enter a valid postal code in the device settings",
    "ru": "Enter a valid postal code in the device settings",
    "pl": "Enter a valid postal code in the device settings",
    "ko": "Enter a valid postal code in the device settings",
    "ar": "Enter a valid postal code in the device settings"
  },
  "gls_unreachable": {
    "en": "GLS is temporarily unreachable; showing the last known data",
    "nl": "GLS is tijdelijk niet bereikbaar; laatst bekende gegevens worden getoond",
    "de": "GLS ist vorübergehend nicht erreichbar; letzte bekannte Daten werden angezeigt",
    "fr": "GLS est temporairement inaccessible ; dernières données connues affichées",
    "it": "GLS is temporarily unreachable; showing the last known data",
    "sv": "GLS is temporarily unreachable; showing the last known data",
    "no": "GLS is temporarily unreachable; showing the last known data",
    "es": "GLS is temporarily unreachable; showing the last known data",
    "da": "GLS is temporarily unreachable; showing the last known data",
    "ru": "GLS is temporarily unreachable; showing the last known data",
    "pl": "GLS is temporarily unreachable; showing the last known data",
    "ko": "GLS is temporarily unreachable; showing the last known data",
    "ar": "GLS is temporarily unreachable; showing the last known data"
  },
  "invalid_postcode": {
    "en": "Invalid postal code for {country}. Example: {example}",
    "nl": "Ongeldige postcode voor {country}. Voorbeeld: {example}",
    "de": "Ungültige Postleitzahl für {country}. Beispiel: {example}",
    "fr": "Code postal invalide pour {country}. Exemple : {example}",
    "it": "Invalid postal code for {country}. Example: {example}",
    "sv": "Invalid postal code for {country}. Example: {example}",
    "no": "Invalid postal code for {country}. Example: {example}",
    "es": "Invalid postal code for {country}. Example: {example}",
    "da": "Invalid postal code for {country}. Example: {example}",
    "ru": "Invalid postal code for {country}. Example: {example}",
    "pl": "Invalid postal code for {country}. Example: {example}",
    "ko": "Invalid postal code for {country}. Example: {example}",
    "ar": "Invalid postal code for {country}. Example: {example}"
  },
  "invalid_tracking": {
    "en": "Enter a tracking number.",
    "nl": "Vul een trackingnummer in.",
    "de": "Bitte eine Sendungsnummer eingeben.",
    "fr": "Saisissez un numéro de suivi.",
    "it": "Enter a tracking number.",
    "sv": "Enter a tracking number.",
    "no": "Enter a tracking number.",
    "es": "Enter a tracking number.",
    "da": "Enter a tracking number.",
    "ru": "Enter a tracking number.",
    "pl": "Enter a tracking number.",
    "ko": "Enter a tracking number.",
    "ar": "Enter a tracking number."
  },
  "tomorrow": {
    "en": "tomorrow",
    "nl": "morgen",
    "de": "morgen",
    "fr": "demain",
    "it": "domani",
    "sv": "i morgon",
    "no": "i morgen",
    "es": "mañana",
    "da": "i morgen",
    "ru": "завтра",
    "pl": "jutro",
    "ko": "내일",
    "ar": "غدًا"
  },
  "today": {
    "en": "today",
    "nl": "vandaag",
    "de": "heute",
    "fr": "aujourd’hui",
    "it": "oggi",
    "sv": "i dag",
    "no": "i dag",
    "es": "hoy",
    "da": "i dag",
    "ru": "сегодня",
    "pl": "dzisiaj",
    "ko": "오늘",
    "ar": "اليوم"
  }
};

const COUNTRY_NAMES = {"NL": {"en": "Netherlands", "nl": "Nederland", "de": "Niederlande", "fr": "Pays-Bas", "it": "Netherlands", "sv": "Netherlands", "no": "Netherlands", "es": "Netherlands", "da": "Netherlands", "ru": "Netherlands", "pl": "Netherlands", "ko": "Netherlands", "ar": "Netherlands"}, "BE": {"en": "Belgium", "nl": "België", "de": "Belgien", "fr": "Belgique", "it": "Belgium", "sv": "Belgium", "no": "Belgium", "es": "Belgium", "da": "Belgium", "ru": "Belgium", "pl": "Belgium", "ko": "Belgium", "ar": "Belgium"}, "DE": {"en": "Germany", "nl": "Duitsland", "de": "Deutschland", "fr": "Allemagne", "it": "Germany", "sv": "Germany", "no": "Germany", "es": "Germany", "da": "Germany", "ru": "Germany", "pl": "Germany", "ko": "Germany", "ar": "Germany"}, "AT": {"en": "Austria", "nl": "Oostenrijk", "de": "Österreich", "fr": "Autriche", "it": "Austria", "sv": "Austria", "no": "Austria", "es": "Austria", "da": "Austria", "ru": "Austria", "pl": "Austria", "ko": "Austria", "ar": "Austria"}, "CH": {"en": "Switzerland", "nl": "Zwitserland", "de": "Schweiz", "fr": "Suisse", "it": "Switzerland", "sv": "Switzerland", "no": "Switzerland", "es": "Switzerland", "da": "Switzerland", "ru": "Switzerland", "pl": "Switzerland", "ko": "Switzerland", "ar": "Switzerland"}, "LU": {"en": "Luxembourg", "nl": "Luxemburg", "de": "Luxemburg", "fr": "Luxembourg", "it": "Luxembourg", "sv": "Luxembourg", "no": "Luxembourg", "es": "Luxembourg", "da": "Luxembourg", "ru": "Luxembourg", "pl": "Luxembourg", "ko": "Luxembourg", "ar": "Luxembourg"}, "FR": {"en": "France", "nl": "Frankrijk", "de": "Frankreich", "fr": "France", "it": "France", "sv": "France", "no": "France", "es": "France", "da": "France", "ru": "France", "pl": "France", "ko": "France", "ar": "France"}, "IT": {"en": "Italy", "nl": "Italië", "de": "Italien", "fr": "Italie", "it": "Italy", "sv": "Italy", "no": "Italy", "es": "Italy", "da": "Italy", "ru": "Italy", "pl": "Italy", "ko": "Italy", "ar": "Italy"}, "DK": {"en": "Denmark", "nl": "Denemarken", "de": "Dänemark", "fr": "Danemark", "it": "Denmark", "sv": "Denmark", "no": "Denmark", "es": "Denmark", "da": "Denmark", "ru": "Denmark", "pl": "Denmark", "ko": "Denmark", "ar": "Denmark"}, "FI": {"en": "Finland", "nl": "Finland", "de": "Finnland", "fr": "Finlande", "it": "Finland", "sv": "Finland", "no": "Finland", "es": "Finland", "da": "Finland", "ru": "Finland", "pl": "Finland", "ko": "Finland", "ar": "Finland"}, "IE": {"en": "Ireland", "nl": "Ierland", "de": "Irland", "fr": "Irlande", "it": "Ireland", "sv": "Ireland", "no": "Ireland", "es": "Ireland", "da": "Ireland", "ru": "Ireland", "pl": "Ireland", "ko": "Ireland", "ar": "Ireland"}, "PL": {"en": "Poland", "nl": "Polen", "de": "Polen", "fr": "Pologne", "it": "Poland", "sv": "Poland", "no": "Poland", "es": "Poland", "da": "Poland", "ru": "Poland", "pl": "Poland", "ko": "Poland", "ar": "Poland"}, "CZ": {"en": "Czech Republic", "nl": "Tsjechië", "de": "Tschechien", "fr": "République tchèque", "it": "Czech Republic", "sv": "Czech Republic", "no": "Czech Republic", "es": "Czech Republic", "da": "Czech Republic", "ru": "Czech Republic", "pl": "Czech Republic", "ko": "Czech Republic", "ar": "Czech Republic"}, "SK": {"en": "Slovakia", "nl": "Slowakije", "de": "Slowakei", "fr": "Slovaquie", "it": "Slovakia", "sv": "Slovakia", "no": "Slovakia", "es": "Slovakia", "da": "Slovakia", "ru": "Slovakia", "pl": "Slovakia", "ko": "Slovakia", "ar": "Slovakia"}, "HU": {"en": "Hungary", "nl": "Hongarije", "de": "Ungarn", "fr": "Hongrie", "it": "Hungary", "sv": "Hungary", "no": "Hungary", "es": "Hungary", "da": "Hungary", "ru": "Hungary", "pl": "Hungary", "ko": "Hungary", "ar": "Hungary"}, "SI": {"en": "Slovenia", "nl": "Slovenië", "de": "Slowenien", "fr": "Slovénie", "it": "Slovenia", "sv": "Slovenia", "no": "Slovenia", "es": "Slovenia", "da": "Slovenia", "ru": "Slovenia", "pl": "Slovenia", "ko": "Slovenia", "ar": "Slovenia"}, "HR": {"en": "Croatia", "nl": "Kroatië", "de": "Kroatien", "fr": "Croatie", "it": "Croatia", "sv": "Croatia", "no": "Croatia", "es": "Croatia", "da": "Croatia", "ru": "Croatia", "pl": "Croatia", "ko": "Croatia", "ar": "Croatia"}, "RS": {"en": "Serbia", "nl": "Servië", "de": "Serbien", "fr": "Serbie", "it": "Serbia", "sv": "Serbia", "no": "Serbia", "es": "Serbia", "da": "Serbia", "ru": "Serbia", "pl": "Serbia", "ko": "Serbia", "ar": "Serbia"}, "US": {"en": "United States", "nl": "Verenigde Staten", "de": "Vereinigte Staaten", "fr": "États-Unis", "it": "United States", "sv": "United States", "no": "United States", "es": "United States", "da": "United States", "ru": "United States", "pl": "United States", "ko": "United States", "ar": "United States"}, "CA": {"en": "Canada", "nl": "Canada", "de": "Kanada", "fr": "Canada", "it": "Canada", "sv": "Canada", "no": "Canada", "es": "Canada", "da": "Canada", "ru": "Canada", "pl": "Canada", "ko": "Canada", "ar": "Canada"}};

function lang(homey) {
  try { return homey.i18n.getLanguage() || 'en'; } catch (_) { return 'en'; }
}
function statusText(homey, code) {
  const row = STATUS_TEXT[code] || STATUS_TEXT.unknown;
  return row[lang(homey)] || row.en;
}
function text(homey, key, vars = {}) {
  const row = TEXT[key];
  if (!row) return key;
  return String(row[lang(homey)] || row.en).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}
function countryName(homey, code) {
  const row = COUNTRY_NAMES[code];
  return row ? (row[lang(homey)] || row.en) : code;
}

module.exports = { STATUS_TEXT, statusText, text, countryName, lang };
