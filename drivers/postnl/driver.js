'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const PostNLApi = require('../../lib/postnl-api');
const { tr } = require('../../lib/i18n');
const { t, localizeSession } = require('../../lib/messages-i18n');

class PostNLDriver extends Homey.Driver {
  async onInit() {
    // Device Flow triggers are initialized once on the Driver. Devices delegate
    // triggering here so Homey's card lifecycle is consistent for every account.
    this._flowTriggers = {
      new_mail: this.homey.flow.getDeviceTriggerCard('new_mail'),
      new_package: this.homey.flow.getDeviceTriggerCard('new_package'),
      delivery_window_known: this.homey.flow.getDeviceTriggerCard('delivery_window_known'),
      package_status_changed: this.homey.flow.getDeviceTriggerCard('package_status_changed'),
      package_delivered: this.homey.flow.getDeviceTriggerCard('package_delivered'),
      delivery_window_changed: this.homey.flow.getDeviceTriggerCard('delivery_window_changed'),
      package_event_changed: this.homey.flow.getDeviceTriggerCard('package_event_changed'),
      package_weight_known: this.homey.flow.getDeviceTriggerCard('package_weight_known'),
      package_dimensions_known: this.homey.flow.getDeviceTriggerCard('package_dimensions_known'),
      sync_failed: this.homey.flow.getDeviceTriggerCard('sync_failed'),
      login_expired: this.homey.flow.getDeviceTriggerCard('login_expired'),
    };

    this.homey.flow.getConditionCard('mail_expected').registerRunListener(async ({ device }) => Boolean(device && device.isMailExpected()));
    this.homey.flow.getConditionCard('packages_underway').registerRunListener(async ({ device }) => Boolean(device && device.hasPackagesUnderway()));
    this.homey.flow.getConditionCard('delivery_window_known').registerRunListener(async ({ device }) => Boolean(device && device.hasDeliveryWindowKnown()));
    this.homey.flow.getConditionCard('postnl_connected').registerRunListener(async ({ device }) => Boolean(device && device.isPostNLConnected()));
    this.homey.flow.getConditionCard('package_has_weight').registerRunListener(async ({ device }) => Boolean(device && device.currentPackageHasWeight()));
    this.homey.flow.getConditionCard('package_has_dimensions').registerRunListener(async ({ device }) => Boolean(device && device.currentPackageHasDimensions()));
    this.homey.flow.getConditionCard('package_status_is').registerRunListener(async ({ device, status }) => Boolean(device && device.currentPackageStatusIs(status)));
    this.homey.flow.getActionCard('sync_now').registerRunListener(async ({ device }) => {
      if (!device) throw new Error(t(this.homey, 'no_device'));
      await device.sync({ reason: 'flow', force: true });
      return true;
    });

    // Global Flow tags. Flow cards themselves remain device-specific.
    this._globalTokens = new Map();
  }

