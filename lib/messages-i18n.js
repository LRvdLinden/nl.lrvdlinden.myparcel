'use strict';

/**
 * Shared user-facing runtime messages (13 languages) and the translation of carrier-library errors.
 *
 * The carrier libraries (lib/*-tracking.js, lib/*-api.js) have no Homey instance; they throw errors with an
 * English source message (the base language). Where such an error reaches the user – a pairing/repair
 * screen, a Flow card, a device that becomes unavailable – it is translated here by matching the source
 * message against ERROR_PATTERNS. Logs keep the English source text.
 */
const { tr, fill } = require('./i18n');

const MESSAGES = {
  connected: {
    en: 'Connected', nl: 'Verbonden', de: 'Verbunden', fr: 'Connecté', it: 'Connesso', sv: 'Ansluten', no: 'Tilkoblet',
    es: 'Conectado', da: 'Forbundet', ru: 'Подключено', pl: 'Połączono', ko: '연결됨', ar: 'متصل',
  },
  not_connected: {
    en: 'Not connected', nl: 'Niet verbonden', de: 'Nicht verbunden', fr: 'Non connecté', it: 'Non connesso', sv: 'Inte ansluten', no: 'Ikke tilkoblet',
    es: 'No conectado', da: 'Ikke forbundet', ru: 'Не подключено', pl: 'Nie połączono', ko: '연결되지 않음', ar: 'غير متصل',
  },
  no_parcels: {
    en: 'No parcels', nl: 'Geen pakketten', de: 'Keine Pakete', fr: 'Aucun colis', it: 'Nessun pacco', sv: 'Inga paket', no: 'Ingen pakker',
    es: 'No hay paquetes', da: 'Ingen pakker', ru: 'Нет посылок', pl: 'Brak paczek', ko: '택배 없음', ar: 'لا توجد طرود',
  },
  no_recent_orders: {
    en: 'Connected – no recent orders', nl: 'Verbonden – geen recente orders', de: 'Verbunden – keine aktuellen Bestellungen',
    fr: 'Connecté – aucune commande récente', it: 'Connesso – nessun ordine recente', sv: 'Ansluten – inga nya beställningar',
    no: 'Tilkoblet – ingen nye bestillinger', es: 'Conectado: no hay pedidos recientes', da: 'Forbundet – ingen nye ordrer',
    ru: 'Подключено – нет недавних заказов', pl: 'Połączono – brak ostatnich zamówień', ko: '연결됨 – 최근 주문 없음', ar: 'متصل – لا توجد طلبات حديثة',
  },
  size: {
    en: 'Size {size}', nl: 'Formaat {size}', de: 'Größe {size}', fr: 'Taille {size}', it: 'Formato {size}', sv: 'Storlek {size}', no: 'Størrelse {size}',
    es: 'Tamaño {size}', da: 'Størrelse {size}', ru: 'Размер {size}', pl: 'Gabaryt {size}', ko: '크기 {size}', ar: 'الحجم {size}',
  },
  my_postnl: {
    en: 'My PostNL', nl: 'Mijn PostNL', de: 'Mein PostNL', fr: 'Mon PostNL', it: 'Il mio PostNL', sv: 'Mitt PostNL', no: 'Mitt PostNL',
    es: 'Mi PostNL', da: 'Mit PostNL', ru: 'Мой PostNL', pl: 'Mój PostNL', ko: '내 PostNL', ar: 'PostNL الخاص بي',
  },
  my_delivery: {
    en: 'My Delivery', nl: 'Mijn Bezorging', de: 'Meine Zustellung', fr: 'Ma livraison', it: 'La mia consegna', sv: 'Min leverans', no: 'Min levering',
    es: 'Mi entrega', da: 'Min levering', ru: 'Моя доставка', pl: 'Moja dostawa', ko: '내 배송', ar: 'توصيلي',
  },
  latest_mail_item: {
    en: 'Latest mail item', nl: 'Laatste poststuk', de: 'Letzte Briefsendung', fr: 'Dernier courrier', it: 'Ultimo invio postale', sv: 'Senaste postförsändelse',
    no: 'Siste postsending', es: 'Último envío postal', da: 'Seneste postforsendelse', ru: 'Последнее почтовое отправление', pl: 'Ostatnia przesyłka listowa',
    ko: '최근 우편물', ar: 'آخر رسالة',
  },
  parcel: {
    en: 'Parcel', nl: 'Pakket', de: 'Paket', fr: 'Colis', it: 'Pacco', sv: 'Paket', no: 'Pakke', es: 'Paquete', da: 'Pakke', ru: 'Посылка', pl: 'Paczka', ko: '택배', ar: 'طرد',
  },
  unknown: {
    en: 'unknown', nl: 'onbekend', de: 'unbekannt', fr: 'inconnu', it: 'sconosciuto', sv: 'okänd', no: 'ukjent',
    es: 'desconocido', da: 'ukendt', ru: 'неизвестно', pl: 'nieznany', ko: '알 수 없음', ar: 'غير معروف',
  },
  unknown_error: {
    en: 'Unknown error', nl: 'Onbekende fout', de: 'Unbekannter Fehler', fr: 'Erreur inconnue', it: 'Errore sconosciuto', sv: 'Okänt fel', no: 'Ukjent feil',
    es: 'Error desconocido', da: 'Ukendt fejl', ru: 'Неизвестная ошибка', pl: 'Nieznany błąd', ko: '알 수 없는 오류', ar: 'خطأ غير معروف',
  },

  /* ------------------------------------------------------- device state -- */
  unreachable: {
    en: '{name} is temporarily unreachable; showing the last known data',
    nl: '{name} is tijdelijk niet bereikbaar; laatst bekende gegevens worden getoond',
    de: '{name} ist vorübergehend nicht erreichbar; letzte bekannte Daten werden angezeigt',
    fr: '{name} est temporairement inaccessible ; dernières données connues affichées',
    it: '{name} non è momentaneamente raggiungibile; vengono mostrati gli ultimi dati noti',
    sv: '{name} går tillfälligt inte att nå; senast kända uppgifter visas',
    no: '{name} er midlertidig utilgjengelig; sist kjente data vises',
    es: '{name} no está disponible temporalmente; se muestran los últimos datos conocidos',
    da: '{name} er midlertidigt utilgængelig; senest kendte data vises',
    ru: '{name} временно недоступен; показаны последние известные данные',
    pl: '{name} jest chwilowo niedostępny; wyświetlane są ostatnie znane dane',
    ko: '{name}에 일시적으로 연결할 수 없습니다. 마지막으로 확인된 데이터를 표시합니다',
    ar: 'يتعذّر الوصول إلى {name} مؤقتًا؛ يتم عرض آخر البيانات المعروفة',
  },
  auth_notification: {
    en: '{carrier} needs to be reconnected – the login for {name} no longer works. Open the device and repair the connection.',
    nl: '{carrier} opnieuw koppelen – de login voor {name} werkt niet meer. Open het apparaat en herstel de koppeling.',
    de: '{carrier} erneut verbinden – die Anmeldung für {name} funktioniert nicht mehr. Öffne das Gerät und stelle die Verbindung wieder her.',
    fr: 'Reconnecter {carrier} – la connexion pour {name} ne fonctionne plus. Ouvrez l’appareil et rétablissez la connexion.',
    it: 'Ricollega {carrier} – l’accesso per {name} non funziona più. Apri il dispositivo e ripara la connessione.',
    sv: 'Anslut {carrier} igen – inloggningen för {name} fungerar inte längre. Öppna enheten och reparera anslutningen.',
    no: 'Koble til {carrier} på nytt – påloggingen for {name} fungerer ikke lenger. Åpne enheten og reparer tilkoblingen.',
    es: 'Vuelve a conectar {carrier}: el inicio de sesión de {name} ya no funciona. Abre el dispositivo y repara la conexión.',
    da: 'Forbind {carrier} igen – login for {name} virker ikke længere. Åbn enheden, og reparer forbindelsen.',
    ru: 'Переподключите {carrier}: вход для {name} больше не работает. Откройте устройство и восстановите подключение.',
    pl: 'Połącz ponownie {carrier} – logowanie dla {name} już nie działa. Otwórz urządzenie i napraw połączenie.',
    ko: '{carrier}을(를) 다시 연결하세요. {name}의 로그인이 더 이상 작동하지 않습니다. 기기를 열고 연결을 복구하세요.',
    ar: 'أعد ربط {carrier} – لم يعد تسجيل الدخول لـ {name} يعمل. افتح الجهاز وأصلح الاتصال.',
  },
  auth_unavailable: {
    en: '{carrier}: the login has expired. Repair the device to sign in again.',
    nl: '{carrier}: de login is verlopen. Repareer het apparaat om opnieuw in te loggen.',
    de: '{carrier}: Die Anmeldung ist abgelaufen. Repariere das Gerät, um dich erneut anzumelden.',
    fr: '{carrier} : la connexion a expiré. Réparez l’appareil pour vous reconnecter.',
    it: '{carrier}: l’accesso è scaduto. Ripara il dispositivo per accedere di nuovo.',
    sv: '{carrier}: inloggningen har gått ut. Reparera enheten för att logga in igen.',
    no: '{carrier}: påloggingen er utløpt. Reparer enheten for å logge inn på nytt.',
    es: '{carrier}: el inicio de sesión ha caducado. Repara el dispositivo para volver a iniciar sesión.',
    da: '{carrier}: login er udløbet. Reparer enheden for at logge ind igen.',
    ru: '{carrier}: срок действия входа истёк. Восстановите устройство, чтобы войти снова.',
    pl: '{carrier}: logowanie wygasło. Napraw urządzenie, aby zalogować się ponownie.',
    ko: '{carrier}: 로그인이 만료되었습니다. 기기를 복구하여 다시 로그인하세요.',
    ar: '{carrier}: انتهت صلاحية تسجيل الدخول. أصلح الجهاز لتسجيل الدخول مجددًا.',
  },
  disconnected: {
    en: 'MyParcel – {carrier} is not connected for {name}. Open the device and repair the connection.',
    nl: 'MyParcel – {carrier} is niet verbonden voor {name}. Open het apparaat en herstel de koppeling.',
    de: 'MyParcel – {carrier} ist für {name} nicht verbunden. Öffne das Gerät und stelle die Verbindung wieder her.',
    fr: 'MyParcel – {carrier} n’est pas connecté pour {name}. Ouvrez l’appareil et rétablissez la connexion.',
    it: 'MyParcel – {carrier} non è connesso per {name}. Apri il dispositivo e ripristina il collegamento.',
    sv: 'MyParcel – {carrier} är inte ansluten för {name}. Öppna enheten och återställ anslutningen.',
    no: 'MyParcel – {carrier} er ikke tilkoblet for {name}. Åpne enheten og reparer tilkoblingen.',
    es: 'MyParcel – {carrier} no está conectado para {name}. Abre el dispositivo y repara la conexión.',
    da: 'MyParcel – {carrier} er ikke forbundet for {name}. Åbn enheden, og reparer forbindelsen.',
    ru: 'MyParcel – {carrier} не подключён для {name}. Откройте устройство и восстановите подключение.',
    pl: 'MyParcel – {carrier} nie jest połączony dla {name}. Otwórz urządzenie i napraw połączenie.',
    ko: 'MyParcel – {name}의 {carrier} 연결이 끊어졌습니다. 기기를 열고 연결을 복구하세요.',
    ar: 'MyParcel – ‏{carrier} غير متصل للجهاز {name}. افتح الجهاز وأصلح الاتصال.',
  },

  /* ------------------------------------------------ pairing / Flow input -- */
  no_device: {
    en: 'No device selected.', nl: 'Geen apparaat geselecteerd.', de: 'Kein Gerät ausgewählt.', fr: 'Aucun appareil sélectionné.',
    it: 'Nessun dispositivo selezionato.', sv: 'Ingen enhet vald.', no: 'Ingen enhet valgt.', es: 'No se ha seleccionado ningún dispositivo.',
    da: 'Ingen enhed valgt.', ru: 'Устройство не выбрано.', pl: 'Nie wybrano urządzenia.', ko: '선택된 기기가 없습니다.', ar: 'لم يتم تحديد أي جهاز.',
  },
  invalid_tracking: {
    en: 'Enter a valid {carrier} tracking number.', nl: 'Vul een geldig {carrier}-trackingnummer in.', de: 'Gib eine gültige {carrier}-Sendungsnummer ein.',
    fr: 'Saisissez un numéro de suivi {carrier} valide.', it: 'Inserisci un numero di tracciamento {carrier} valido.',
    sv: 'Ange ett giltigt spårningsnummer för {carrier}.', no: 'Skriv inn et gyldig sporingsnummer for {carrier}.',
    es: 'Introduce un número de seguimiento de {carrier} válido.', da: 'Indtast et gyldigt sporingsnummer fra {carrier}.',
    ru: 'Введите действительный номер отслеживания {carrier}.', pl: 'Wpisz prawidłowy numer przesyłki {carrier}.',
    ko: '유효한 {carrier} 운송장 번호를 입력하세요.', ar: 'أدخل رقم تتبّع صالحًا من {carrier}.',
  },
  enter_tracking: {
    en: 'Enter a tracking number.', nl: 'Vul een trackingnummer in.', de: 'Bitte eine Sendungsnummer eingeben.', fr: 'Saisissez un numéro de suivi.',
    it: 'Inserisci un numero di tracciamento.', sv: 'Ange ett spårningsnummer.', no: 'Skriv inn et sporingsnummer.', es: 'Introduce un número de seguimiento.',
    da: 'Indtast et sporingsnummer.', ru: 'Введите номер отслеживания.', pl: 'Wpisz numer przesyłki.', ko: '운송장 번호를 입력하세요.', ar: 'أدخل رقم تتبّع.',
  },
  enter_at_least_one: {
    en: 'Enter at least one {carrier} tracking number.', nl: 'Vul minstens één {carrier}-trackingnummer in.',
    de: 'Gib mindestens eine {carrier}-Sendungsnummer ein.', fr: 'Saisissez au moins un numéro de suivi {carrier}.',
    it: 'Inserisci almeno un numero di tracciamento {carrier}.', sv: 'Ange minst ett spårningsnummer för {carrier}.',
    no: 'Skriv inn minst ett sporingsnummer for {carrier}.', es: 'Introduce al menos un número de seguimiento de {carrier}.',
    da: 'Indtast mindst ét sporingsnummer fra {carrier}.', ru: 'Введите хотя бы один номер отслеживания {carrier}.',
    pl: 'Wpisz co najmniej jeden numer przesyłki {carrier}.', ko: '{carrier} 운송장 번호를 하나 이상 입력하세요.',
    ar: 'أدخل رقم تتبّع واحدًا على الأقل من {carrier}.',
  },
  enter_email_password: {
    en: 'Enter your {account} e-mail address and password.', nl: 'Vul het e-mailadres en wachtwoord van {account} in.',
    de: 'Gib deine E-Mail-Adresse und dein Passwort für {account} ein.', fr: 'Saisissez l’adresse e-mail et le mot de passe de votre compte {account}.',
    it: 'Inserisci l’indirizzo e-mail e la password di {account}.', sv: 'Ange e-postadress och lösenord för {account}.',
    no: 'Skriv inn e-postadressen og passordet for {account}.', es: 'Introduce el correo electrónico y la contraseña de {account}.',
    da: 'Indtast e-mailadresse og adgangskode til {account}.', ru: 'Введите адрес электронной почты и пароль {account}.',
    pl: 'Wpisz adres e-mail i hasło do {account}.', ko: '{account} 이메일 주소와 비밀번호를 입력하세요.',
    ar: 'أدخل عنوان البريد الإلكتروني وكلمة المرور لحساب {account}.',
  },
  enter_email: {
    en: 'Enter your {account} e-mail address.', nl: 'Vul het e-mailadres van {account} in.', de: 'Gib deine E-Mail-Adresse für {account} ein.',
    fr: 'Saisissez l’adresse e-mail de votre compte {account}.', it: 'Inserisci l’indirizzo e-mail di {account}.', sv: 'Ange e-postadressen för {account}.',
    no: 'Skriv inn e-postadressen for {account}.', es: 'Introduce el correo electrónico de {account}.', da: 'Indtast e-mailadressen til {account}.',
    ru: 'Введите адрес электронной почты {account}.', pl: 'Wpisz adres e-mail do {account}.', ko: '{account} 이메일 주소를 입력하세요.',
    ar: 'أدخل عنوان البريد الإلكتروني لحساب {account}.',
  },
  dhl_account_or_tracking: {
    en: 'Enter your My DHL account, or at least one tracking number.', nl: 'Vul je My DHL-account in, of minstens één trackingnummer.',
    de: 'Gib dein My-DHL-Konto oder mindestens eine Sendungsnummer ein.', fr: 'Saisissez votre compte My DHL ou au moins un numéro de suivi.',
    it: 'Inserisci il tuo account My DHL o almeno un numero di tracciamento.', sv: 'Ange ditt My DHL-konto eller minst ett spårningsnummer.',
    no: 'Skriv inn My DHL-kontoen din eller minst ett sporingsnummer.', es: 'Introduce tu cuenta My DHL o al menos un número de seguimiento.',
    da: 'Indtast din My DHL-konto eller mindst ét sporingsnummer.', ru: 'Введите учётную запись My DHL или хотя бы один номер отслеживания.',
    pl: 'Wpisz konto My DHL lub co najmniej jeden numer przesyłki.', ko: 'My DHL 계정 또는 운송장 번호를 하나 이상 입력하세요.',
    ar: 'أدخل حساب My DHL أو رقم تتبّع واحدًا على الأقل.',
  },
  awb_not_express: {
    en: 'Not a DHL Express air waybill (10 digits): {codes}', nl: 'Geen DHL Express-luchtvrachtbriefnummer (10 cijfers): {codes}',
    de: 'Keine DHL-Express-Luftfrachtbriefnummer (10 Ziffern): {codes}', fr: 'Pas une lettre de transport aérien DHL Express (10 chiffres) : {codes}',
    it: 'Non è una lettera di vettura aerea DHL Express (10 cifre): {codes}', sv: 'Inte ett DHL Express-fraktsedelnummer (10 siffror): {codes}',
    no: 'Ikke et DHL Express-fraktbrevnummer (10 sifre): {codes}', es: 'No es una guía aérea de DHL Express (10 dígitos): {codes}',
    da: 'Ikke et DHL Express-luftfragtbrevsnummer (10 cifre): {codes}', ru: 'Это не номер авианакладной DHL Express (10 цифр): {codes}',
    pl: 'To nie jest numer lotniczego listu przewozowego DHL Express (10 cyfr): {codes}', ko: 'DHL Express 항공 운송장 번호(10자리)가 아닙니다: {codes}',
    ar: 'ليس رقم بوليصة شحن جوي من DHL Express (10 أرقام): {codes}',
  },
  awb_enter_one: {
    en: 'Enter at least one air waybill number.', nl: 'Vul minstens één luchtvrachtbriefnummer in.', de: 'Gib mindestens eine Luftfrachtbriefnummer ein.',
    fr: 'Saisissez au moins un numéro de lettre de transport aérien.', it: 'Inserisci almeno un numero di lettera di vettura aerea.',
    sv: 'Ange minst ett fraktsedelnummer.', no: 'Skriv inn minst ett fraktbrevnummer.', es: 'Introduce al menos un número de guía aérea.',
    da: 'Indtast mindst ét luftfragtbrevsnummer.', ru: 'Введите хотя бы один номер авианакладной.',
    pl: 'Wpisz co najmniej jeden numer lotniczego listu przewozowego.', ko: '항공 운송장 번호를 하나 이상 입력하세요.', ar: 'أدخل رقم بوليصة شحن جوي واحدًا على الأقل.',
  },
  awb_digits: {
    en: 'A DHL Express air waybill has 10 digits. Other DHL numbers belong on the DHL device.',
    nl: 'Een DHL Express-luchtvrachtbriefnummer bestaat uit 10 cijfers. Andere DHL-nummers horen bij het DHL-apparaat.',
    de: 'Eine DHL-Express-Luftfrachtbriefnummer hat 10 Ziffern. Andere DHL-Nummern gehören zum DHL-Gerät.',
    fr: 'Une lettre de transport aérien DHL Express comporte 10 chiffres. Les autres numéros DHL vont sur l’appareil DHL.',
    it: 'Una lettera di vettura aerea DHL Express ha 10 cifre. Gli altri numeri DHL vanno sul dispositivo DHL.',
    sv: 'Ett DHL Express-fraktsedelnummer har 10 siffror. Andra DHL-nummer hör till DHL-enheten.',
    no: 'Et DHL Express-fraktbrevnummer har 10 sifre. Andre DHL-numre hører til DHL-enheten.',
    es: 'Una guía aérea de DHL Express tiene 10 dígitos. Los demás números de DHL van en el dispositivo DHL.',
    da: 'Et DHL Express-luftfragtbrevsnummer har 10 cifre. Andre DHL-numre hører til DHL-enheden.',
    ru: 'Номер авианакладной DHL Express состоит из 10 цифр. Другие номера DHL добавляйте в устройство DHL.',
    pl: 'Numer lotniczego listu przewozowego DHL Express ma 10 cyfr. Inne numery DHL należą do urządzenia DHL.',
    ko: 'DHL Express 항공 운송장 번호는 10자리입니다. 다른 DHL 번호는 DHL 기기에 추가하세요.',
    ar: 'يتكوّن رقم بوليصة الشحن الجوي من DHL Express من 10 أرقام. أضف أرقام DHL الأخرى إلى جهاز DHL.',
  },
  awb_wrong_device: {
    en: 'This is a DHL Express air waybill. Add it to the DHL Express device instead.',
    nl: 'Dit is een DHL Express-luchtvrachtbriefnummer. Voeg het toe aan het DHL Express-apparaat.',
    de: 'Das ist eine DHL-Express-Luftfrachtbriefnummer. Füge sie stattdessen zum DHL-Express-Gerät hinzu.',
    fr: 'Ceci est une lettre de transport aérien DHL Express. Ajoutez-la plutôt à l’appareil DHL Express.',
    it: 'Questa è una lettera di vettura aerea DHL Express. Aggiungila invece al dispositivo DHL Express.',
    sv: 'Det här är ett DHL Express-fraktsedelnummer. Lägg till det i DHL Express-enheten i stället.',
    no: 'Dette er et DHL Express-fraktbrevnummer. Legg det til i DHL Express-enheten i stedet.',
    es: 'Esta es una guía aérea de DHL Express. Añádela al dispositivo DHL Express.',
    da: 'Dette er et DHL Express-luftfragtbrevsnummer. Tilføj det til DHL Express-enheden i stedet.',
    ru: 'Это номер авианакладной DHL Express. Добавьте его в устройство DHL Express.',
    pl: 'To numer lotniczego listu przewozowego DHL Express. Dodaj go do urządzenia DHL Express.',
    ko: 'DHL Express 항공 운송장 번호입니다. DHL Express 기기에 추가하세요.',
    ar: 'هذا رقم بوليصة شحن جوي من DHL Express. أضفه إلى جهاز DHL Express بدلًا من ذلك.',
  },
  dhlde_extra: {
    en: 'Extra tracking numbers need the DHL.de login (repair the device).',
    nl: 'Extra trackingnummers werken met de DHL.de-login (repareer het apparaat).',
    de: 'Zusätzliche Sendungsnummern brauchen die DHL.de-Anmeldung (Gerät reparieren).',
    fr: 'Les numéros de suivi supplémentaires nécessitent la connexion DHL.de (réparez l’appareil).',
    it: 'I numeri di tracciamento aggiuntivi richiedono l’accesso DHL.de (ripara il dispositivo).',
    sv: 'Extra spårningsnummer kräver DHL.de-inloggningen (reparera enheten).',
    no: 'Ekstra sporingsnumre krever DHL.de-påloggingen (reparer enheten).',
    es: 'Los números de seguimiento adicionales requieren el inicio de sesión de DHL.de (repara el dispositivo).',
    da: 'Ekstra sporingsnumre kræver DHL.de-login (reparer enheden).',
    ru: 'Для дополнительных номеров отслеживания нужен вход DHL.de (восстановите устройство).',
    pl: 'Dodatkowe numery przesyłek wymagają logowania DHL.de (napraw urządzenie).',
    ko: '추가 운송장 번호를 사용하려면 DHL.de 로그인이 필요합니다(기기 복구).',
    ar: 'تتطلّب أرقام التتبّع الإضافية تسجيل الدخول إلى DHL.de (أصلح الجهاز).',
  },
  start_first: {
    en: 'Start the {service} sign-in first.', nl: 'Start eerst de {service}-login.', de: 'Starte zuerst die {service}-Anmeldung.',
    fr: 'Lancez d’abord la connexion {service}.', it: 'Avvia prima l’accesso {service}.', sv: 'Starta inloggningen hos {service} först.',
    no: 'Start påloggingen hos {service} først.', es: 'Inicia primero el inicio de sesión de {service}.', da: 'Start login hos {service} først.',
    ru: 'Сначала начните вход в {service}.', pl: 'Najpierw rozpocznij logowanie do {service}.', ko: '먼저 {service} 로그인을 시작하세요.',
    ar: 'ابدأ تسجيل الدخول إلى {service} أولًا.',
  },
  older_attempt: {
    en: 'This sign-in belongs to an older attempt. Start the {service} sign-in again.',
    nl: 'Deze login hoort bij een eerdere poging. Start de {service}-login opnieuw.',
    de: 'Diese Anmeldung gehört zu einem älteren Versuch. Starte die {service}-Anmeldung erneut.',
    fr: 'Cette connexion appartient à une tentative précédente. Relancez la connexion {service}.',
    it: 'Questo accesso appartiene a un tentativo precedente. Avvia di nuovo l’accesso {service}.',
    sv: 'Den här inloggningen hör till ett tidigare försök. Starta inloggningen hos {service} igen.',
    no: 'Denne påloggingen hører til et tidligere forsøk. Start påloggingen hos {service} på nytt.',
    es: 'Este inicio de sesión pertenece a un intento anterior. Vuelve a iniciar sesión en {service}.',
    da: 'Dette login hører til et tidligere forsøg. Start login hos {service} igen.',
    ru: 'Этот вход относится к предыдущей попытке. Начните вход в {service} заново.',
    pl: 'To logowanie należy do wcześniejszej próby. Rozpocznij logowanie do {service} ponownie.',
    ko: '이전 시도의 로그인입니다. {service} 로그인을 다시 시작하세요.',
    ar: 'ينتمي تسجيل الدخول هذا إلى محاولة سابقة. ابدأ تسجيل الدخول إلى {service} مجددًا.',
  },
  paste_address: {
    en: 'Paste the complete {url} address.', nl: 'Plak het volledige adres {url}.', de: 'Füge die vollständige Adresse {url} ein.',
    fr: 'Collez l’adresse complète {url}.', it: 'Incolla l’indirizzo completo {url}.', sv: 'Klistra in hela adressen {url}.',
    no: 'Lim inn hele adressen {url}.', es: 'Pega la dirección completa {url}.', da: 'Indsæt hele adressen {url}.',
    ru: 'Вставьте полный адрес {url}.', pl: 'Wklej pełny adres {url}.', ko: '전체 주소 {url}을(를) 붙여 넣으세요.', ar: 'الصق العنوان الكامل {url}.',
  },
  invalid_callback: {
    en: 'The sign-in address is invalid. Copy the complete address after signing in.',
    nl: 'Het login-adres is ongeldig. Kopieer na het inloggen het volledige adres.',
    de: 'Die Anmeldeadresse ist ungültig. Kopiere nach der Anmeldung die vollständige Adresse.',
    fr: 'L’adresse de connexion n’est pas valide. Copiez l’adresse complète après vous être connecté.',
    it: 'L’indirizzo di accesso non è valido. Copia l’indirizzo completo dopo aver effettuato l’accesso.',
    sv: 'Inloggningsadressen är ogiltig. Kopiera hela adressen efter inloggningen.',
    no: 'Påloggingsadressen er ugyldig. Kopier hele adressen etter at du har logget inn.',
    es: 'La dirección de inicio de sesión no es válida. Copia la dirección completa después de iniciar sesión.',
    da: 'Login-adressen er ugyldig. Kopiér hele adressen, når du har logget ind.',
    ru: 'Адрес входа недействителен. Скопируйте полный адрес после входа.',
    pl: 'Adres logowania jest nieprawidłowy. Po zalogowaniu skopiuj pełny adres.',
    ko: '로그인 주소가 올바르지 않습니다. 로그인한 후 전체 주소를 복사하세요.',
    ar: 'عنوان تسجيل الدخول غير صالح. انسخ العنوان الكامل بعد تسجيل الدخول.',
  },
  different_account: {
    en: 'This is a different {carrier} account than the one this device belongs to.',
    nl: 'Dit is een ander {carrier}-account dan het account van dit apparaat.',
    de: 'Das ist ein anderes {carrier}-Konto als das, zu dem dieses Gerät gehört.',
    fr: 'Ce compte {carrier} est différent de celui auquel appartient cet appareil.',
    it: 'Questo account {carrier} è diverso da quello a cui appartiene questo dispositivo.',
    sv: 'Det här är ett annat {carrier}-konto än det som enheten hör till.',
    no: 'Dette er en annen {carrier}-konto enn den enheten tilhører.',
    es: 'Esta cuenta de {carrier} es distinta de la que pertenece a este dispositivo.',
    da: 'Dette er en anden {carrier}-konto end den, enheden hører til.',
    ru: 'Это другая учётная запись {carrier}, не та, к которой привязано это устройство.',
    pl: 'To inne konto {carrier} niż to, do którego należy to urządzenie.',
    ko: '이 기기에 연결된 계정과 다른 {carrier} 계정입니다.',
    ar: 'هذا حساب {carrier} مختلف عن الحساب الذي ينتمي إليه هذا الجهاز.',
  },
  fedex_credentials: {
    en: 'Enter your FedEx Client ID and Client Secret.', nl: 'Vul je FedEx Client ID en Client Secret in.',
    de: 'Gib deine FedEx Client ID und dein Client Secret ein.', fr: 'Saisissez votre Client ID et votre Client Secret FedEx.',
    it: 'Inserisci il Client ID e il Client Secret di FedEx.', sv: 'Ange ditt Client ID och Client Secret för FedEx.',
    no: 'Skriv inn Client ID og Client Secret for FedEx.', es: 'Introduce tu Client ID y tu Client Secret de FedEx.',
    da: 'Indtast dit Client ID og Client Secret til FedEx.', ru: 'Введите Client ID и Client Secret FedEx.',
    pl: 'Wpisz Client ID i Client Secret FedEx.', ko: 'FedEx Client ID와 Client Secret을 입력하세요.', ar: 'أدخل Client ID وClient Secret الخاصين بـ FedEx.',
  },
  royal_mail_key: {
    en: 'Enter the Royal Mail Click & Drop API key.', nl: 'Vul de Royal Mail Click & Drop API-sleutel in.', de: 'Gib den Royal Mail Click & Drop API-Schlüssel ein.',
    fr: 'Saisissez la clé API Royal Mail Click & Drop.', it: 'Inserisci la chiave API Royal Mail Click & Drop.', sv: 'Ange API-nyckeln för Royal Mail Click & Drop.',
    no: 'Skriv inn API-nøkkelen for Royal Mail Click & Drop.', es: 'Introduce la clave API de Royal Mail Click & Drop.', da: 'Indtast API-nøglen til Royal Mail Click & Drop.',
    ru: 'Введите API-ключ Royal Mail Click & Drop.', pl: 'Wpisz klucz API Royal Mail Click & Drop.', ko: 'Royal Mail Click & Drop API 키를 입력하세요.',
    ar: 'أدخل مفتاح API لخدمة Royal Mail Click & Drop.',
  },
  polish_phone: {
    en: 'Enter a Polish nine-digit mobile number.', nl: 'Vul een Pools mobiel nummer van negen cijfers in.', de: 'Gib eine polnische neunstellige Mobilnummer ein.',
    fr: 'Saisissez un numéro de mobile polonais à neuf chiffres.', it: 'Inserisci un numero di cellulare polacco di nove cifre.',
    sv: 'Ange ett polskt mobilnummer med nio siffror.', no: 'Skriv inn et polsk mobilnummer på ni sifre.', es: 'Introduce un número de móvil polaco de nueve dígitos.',
    da: 'Indtast et polsk mobilnummer på ni cifre.', ru: 'Введите польский мобильный номер из девяти цифр.', pl: 'Wpisz dziewięciocyfrowy polski numer komórkowy.',
    ko: '9자리 폴란드 휴대폰 번호를 입력하세요.', ar: 'أدخل رقم هاتف محمول بولنديًا من تسعة أرقام.',
  },
  ampere_link_use: {
    en: 'Use the tracking link from the bol.com e-mail (https://link.bol.com/t/…) or an Ampère link (bol.prd.amperebezorgt.nl).',
    nl: 'Gebruik de trackinglink uit de bol.com-e-mail (https://link.bol.com/t/…) of een Ampère-link (bol.prd.amperebezorgt.nl).',
    de: 'Verwende den Sendungslink aus der bol.com-E-Mail (https://link.bol.com/t/…) oder einen Ampère-Link (bol.prd.amperebezorgt.nl).',
    fr: 'Utilisez le lien de suivi de l’e-mail bol.com (https://link.bol.com/t/…) ou un lien Ampère (bol.prd.amperebezorgt.nl).',
    it: 'Usa il link di tracciamento dell’e-mail di bol.com (https://link.bol.com/t/…) o un link Ampère (bol.prd.amperebezorgt.nl).',
    sv: 'Använd spårningslänken från bol.com-mejlet (https://link.bol.com/t/…) eller en Ampère-länk (bol.prd.amperebezorgt.nl).',
    no: 'Bruk sporingslenken fra e-posten fra bol.com (https://link.bol.com/t/…) eller en Ampère-lenke (bol.prd.amperebezorgt.nl).',
    es: 'Usa el enlace de seguimiento del correo de bol.com (https://link.bol.com/t/…) o un enlace de Ampère (bol.prd.amperebezorgt.nl).',
    da: 'Brug sporingslinket fra bol.com-e-mailen (https://link.bol.com/t/…) eller et Ampère-link (bol.prd.amperebezorgt.nl).',
    ru: 'Используйте ссылку для отслеживания из письма bol.com (https://link.bol.com/t/…) или ссылку Ampère (bol.prd.amperebezorgt.nl).',
    pl: 'Użyj linku śledzenia z e-maila bol.com (https://link.bol.com/t/…) lub linku Ampère (bol.prd.amperebezorgt.nl).',
    ko: 'bol.com 이메일의 배송 추적 링크(https://link.bol.com/t/…) 또는 Ampère 링크(bol.prd.amperebezorgt.nl)를 사용하세요.',
    ar: 'استخدم رابط التتبّع من بريد bol.com الإلكتروني (https://link.bol.com/t/…) أو رابط Ampère (bol.prd.amperebezorgt.nl).',
  },
  ampere_link_paste: {
    en: 'Paste the tracking link from the bol.com e-mail (https://link.bol.com/t/…).',
    nl: 'Plak de trackinglink uit de bol.com-e-mail (https://link.bol.com/t/…).',
    de: 'Füge den Sendungslink aus der bol.com-E-Mail ein (https://link.bol.com/t/…).',
    fr: 'Collez le lien de suivi de l’e-mail bol.com (https://link.bol.com/t/…).',
    it: 'Incolla il link di tracciamento dell’e-mail di bol.com (https://link.bol.com/t/…).',
    sv: 'Klistra in spårningslänken från bol.com-mejlet (https://link.bol.com/t/…).',
    no: 'Lim inn sporingslenken fra e-posten fra bol.com (https://link.bol.com/t/…).',
    es: 'Pega el enlace de seguimiento del correo de bol.com (https://link.bol.com/t/…).',
    da: 'Indsæt sporingslinket fra bol.com-e-mailen (https://link.bol.com/t/…).',
    ru: 'Вставьте ссылку для отслеживания из письма bol.com (https://link.bol.com/t/…).',
    pl: 'Wklej link śledzenia z e-maila bol.com (https://link.bol.com/t/…).',
    ko: 'bol.com 이메일의 배송 추적 링크(https://link.bol.com/t/…)를 붙여 넣으세요.',
    ar: 'الصق رابط التتبّع من بريد bol.com الإلكتروني (https://link.bol.com/t/…).',
  },
  ampere_code_or_link: {
    en: 'Paste the bol.com session code from the helper or the tracking link from the bol.com e-mail.',
    nl: 'Plak de bol.com-sessiecode uit de helper of de trackinglink uit de bol.com-e-mail.',
    de: 'Füge den bol.com-Sitzungscode aus dem Helper oder den Sendungslink aus der bol.com-E-Mail ein.',
    fr: 'Collez le code de session bol.com de l’assistant ou le lien de suivi de l’e-mail bol.com.',
    it: 'Incolla il codice di sessione bol.com dall’helper o il link di tracciamento dell’e-mail di bol.com.',
    sv: 'Klistra in bol.com-sessionskoden från hjälpappen eller spårningslänken från bol.com-mejlet.',
    no: 'Lim inn bol.com-øktkoden fra hjelpeappen eller sporingslenken fra e-posten fra bol.com.',
    es: 'Pega el código de sesión de bol.com del asistente o el enlace de seguimiento del correo de bol.com.',
    da: 'Indsæt bol.com-sessionskoden fra hjælpeappen eller sporingslinket fra bol.com-e-mailen.',
    ru: 'Вставьте код сеанса bol.com из помощника или ссылку для отслеживания из письма bol.com.',
    pl: 'Wklej kod sesji bol.com z pomocnika lub link śledzenia z e-maila bol.com.',
    ko: '도우미의 bol.com 세션 코드 또는 bol.com 이메일의 배송 추적 링크를 붙여 넣으세요.',
    ar: 'الصق رمز جلسة bol.com من المساعد أو رابط التتبّع من بريد bol.com الإلكتروني.',
  },
  ups_helper: {
    en: 'Use UPS Token Helper 0.1.5 or newer and paste the web_session pairing value.',
    nl: 'Gebruik UPS Token Helper 0.1.5 of nieuwer en plak de web_session-koppelwaarde.',
    de: 'Verwende UPS Token Helper 0.1.5 oder neuer und füge den web_session-Kopplungswert ein.',
    fr: 'Utilisez UPS Token Helper 0.1.5 ou plus récent et collez la valeur d’appairage web_session.',
    it: 'Usa UPS Token Helper 0.1.5 o successivo e incolla il valore di associazione web_session.',
    sv: 'Använd UPS Token Helper 0.1.5 eller senare och klistra in parkopplingsvärdet web_session.',
    no: 'Bruk UPS Token Helper 0.1.5 eller nyere og lim inn paringsverdien web_session.',
    es: 'Usa UPS Token Helper 0.1.5 o posterior y pega el valor de emparejamiento web_session.',
    da: 'Brug UPS Token Helper 0.1.5 eller nyere, og indsæt parringsværdien web_session.',
    ru: 'Используйте UPS Token Helper 0.1.5 или новее и вставьте значение сопряжения web_session.',
    pl: 'Użyj UPS Token Helper 0.1.5 lub nowszego i wklej wartość parowania web_session.',
    ko: 'UPS Token Helper 0.1.5 이상을 사용하고 web_session 페어링 값을 붙여 넣으세요.',
    ar: 'استخدم UPS Token Helper 0.1.5 أو أحدث والصق قيمة الإقران web_session.',
  },
  ups_data_invalid: {
    en: 'The UPS login data is empty or invalid. Copy it again from UPS Token Helper 0.1.5 or newer.',
    nl: 'De UPS-logingegevens zijn leeg of ongeldig. Kopieer ze opnieuw uit UPS Token Helper 0.1.5 of nieuwer.',
    de: 'Die UPS-Anmeldedaten sind leer oder ungültig. Kopiere sie erneut aus UPS Token Helper 0.1.5 oder neuer.',
    fr: 'Les données de connexion UPS sont vides ou invalides. Copiez-les à nouveau depuis UPS Token Helper 0.1.5 ou plus récent.',
    it: 'I dati di accesso UPS sono vuoti o non validi. Copiali di nuovo da UPS Token Helper 0.1.5 o successivo.',
    sv: 'UPS-inloggningsuppgifterna är tomma eller ogiltiga. Kopiera dem igen från UPS Token Helper 0.1.5 eller senare.',
    no: 'UPS-påloggingsdataene er tomme eller ugyldige. Kopier dem på nytt fra UPS Token Helper 0.1.5 eller nyere.',
    es: 'Los datos de inicio de sesión de UPS están vacíos o no son válidos. Cópialos de nuevo desde UPS Token Helper 0.1.5 o posterior.',
    da: 'UPS-logindata er tomme eller ugyldige. Kopiér dem igen fra UPS Token Helper 0.1.5 eller nyere.',
    ru: 'Данные входа UPS пусты или недействительны. Скопируйте их снова из UPS Token Helper 0.1.5 или новее.',
    pl: 'Dane logowania UPS są puste lub nieprawidłowe. Skopiuj je ponownie z UPS Token Helper 0.1.5 lub nowszego.',
    ko: 'UPS 로그인 데이터가 비어 있거나 올바르지 않습니다. UPS Token Helper 0.1.5 이상에서 다시 복사하세요.',
    ar: 'بيانات تسجيل الدخول إلى UPS فارغة أو غير صالحة. انسخها مجددًا من UPS Token Helper 0.1.5 أو أحدث.',
  },
  session_code_invalid: {
    en: '{carrier}: the session code is empty or invalid. Copy it again from the helper.',
    nl: '{carrier}: de sessiecode is leeg of ongeldig. Kopieer hem opnieuw uit de helper.',
    de: '{carrier}: Der Sitzungscode ist leer oder ungültig. Kopiere ihn erneut aus dem Helper.',
    fr: '{carrier} : le code de session est vide ou invalide. Copiez-le à nouveau depuis l’assistant.',
    it: '{carrier}: il codice di sessione è vuoto o non valido. Copialo di nuovo dall’helper.',
    sv: '{carrier}: sessionskoden är tom eller ogiltig. Kopiera den igen från hjälpappen.',
    no: '{carrier}: øktkoden er tom eller ugyldig. Kopier den på nytt fra hjelpeappen.',
    es: '{carrier}: el código de sesión está vacío o no es válido. Cópialo de nuevo desde el asistente.',
    da: '{carrier}: sessionskoden er tom eller ugyldig. Kopiér den igen fra hjælpeappen.',
    ru: '{carrier}: код сеанса пуст или недействителен. Скопируйте его снова из помощника.',
    pl: '{carrier}: kod sesji jest pusty lub nieprawidłowy. Skopiuj go ponownie z pomocnika.',
    ko: '{carrier}: 세션 코드가 비어 있거나 올바르지 않습니다. 도우미에서 다시 복사하세요.',
    ar: '{carrier}: رمز الجلسة فارغ أو غير صالح. انسخه مجددًا من المساعد.',
  },

  /* ------------------------------------------- carrier errors (generic) -- */
  parcel_postcode_rejected: {
    en: '{carrier} does not recognise parcel {code} with this postal code. Check the number and the postal code.',
    nl: '{carrier} herkent pakket {code} niet met deze postcode. Controleer het nummer en de postcode.',
    de: '{carrier} erkennt das Paket {code} mit dieser Postleitzahl nicht. Prüfe die Nummer und die Postleitzahl.',
    fr: '{carrier} ne reconnaît pas le colis {code} avec ce code postal. Vérifiez le numéro et le code postal.',
    it: '{carrier} non riconosce il pacco {code} con questo CAP. Controlla il numero e il CAP.',
    sv: '{carrier} känner inte igen paketet {code} med det här postnumret. Kontrollera numret och postnumret.',
    no: '{carrier} gjenkjenner ikke pakken {code} med dette postnummeret. Kontroller nummeret og postnummeret.',
    es: '{carrier} no reconoce el paquete {code} con este código postal. Comprueba el número y el código postal.',
    da: '{carrier} genkender ikke pakken {code} med dette postnummer. Kontrollér nummeret og postnummeret.',
    ru: '{carrier} не находит посылку {code} с этим индексом. Проверьте номер и индекс.',
    pl: '{carrier} nie rozpoznaje paczki {code} z tym kodem pocztowym. Sprawdź numer i kod pocztowy.',
    ko: '{carrier}에서 이 우편번호로 택배 {code}을(를) 찾을 수 없습니다. 번호와 우편번호를 확인하세요.',
    ar: 'لا يتعرّف {carrier} على الطرد {code} بهذا الرمز البريدي. تحقّق من الرقم والرمز البريدي.',
  },
  carrier_unreachable: {
    en: '{carrier} cannot be reached right now. Try again later.', nl: '{carrier} is nu niet bereikbaar. Probeer het later opnieuw.',
    de: '{carrier} ist gerade nicht erreichbar. Versuche es später erneut.', fr: '{carrier} est injoignable pour le moment. Réessayez plus tard.',
    it: '{carrier} non è raggiungibile al momento. Riprova più tardi.', sv: '{carrier} går inte att nå just nu. Försök igen senare.',
    no: '{carrier} kan ikke nås akkurat nå. Prøv igjen senere.', es: 'No se puede conectar con {carrier} en este momento. Inténtalo de nuevo más tarde.',
    da: '{carrier} kan ikke nås lige nu. Prøv igen senere.', ru: '{carrier} сейчас недоступен. Повторите попытку позже.',
    pl: '{carrier} jest teraz nieosiągalny. Spróbuj ponownie później.', ko: '지금은 {carrier}에 연결할 수 없습니다. 나중에 다시 시도하세요.',
    ar: 'يتعذّر الوصول إلى {carrier} الآن. حاول مرة أخرى لاحقًا.',
  },
  carrier_unavailable: {
    en: '{carrier} is temporarily unavailable.', nl: '{carrier} is tijdelijk niet beschikbaar.', de: '{carrier} ist vorübergehend nicht verfügbar.',
    fr: '{carrier} est temporairement indisponible.', it: '{carrier} non è temporaneamente disponibile.', sv: '{carrier} är tillfälligt otillgänglig.',
    no: '{carrier} er midlertidig utilgjengelig.', es: '{carrier} no está disponible temporalmente.', da: '{carrier} er midlertidigt utilgængelig.',
    ru: '{carrier} временно недоступен.', pl: '{carrier} jest chwilowo niedostępny.', ko: '{carrier}을(를) 일시적으로 사용할 수 없습니다.', ar: '{carrier} غير متاح مؤقتًا.',
  },
  http_failed: {
    en: '{carrier} returned an error (HTTP {status}).', nl: '{carrier} gaf een fout terug (HTTP {status}).', de: '{carrier} hat einen Fehler zurückgegeben (HTTP {status}).',
    fr: '{carrier} a renvoyé une erreur (HTTP {status}).', it: '{carrier} ha restituito un errore (HTTP {status}).', sv: '{carrier} returnerade ett fel (HTTP {status}).',
    no: '{carrier} returnerte en feil (HTTP {status}).', es: '{carrier} devolvió un error (HTTP {status}).', da: '{carrier} returnerede en fejl (HTTP {status}).',
    ru: '{carrier} вернул ошибку (HTTP {status}).', pl: '{carrier} zwrócił błąd (HTTP {status}).', ko: '{carrier}에서 오류를 반환했습니다(HTTP {status}).',
    ar: 'أعاد {carrier} خطأً (HTTP {status}).',
  },
  carrier_error: {
    en: '{carrier} reported an error: {detail}', nl: '{carrier} meldde een fout: {detail}', de: '{carrier} hat einen Fehler gemeldet: {detail}',
    fr: '{carrier} a signalé une erreur : {detail}', it: '{carrier} ha segnalato un errore: {detail}', sv: '{carrier} rapporterade ett fel: {detail}',
    no: '{carrier} rapporterte en feil: {detail}', es: '{carrier} informó de un error: {detail}', da: '{carrier} rapporterede en fejl: {detail}',
    ru: '{carrier} сообщил об ошибке: {detail}', pl: '{carrier} zgłosił błąd: {detail}', ko: '{carrier}에서 오류를 보고했습니다: {detail}', ar: 'أبلغ {carrier} عن خطأ: {detail}',
  },
  unexpected_response: {
    en: '{carrier} returned an unexpected response. Try again later.', nl: '{carrier} gaf een onverwacht antwoord. Probeer het later opnieuw.',
    de: '{carrier} hat unerwartet geantwortet. Versuche es später erneut.', fr: '{carrier} a renvoyé une réponse inattendue. Réessayez plus tard.',
    it: '{carrier} ha restituito una risposta inattesa. Riprova più tardi.', sv: '{carrier} gav ett oväntat svar. Försök igen senare.',
    no: '{carrier} ga et uventet svar. Prøv igjen senere.', es: '{carrier} devolvió una respuesta inesperada. Inténtalo de nuevo más tarde.',
    da: '{carrier} gav et uventet svar. Prøv igen senere.', ru: '{carrier} вернул неожиданный ответ. Повторите попытку позже.',
    pl: '{carrier} zwrócił nieoczekiwaną odpowiedź. Spróbuj ponownie później.', ko: '{carrier}에서 예기치 않은 응답을 반환했습니다. 나중에 다시 시도하세요.',
    ar: 'أعاد {carrier} استجابة غير متوقعة. حاول مرة أخرى لاحقًا.',
  },
  rate_limited: {
    en: '{carrier} is receiving too many requests; MyParcel will try again later.', nl: '{carrier} krijgt te veel verzoeken; MyParcel probeert het later opnieuw.',
    de: '{carrier} erhält zu viele Anfragen; MyParcel versucht es später erneut.', fr: '{carrier} reçoit trop de requêtes ; MyParcel réessaiera plus tard.',
    it: '{carrier} sta ricevendo troppe richieste; MyParcel riproverà più tardi.', sv: '{carrier} tar emot för många förfrågningar; MyParcel försöker igen senare.',
    no: '{carrier} mottar for mange forespørsler; MyParcel prøver igjen senere.', es: '{carrier} está recibiendo demasiadas solicitudes; MyParcel lo intentará de nuevo más tarde.',
    da: '{carrier} modtager for mange forespørgsler; MyParcel prøver igen senere.', ru: '{carrier} получает слишком много запросов; MyParcel повторит попытку позже.',
    pl: '{carrier} otrzymuje zbyt wiele żądań; MyParcel spróbuje ponownie później.', ko: '{carrier}에 요청이 너무 많습니다. MyParcel이 나중에 다시 시도합니다.',
    ar: 'يتلقّى {carrier} طلبات كثيرة جدًا؛ سيحاول MyParcel مجددًا لاحقًا.',
  },
  wrong_credentials: {
    en: '{carrier}: the e-mail address or password is incorrect.', nl: '{carrier}: het e-mailadres of wachtwoord is onjuist.',
    de: '{carrier}: E-Mail-Adresse oder Passwort ist falsch.', fr: '{carrier} : l’adresse e-mail ou le mot de passe est incorrect.',
    it: '{carrier}: l’indirizzo e-mail o la password non sono corretti.', sv: '{carrier}: e-postadressen eller lösenordet är fel.',
    no: '{carrier}: e-postadressen eller passordet er feil.', es: '{carrier}: el correo electrónico o la contraseña no son correctos.',
    da: '{carrier}: e-mailadressen eller adgangskoden er forkert.', ru: '{carrier}: неверный адрес электронной почты или пароль.',
    pl: '{carrier}: adres e-mail lub hasło są nieprawidłowe.', ko: '{carrier}: 이메일 주소 또는 비밀번호가 올바르지 않습니다.',
    ar: '{carrier}: البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  },
  rejected: {
    en: '{carrier} rejected the sign-in. Check your details and try again.', nl: '{carrier} heeft de login geweigerd. Controleer je gegevens en probeer het opnieuw.',
    de: '{carrier} hat die Anmeldung abgelehnt. Prüfe deine Angaben und versuche es erneut.', fr: '{carrier} a refusé la connexion. Vérifiez vos informations et réessayez.',
    it: '{carrier} ha rifiutato l’accesso. Controlla i tuoi dati e riprova.', sv: '{carrier} nekade inloggningen. Kontrollera dina uppgifter och försök igen.',
    no: '{carrier} avviste påloggingen. Kontroller opplysningene og prøv igjen.', es: '{carrier} rechazó el inicio de sesión. Revisa tus datos e inténtalo de nuevo.',
    da: '{carrier} afviste login. Kontrollér dine oplysninger, og prøv igen.', ru: '{carrier} отклонил вход. Проверьте данные и повторите попытку.',
    pl: '{carrier} odrzucił logowanie. Sprawdź dane i spróbuj ponownie.', ko: '{carrier}에서 로그인을 거부했습니다. 정보를 확인하고 다시 시도하세요.',
    ar: 'رفض {carrier} تسجيل الدخول. تحقّق من بياناتك وحاول مرة أخرى.',
  },
  login_failed: {
    en: 'Signing in to {carrier} failed.', nl: 'Inloggen bij {carrier} is mislukt.', de: 'Die Anmeldung bei {carrier} ist fehlgeschlagen.',
    fr: 'La connexion à {carrier} a échoué.', it: 'Accesso a {carrier} non riuscito.', sv: 'Inloggningen hos {carrier} misslyckades.',
    no: 'Påloggingen hos {carrier} mislyktes.', es: 'No se pudo iniciar sesión en {carrier}.', da: 'Login hos {carrier} mislykkedes.',
    ru: 'Не удалось войти в {carrier}.', pl: 'Logowanie do {carrier} nie powiodło się.', ko: '{carrier} 로그인에 실패했습니다.', ar: 'فشل تسجيل الدخول إلى {carrier}.',
  },
  login_changed: {
    en: 'The {carrier} sign-in did not complete; the login page may have changed.', nl: 'De {carrier}-login is niet afgerond; mogelijk is de loginpagina gewijzigd.',
    de: 'Die {carrier}-Anmeldung wurde nicht abgeschlossen; die Anmeldeseite hat sich möglicherweise geändert.',
    fr: 'La connexion {carrier} n’a pas abouti ; la page de connexion a peut-être changé.',
    it: 'L’accesso {carrier} non è stato completato; la pagina di accesso potrebbe essere cambiata.',
    sv: 'Inloggningen hos {carrier} slutfördes inte; inloggningssidan kan ha ändrats.',
    no: 'Påloggingen hos {carrier} ble ikke fullført; påloggingssiden kan ha endret seg.',
    es: 'El inicio de sesión de {carrier} no se completó; puede que la página de acceso haya cambiado.',
    da: 'Login hos {carrier} blev ikke gennemført; loginsiden kan være ændret.', ru: 'Вход в {carrier} не завершён; возможно, страница входа изменилась.',
    pl: 'Logowanie do {carrier} nie zostało ukończone; strona logowania mogła się zmienić.', ko: '{carrier} 로그인이 완료되지 않았습니다. 로그인 페이지가 변경되었을 수 있습니다.',
    ar: 'لم يكتمل تسجيل الدخول إلى {carrier}؛ ربما تغيّرت صفحة تسجيل الدخول.',
  },
  not_signed_in: {
    en: '{carrier} is not signed in.', nl: '{carrier} is niet aangemeld.', de: '{carrier} ist nicht angemeldet.', fr: '{carrier} n’est pas connecté.',
    it: '{carrier} non ha effettuato l’accesso.', sv: '{carrier} är inte inloggad.', no: '{carrier} er ikke pålogget.', es: '{carrier} no ha iniciado sesión.',
    da: '{carrier} er ikke logget ind.', ru: 'Вход в {carrier} не выполнен.', pl: '{carrier} nie jest zalogowany.', ko: '{carrier}에 로그인되어 있지 않습니다.',
    ar: 'لم يتم تسجيل الدخول إلى {carrier}.',
  },
  too_many_redirects: {
    en: 'Too many redirects during the {carrier} sign-in.', nl: 'Te veel doorverwijzingen tijdens de {carrier}-login.', de: 'Zu viele Weiterleitungen bei der {carrier}-Anmeldung.',
    fr: 'Trop de redirections pendant la connexion {carrier}.', it: 'Troppi reindirizzamenti durante l’accesso {carrier}.',
    sv: 'För många omdirigeringar under inloggningen hos {carrier}.', no: 'For mange omdirigeringer under påloggingen hos {carrier}.',
    es: 'Demasiadas redirecciones durante el inicio de sesión de {carrier}.', da: 'For mange omdirigeringer under login hos {carrier}.',
    ru: 'Слишком много перенаправлений при входе в {carrier}.', pl: 'Zbyt wiele przekierowań podczas logowania do {carrier}.',
    ko: '{carrier} 로그인 중 리디렉션이 너무 많습니다.', ar: 'عمليات إعادة توجيه كثيرة جدًا أثناء تسجيل الدخول إلى {carrier}.',
  },
  app_update: {
    en: '{carrier} no longer supports this app version; update MyParcel.', nl: '{carrier} ondersteunt deze appversie niet meer; werk MyParcel bij.',
    de: '{carrier} unterstützt diese App-Version nicht mehr; aktualisiere MyParcel.', fr: '{carrier} ne prend plus en charge cette version de l’app ; mettez à jour MyParcel.',
    it: '{carrier} non supporta più questa versione dell’app; aggiorna MyParcel.', sv: '{carrier} stöder inte längre den här appversionen; uppdatera MyParcel.',
    no: '{carrier} støtter ikke lenger denne appversjonen; oppdater MyParcel.', es: '{carrier} ya no admite esta versión de la app; actualiza MyParcel.',
    da: '{carrier} understøtter ikke længere denne appversion; opdater MyParcel.', ru: '{carrier} больше не поддерживает эту версию приложения; обновите MyParcel.',
    pl: '{carrier} nie obsługuje już tej wersji aplikacji; zaktualizuj MyParcel.', ko: '{carrier}에서 더 이상 이 앱 버전을 지원하지 않습니다. MyParcel을 업데이트하세요.',
    ar: 'لم يعد {carrier} يدعم إصدار التطبيق هذا؛ حدّث MyParcel.',
  },
  link_invalid: {
    en: 'This {carrier} link is no longer valid.', nl: 'Deze {carrier}-link is niet meer geldig.', de: 'Dieser {carrier}-Link ist nicht mehr gültig.',
    fr: 'Ce lien {carrier} n’est plus valide.', it: 'Questo link {carrier} non è più valido.', sv: 'Den här {carrier}-länken är inte längre giltig.',
    no: 'Denne {carrier}-lenken er ikke lenger gyldig.', es: 'Este enlace de {carrier} ya no es válido.', da: 'Dette {carrier}-link er ikke længere gyldigt.',
    ru: 'Эта ссылка {carrier} больше недействительна.', pl: 'Ten link {carrier} jest już nieważny.', ko: '이 {carrier} 링크는 더 이상 유효하지 않습니다.',
    ar: 'لم يعد رابط {carrier} هذا صالحًا.',
  },
  link_no_parcel: {
    en: 'This link does not lead to a parcel at {carrier}.', nl: 'Deze link leidt niet naar een pakket bij {carrier}.', de: 'Dieser Link führt zu keinem Paket bei {carrier}.',
    fr: 'Ce lien ne mène à aucun colis chez {carrier}.', it: 'Questo link non porta a un pacco di {carrier}.', sv: 'Den här länken leder inte till något paket hos {carrier}.',
    no: 'Denne lenken fører ikke til en pakke hos {carrier}.', es: 'Este enlace no lleva a ningún paquete de {carrier}.', da: 'Dette link fører ikke til en pakke hos {carrier}.',
    ru: 'Эта ссылка не ведёт к посылке {carrier}.', pl: 'Ten link nie prowadzi do paczki {carrier}.', ko: '이 링크는 {carrier} 택배로 연결되지 않습니다.',
    ar: 'لا يؤدي هذا الرابط إلى طرد لدى {carrier}.',
  },
  bol_expired: {
    en: 'The bol.com session has expired. Reconnect with the bol.com Homey Login Helper.',
    nl: 'De bol.com-sessie is verlopen. Koppel opnieuw met de bol.com Homey Login Helper.',
    de: 'Die bol.com-Sitzung ist abgelaufen. Verbinde dich erneut mit dem bol.com Homey Login Helper.',
    fr: 'La session bol.com a expiré. Reconnectez-vous avec le bol.com Homey Login Helper.',
    it: 'La sessione bol.com è scaduta. Ricollegati con il bol.com Homey Login Helper.',
    sv: 'bol.com-sessionen har gått ut. Anslut igen med bol.com Homey Login Helper.',
    no: 'bol.com-økten er utløpt. Koble til på nytt med bol.com Homey Login Helper.',
    es: 'La sesión de bol.com ha caducado. Vuelve a conectar con bol.com Homey Login Helper.',
    da: 'bol.com-sessionen er udløbet. Forbind igen med bol.com Homey Login Helper.',
    ru: 'Сеанс bol.com истёк. Подключитесь снова с помощью bol.com Homey Login Helper.',
    pl: 'Sesja bol.com wygasła. Połącz ponownie za pomocą bol.com Homey Login Helper.',
    ko: 'bol.com 세션이 만료되었습니다. bol.com Homey Login Helper로 다시 연결하세요.',
    ar: 'انتهت صلاحية جلسة bol.com. أعد الاتصال باستخدام bol.com Homey Login Helper.',
  },
  de_ip: {
    en: 'DHL.de only accepts these requests from a German internet connection (HTTP 403).',
    nl: 'DHL.de accepteert deze verzoeken alleen vanaf een Duitse internetverbinding (HTTP 403).',
    de: 'DHL.de akzeptiert diese Anfragen nur über einen deutschen Internetanschluss (HTTP 403).',
    fr: 'DHL.de n’accepte ces requêtes que depuis une connexion internet allemande (HTTP 403).',
    it: 'DHL.de accetta queste richieste solo da una connessione internet tedesca (HTTP 403).',
    sv: 'DHL.de tar bara emot dessa förfrågningar från en tysk internetanslutning (HTTP 403).',
    no: 'DHL.de godtar bare disse forespørslene fra en tysk internettforbindelse (HTTP 403).',
    es: 'DHL.de solo acepta estas solicitudes desde una conexión a internet alemana (HTTP 403).',
    da: 'DHL.de accepterer kun disse forespørgsler fra en tysk internetforbindelse (HTTP 403).',
    ru: 'DHL.de принимает эти запросы только с немецкого интернет-подключения (HTTP 403).',
    pl: 'DHL.de przyjmuje te żądania tylko z niemieckiego połączenia internetowego (HTTP 403).',
    ko: 'DHL.de는 독일 인터넷 연결에서 보낸 요청만 허용합니다(HTTP 403).',
    ar: 'لا يقبل DHL.de هذه الطلبات إلا من اتصال إنترنت ألماني (HTTP 403).',
  },
  inpost_market: {
    en: 'This InPost account belongs to {account}, not {market}. Sign out of InPost in your browser and try again.',
    nl: 'Dit InPost-account hoort bij {account}, niet bij {market}. Log in je browser uit bij InPost en probeer het opnieuw.',
    de: 'Dieses InPost-Konto gehört zu {account}, nicht zu {market}. Melde dich im Browser bei InPost ab und versuche es erneut.',
    fr: 'Ce compte InPost appartient à {account}, pas à {market}. Déconnectez-vous d’InPost dans votre navigateur et réessayez.',
    it: 'Questo account InPost appartiene a {account}, non a {market}. Esci da InPost nel browser e riprova.',
    sv: 'Det här InPost-kontot tillhör {account}, inte {market}. Logga ut från InPost i webbläsaren och försök igen.',
    no: 'Denne InPost-kontoen tilhører {account}, ikke {market}. Logg ut av InPost i nettleseren og prøv igjen.',
    es: 'Esta cuenta de InPost pertenece a {account}, no a {market}. Cierra la sesión de InPost en el navegador e inténtalo de nuevo.',
    da: 'Denne InPost-konto tilhører {account}, ikke {market}. Log ud af InPost i browseren, og prøv igen.',
    ru: 'Эта учётная запись InPost относится к {account}, а не к {market}. Выйдите из InPost в браузере и повторите попытку.',
    pl: 'To konto InPost należy do {account}, a nie do {market}. Wyloguj się z InPost w przeglądarce i spróbuj ponownie.',
    ko: '이 InPost 계정은 {market}이(가) 아니라 {account}에 속합니다. 브라우저에서 InPost에서 로그아웃한 후 다시 시도하세요.',
    ar: 'ينتمي حساب InPost هذا إلى {account} وليس إلى {market}. سجّل الخروج من InPost في المتصفح وحاول مرة أخرى.',
  },
  dhlx_otp: {
    en: 'DHLPass asks for a verification code. Enter the code you received and try again.',
    nl: 'DHLPass vraagt om een verificatiecode. Vul de ontvangen code in en probeer opnieuw.',
    de: 'DHLPass fragt nach einem Bestätigungscode. Gib den erhaltenen Code ein und versuche es erneut.',
    fr: 'DHLPass demande un code de vérification. Saisissez le code reçu et réessayez.',
    it: 'DHLPass richiede un codice di verifica. Inserisci il codice ricevuto e riprova.',
    sv: 'DHLPass ber om en verifieringskod. Ange koden du fick och försök igen.',
    no: 'DHLPass ber om en bekreftelseskode. Skriv inn koden du fikk, og prøv igjen.',
    es: 'DHLPass solicita un código de verificación. Introduce el código recibido e inténtalo de nuevo.',
    da: 'DHLPass beder om en bekræftelseskode. Indtast den modtagne kode, og prøv igen.',
    ru: 'DHLPass запрашивает код подтверждения. Введите полученный код и повторите попытку.',
    pl: 'DHLPass prosi o kod weryfikacyjny. Wpisz otrzymany kod i spróbuj ponownie.',
    ko: 'DHLPass에서 인증 코드를 요청합니다. 받은 코드를 입력하고 다시 시도하세요.',
    ar: 'يطلب DHLPass رمز تحقق. أدخل الرمز الذي استلمته وحاول مرة أخرى.',
  },
  dhlx_browser: {
    en: 'DHLPass needs an interactive browser step for this login. Use the DHL Express Homey Login Helper instead.',
    nl: 'DHLPass gebruikt voor deze login een interactieve browserstap. Gebruik in plaats daarvan de DHL Express Homey Login Helper.',
    de: 'DHLPass verlangt für diese Anmeldung einen interaktiven Browserschritt. Verwende stattdessen den DHL Express Homey Login Helper.',
    fr: 'DHLPass exige une étape interactive dans le navigateur pour cette connexion. Utilisez plutôt le DHL Express Homey Login Helper.',
    it: 'DHLPass richiede un passaggio interattivo nel browser per questo accesso. Usa invece il DHL Express Homey Login Helper.',
    sv: 'DHLPass kräver ett interaktivt webbläsarsteg för den här inloggningen. Använd DHL Express Homey Login Helper i stället.',
    no: 'DHLPass krever et interaktivt nettlesertrinn for denne påloggingen. Bruk DHL Express Homey Login Helper i stedet.',
    es: 'DHLPass requiere un paso interactivo en el navegador para este inicio de sesión. Usa en su lugar DHL Express Homey Login Helper.',
    da: 'DHLPass kræver et interaktivt browsertrin for dette login. Brug DHL Express Homey Login Helper i stedet.',
    ru: 'Для этого входа DHLPass требует интерактивного шага в браузере. Используйте вместо этого DHL Express Homey Login Helper.',
    pl: 'DHLPass wymaga interaktywnego kroku w przeglądarce przy tym logowaniu. Użyj zamiast tego DHL Express Homey Login Helper.',
    ko: 'DHLPass에서 이 로그인에 대화형 브라우저 단계를 요구합니다. 대신 DHL Express Homey Login Helper를 사용하세요.',
    ar: 'يتطلّب DHLPass خطوة تفاعلية في المتصفح لتسجيل الدخول هذا. استخدم DHL Express Homey Login Helper بدلًا من ذلك.',
  },
  dhlx_no_shipments: {
    en: 'The DHL Express account is signed in, but MyDHL+ did not return a shipment list yet. If needed, use the helper and open All Shipments there.',
    nl: 'Het DHL Express-account is ingelogd, maar MyDHL+ gaf nog geen zendingenlijst. Gebruik eventueel de helper en open daar All Shipments.',
    de: 'Das DHL-Express-Konto ist angemeldet, aber MyDHL+ hat noch keine Sendungsliste geliefert. Verwende bei Bedarf den Helper und öffne dort All Shipments.',
    fr: 'Le compte DHL Express est connecté, mais MyDHL+ n’a pas encore renvoyé de liste d’envois. Si besoin, utilisez l’assistant et ouvrez-y All Shipments.',
    it: 'L’account DHL Express ha effettuato l’accesso, ma MyDHL+ non ha ancora restituito un elenco di spedizioni. Se necessario, usa l’helper e apri All Shipments.',
    sv: 'DHL Express-kontot är inloggat, men MyDHL+ har ännu inte returnerat någon försändelselista. Använd vid behov hjälpappen och öppna All Shipments där.',
    no: 'DHL Express-kontoen er pålogget, men MyDHL+ har ennå ikke returnert en forsendelsesliste. Bruk hjelpeappen ved behov og åpne All Shipments der.',
    es: 'La cuenta de DHL Express ha iniciado sesión, pero MyDHL+ aún no ha devuelto una lista de envíos. Si es necesario, usa el asistente y abre All Shipments.',
    da: 'DHL Express-kontoen er logget ind, men MyDHL+ har endnu ikke returneret en forsendelsesliste. Brug om nødvendigt hjælpeappen, og åbn All Shipments der.',
    ru: 'Вход в учётную запись DHL Express выполнен, но MyDHL+ пока не вернул список отправлений. При необходимости воспользуйтесь помощником и откройте там All Shipments.',
    pl: 'Konto DHL Express jest zalogowane, ale MyDHL+ nie zwrócił jeszcze listy przesyłek. W razie potrzeby użyj pomocnika i otwórz tam All Shipments.',
    ko: 'DHL Express 계정에 로그인했지만 MyDHL+에서 아직 배송 목록을 반환하지 않았습니다. 필요하면 도우미를 사용해 All Shipments를 여세요.',
    ar: 'تم تسجيل الدخول إلى حساب DHL Express، لكن MyDHL+ لم يُرجع قائمة الشحنات بعد. استخدم المساعد عند الحاجة وافتح All Shipments هناك.',
  },
  attempt_expired: {
    en: 'The sign-in attempt has expired. Start again.', nl: 'De aanmeldpoging is verlopen. Start opnieuw.', de: 'Der Anmeldeversuch ist abgelaufen. Starte erneut.',
    fr: 'La tentative de connexion a expiré. Recommencez.', it: 'Il tentativo di accesso è scaduto. Ricomincia.', sv: 'Inloggningsförsöket har gått ut. Börja om.',
    no: 'Påloggingsforsøket er utløpt. Start på nytt.', es: 'El intento de inicio de sesión ha caducado. Empieza de nuevo.', da: 'Loginforsøget er udløbet. Start forfra.',
    ru: 'Время попытки входа истекло. Начните заново.', pl: 'Próba logowania wygasła. Zacznij od nowa.', ko: '로그인 시도가 만료되었습니다. 다시 시작하세요.',
    ar: 'انتهت صلاحية محاولة تسجيل الدخول. ابدأ من جديد.',
  },
  no_auth_code: {
    en: 'No valid authorisation code found.', nl: 'Geen geldige autorisatiecode gevonden.', de: 'Kein gültiger Autorisierungscode gefunden.',
    fr: 'Aucun code d’autorisation valide trouvé.', it: 'Nessun codice di autorizzazione valido trovato.', sv: 'Ingen giltig auktoriseringskod hittades.',
    no: 'Fant ingen gyldig autorisasjonskode.', es: 'No se ha encontrado ningún código de autorización válido.', da: 'Der blev ikke fundet nogen gyldig autorisationskode.',
    ru: 'Действительный код авторизации не найден.', pl: 'Nie znaleziono prawidłowego kodu autoryzacji.', ko: '유효한 인증 코드를 찾을 수 없습니다.',
    ar: 'لم يتم العثور على رمز تفويض صالح.',
  },
  state_mismatch: {
    en: 'The security code of the sign-in does not match.', nl: 'De beveiligingscode van de aanmelding klopt niet.',
    de: 'Der Sicherheitscode der Anmeldung stimmt nicht überein.', fr: 'Le code de sécurité de la connexion ne correspond pas.',
    it: 'Il codice di sicurezza dell’accesso non corrisponde.', sv: 'Inloggningens säkerhetskod stämmer inte.', no: 'Sikkerhetskoden for påloggingen stemmer ikke.',
    es: 'El código de seguridad del inicio de sesión no coincide.', da: 'Loginets sikkerhedskode passer ikke.', ru: 'Код безопасности входа не совпадает.',
    pl: 'Kod zabezpieczający logowania się nie zgadza.', ko: '로그인 보안 코드가 일치하지 않습니다.', ar: 'رمز الأمان الخاص بتسجيل الدخول غير مطابق.',
  },
  image_too_large: {
    en: 'The image is too large.', nl: 'De afbeelding is te groot.', de: 'Das Bild ist zu groß.', fr: 'L’image est trop grande.', it: 'L’immagine è troppo grande.',
    sv: 'Bilden är för stor.', no: 'Bildet er for stort.', es: 'La imagen es demasiado grande.', da: 'Billedet er for stort.', ru: 'Изображение слишком большое.',
    pl: 'Obraz jest za duży.', ko: '이미지가 너무 큽니다.', ar: 'الصورة كبيرة جدًا.',
  },
  account_missing: {
    en: '{carrier} did not return an account identifier.', nl: '{carrier} gaf geen account-ID terug.', de: '{carrier} hat keine Konto-ID zurückgegeben.',
    fr: '{carrier} n’a renvoyé aucun identifiant de compte.', it: '{carrier} non ha restituito un identificativo dell’account.', sv: '{carrier} returnerade inget konto-ID.',
    no: '{carrier} returnerte ingen konto-ID.', es: '{carrier} no devolvió ningún identificador de cuenta.', da: '{carrier} returnerede intet konto-id.',
    ru: '{carrier} не вернул идентификатор учётной записи.', pl: '{carrier} nie zwrócił identyfikatora konta.', ko: '{carrier}에서 계정 식별자를 반환하지 않았습니다.',
    ar: 'لم يُرجع {carrier} معرّف الحساب.',
  },
  graphql_error: {
    en: '{carrier} reported a data error.', nl: '{carrier} meldde een gegevensfout.', de: '{carrier} hat einen Datenfehler gemeldet.', fr: '{carrier} a signalé une erreur de données.',
    it: '{carrier} ha segnalato un errore nei dati.', sv: '{carrier} rapporterade ett datafel.', no: '{carrier} rapporterte en datafeil.', es: '{carrier} informó de un error de datos.',
    da: '{carrier} rapporterede en datafejl.', ru: '{carrier} сообщил об ошибке данных.', pl: '{carrier} zgłosił błąd danych.', ko: '{carrier}에서 데이터 오류를 보고했습니다.',
    ar: 'أبلغ {carrier} عن خطأ في البيانات.',
  },
};

/** Brand names as they appear in the carrier libraries' English source messages (longest first). */
const BRANDS = [
  'Post & DHL Germany', 'DHL Express', 'DHL.de', 'My DHL', 'DHLPass', 'MyDHL+', 'DPD Germany', 'DPD Poland', 'GLS Germany', 'My bpost', 'Vinted Go',
  'Royal Mail', 'bol.com', 'Bol.com', 'Ampère', 'Budbee', 'FedEx', 'InPost', 'PostNL', 'bpost', 'UPS', 'DHL', 'DPD', 'GLS', 'Trunkrs', 'Dynalogic', 'Dragonfly', 'Intelcom', 'Mondial Relay', 'Amazon'];
function brandOf(message, fallback = '') {
  const text = String(message || '');
  for (const brand of BRANDS) if (text.includes(brand)) return brand === 'Bol.com' ? 'bol.com' : brand;
  return fallback;
}

/**
 * English source messages of the carrier libraries → message key (+ variables).
 * Order matters: specific patterns first, generic ones (HTTP, unexpected response) last.
 */
const ERROR_PATTERNS = [
  [/requests must come from Germany/i, 'de_ip'],
  [/no longer supports this app version/i, 'app_update'],
  [/rate limit|asked to slow down/i, 'rate_limited'],
  [/temporarily unavailable|endpoint is missing/i, 'carrier_unavailable'],
  [/e-mail address or password is incorrect|sign-in failed\. Check your e-mail/i, 'wrong_credentials'],
  [/^Enter your (My DHL|DHL Express|My bpost|DPD|PostNL) e-mail address and password\.?$/i, 'enter_email_password', m => ({ account: m[1] })],
  [/e-mail and password are required/i, 'enter_email_password', (m, c) => ({ account: c })],
  [/Client ID and Client Secret/i, 'fedex_credentials'],
  [/Click & Drop API key is missing/i, 'royal_mail_key'],
  [/Polish nine-digit mobile number/i, 'polish_phone'],
  [/^Paste the tracking link from the bol\.com e-mail/i, 'ampere_link_paste'],
  [/^This (\S+) link is no longer valid|login link is no longer valid/i, 'link_invalid'],
  [/did not lead to a parcel|did not start a session for this link/i, 'link_no_parcel'],
  [/bol\.com session (expired|code contains no usable)|web session is missing|helper session has expired/i, 'bol_expired'],
  [/session code is (required|empty)|Invalid (bol\.com|DHL Express) session code/i, 'session_code_invalid'],
  [/UPS login data is empty|Invalid UPS login data|Invalid UPS PPC session bundle|UPS PPC session bundle is incomplete/i, 'ups_data_invalid'],
  [/Use UPS Token Helper 0\.1\.5 or newer/i, 'ups_helper'],
  [/^Paste the complete (\S+) address/i, 'paste_address', m => ({ url: m[1] })],
  [/belongs to an older attempt/i, 'older_attempt', (m, c) => ({ service: c })],
  [/This InPost account belongs to (\S+), not (\S+)\./i, 'inpost_market', m => ({ account: m[1], market: m[2] })],
  [/DHLPass asks for a verification code|DHL Express asks for a verification code/i, 'dhlx_otp'],
  [/interactive browser step|did not return a usable session/i, 'dhlx_browser'],
  [/did not return a shipment list/i, 'dhlx_no_shipments'],
  [/redirect loop|Too many redirects/i, 'too_many_redirects'],
  [/Tracking number is missing/i, 'enter_tracking'],
  [/(login|session|sign-in) has expired|session (expired|was rejected|rejected)|rejected the session|Not signed in to|session is missing|sign in again|has no refresh token|post number\) is missing|redirected to the sign-in page|is not signed in|session refresh failed/i, 'auth_unavailable'],
  [/rejected (the )?(API credentials|account token|login|sign-in|phone number|SMS code|refreshed credentials|\S+ grant)|login failed:|Germany login failed|authentication failed|tracking refused|did not grant offline access/i, 'rejected'],
  [/is unreachable|did not respond in time|network error/i, 'carrier_unreachable'],
  [/HTTP (\d{3})|\((\d{3})\)/, 'http_failed', m => ({ status: m[1] || m[2] })],
  [/returned (an? )?(unexpected|unreadable|invalid|incomplete|malformed|no)\b|did not return|SOAP fault|without parcel data|returned no|had no access token|did not identify the account/i, 'unexpected_response'],
  [/^(\S+) rejected (\S+) – check the number and postcode$/, 'parcel_postcode_rejected', m => ({ code: m[2] })],
  [/^(Budbee|UPS \/\S+|Dragonfly|Intelcom): (.+)$/, 'carrier_error', m => ({ detail: m[2] })],
];

