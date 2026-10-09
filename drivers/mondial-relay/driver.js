'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const {
  MondialRelayOAuth, MondialRelayClient, buildAuthorizationUrl, isValidCallbackUrl, parseCallbackUrl, decodeIdTokenSubject,
  hasConfirmedPhone, accountType, newDeviceUid, marketOf, MARKETS,
} = require('../../lib/mondial-relay-tracking');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');
const { tr } = require('../../lib/i18n');

/** Pairing / repair errors – the four setup refusals of ha-mondial-relay stay separate on purpose. */
const ERRORS = {
  invalid_redirect: {
    en: 'This is not the address Mondial Relay sent you to. Paste the complete address that starts with https://account.inpost-group.com/callback from your latest sign-in.',
    nl: 'Dit is niet het adres waar Mondial Relay je naartoe stuurde. Plak het volledige adres dat begint met https://account.inpost-group.com/callback van je laatste aanmelding.',
    de: 'Das ist nicht die Adresse, zu der Mondial Relay dich weitergeleitet hat. Füge die vollständige Adresse ein, die mit https://account.inpost-group.com/callback beginnt, aus deiner letzten Anmeldung.',
    fr: 'Ce n’est pas l’adresse vers laquelle Mondial Relay vous a redirigé. Collez l’adresse complète commençant par https://account.inpost-group.com/callback issue de votre dernière connexion.',
    it: 'Questo non è l’indirizzo a cui ti ha reindirizzato Mondial Relay. Incolla l’indirizzo completo che inizia con https://account.inpost-group.com/callback del tuo ultimo accesso.',
    sv: 'Det här är inte adressen som Mondial Relay skickade dig till. Klistra in hela adressen som börjar med https://account.inpost-group.com/callback från din senaste inloggning.',
    no: 'Dette er ikke adressen Mondial Relay sendte deg til. Lim inn hele adressen som starter med https://account.inpost-group.com/callback fra den siste innloggingen.',
    es: 'Esta no es la dirección a la que te envió Mondial Relay. Pega la dirección completa que empieza por https://account.inpost-group.com/callback de tu último inicio de sesión.',
    da: 'Dette er ikke den adresse, Mondial Relay sendte dig til. Indsæt hele adressen, der starter med https://account.inpost-group.com/callback, fra dit seneste login.',
    ru: 'Это не тот адрес, на который вас перенаправил Mondial Relay. Вставьте полный адрес, начинающийся с https://account.inpost-group.com/callback, из последнего входа.',
    pl: 'To nie jest adres, na który przekierował Cię Mondial Relay. Wklej pełny adres zaczynający się od https://account.inpost-group.com/callback z ostatniego logowania.',
    ko: 'Mondial Relay가 이동시킨 주소가 아닙니다. 가장 최근 로그인에서 https://account.inpost-group.com/callback 으로 시작하는 전체 주소를 붙여 넣으세요.',
    ar: 'هذا ليس العنوان الذي أرسلك إليه Mondial Relay. الصق العنوان الكامل الذي يبدأ بـ https://account.inpost-group.com/callback من آخر تسجيل دخول.',
  },
  invalid_auth: {
    en: 'The sign-in was refused – this link was probably used before or has expired. Open the sign-in link again and paste the new address.',
    nl: 'De aanmelding werd geweigerd – deze link is waarschijnlijk al gebruikt of verlopen. Open de aanmeldlink opnieuw en plak het nieuwe adres.',
    de: 'Die Anmeldung wurde abgelehnt – dieser Link wurde wahrscheinlich schon verwendet oder ist abgelaufen. Öffne den Anmeldelink erneut und füge die neue Adresse ein.',
    fr: 'La connexion a été refusée – ce lien a probablement déjà été utilisé ou a expiré. Rouvrez le lien de connexion et collez la nouvelle adresse.',
    it: 'L’accesso è stato rifiutato: probabilmente questo link è già stato usato o è scaduto. Apri di nuovo il link di accesso e incolla il nuovo indirizzo.',
    sv: 'Inloggningen nekades – länken har troligen redan använts eller gått ut. Öppna inloggningslänken igen och klistra in den nya adressen.',
    no: 'Innloggingen ble avvist – lenken er sannsynligvis allerede brukt eller utløpt. Åpne innloggingslenken på nytt og lim inn den nye adressen.',
    es: 'Se rechazó el inicio de sesión: probablemente este enlace ya se usó o ha caducado. Vuelve a abrir el enlace de inicio de sesión y pega la nueva dirección.',
    da: 'Login blev afvist – linket er sandsynligvis allerede brugt eller udløbet. Åbn login-linket igen, og indsæt den nye adresse.',
    ru: 'Вход отклонён — эта ссылка, вероятно, уже использовалась или истекла. Откройте ссылку для входа ещё раз и вставьте новый адрес.',
    pl: 'Logowanie zostało odrzucone – ten link prawdopodobnie został już użyty lub wygasł. Otwórz ponownie link logowania i wklej nowy adres.',
    ko: '로그인이 거부되었습니다. 이 링크는 이미 사용되었거나 만료되었을 수 있습니다. 로그인 링크를 다시 열고 새 주소를 붙여 넣으세요.',
    ar: 'تم رفض تسجيل الدخول – ربما استُخدم هذا الرابط من قبل أو انتهت صلاحيته. افتح رابط تسجيل الدخول مرة أخرى والصق العنوان الجديد.',
  },
  account_rejected: {
    en: 'Signing in worked, but Mondial Relay does not accept this account yet. Sign in once on {website} or in the Mondial Relay app, then try again.',
    nl: 'Aanmelden is gelukt, maar Mondial Relay accepteert dit account nog niet. Meld je één keer aan op {website} of in de Mondial Relay-app en probeer het daarna opnieuw.',
    de: 'Die Anmeldung hat geklappt, aber Mondial Relay akzeptiert dieses Konto noch nicht. Melde dich einmal auf {website} oder in der Mondial-Relay-App an und versuche es dann erneut.',
    fr: 'La connexion a réussi, mais Mondial Relay n’accepte pas encore ce compte. Connectez-vous une fois sur {website} ou dans l’application Mondial Relay, puis réessayez.',
    it: 'L’accesso è riuscito, ma Mondial Relay non accetta ancora questo account. Accedi una volta su {website} o nell’app Mondial Relay, poi riprova.',
    sv: 'Inloggningen lyckades, men Mondial Relay godkänner inte kontot ännu. Logga in en gång på {website} eller i Mondial Relay-appen och försök sedan igen.',
    no: 'Innloggingen virket, men Mondial Relay godtar ikke denne kontoen ennå. Logg inn én gang på {website} eller i Mondial Relay-appen, og prøv igjen.',
    es: 'El inicio de sesión funcionó, pero Mondial Relay todavía no acepta esta cuenta. Inicia sesión una vez en {website} o en la app de Mondial Relay y vuelve a intentarlo.',
    da: 'Login lykkedes, men Mondial Relay accepterer ikke kontoen endnu. Log ind én gang på {website} eller i Mondial Relay-appen, og prøv derefter igen.',
    ru: 'Вход выполнен, но Mondial Relay пока не принимает эту учётную запись. Войдите один раз на {website} или в приложении Mondial Relay, затем повторите попытку.',
    pl: 'Logowanie się powiodło, ale Mondial Relay jeszcze nie akceptuje tego konta. Zaloguj się raz na {website} lub w aplikacji Mondial Relay, a potem spróbuj ponownie.',
    ko: '로그인은 되었지만 Mondial Relay가 아직 이 계정을 허용하지 않습니다. {website} 또는 Mondial Relay 앱에서 한 번 로그인한 후 다시 시도하세요.',
    ar: 'نجح تسجيل الدخول، لكن Mondial Relay لا يقبل هذا الحساب بعد. سجّل الدخول مرة واحدة على {website} أو في تطبيق Mondial Relay ثم أعد المحاولة.',
  },
  phone_not_confirmed: {
    en: 'Mondial Relay refused the parcel list because the phone number of this account is not confirmed. Confirm it in the Mondial Relay app, then try again.',
    nl: 'Mondial Relay weigerde de pakketlijst omdat het telefoonnummer van dit account niet bevestigd is. Bevestig het in de Mondial Relay-app en probeer het daarna opnieuw.',
    de: 'Mondial Relay hat die Paketliste verweigert, weil die Telefonnummer dieses Kontos nicht bestätigt ist. Bestätige sie in der Mondial-Relay-App und versuche es dann erneut.',
    fr: 'Mondial Relay a refusé la liste des colis car le numéro de téléphone de ce compte n’est pas confirmé. Confirmez-le dans l’application Mondial Relay, puis réessayez.',
    it: 'Mondial Relay ha rifiutato l’elenco dei pacchi perché il numero di telefono di questo account non è confermato. Confermalo nell’app Mondial Relay, poi riprova.',
    sv: 'Mondial Relay nekade paketlistan eftersom kontots telefonnummer inte är bekräftat. Bekräfta det i Mondial Relay-appen och försök sedan igen.',
    no: 'Mondial Relay avviste pakkelisten fordi telefonnummeret til kontoen ikke er bekreftet. Bekreft det i Mondial Relay-appen, og prøv igjen.',
    es: 'Mondial Relay rechazó la lista de paquetes porque el número de teléfono de esta cuenta no está confirmado. Confírmalo en la app de Mondial Relay y vuelve a intentarlo.',
    da: 'Mondial Relay afviste pakkelisten, fordi kontoens telefonnummer ikke er bekræftet. Bekræft det i Mondial Relay-appen, og prøv derefter igen.',
    ru: 'Mondial Relay отклонил список посылок, потому что номер телефона этой учётной записи не подтверждён. Подтвердите его в приложении Mondial Relay и повторите попытку.',
    pl: 'Mondial Relay odrzucił listę paczek, ponieważ numer telefonu tego konta nie jest potwierdzony. Potwierdź go w aplikacji Mondial Relay i spróbuj ponownie.',
    ko: '이 계정의 전화번호가 확인되지 않아 Mondial Relay가 소포 목록을 거부했습니다. Mondial Relay 앱에서 번호를 확인한 후 다시 시도하세요.',
    ar: 'رفض Mondial Relay قائمة الطرود لأن رقم هاتف هذا الحساب غير مؤكَّد. أكّده في تطبيق Mondial Relay ثم أعد المحاولة.',
  },
  parcels_unavailable: {
    en: 'Your account is valid, but Mondial Relay refused its parcel list. Sign in once on {website} or in the Mondial Relay app, then try again.',
    nl: 'Je account is geldig, maar Mondial Relay weigerde de pakketlijst. Meld je één keer aan op {website} of in de Mondial Relay-app en probeer het daarna opnieuw.',
    de: 'Dein Konto ist gültig, aber Mondial Relay hat die Paketliste verweigert. Melde dich einmal auf {website} oder in der Mondial-Relay-App an und versuche es dann erneut.',
    fr: 'Votre compte est valide, mais Mondial Relay a refusé sa liste de colis. Connectez-vous une fois sur {website} ou dans l’application Mondial Relay, puis réessayez.',
    it: 'Il tuo account è valido, ma Mondial Relay ha rifiutato l’elenco dei pacchi. Accedi una volta su {website} o nell’app Mondial Relay, poi riprova.',
    sv: 'Ditt konto är giltigt, men Mondial Relay nekade paketlistan. Logga in en gång på {website} eller i Mondial Relay-appen och försök sedan igen.',
    no: 'Kontoen din er gyldig, men Mondial Relay avviste pakkelisten. Logg inn én gang på {website} eller i Mondial Relay-appen, og prøv igjen.',
    es: 'Tu cuenta es válida, pero Mondial Relay rechazó su lista de paquetes. Inicia sesión una vez en {website} o en la app de Mondial Relay y vuelve a intentarlo.',
    da: 'Din konto er gyldig, men Mondial Relay afviste pakkelisten. Log ind én gang på {website} eller i Mondial Relay-appen, og prøv derefter igen.',
    ru: 'Учётная запись действительна, но Mondial Relay отклонил список посылок. Войдите один раз на {website} или в приложении Mondial Relay, затем повторите попытку.',
    pl: 'Twoje konto jest prawidłowe, ale Mondial Relay odrzucił listę paczek. Zaloguj się raz na {website} lub w aplikacji Mondial Relay, a potem spróbuj ponownie.',
    ko: '계정은 유효하지만 Mondial Relay가 소포 목록을 거부했습니다. {website} 또는 Mondial Relay 앱에서 한 번 로그인한 후 다시 시도하세요.',
    ar: 'حسابك صالح، لكن Mondial Relay رفض قائمة الطرود. سجّل الدخول مرة واحدة على {website} أو في تطبيق Mondial Relay ثم أعد المحاولة.',
  },
  cannot_connect: {
    en: 'Mondial Relay cannot be reached right now. Check your internet connection and try again later.',
    nl: 'Mondial Relay is op dit moment niet bereikbaar. Controleer je internetverbinding en probeer het later opnieuw.',
    de: 'Mondial Relay ist gerade nicht erreichbar. Prüfe deine Internetverbindung und versuche es später erneut.',
    fr: 'Mondial Relay est actuellement injoignable. Vérifiez votre connexion internet et réessayez plus tard.',
    it: 'Mondial Relay non è raggiungibile al momento. Controlla la connessione a internet e riprova più tardi.',
    sv: 'Mondial Relay går inte att nå just nu. Kontrollera din internetanslutning och försök igen senare.',
    no: 'Mondial Relay kan ikke nås akkurat nå. Sjekk internettforbindelsen og prøv igjen senere.',
    es: 'No se puede contactar con Mondial Relay en este momento. Comprueba tu conexión a internet e inténtalo más tarde.',
    da: 'Mondial Relay kan ikke nås lige nu. Tjek din internetforbindelse, og prøv igen senere.',
    ru: 'Mondial Relay сейчас недоступен. Проверьте подключение к интернету и повторите попытку позже.',
    pl: 'Mondial Relay jest teraz niedostępny. Sprawdź połączenie z internetem i spróbuj ponownie później.',
    ko: '지금은 Mondial Relay에 연결할 수 없습니다. 인터넷 연결을 확인하고 나중에 다시 시도하세요.',
    ar: 'يتعذر الوصول إلى Mondial Relay حاليًا. تحقّق من اتصالك بالإنترنت وأعد المحاولة لاحقًا.',
  },
  signing_rejected: {
    en: 'Mondial Relay rejected this app’s request. This is not a problem with your account and signing in again will not help – an app update is needed.',
    nl: 'Mondial Relay weigerde het verzoek van deze app. Dit ligt niet aan je account en opnieuw aanmelden helpt niet – er is een app-update nodig.',
    de: 'Mondial Relay hat die Anfrage dieser App abgelehnt. Das liegt nicht an deinem Konto, und eine erneute Anmeldung hilft nicht – ein App-Update ist nötig.',
    fr: 'Mondial Relay a refusé la requête de cette application. Ce n’est pas un problème de votre compte et se reconnecter n’y changera rien – une mise à jour de l’application est nécessaire.',
    it: 'Mondial Relay ha rifiutato la richiesta di questa app. Non è un problema del tuo account e accedere di nuovo non serve: è necessario un aggiornamento dell’app.',
    sv: 'Mondial Relay avvisade appens förfrågan. Det är inget fel på ditt konto och en ny inloggning hjälper inte – appen behöver uppdateras.',
    no: 'Mondial Relay avviste forespørselen fra denne appen. Det er ikke noe galt med kontoen din, og ny innlogging hjelper ikke – appen må oppdateres.',
    es: 'Mondial Relay rechazó la solicitud de esta app. No es un problema de tu cuenta y volver a iniciar sesión no servirá: hace falta una actualización de la app.',
    da: 'Mondial Relay afviste denne apps forespørgsel. Det er ikke et problem med din konto, og et nyt login hjælper ikke – appen skal opdateres.',
    ru: 'Mondial Relay отклонил запрос этого приложения. Проблема не в вашей учётной записи, и повторный вход не поможет — нужно обновление приложения.',
    pl: 'Mondial Relay odrzucił żądanie tej aplikacji. To nie jest problem z Twoim kontem i ponowne logowanie nie pomoże – potrzebna jest aktualizacja aplikacji.',
    ko: 'Mondial Relay가 이 앱의 요청을 거부했습니다. 계정 문제가 아니므로 다시 로그인해도 해결되지 않으며, 앱 업데이트가 필요합니다.',
    ar: 'رفض Mondial Relay طلب هذا التطبيق. المشكلة ليست في حسابك ولن تفيد إعادة تسجيل الدخول – يلزم تحديث التطبيق.',
  },
  wrong_account: {
    en: 'You signed in with a different Mondial Relay account than the one this device belongs to. Sign in with the original account, or add a new device for the other account.',
    nl: 'Je hebt je aangemeld met een ander Mondial Relay-account dan het account van dit apparaat. Meld je aan met het oorspronkelijke account, of voeg een nieuw apparaat toe voor het andere account.',
    de: 'Du hast dich mit einem anderen Mondial-Relay-Konto angemeldet als dem, zu dem dieses Gerät gehört. Melde dich mit dem ursprünglichen Konto an oder füge für das andere Konto ein neues Gerät hinzu.',
    fr: 'Vous vous êtes connecté avec un autre compte Mondial Relay que celui de cet appareil. Connectez-vous avec le compte d’origine ou ajoutez un nouvel appareil pour l’autre compte.',
    it: 'Hai effettuato l’accesso con un account Mondial Relay diverso da quello di questo dispositivo. Accedi con l’account originale oppure aggiungi un nuovo dispositivo per l’altro account.',
    sv: 'Du loggade in med ett annat Mondial Relay-konto än det som den här enheten tillhör. Logga in med det ursprungliga kontot eller lägg till en ny enhet för det andra kontot.',
    no: 'Du logget inn med en annen Mondial Relay-konto enn den denne enheten tilhører. Logg inn med den opprinnelige kontoen, eller legg til en ny enhet for den andre kontoen.',
    es: 'Has iniciado sesión con una cuenta de Mondial Relay distinta a la de este dispositivo. Inicia sesión con la cuenta original o añade un dispositivo nuevo para la otra cuenta.',
    da: 'Du loggede ind med en anden Mondial Relay-konto end den, denne enhed tilhører. Log ind med den oprindelige konto, eller tilføj en ny enhed til den anden konto.',
    ru: 'Вы вошли в другую учётную запись Mondial Relay, а не в ту, к которой относится это устройство. Войдите в исходную учётную запись или добавьте новое устройство для другой.',
    pl: 'Zalogowano się na inne konto Mondial Relay niż to, do którego należy to urządzenie. Zaloguj się na pierwotne konto albo dodaj nowe urządzenie dla drugiego konta.',
    ko: '이 기기에 연결된 계정과 다른 Mondial Relay 계정으로 로그인했습니다. 원래 계정으로 로그인하거나 다른 계정용 새 기기를 추가하세요.',
    ar: 'سجّلت الدخول بحساب Mondial Relay مختلف عن الحساب الذي ينتمي إليه هذا الجهاز. سجّل الدخول بالحساب الأصلي، أو أضف جهازًا جديدًا للحساب الآخر.',
  },
};