  _globalTokenDefinitions() {
    // Titles in all 13 languages; ids and types never change (existing Flows keep working).
    return {
      mail_expected: { type: 'boolean', title: { en: "Mail expected", nl: "Post verwacht", de: "Post erwartet", fr: "Courrier attendu", it: "Posta in arrivo", sv: "Post väntas", no: "Post ventet", es: "Correo previsto", da: "Post ventet", ru: "Ожидается почта", pl: "Oczekiwana poczta", ko: "우편물 도착 예정", ar: "بريد متوقع" } },
      mail_count: { type: 'number', title: { en: "Mail items", nl: "Poststukken", de: "Briefsendungen", fr: "Courriers", it: "Invii postali", sv: "Postförsändelser", no: "Postsendinger", es: "Envíos postales", da: "Postforsendelser", ru: "Почтовые отправления", pl: "Przesyłki listowe", ko: "우편물 수", ar: "عدد الرسائل" } },
      mail_id: { type: 'string', title: { en: "Latest mail item ID", nl: "Laatste poststuk-ID", de: "ID der letzten Briefsendung", fr: "ID du dernier courrier", it: "ID dell’ultimo invio postale", sv: "ID för senaste postförsändelse", no: "ID for siste postsending", es: "ID del último envío postal", da: "ID for seneste postforsendelse", ru: "ID последнего почтового отправления", pl: "ID ostatniej przesyłki listowej", ko: "최근 우편물 ID", ar: "معرّف آخر رسالة" } },
      mail_title: { type: 'string', title: { en: "Latest mail item", nl: "Laatste poststuk", de: "Letzte Briefsendung", fr: "Dernier courrier", it: "Ultimo invio postale", sv: "Senaste postförsändelse", no: "Siste postsending", es: "Último envío postal", da: "Seneste postforsendelse", ru: "Последнее почтовое отправление", pl: "Ostatnia przesyłka listowa", ko: "최근 우편물", ar: "آخر رسالة" } },
      mail_sender: { type: 'string', title: { en: "Latest mail sender", nl: "Afzender laatste poststuk", de: "Absender der letzten Briefsendung", fr: "Expéditeur du dernier courrier", it: "Mittente dell’ultimo invio postale", sv: "Avsändare för senaste postförsändelse", no: "Avsender for siste postsending", es: "Remitente del último envío postal", da: "Afsender af seneste postforsendelse", ru: "Отправитель последнего почтового отправления", pl: "Nadawca ostatniej przesyłki listowej", ko: "최근 우편물 발송인", ar: "مرسل آخر رسالة" } },
      mail_date: { type: 'string', title: { en: "Latest mail delivery date", nl: "Bezorgdatum laatste poststuk", de: "Zustelldatum der letzten Briefsendung", fr: "Date de livraison du dernier courrier", it: "Data di consegna dell’ultimo invio postale", sv: "Leveransdatum för senaste postförsändelse", no: "Leveringsdato for siste postsending", es: "Fecha de entrega del último envío postal", da: "Leveringsdato for seneste postforsendelse", ru: "Дата доставки последнего почтового отправления", pl: "Data doręczenia ostatniej przesyłki listowej", ko: "최근 우편물 배송 날짜", ar: "تاريخ تسليم آخر رسالة" } },
      mail_unread: { type: 'boolean', title: { en: "Latest mail unread", nl: "Laatste poststuk ongelezen", de: "Letzte Briefsendung ungelesen", fr: "Dernier courrier non lu", it: "Ultimo invio postale non letto", sv: "Senaste postförsändelse oläst", no: "Siste postsending ulest", es: "Último envío postal sin leer", da: "Seneste postforsendelse ulæst", ru: "Последнее почтовое отправление не прочитано", pl: "Ostatnia przesyłka listowa nieprzeczytana", ko: "최근 우편물 읽지 않음", ar: "آخر رسالة غير مقروءة" } },
      package_count: { type: 'number', title: { en: "Parcels underway", nl: "Pakketten onderweg", de: "Pakete unterwegs", fr: "Colis en route", it: "Pacchi in viaggio", sv: "Paket på väg", no: "Pakker underveis", es: "Paquetes en camino", da: "Pakker undervejs", ru: "Посылки в пути", pl: "Paczki w drodze", ko: "배송 중인 택배", ar: "الطرود في الطريق" } },
      package_id: { type: 'string', title: { en: "Current parcel ID", nl: "Huidig pakket-ID", de: "ID des aktuellen Pakets", fr: "ID du colis actuel", it: "ID del pacco attuale", sv: "ID för aktuellt paket", no: "ID for gjeldende pakke", es: "ID del paquete actual", da: "ID for aktuel pakke", ru: "ID текущей посылки", pl: "ID bieżącej paczki", ko: "현재 택배 ID", ar: "معرّف الطرد الحالي" } },
      package_sender: { type: 'string', title: { en: "Parcel sender", nl: "Afzender pakket", de: "Absender des Pakets", fr: "Expéditeur du colis", it: "Mittente del pacco", sv: "Paketets avsändare", no: "Pakkens avsender", es: "Remitente del paquete", da: "Pakkens afsender", ru: "Отправитель посылки", pl: "Nadawca paczki", ko: "택배 발송인", ar: "مرسل الطرد" } },
      package_receiver: { type: 'string', title: { en: "Parcel receiver", nl: "Ontvanger pakket", de: "Empfänger des Pakets", fr: "Destinataire du colis", it: "Destinatario del pacco", sv: "Paketets mottagare", no: "Pakkens mottaker", es: "Destinatario del paquete", da: "Pakkens modtager", ru: "Получатель посылки", pl: "Odbiorca paczki", ko: "택배 수령인", ar: "مستلم الطرد" } },
      package_title: { type: 'string', title: { en: "Parcel", nl: "Pakket", de: "Paket", fr: "Colis", it: "Pacco", sv: "Paket", no: "Pakke", es: "Paquete", da: "Pakke", ru: "Посылка", pl: "Paczka", ko: "택배", ar: "الطرد" } },
      package_barcode: { type: 'string', title: { en: "Parcel barcode", nl: "Barcode pakket", de: "Barcode des Pakets", fr: "Code-barres du colis", it: "Codice a barre del pacco", sv: "Paketets streckkod", no: "Pakkens strekkode", es: "Código de barras del paquete", da: "Pakkens stregkode", ru: "Штрихкод посылки", pl: "Kod kreskowy paczki", ko: "택배 바코드", ar: "الرمز الشريطي للطرد" } },
      package_status: { type: 'string', title: { en: "Parcel status", nl: "Pakketstatus", de: "Paketstatus", fr: "Statut du colis", it: "Stato del pacco", sv: "Paketstatus", no: "Pakkestatus", es: "Estado del paquete", da: "Pakkestatus", ru: "Статус посылки", pl: "Status paczki", ko: "택배 상태", ar: "حالة الطرد" } },
      package_status_raw: { type: 'string', title: { en: "Official PostNL status", nl: "Officiële PostNL-status", de: "Offizieller PostNL-Status", fr: "Statut officiel PostNL", it: "Stato ufficiale PostNL", sv: "Officiell PostNL-status", no: "Offisiell PostNL-status", es: "Estado oficial de PostNL", da: "Officiel PostNL-status", ru: "Официальный статус PostNL", pl: "Oficjalny status PostNL", ko: "PostNL 공식 상태", ar: "حالة PostNL الرسمية" } },
      package_status_code: { type: 'string', title: { en: "Official PostNL status code", nl: "Officiële PostNL-statuscode", de: "Offizieller PostNL-Statuscode", fr: "Code de statut officiel PostNL", it: "Codice di stato ufficiale PostNL", sv: "Officiell PostNL-statuskod", no: "Offisiell PostNL-statuskode", es: "Código de estado oficial de PostNL", da: "Officiel PostNL-statuskode", ru: "Официальный код статуса PostNL", pl: "Oficjalny kod statusu PostNL", ko: "PostNL 공식 상태 코드", ar: "رمز حالة PostNL الرسمي" } },
      package_status_event: { type: 'string', title: { en: "Latest PostNL status event", nl: "Laatste PostNL-statusgebeurtenis", de: "Letztes PostNL-Statusereignis", fr: "Dernier événement de statut PostNL", it: "Ultimo evento di stato PostNL", sv: "Senaste PostNL-statushändelse", no: "Siste PostNL-statushendelse", es: "Último evento de estado de PostNL", da: "Seneste PostNL-statushændelse", ru: "Последнее событие статуса PostNL", pl: "Ostatnie zdarzenie statusu PostNL", ko: "최근 PostNL 상태 이벤트", ar: "آخر حدث لحالة PostNL" } },
      package_status_event_time: { type: 'string', title: { en: "Latest PostNL status time", nl: "Tijdstip laatste PostNL-status", de: "Zeitpunkt des letzten PostNL-Status", fr: "Heure du dernier statut PostNL", it: "Ora dell’ultimo stato PostNL", sv: "Tidpunkt för senaste PostNL-status", no: "Tidspunkt for siste PostNL-status", es: "Hora del último estado de PostNL", da: "Tidspunkt for seneste PostNL-status", ru: "Время последнего статуса PostNL", pl: "Czas ostatniego statusu PostNL", ko: "최근 PostNL 상태 시각", ar: "وقت آخر حالة لـ PostNL" } },
      package_delivery_date: { type: 'string', title: { en: "Parcel delivery date", nl: "Bezorgdatum pakket", de: "Zustelldatum des Pakets", fr: "Date de livraison du colis", it: "Data di consegna del pacco", sv: "Paketets leveransdatum", no: "Pakkens leveringsdato", es: "Fecha de entrega del paquete", da: "Pakkens leveringsdato", ru: "Дата доставки посылки", pl: "Data doręczenia paczki", ko: "택배 배송 날짜", ar: "تاريخ تسليم الطرد" } },
      package_delivery_window: { type: 'string', title: { en: "Parcel delivery window", nl: "Bezorgvenster pakket", de: "Zustellzeitfenster des Pakets", fr: "Créneau de livraison du colis", it: "Finestra di consegna del pacco", sv: "Paketets leveransfönster", no: "Pakkens leveringsvindu", es: "Franja de entrega del paquete", da: "Pakkens leveringsvindue", ru: "Интервал доставки посылки", pl: "Okno doręczenia paczki", ko: "택배 배송 시간대", ar: "نافذة تسليم الطرد" } },
      package_delivery_window_from: { type: 'string', title: { en: "Parcel delivery window from", nl: "Bezorgvenster pakket vanaf", de: "Zustellzeitfenster des Pakets ab", fr: "Début du créneau de livraison du colis", it: "Inizio della finestra di consegna del pacco", sv: "Paketets leveransfönster från", no: "Pakkens leveringsvindu fra", es: "Inicio de la franja de entrega del paquete", da: "Pakkens leveringsvindue fra", ru: "Начало интервала доставки посылки", pl: "Początek okna doręczenia paczki", ko: "택배 배송 시간대 시작", ar: "بداية نافذة تسليم الطرد" } },
      package_delivery_window_to: { type: 'string', title: { en: "Parcel delivery window to", nl: "Bezorgvenster pakket tot", de: "Zustellzeitfenster des Pakets bis", fr: "Fin du créneau de livraison du colis", it: "Fine della finestra di consegna del pacco", sv: "Paketets leveransfönster till", no: "Pakkens leveringsvindu til", es: "Fin de la franja de entrega del paquete", da: "Pakkens leveringsvindue til", ru: "Конец интервала доставки посылки", pl: "Koniec okna doręczenia paczki", ko: "택배 배송 시간대 종료", ar: "نهاية نافذة تسليم الطرد" } },
      package_delivery_window_type: { type: 'string', title: { en: "Parcel delivery window type", nl: "Type bezorgvenster pakket", de: "Art des Zustellzeitfensters", fr: "Type de créneau de livraison du colis", it: "Tipo di finestra di consegna del pacco", sv: "Typ av leveransfönster för paketet", no: "Type leveringsvindu for pakken", es: "Tipo de franja de entrega del paquete", da: "Type af leveringsvindue for pakken", ru: "Тип интервала доставки посылки", pl: "Typ okna doręczenia paczki", ko: "택배 배송 시간대 유형", ar: "نوع نافذة تسليم الطرد" } },
      package_details_url: { type: 'string', title: { en: "Parcel tracking URL", nl: "Tracking-URL pakket", de: "Sendungsverfolgungs-URL des Pakets", fr: "URL de suivi du colis", it: "URL di tracciamento del pacco", sv: "Paketets spårnings-URL", no: "Pakkens sporings-URL", es: "URL de seguimiento del paquete", da: "Pakkens sporings-URL", ru: "URL отслеживания посылки", pl: "URL śledzenia paczki", ko: "택배 추적 URL", ar: "رابط تتبّع الطرد" } },
      package_shipment_type: { type: 'string', title: { en: "Parcel shipment type", nl: "Zendingstype pakket", de: "Sendungsart des Pakets", fr: "Type d’envoi du colis", it: "Tipo di spedizione del pacco", sv: "Paketets försändelsetyp", no: "Pakkens forsendelsestype", es: "Tipo de envío del paquete", da: "Pakkens forsendelsestype", ru: "Тип отправления посылки", pl: "Typ przesyłki paczki", ko: "택배 배송 유형", ar: "نوع شحنة الطرد" } },
      package_delivery_address_type: { type: 'string', title: { en: "Parcel delivery address type", nl: "Type bezorgadres pakket", de: "Art der Zustelladresse des Pakets", fr: "Type d’adresse de livraison du colis", it: "Tipo di indirizzo di consegna del pacco", sv: "Typ av leveransadress för paketet", no: "Type leveringsadresse for pakken", es: "Tipo de dirección de entrega del paquete", da: "Type af leveringsadresse for pakken", ru: "Тип адреса доставки посылки", pl: "Typ adresu doręczenia paczki", ko: "택배 배송지 유형", ar: "نوع عنوان تسليم الطرد" } },
      package_direction: { type: 'string', title: { en: "Parcel direction", nl: "Richting pakket", de: "Richtung des Pakets", fr: "Sens du colis", it: "Direzione del pacco", sv: "Paketets riktning", no: "Pakkens retning", es: "Dirección del paquete", da: "Pakkens retning", ru: "Направление посылки", pl: "Kierunek paczki", ko: "택배 방향", ar: "اتجاه الطرد" } },
      package_created_at: { type: 'string', title: { en: "Parcel created at", nl: "Pakket aangemaakt op", de: "Paket erstellt am", fr: "Colis créé le", it: "Pacco creato il", sv: "Paket skapat", no: "Pakke opprettet", es: "Paquete creado el", da: "Pakke oprettet", ru: "Посылка создана", pl: "Paczka utworzona", ko: "택배 생성 시각", ar: "تاريخ إنشاء الطرد" } },
      package_delivered: { type: 'boolean', title: { en: "Parcel delivered", nl: "Pakket bezorgd", de: "Paket zugestellt", fr: "Colis livré", it: "Pacco consegnato", sv: "Paket levererat", no: "Pakke levert", es: "Paquete entregado", da: "Pakke leveret", ru: "Посылка доставлена", pl: "Paczka doręczona", ko: "택배 배송 완료", ar: "تم تسليم الطرد" } },
      package_shared_from: { type: 'string', title: { en: "Parcel shared from", nl: "Pakket gedeeld via", de: "Paket geteilt von", fr: "Colis partagé par", it: "Pacco condiviso da", sv: "Paket delat från", no: "Pakke delt fra", es: "Paquete compartido por", da: "Pakke delt fra", ru: "Посылка от пользователя", pl: "Paczka udostępniona przez", ko: "택배 공유자", ar: "طرد تمت مشاركته من" } },
      package_source_account_id: { type: 'string', title: { en: "Parcel source account ID", nl: "Bronaccount-ID pakket", de: "Quellkonto-ID des Pakets", fr: "ID du compte source du colis", it: "ID dell’account di origine del pacco", sv: "Paketets källkonto-ID", no: "Pakkens kildekonto-ID", es: "ID de la cuenta de origen del paquete", da: "Pakkens kildekonto-id", ru: "ID исходной учётной записи посылки", pl: "ID konta źródłowego paczki", ko: "택배 원본 계정 ID", ar: "معرّف الحساب المصدر للطرد" } },
      package_tracking: { type: 'string', title: { en: "Parcel tracking number", nl: "Trackingnummer pakket", de: "Sendungsnummer des Pakets", fr: "Numéro de suivi du colis", it: "Numero di tracciamento del pacco", sv: "Paketets spårningsnummer", no: "Pakkens sporingsnummer", es: "Número de seguimiento del paquete", da: "Pakkens sporingsnummer", ru: "Номер отслеживания посылки", pl: "Numer śledzenia paczki", ko: "택배 운송장 번호", ar: "رقم تتبّع الطرد" } },
      package_weight: { type: 'string', title: { en: "Parcel weight", nl: "Gewicht pakket", de: "Gewicht des Pakets", fr: "Poids du colis", it: "Peso del pacco", sv: "Paketets vikt", no: "Pakkens vekt", es: "Peso del paquete", da: "Pakkens vægt", ru: "Вес посылки", pl: "Waga paczki", ko: "택배 무게", ar: "وزن الطرد" } },
      package_weight_kg: { type: 'number', title: { en: "Parcel weight (kg)", nl: "Gewicht pakket (kg)", de: "Gewicht des Pakets (kg)", fr: "Poids du colis (kg)", it: "Peso del pacco (kg)", sv: "Paketets vikt (kg)", no: "Pakkens vekt (kg)", es: "Peso del paquete (kg)", da: "Pakkens vægt (kg)", ru: "Вес посылки (кг)", pl: "Waga paczki (kg)", ko: "택배 무게(kg)", ar: "وزن الطرد (كغ)" } },
      package_dimensions: { type: 'string', title: { en: "Parcel dimensions", nl: "Afmetingen pakket", de: "Abmessungen des Pakets", fr: "Dimensions du colis", it: "Dimensioni del pacco", sv: "Paketets mått", no: "Pakkens mål", es: "Dimensiones del paquete", da: "Pakkens mål", ru: "Размеры посылки", pl: "Wymiary paczki", ko: "택배 크기", ar: "أبعاد الطرد" } },
      package_dimension_length: { type: 'number', title: { en: "Parcel length (cm)", nl: "Lengte pakket (cm)", de: "Länge des Pakets (cm)", fr: "Longueur du colis (cm)", it: "Lunghezza del pacco (cm)", sv: "Paketets längd (cm)", no: "Pakkens lengde (cm)", es: "Longitud del paquete (cm)", da: "Pakkens længde (cm)", ru: "Длина посылки (см)", pl: "Długość paczki (cm)", ko: "택배 길이(cm)", ar: "طول الطرد (سم)" } },
      package_dimension_width: { type: 'number', title: { en: "Parcel width (cm)", nl: "Breedte pakket (cm)", de: "Breite des Pakets (cm)", fr: "Largeur du colis (cm)", it: "Larghezza del pacco (cm)", sv: "Paketets bredd (cm)", no: "Pakkens bredde (cm)", es: "Anchura del paquete (cm)", da: "Pakkens bredde (cm)", ru: "Ширина посылки (см)", pl: "Szerokość paczki (cm)", ko: "택배 너비(cm)", ar: "عرض الطرد (سم)" } },
      package_dimension_height: { type: 'number', title: { en: "Parcel height (cm)", nl: "Hoogte pakket (cm)", de: "Höhe des Pakets (cm)", fr: "Hauteur du colis (cm)", it: "Altezza del pacco (cm)", sv: "Paketets höjd (cm)", no: "Pakkens høyde (cm)", es: "Altura del paquete (cm)", da: "Pakkens højde (cm)", ru: "Высота посылки (см)", pl: "Wysokość paczki (cm)", ko: "택배 높이(cm)", ar: "ارتفاع الطرد (سم)" } },
      package_status_history: { type: 'string', title: { en: "Full parcel status history", nl: "Volledige pakketstatusgeschiedenis", de: "Vollständiger Paketstatusverlauf", fr: "Historique complet des statuts du colis", it: "Cronologia completa degli stati del pacco", sv: "Fullständig statushistorik för paketet", no: "Full statushistorikk for pakken", es: "Historial completo de estados del paquete", da: "Fuld statushistorik for pakken", ru: "Полная история статусов посылки", pl: "Pełna historia statusów paczki", ko: "택배 전체 상태 기록", ar: "السجل الكامل لحالات الطرد" } },
      package_observation_code: { type: 'string', title: { en: "PostNL observation code", nl: "PostNL-observatiecode", de: "PostNL-Beobachtungscode", fr: "Code d’observation PostNL", it: "Codice di osservazione PostNL", sv: "PostNL-observationskod", no: "PostNL-observasjonskode", es: "Código de observación de PostNL", da: "PostNL-observationskode", ru: "Код наблюдения PostNL", pl: "Kod obserwacji PostNL", ko: "PostNL 관측 코드", ar: "رمز ملاحظة PostNL" } },
      package_canonical_status: { type: 'string', title: { en: "Canonical parcel status", nl: "Canonieke pakketstatus", de: "Kanonischer Paketstatus", fr: "Statut normalisé du colis", it: "Stato normalizzato del pacco", sv: "Normaliserad paketstatus", no: "Normalisert pakkestatus", es: "Estado normalizado del paquete", da: "Normaliseret pakkestatus", ru: "Нормализованный статус посылки", pl: "Znormalizowany status paczki", ko: "표준화된 택배 상태", ar: "الحالة الموحّدة للطرد" } },
      package_pickup: { type: 'boolean', title: { en: "PostNL Point delivery", nl: "Bezorging bij PostNL-punt", de: "Zustellung an PostNL-Punkt", fr: "Livraison en point PostNL", it: "Consegna al PostNL Point", sv: "Leverans till PostNL-ombud", no: "Levering til PostNL-punkt", es: "Entrega en punto PostNL", da: "Levering til PostNL-punkt", ru: "Доставка в пункт PostNL", pl: "Doręczenie do punktu PostNL", ko: "PostNL 지점 배송", ar: "التسليم في نقطة PostNL" } },
      package_pickup_point: { type: 'string', title: { en: "PostNL Point", nl: "PostNL-punt", de: "PostNL-Punkt", fr: "Point PostNL", it: "PostNL Point", sv: "PostNL-ombud", no: "PostNL-punkt", es: "Punto PostNL", da: "PostNL-punkt", ru: "Пункт PostNL", pl: "Punkt PostNL", ko: "PostNL 지점", ar: "نقطة PostNL" } },
      next_delivery: { type: 'string', title: { en: "Next delivery", nl: "Volgende bezorging", de: "Nächste Zustellung", fr: "Prochaine livraison", it: "Prossima consegna", sv: "Nästa leverans", no: "Neste levering", es: "Próxima entrega", da: "Næste levering", ru: "Следующая доставка", pl: "Następne doręczenie", ko: "다음 배송", ar: "التسليم التالي" } },
      connection_status: { type: 'string', title: { en: "PostNL connection status", nl: "PostNL-verbindingsstatus", de: "PostNL-Verbindungsstatus", fr: "État de connexion PostNL", it: "Stato della connessione PostNL", sv: "PostNL-anslutningsstatus", no: "PostNL-tilkoblingsstatus", es: "Estado de conexión de PostNL", da: "PostNL-forbindelsesstatus", ru: "Статус подключения PostNL", pl: "Stan połączenia PostNL", ko: "PostNL 연결 상태", ar: "حالة اتصال PostNL" } },
      last_update: { type: 'string', title: { en: "Last PostNL update", nl: "Laatste PostNL-update", de: "Letzte PostNL-Aktualisierung", fr: "Dernière mise à jour PostNL", it: "Ultimo aggiornamento PostNL", sv: "Senaste PostNL-uppdatering", no: "Siste PostNL-oppdatering", es: "Última actualización de PostNL", da: "Seneste PostNL-opdatering", ru: "Последнее обновление PostNL", pl: "Ostatnia aktualizacja PostNL", ko: "최근 PostNL 업데이트", ar: "آخر تحديث من PostNL" } },
      old_status: { type: 'string', title: { en: "Previous parcel status", nl: "Vorige pakketstatus", de: "Vorheriger Paketstatus", fr: "Statut précédent du colis", it: "Stato precedente del pacco", sv: "Föregående paketstatus", no: "Forrige pakkestatus", es: "Estado anterior del paquete", da: "Forrige pakkestatus", ru: "Предыдущий статус посылки", pl: "Poprzedni status paczki", ko: "이전 택배 상태", ar: "الحالة السابقة للطرد" } },
      last_error: { type: 'string', title: { en: "Last PostNL error", nl: "Laatste PostNL-fout", de: "Letzter PostNL-Fehler", fr: "Dernière erreur PostNL", it: "Ultimo errore PostNL", sv: "Senaste PostNL-fel", no: "Siste PostNL-feil", es: "Último error de PostNL", da: "Seneste PostNL-fejl", ru: "Последняя ошибка PostNL", pl: "Ostatni błąd PostNL", ko: "최근 PostNL 오류", ar: "آخر خطأ من PostNL" } },
      last_trigger: { type: 'string', title: { en: "Last PostNL trigger", nl: "Laatste PostNL-trigger", de: "Letzter PostNL-Auslöser", fr: "Dernier déclencheur PostNL", it: "Ultimo trigger PostNL", sv: "Senaste PostNL-utlösare", no: "Siste PostNL-utløser", es: "Último disparador de PostNL", da: "Seneste PostNL-udløser", ru: "Последний триггер PostNL", pl: "Ostatni wyzwalacz PostNL", ko: "최근 PostNL 트리거", ar: "آخر مشغّل من PostNL" } },
      last_trigger_time: { type: 'string', title: { en: "Last PostNL trigger time", nl: "Tijdstip laatste PostNL-trigger", de: "Zeitpunkt des letzten PostNL-Auslösers", fr: "Heure du dernier déclencheur PostNL", it: "Ora dell’ultimo trigger PostNL", sv: "Tidpunkt för senaste PostNL-utlösare", no: "Tidspunkt for siste PostNL-utløser", es: "Hora del último disparador de PostNL", da: "Tidspunkt for seneste PostNL-udløser", ru: "Время последнего триггера PostNL", pl: "Czas ostatniego wyzwalacza PostNL", ko: "최근 PostNL 트리거 시각", ar: "وقت آخر مشغّل من PostNL" } },
      // Global image tokens work in every Flow, whichever card started it.
      package_image: { type: 'image', title: { en: "Parcel image", nl: "Pakketafbeelding", de: "Paketbild", fr: "Image du colis", it: "Immagine del pacco", sv: "Paketbild", no: "Pakkebilde", es: "Imagen del paquete", da: "Pakkebillede", ru: "Изображение посылки", pl: "Obraz paczki", ko: "택배 이미지", ar: "صورة الطرد" } },
      mail_image: { type: 'image', title: { en: "Latest mail scan", nl: "Scan laatste poststuk", de: "Scan der letzten Briefsendung", fr: "Scan du dernier courrier", it: "Scansione dell’ultimo invio postale", sv: "Skanning av senaste postförsändelse", no: "Skanning av siste postsending", es: "Escaneo del último envío postal", da: "Scanning af seneste postforsendelse", ru: "Скан последнего почтового отправления", pl: "Skan ostatniej przesyłki listowej", ko: "최근 우편물 스캔", ar: "صورة آخر رسالة" } },
    };
  }

