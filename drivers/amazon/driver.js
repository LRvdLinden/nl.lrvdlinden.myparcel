'use strict';

const Homey = require('homey');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');
const { tr } = require('../../lib/i18n');
const { resolveCountry, COUNTRIES } = require('../../lib/amazon-tracking');
const auth = require('../../lib/amazon-auth');

const T = {
  noCountry: {
    en: 'Choose the Amazon country you order from.',
    nl: 'Kies het Amazon-land waar je bestelt.',
    de: 'Wähle das Amazon-Land, in dem du bestellst.',
    fr: 'Choisissez le pays Amazon sur lequel vous commandez.',
    it: 'Scegli il paese Amazon su cui ordini.',
    sv: 'Välj det Amazon-land där du beställer.',
    no: 'Velg Amazon-landet du bestiller fra.',
    es: 'Elige el país de Amazon en el que haces tus pedidos.',
    da: 'Vælg det Amazon-land, du bestiller fra.',
    ru: 'Выберите страну Amazon, в которой вы делаете заказы.',
    pl: 'Wybierz kraj Amazon, w którym zamawiasz.',
    ko: '주문하는 Amazon 국가를 선택하세요.',
    ar: 'اختر بلد Amazon الذي تطلب منه.',
  },
  noLogin: {
    en: 'Open the Amazon sign-in link first.',
    nl: 'Open eerst de inloglink van Amazon.',
    de: 'Öffne zuerst den Amazon-Anmeldelink.',
    fr: 'Ouvrez d’abord le lien de connexion Amazon.',
    it: 'Apri prima il link di accesso di Amazon.',
    sv: 'Öppna först Amazons inloggningslänk.',
    no: 'Åpne først påloggingslenken til Amazon.',
    es: 'Abre primero el enlace de inicio de sesión de Amazon.',
    da: 'Åbn først Amazons login-link.',
    ru: 'Сначала откройте ссылку для входа в Amazon.',
    pl: 'Najpierw otwórz link logowania Amazon.',
    ko: '먼저 Amazon 로그인 링크를 여세요.',
    ar: 'افتح رابط تسجيل الدخول إلى Amazon أولاً.',
  },
  invalidUrl: {
    en: 'That is not the right address. Copy the full address of the page that starts with {prefix} (including everything after the “?”) and paste it here.',
    nl: 'Dat is niet het juiste adres. Kopieer het volledige adres van de pagina die begint met {prefix} (inclusief alles na het “?”) en plak het hier.',
    de: 'Das ist nicht die richtige Adresse. Kopiere die vollständige Adresse der Seite, die mit {prefix} beginnt (einschließlich allem nach dem „?“), und füge sie hier ein.',
    fr: 'Ce n’est pas la bonne adresse. Copiez l’adresse complète de la page qui commence par {prefix} (y compris tout ce qui suit le « ? ») et collez-la ici.',
    it: 'Non è l’indirizzo giusto. Copia l’indirizzo completo della pagina che inizia con {prefix} (compreso tutto ciò che segue il “?”) e incollalo qui.',
    sv: 'Det är inte rätt adress. Kopiera hela adressen till sidan som börjar med {prefix} (inklusive allt efter ”?”) och klistra in den här.',
    no: 'Det er ikke riktig adresse. Kopier hele adressen til siden som starter med {prefix} (inkludert alt etter «?») og lim den inn her.',
    es: 'Esa no es la dirección correcta. Copia la dirección completa de la página que empieza por {prefix} (incluido todo lo que va después del «?») y pégala aquí.',
    da: 'Det er ikke den rigtige adresse. Kopiér hele adressen på siden, der starter med {prefix} (inklusive alt efter “?”), og indsæt den her.',
    ru: 'Это неверный адрес. Скопируйте полный адрес страницы, начинающийся с {prefix} (включая всё после «?»), и вставьте его сюда.',
    pl: 'To nie jest właściwy adres. Skopiuj pełny adres strony zaczynającej się od {prefix} (łącznie ze wszystkim po „?”) i wklej go tutaj.',
    ko: '올바른 주소가 아닙니다. {prefix}(으)로 시작하는 페이지의 전체 주소(“?” 뒤의 모든 내용 포함)를 복사해 여기에 붙여 넣으세요.',
    ar: 'هذا ليس العنوان الصحيح. انسخ العنوان الكامل للصفحة التي تبدأ بـ {prefix} (بما في ذلك كل ما بعد "؟") والصقه هنا.',
  },
  rejected: {
    en: 'Amazon did not accept this sign-in. Open a fresh sign-in link, complete every step Amazon asks for and paste the new address straight away.',
    nl: 'Amazon heeft deze aanmelding niet geaccepteerd. Open een nieuwe inloglink, doorloop alle stappen die Amazon vraagt en plak het nieuwe adres meteen.',
    de: 'Amazon hat diese Anmeldung nicht akzeptiert. Öffne einen neuen Anmeldelink, schließe alle Schritte ab, die Amazon verlangt, und füge die neue Adresse sofort ein.',
    fr: 'Amazon n’a pas accepté cette connexion. Ouvrez un nouveau lien de connexion, effectuez toutes les étapes demandées par Amazon et collez immédiatement la nouvelle adresse.',
    it: 'Amazon non ha accettato questo accesso. Apri un nuovo link di accesso, completa tutti i passaggi richiesti da Amazon e incolla subito il nuovo indirizzo.',
    sv: 'Amazon godkände inte den här inloggningen. Öppna en ny inloggningslänk, slutför alla steg Amazon ber om och klistra in den nya adressen direkt.',
    no: 'Amazon godtok ikke denne påloggingen. Åpne en ny påloggingslenke, fullfør alle trinnene Amazon ber om, og lim inn den nye adressen med en gang.',
    es: 'Amazon no ha aceptado este inicio de sesión. Abre un enlace nuevo, completa todos los pasos que pida Amazon y pega la nueva dirección enseguida.',
    da: 'Amazon accepterede ikke dette login. Åbn et nyt login-link, gennemfør alle de trin, Amazon beder om, og indsæt den nye adresse med det samme.',
    ru: 'Amazon не принял этот вход. Откройте новую ссылку для входа, выполните все шаги, которые просит Amazon, и сразу вставьте новый адрес.',
    pl: 'Amazon nie zaakceptował tego logowania. Otwórz nowy link logowania, wykonaj wszystkie kroki wymagane przez Amazon i od razu wklej nowy adres.',
    ko: 'Amazon이 이 로그인을 승인하지 않았습니다. 새 로그인 링크를 열고 Amazon이 요청하는 모든 단계를 완료한 뒤 새 주소를 바로 붙여 넣으세요.',
    ar: 'لم تقبل Amazon تسجيل الدخول هذا. افتح رابط تسجيل دخول جديدًا وأكمل كل الخطوات التي تطلبها Amazon ثم الصق العنوان الجديد فورًا.',
  },
  unreachable: {
    en: 'Amazon cannot be reached right now. Try again in a few minutes.',
    nl: 'Amazon is op dit moment niet bereikbaar. Probeer het over een paar minuten opnieuw.',
    de: 'Amazon ist gerade nicht erreichbar. Versuche es in ein paar Minuten erneut.',
    fr: 'Amazon est injoignable pour le moment. Réessayez dans quelques minutes.',
    it: 'Amazon non è raggiungibile al momento. Riprova tra qualche minuto.',
    sv: 'Amazon går inte att nå just nu. Försök igen om några minuter.',
    no: 'Amazon kan ikke nås akkurat nå. Prøv igjen om noen minutter.',
    es: 'No se puede acceder a Amazon en este momento. Inténtalo de nuevo dentro de unos minutos.',
    da: 'Amazon kan ikke nås lige nu. Prøv igen om et par minutter.',
    ru: 'Сейчас Amazon недоступен. Повторите попытку через несколько минут.',
    pl: 'Amazon jest teraz niedostępny. Spróbuj ponownie za kilka minut.',
    ko: '지금은 Amazon에 연결할 수 없습니다. 몇 분 후에 다시 시도하세요.',
    ar: 'لا يمكن الوصول إلى Amazon الآن. حاول مرة أخرى بعد بضع دقائق.',
  },
};