/** Translated text for a carrier-library error message; null when the message is not a known source text. */
function translateMessage(homey, message, fallbackCarrier = '') {
  const text = String(message || '').trim();
  if (!text) return null;
  for (const [pattern, key, varsOf] of ERROR_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const carrier = brandOf(text, fallbackCarrier) || fallbackCarrier;
    const vars = { carrier, name: carrier, service: carrier, account: carrier, ...(varsOf ? varsOf(match, carrier) : {}) };
    return tr(homey, MESSAGES[key], vars);
  }
  return null;
}

/** Error with the same properties (status, auth, code …) and a translated message. */
function localizeError(homey, error, fallbackCarrier = '') {
  if (!error || error.localized) return error;
  const text = translateMessage(homey, error.message, fallbackCarrier);
  if (!text) return error;
  const out = new Error(text);
  for (const key of Object.keys(error)) out[key] = error[key];
  out.name = error.name;
  out.sourceMessage = error.message;
  out.localized = true;
  return out;
}

/** Display text for an error (translated when it is a known carrier message). */
function errorText(homey, error, fallbackCarrier = '') {
  return translateMessage(homey, error?.message, fallbackCarrier) || String(error?.message || error || '');
}

/** Wrap every pairing/repair handler so carrier errors reach the pairing screen translated. */
function localizeSession(homey, session, fallbackCarrier = '') {
  if (!session || typeof session.setHandler !== 'function' || session.__myparcelLocalized) return session;
  const setHandler = session.setHandler.bind(session);
  session.setHandler = (name, handler) => setHandler(name, localizeListener(homey, handler, fallbackCarrier));
  session.__myparcelLocalized = true;
  return session;
}

/** Same for Flow card run listeners; fallbackCarrier may be a function of the listener arguments. */
function localizeListener(homey, fn, fallbackCarrier = '') {
  return async (...args) => {
    try { return await fn(...args); } catch (error) {
      let carrier = fallbackCarrier;
      try { if (typeof fallbackCarrier === 'function') carrier = fallbackCarrier(...args) || ''; } catch (_) { carrier = ''; }
      throw localizeError(homey, error, carrier);
    }
  };
}

function t(homey, key, vars = {}) { return MESSAGES[key] ? tr(homey, MESSAGES[key], vars) : fill(key, vars); }

module.exports = {
  MESSAGES, ERROR_PATTERNS, BRANDS, t, translateMessage, localizeError, errorText, localizeSession, localizeListener, brandOf,
};