  _globalTokenDeviceKey(device) {
    return crypto.createHash('sha1').update(String(device?.getData?.().id || device?.getId?.() || 'postnl')).digest('hex').slice(0, 10);
  }

  async ensureGlobalTokens(device) {
    const deviceKey = this._globalTokenDeviceKey(device);
    const deviceName = device?.getName?.() || t(this.homey, 'my_postnl');
    if (!this._globalTokens) this._globalTokens = new Map();
    if (!this._globalTokens.has(deviceKey)) this._globalTokens.set(deviceKey, new Map());
    const set = this._globalTokens.get(deviceKey);
    for (const [name, definition] of Object.entries(this._globalTokenDefinitions())) {
      if (set.has(name)) continue;
      const id = `postnl_${deviceKey}_${name}`;
      const title = `${deviceName} · ${tr(this.homey, definition.title)}`;
      let token;
      try {
        token = await this.homey.flow.createToken(id, { type: definition.type, title });
      } catch (error) {
        try { token = await this.homey.flow.getToken(id); }
        catch (_) { throw error; }
      }
      if (token) set.set(name, token);
    }
    return set;
  }

  async updateGlobalTokens(device, values = {}) {
    const set = await this.ensureGlobalTokens(device);
    const definitions = this._globalTokenDefinitions();
    await Promise.all(Object.entries(values).map(async ([name, value]) => {
      const token = set.get(name);
      const definition = definitions[name];
      if (!token || !definition) return;
      let safeValue = value;
      if (definition.type === 'image') {
        if (!value) return;
        await token.setValue(value).catch(error => this.error('[GlobalToken]', name, error));
        return;
      }
      if (definition.type === 'boolean') safeValue = Boolean(value);
      else if (definition.type === 'number') safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
      else safeValue = value == null ? '' : String(value);
      await token.setValue(safeValue).catch(error => this.error('[GlobalToken]', name, error));
    }));
  }

