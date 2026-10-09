'use strict';

const { language, tr, regionName } = require('./i18n');

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
    "en": "Not yet known at {carrier}",
    "nl": "Nog niet bekend bij {carrier}",
    "de": "Noch nicht bei {carrier} bekannt",
    "fr": "Pas encore connu chez {carrier}",
    "it": "Non ancora noto a {carrier}",
    "sv": "Ännu inte känt hos {carrier}",
    "no": "Ikke kjent hos {carrier} ennå",
    "es": "Aún no conocido por {carrier}",
    "da": "Endnu ikke kendt hos {carrier}",
    "ru": "Пока неизвестна в {carrier}",
    "pl": "Jeszcze nieznana w {carrier}",
    "ko": "{carrier}에 아직 등록되지 않음",
    "ar": "غير معروف لدى {carrier} بعد"
  }
};

const TEXT = {
  "no_parcels": {
    "en": "No {carrier} parcels",
    "nl": "Geen {carrier}-pakketten",
    "de": "Keine {carrier}-Pakete",
    "fr": "Aucun colis {carrier}",
    "it": "Nessun pacco {carrier}",
    "sv": "Inga {carrier}-paket",
    "no": "Ingen {carrier}-pakker",
    "es": "No hay paquetes de {carrier}",
    "da": "Ingen {carrier}-pakker",
    "ru": "Нет посылок {carrier}",
    "pl": "Brak paczek {carrier}",
    "ko": "{carrier} 택배 없음",
    "ar": "لا توجد طرود {carrier}"
  },
  "setup_needed": {
    "en": "Enter a valid postal code in the device settings",
    "nl": "Vul een geldige postcode in bij de apparaatinstellingen",
    "de": "Gültige Postleitzahl in den Geräteeinstellungen eingeben",
    "fr": "Saisissez un code postal valide dans les réglages de l’appareil",
    "it": "Inserisci un CAP valido nelle impostazioni del dispositivo",
    "sv": "Ange ett giltigt postnummer i enhetsinställningarna",
    "no": "Skriv inn et gyldig postnummer i enhetsinnstillingene",
    "es": "Introduce un código postal válido en los ajustes del dispositivo",
    "da": "Indtast et gyldigt postnummer i enhedsindstillingerne",
    "ru": "Укажите действительный почтовый индекс в настройках устройства",
    "pl": "Wpisz prawidłowy kod pocztowy w ustawieniach urządzenia",
    "ko": "기기 설정에 유효한 우편번호를 입력하세요",
    "ar": "أدخل رمزًا بريديًا صالحًا في إعدادات الجهاز"
  },
  "invalid_postcode": {
    "en": "Invalid postal code for {country}. Example: {example}",
    "nl": "Ongeldige postcode voor {country}. Voorbeeld: {example}",
    "de": "Ungültige Postleitzahl für {country}. Beispiel: {example}",
    "fr": "Code postal invalide pour {country}. Exemple : {example}",
    "it": "CAP non valido per {country}. Esempio: {example}",
    "sv": "Ogiltigt postnummer för {country}. Exempel: {example}",
    "no": "Ugyldig postnummer for {country}. Eksempel: {example}",
    "es": "Código postal no válido para {country}. Ejemplo: {example}",
    "da": "Ugyldigt postnummer for {country}. Eksempel: {example}",
    "ru": "Недействительный почтовый индекс для {country}. Пример: {example}",
    "pl": "Nieprawidłowy kod pocztowy dla {country}. Przykład: {example}",
    "ko": "{country}의 우편번호가 올바르지 않습니다. 예: {example}",
    "ar": "رمز بريدي غير صالح لـ {country}. مثال: {example}"
  },
  "invalid_postcode_row": {
    "en": "{tracking}: invalid postal code for {country}. Example: {example}",
    "nl": "{tracking}: ongeldige postcode voor {country}. Voorbeeld: {example}",
    "de": "{tracking}: ungültige Postleitzahl für {country}. Beispiel: {example}",
    "fr": "{tracking} : code postal invalide pour {country}. Exemple : {example}",
    "it": "{tracking}: CAP non valido per {country}. Esempio: {example}",
    "sv": "{tracking}: ogiltigt postnummer för {country}. Exempel: {example}",
    "no": "{tracking}: ugyldig postnummer for {country}. Eksempel: {example}",
    "es": "{tracking}: código postal no válido para {country}. Ejemplo: {example}",
    "da": "{tracking}: ugyldigt postnummer for {country}. Eksempel: {example}",
    "ru": "{tracking}: недействительный почтовый индекс для {country}. Пример: {example}",
    "pl": "{tracking}: nieprawidłowy kod pocztowy dla {country}. Przykład: {example}",
    "ko": "{tracking}: {country}의 우편번호가 올바르지 않습니다. 예: {example}",
    "ar": "{tracking}: رمز بريدي غير صالح لـ {country}. مثال: {example}"
  },
  "tomorrow": {
    "en": "tomorrow", "nl": "morgen", "de": "morgen", "fr": "demain", "it": "domani", "sv": "i morgon", "no": "i morgen",
    "es": "mañana", "da": "i morgen", "ru": "завтра", "pl": "jutro", "ko": "내일", "ar": "غدًا"
  },
  "today": {
    "en": "today", "nl": "vandaag", "de": "heute", "fr": "aujourd’hui", "it": "oggi", "sv": "i dag", "no": "i dag",
    "es": "hoy", "da": "i dag", "ru": "сегодня", "pl": "dzisiaj", "ko": "오늘", "ar": "اليوم"
  }
};

function lang(homey) { return language(homey); }
/** Canonical status label; "unknown" names the carrier ("Not yet known at DHL"). */
function statusText(homey, code, carrier = 'GLS') {
  const row = STATUS_TEXT[code] || STATUS_TEXT.unknown;
  return tr(homey, row, { carrier });
}
function text(homey, key, vars = {}) {
  const row = TEXT[key];
  if (!row) return key;
  return tr(homey, row, { carrier: 'GLS', ...vars });
}
/** Country name in the user's language (Intl, all 13 languages). */
function countryName(homey, code) { return regionName(homey, code); }

module.exports = { STATUS_TEXT, statusText, text, countryName, lang };