function displayName(domain) { return `A${domain.slice(1)}`; } // "amazon.nl" → "Amazon.nl"

module.exports = class AmazonDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        amazon_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        amazon_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        amazon_ready_for_pickup_now: ({ device }) => device.hasStatus(STATUS.AT_PICKUP_POINT),
        amazon_any_status_is: ({ device, status }) => device.hasStatus(status),
        amazon_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        amazon_is_tracking: ({ device, tracking }) => device.isTracking(tracking?.id || tracking?.name || tracking),
      },
      autocomplete: { amazon_parcel_is_delivered: 'tracking' },
      actions: {
        amazon_refresh: ({ device }) => device.refresh(true).then(() => true),
        amazon_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  /**
   * Pair/repair contract (ha-amazon's config flow, adapted to Homey):
   *   'login'  { country }    → { url, landingPrefix, country, domain }  open `url` in a browser
   *   'verify' { landingUrl } → pair: { device } / repair: true
   */
  _handlers(session, device = null) {
    let pending = null;
    session.setHandler('countries', async () => Object.entries(COUNTRIES).map(([code, c]) => ({ id: code, domain: c.domain, label: c.label })));
    session.setHandler('login', async data => {
      const value = String(data?.country || device?.getSetting('country') || '').trim();
      if (!value) throw new Error(tr(this.homey, T.noCountry));
      const country = resolveCountry(value);
      const serial = auth.newDeviceSerial();
      const verifier = auth.newCodeVerifier();
      pending = { country, serial, verifier };
      return { url: auth.buildSignInUrl(country.domain, serial, verifier), landingPrefix: auth.LANDING_URL, country: country.code, domain: country.domain };
    });
    session.setHandler('verify', async data => {
      if (!pending) throw new Error(tr(this.homey, T.noLogin));
      const code = auth.extractAuthorizationCode(data?.landingUrl ?? data?.code ?? '');
      if (!code) throw new Error(tr(this.homey, T.invalidUrl, { prefix: auth.LANDING_URL }));
      const { country, serial, verifier } = pending;
      let registration;
      try {
        registration = await auth.registerDevice(country.domain, serial, verifier, code);
      } catch (error) {
        this.error('[Amazon] sign-in failed:', error.message);
        throw new Error(tr(this.homey, error.auth ? T.rejected : T.unreachable));
      }
      pending = null; // each sign-in link is meant for one sign-in
      const login = { refreshToken: registration.refreshToken, serial, apiHost: registration.host, domain: country.domain };
      if (device) {
        if (device.getSetting('country') !== country.code) await device.setSettings({ country: country.code }).catch(() => {});
        await device.updateLogin(login);
        return true;
      }
      return {
        device: {
          name: displayName(country.domain),
          data: { id: `amazon-${country.domain}` },
          settings: { country: country.code, delivered_days: 7 },
          store: {
            amazon_refresh_token: login.refreshToken,
            amazon_device_serial: serial,
            amazon_api_host: login.apiHost,
            amazon_domain: country.domain,
          },
        },
      };
    });
  }

  async onPair(session) { this._handlers(session); }

  async onRepair(session, device) { this._handlers(session, device); }
};