  async updateGlobalEventTokens(cardId, device, tokens = {}) {
    const common = { last_trigger: String(cardId || ''), last_trigger_time: new Date().toISOString() };
    if (cardId === 'new_mail') Object.assign(common, {
      mail_count: tokens.count, mail_id: tokens.id, mail_title: tokens.title, mail_sender: tokens.sender,
      mail_date: tokens.date, mail_unread: tokens.unread, mail_image: tokens.image,
    });
    if (['new_package', 'delivery_window_known', 'package_status_changed', 'package_delivered', 'delivery_window_changed', 'package_event_changed', 'package_weight_known', 'package_dimensions_known'].includes(cardId)) Object.assign(common, {
      package_id: tokens.id, package_sender: tokens.sender, package_receiver: tokens.receiver,
      package_title: tokens.title, package_barcode: tokens.barcode, package_status: tokens.status,
      package_status_raw: tokens.status_raw, package_status_code: tokens.status_code,
      package_status_event: tokens.status_event, package_status_event_time: tokens.status_event_time,
      package_delivery_date: tokens.delivery_date, package_delivery_window: tokens.delivery_window,
      package_delivery_window_from: tokens.delivery_window_from, package_delivery_window_to: tokens.delivery_window_to,
      package_delivery_window_type: tokens.delivery_window_type, package_details_url: tokens.details_url,
      package_shipment_type: tokens.shipment_type, package_delivery_address_type: tokens.delivery_address_type,
      package_direction: tokens.direction, package_created_at: tokens.created_at, package_delivered: tokens.delivered,
      package_shared_from: tokens.shared_from, package_source_account_id: tokens.source_account_id,
      package_tracking: tokens.package_tracking || tokens.barcode || tokens.id, package_weight: tokens.weight, package_weight_kg: tokens.weight_kg, package_dimensions: tokens.dimensions, package_dimension_length: tokens.dimension_length, package_dimension_width: tokens.dimension_width, package_dimension_height: tokens.dimension_height, package_status_history: tokens.status_history, package_observation_code: tokens.observation_code, package_canonical_status: tokens.canonical_status, package_pickup: tokens.pickup, package_pickup_point: tokens.pickup_point, old_status: tokens.old_status,
      package_image: tokens.package_image,
    });
    if (cardId === 'sync_failed') common.last_error = tokens.error;
    await this.updateGlobalTokens(device, common);
  }