module.exports = class MondialRelayDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        mondial_relay_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        mondial_relay_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        mondial_relay_any_status_is: ({ device, status }) => device.hasStatus(status),
        mondial_relay_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        mondial_relay_is_tracking: ({ device, tracking }) => device.isTracking(tracking?.id || tracking?.name || tracking),
        mondial_relay_outgoing_underway: ({ device }) => device.hasOutgoingUnderway(),
      },
      autocomplete: { mondial_relay_parcel_is_delivered: 'tracking' },
      actions: {
        mondial_relay_refresh: ({ device }) => device.refresh(true).then(() => true),
        mondial_relay_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  _error(key, vars) { return new Error(tr(this.homey, ERRORS[key], vars)); }

  _language() { try { return this.homey.i18n.getLanguage() || 'en'; } catch (_) { return 'en'; } }

  /**
   * Per-session sign-in state. The URL (PKCE verifier + state) is built once per market and kept for the
   * session's lifetime – rebuilding it would invalidate a link the user may already have opened.
   */
  _signIn(session, { deviceUid = null, expectedSubject = null } = {}) {
    const ctx = { market: null, url: null, codeVerifier: null, state: null, deviceUid, expectedSubject };

    session.setHandler('login', async data => {
      const market = marketOf(data?.country || ctx.market);
      if (!ctx.url || ctx.market !== market) {
        const built = buildAuthorizationUrl({ language: data?.language || this._language(), market });
        Object.assign(ctx, { market, url: built.url, codeVerifier: built.codeVerifier, state: built.state });
      }
      return { url: ctx.url, website: MARKETS[market].website, market };
    });

    return ctx;
  }

  /** Validates the pasted callback URL, exchanges the code and runs the two setup checks. */
  async _completeSignIn(ctx, data) {
    const callbackUrl = String(data?.callbackUrl || '').trim();
    if (!ctx.url || !isValidCallbackUrl(callbackUrl)) throw this._error('invalid_redirect');
    const { code, state } = parseCallbackUrl(callbackUrl);
    if (!code || state !== ctx.state) throw this._error('invalid_redirect');
    const website = MARKETS[ctx.market].website;
    const verifier = ctx.codeVerifier;
    // The code and verifier are single-use: forget them whatever happens next.
    ctx.url = null; ctx.codeVerifier = null; ctx.state = null;

    const oauth = new MondialRelayOAuth();
    try {
      await oauth.exchangeCode(code, verifier);
    } catch (error) {
      this.error('[Mondial Relay] code exchange failed:', error.message);
      throw this._error(error.auth ? 'invalid_auth' : 'cannot_connect');
    }
    const uid = ctx.deviceUid || newDeviceUid();
    const client = new MondialRelayClient({ oauth, deviceUid: uid });
    // Identity first, parcel feed second – the order is what separates the refusals.
    let userInfo;
    try {
      userInfo = await client.userInfo();
    } catch (error) {
      this.error('[Mondial Relay] user-infos failed:', error.message);
      if (error.auth) throw this._error('account_rejected', { website });
      throw this._error(error.code === 'signing_rejected' ? 'signing_rejected' : 'cannot_connect');
    }
    try {
      await client.validateParcelAccess();
    } catch (error) {
      this.error('[Mondial Relay] parcel list check failed:', error.message);
      if (error.auth) throw this._error(hasConfirmedPhone(userInfo) ? 'parcels_unavailable' : 'phone_not_confirmed', { website });
      throw this._error(error.code === 'signing_rejected' ? 'signing_rejected' : 'cannot_connect');
    }
    const subject = decodeIdTokenSubject(oauth.idToken) || 'unknown';
    if (ctx.expectedSubject && ctx.expectedSubject !== 'unknown' && subject !== 'unknown' && subject !== ctx.expectedSubject) throw this._error('wrong_account');
    return { oauth, subject, deviceUid: uid, market: ctx.market, accountType: accountType(userInfo) };
  }

  async onPair(session) {
    const ctx = this._signIn(session);
    session.setHandler('callback', async data => {
      const result = await this._completeSignIn(ctx, data);
      const { oauth, subject, deviceUid, market, accountType: type } = result;
      return {
        device: {
          name: 'Mondial Relay',
          data: { id: `mondial-relay-${crypto.createHash('sha1').update(subject === 'unknown' ? deviceUid : subject).digest('hex').slice(0, 16)}` },
          settings: { country: market, delivered_days: 7 },
          store: {
            mondial_relay_refresh_token: oauth.refreshToken,
            mondial_relay_device_uid: deviceUid,
            mondial_relay_market: market,
            mondial_relay_subject: subject,
            mondial_relay_account_type: type,
          },
        },
      };
    });
  }

  async onRepair(session, repairDevice) {
    const device = repairDevice;
    const ctx = this._signIn(session, { deviceUid: device.getStoreValue('mondial_relay_device_uid'), expectedSubject: device.getStoreValue('mondial_relay_subject') });
    ctx.market = device.market();
    session.setHandler('callback', async data => {
      const { oauth, subject, deviceUid, market, accountType: type } = await this._completeSignIn(ctx, data);
      if (!device.getStoreValue('mondial_relay_device_uid')) await device.setStoreValue('mondial_relay_device_uid', deviceUid);
      await device.updateAccount({ refreshToken: oauth.refreshToken, market, subject, accountType: type });
      return true;
    });
  }
};
