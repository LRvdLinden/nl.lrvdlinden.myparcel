'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const { DragonflyClient, normalizeCode, countryOf, brandFor } = require('../../lib/dragonfly-tracking');
const { simpleTrackingList } = require('../../lib/carrier-migrate');
const { registerDhlFlowCards: registerFlowCards } = require('../../lib/dhl-flow');
const { STATUS } = require('../../lib/dhl-tracking');
const { tr } = require('../../lib/i18n');

const UNREACHABLE = {
  en: '{carrier} cannot be reached right now. Check your internet connection and try again.',
  nl: '{carrier} is op dit moment niet bereikbaar. Controleer je internetverbinding en probeer het opnieuw.',
  de: '{carrier} ist gerade nicht erreichbar. Prüfe deine Internetverbindung und versuche es erneut.',
  fr: '{carrier} est actuellement injoignable. Vérifiez votre connexion internet et réessayez.',
  it: '{carrier} non è raggiungibile al momento. Controlla la connessione a internet e riprova.',
  sv: '{carrier} går inte att nå just nu. Kontrollera din internetanslutning och försök igen.',
  no: '{carrier} kan ikke nås akkurat nå. Sjekk internettforbindelsen og prøv igjen.',
  es: 'No se puede contactar con {carrier} en este momento. Comprueba tu conexión a internet e inténtalo de nuevo.',
  da: '{carrier} kan ikke nås lige nu. Tjek din internetforbindelse, og prøv igen.',
  ru: 'Сервис {carrier} сейчас недоступен. Проверьте подключение к интернету и повторите попытку.',
  pl: 'Usługa {carrier} jest teraz niedostępna. Sprawdź połączenie z internetem i spróbuj ponownie.',
  ko: '지금은 {carrier}에 연결할 수 없습니다. 인터넷 연결을 확인한 후 다시 시도하세요.',
  ar: 'يتعذر الوصول إلى {carrier} حاليًا. تحقّق من اتصالك بالإنترنت ثم أعد المحاولة.',
};

module.exports = class DragonflyDriver extends Homey.Driver {
  async onInit() {
    registerFlowCards(this.homey, {
      conditions: {
        dragonfly_packages_underway: ({ device }) => device.hasPackagesUnderway(),
        dragonfly_out_for_delivery_now: ({ device }) => device.hasStatus(STATUS.OUT_FOR_DELIVERY),
        dragonfly_any_status_is: ({ device, status }) => device.hasStatus(status),
        dragonfly_parcel_is_delivered: ({ device, tracking }) => device.isDelivered(tracking?.id || tracking?.name || ''),
        dragonfly_is_tracking: ({ device, tracking }) => device.isTracking(tracking),
        dragonfly_outgoing_underway: ({ device }) => device.hasOutgoingUnderway(),
      },
      autocomplete: { dragonfly_parcel_is_delivered: 'tracking', dragonfly_untrack_parcel: 'tracking' },
      actions: {
        dragonfly_refresh: ({ device }) => device.refresh(true).then(() => true),
        dragonfly_track_parcel: ({ device, tracking, direction }) => device.trackParcel(tracking, direction || 'incoming'),
        dragonfly_untrack_parcel: ({ device, tracking }) => device.untrackParcel(tracking?.id || tracking?.name || tracking),
        dragonfly_remove_delivered: ({ device }) => device.removeDelivered(),
      },
    });
  }

  /** ha-dragonfly accepts every non-empty code (formats vary too much to gate on a guessed shape). */
  _lines(text) {
    return simpleTrackingList(text, normalizeCode).map(e => [e.code, e.direction === 'outgoing' ? 'out' : ''].filter(Boolean).join(' '));
  }

  /**
   * Dragonfly answers HTTP 200 for unknown / not yet scanned codes, so a code is never rejected here –
   * only a backend that cannot be reached at all stops the pairing.
   */
  async _probe(country, lines) {
    if (!lines.length) return;
    try {
      await new DragonflyClient({ country }).parcel(normalizeCode(lines[0].split(' ')[0]));
    } catch (error) {
      if (error.status) return; // the backend answered – unexpected envelope or HTTP error, not a pairing blocker
      throw new Error(tr(this.homey, UNREACHABLE, { carrier: brandFor(country) }));
    }
  }

  async onPair(session) {
    session.setHandler('connect', async data => {
      const country = countryOf(data?.country);
      const lines = this._lines(data?.trackingCodes);
      await this._probe(country, lines);
      const name = brandFor(country);
      return {
        device: {
          name,
          data: { id: `dragonfly-${crypto.randomBytes(8).toString('hex')}` },
          settings: { country, tracking_numbers: lines.join('\n'), delivered_days: 7 },
        },
      };
    });
  }

  async onRepair(session, repairDevice) {
    session.setHandler('connect', async data => {
      const device = repairDevice;
      const country = countryOf(data?.country || device.getSetting('country'));
      const lines = this._lines(data?.trackingCodes);
      await this._probe(country, lines);
      const changed = country !== countryOf(device.getSetting('country'));
      await device.setSettings({ country, ...(lines.length ? { tracking_numbers: lines.join('\n') } : {}) });
      if (changed) await device.onDhlSettings(['country']);
      await device.setAvailable().catch(() => {});
      await device.refresh(true);
      return true;
    });
  }
};