  async triggerDeviceFlow(cardId, device, tokens = {}, state = {}) {
    const card = this._flowTriggers?.[cardId];
    if (!card) throw new Error(`PostNL Flow trigger not initialized: ${cardId}`); // i18n-ignore: internal error, log only
    const safeTokens = Object.fromEntries(Object.entries(tokens || {}).filter(([, value]) => value !== undefined));
    try {
      this.log('[FlowTrigger]', cardId, device?.getName?.() || device?.getId?.() || 'unknown', JSON.stringify(
        Object.fromEntries(Object.entries(safeTokens).filter(([key]) => !['image', 'package_image'].includes(key)))
      ));
      await this.updateGlobalEventTokens(cardId, device, safeTokens).catch(error => this.error('[GlobalToken] event update failed', error));
      await card.trigger(device, safeTokens, state || {});
      this.log('[FlowTrigger]', cardId, 'accepted');
      return true;
    } catch (error) {
      this.error('[FlowTrigger]', cardId, 'failed', error);
      throw error;
    }
  }

  _createMemoryStorage() {
    const values = new Map();
    return { get: key => values.get(key), set: async (key, value) => values.set(key, value), unset: async key => values.delete(key) };
  }

  _createPairApi() {
    return new PostNLApi({ homey: this.homey, log: (...args) => this.log('[PairAuth]', ...args), storage: this._createMemoryStorage() });
  }

  _accountDevice(profile, api) {
    const username = String(profile?.username || '').trim();
    if (!username) throw new Error(t(this.homey, 'account_missing', { carrier: 'PostNL' }));
    const stable = crypto.createHash('sha256').update(username.toLowerCase()).digest('hex').slice(0, 24);
    return {
      name: t(this.homey, 'my_postnl'),
      data: { id: `postnl-${stable}` },
      store: {
        username,
        auth: api.exportAuth(),
        snapshot: { letters: [], liveLetters: [], packages: [], updatedAt: null, account: profile || null, mailApiStatus: 'unknown', mailApiError: null },
      },
    };
  }

  async onPair(session) {
    localizeSession(this.homey, session, 'PostNL');
    const api = this._createPairApi();
    let profile = null;
    session.setHandler('login_credentials', async ({ username, password } = {}) => {
      await api.loginWithPassword(username, password);
      profile = await api.fetchProfile();
      if (!profile?.username) profile = { ...(profile || {}), username: String(username || '').trim() };
      return { authenticated: true, username: profile.username, device: this._accountDevice(profile, api) };
    });
  }

  async onRepair(session, device) {
    localizeSession(this.homey, session, 'PostNL');
    const api = this._createPairApi();
    session.setHandler('login_credentials', async ({ username, password } = {}) => {
      await api.loginWithPassword(username, password);
      let profile = await api.fetchProfile();
      if (!profile?.username) profile = { ...(profile || {}), username: String(username || '').trim() };
      await device.updateCredentials(api.exportAuth(), profile);
      return true;
    });
  }
}

module.exports = PostNLDriver;
