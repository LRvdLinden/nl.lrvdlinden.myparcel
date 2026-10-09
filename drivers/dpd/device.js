'use strict';

const Homey = require('homey');
const localizePackageStatus = require('../../lib/status-i18n.js');
const i18n = require('../../lib/gls-i18n');
const {
  STATUS, COUNTRY_BY_CODE, backendFor, DpdAuthError,
  DpdGeneralClient, DpdDeClient, DpdPlClient, normalizeGeneral, normalizeDe, normalizePl, fmpHashcode,
} = require('../../lib/dpd-tracking');

const CAPABILITIES = [
  'dpd_parcel_count', 'dpd_total_count', 'dpd_status', 'dpd_tracking', 'dpd_sender', 'dpd_receiver',
  'dpd_delivery_date', 'dpd_delivery_window', 'dpd_delivery_point', 'dpd_weight', 'dpd_dimensions',
  'dpd_delivery_type', 'dpd_last_event', 'dpd_direction', 'dpd_next_delivery', 'dpd_out_for_delivery_count',
  'dpd_en_route_pickup_count', 'dpd_pickup_count', 'dpd_delivered_count', 'dpd_outgoing_count',
  'myparcel_connection_status', 'dpd_last_update',
];

const PRIORITY = {
  out_for_delivery: 0, at_pickup_point: 1, in_transit: 2, registered: 3, problem: 4, returning: 5, unknown: 6, delivered: 7,
};
const HOT_MINUTES = 15;
const MID_MINUTES = 45;
const HOT_LOOKAHEAD_MS = 60 * 60 * 1000;
const QUIET_END_HOUR = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY = '—';

const STORE_PARCELS = 'dpd_parcels_v2';
const STORE_MEMORY = 'dpd_flow_memory_v1';
const STORE_SEEDED = 'dpd_memory_seeded';
const STORE_DETAILS = 'dpd_detail_cache_v1';
const STORE_PL_TOKEN = 'dpd_pl_refresh_token';
const STORE_DE_HW = 'dpd_de_hardware_id';
const STORE_UK = 'dpd_uk_codes';

const DIRECTION_TEXT = {
  en: ['Incoming', 'Outgoing'], nl: ['Inkomend', 'Uitgaand'], de: ['Eingehend', 'Ausgehend'],
  fr: ['Entrant', 'Sortant'], it: ['In arrivo', 'In uscita'], sv: ['Inkommande', 'Utgående'],
  no: ['Innkommende', 'Utgående'], es: ['Entrante', 'Saliente'], da: ['Indgående', 'Udgående'],
  ru: ['Входящая', 'Исходящая'], pl: ['Przychodząca', 'Wychodząca'], ko: ['수신', '발신'], ar: ['وارد', 'صادر'],
};
const DELIVERY_TYPE_TEXT = {
  en: { HOME: 'Home delivery', PARCELSHOP: 'ParcelShop' }, nl: { HOME: 'Thuisbezorging', PARCELSHOP: 'Pakketpunt' },
  de: { HOME: 'Hauszustellung', PARCELSHOP: 'Paketshop' }, fr: { HOME: 'Livraison à domicile', PARCELSHOP: 'Point relais' },
  it: { HOME: 'Consegna a domicilio', PARCELSHOP: 'Punto di ritiro' }, sv: { HOME: 'Hemleverans', PARCELSHOP: 'Utlämningsställe' },
  no: { HOME: 'Hjemlevering', PARCELSHOP: 'Hentested' }, es: { HOME: 'Entrega a domicilio', PARCELSHOP: 'Punto de recogida' },
  da: { HOME: 'Hjemmelevering', PARCELSHOP: 'Afhentningssted' }, ru: { HOME: 'Доставка на дом', PARCELSHOP: 'Пункт выдачи' },
  pl: { HOME: 'Dostawa do domu', PARCELSHOP: 'Punkt odbioru' }, ko: { HOME: '자택 배송', PARCELSHOP: '수령 지점' },
  ar: { HOME: 'توصيل إلى المنزل', PARCELSHOP: 'نقطة استلام' },
};
const AUTH_MESSAGES = {
  en: name => `Reconnect DPD – the credentials for ${name} no longer work. Open the device and repair the connection.`,
  nl: name => `DPD opnieuw koppelen – de inloggegevens voor ${name} werken niet meer. Open het apparaat en herstel de koppeling.`,
  de: name => `DPD erneut verbinden – Die Anmeldedaten für ${name} funktionieren nicht mehr. Öffne das Gerät und stelle die Verbindung wieder her.`,
  fr: name => `Reconnecter DPD – Les identifiants de ${name} ne fonctionnent plus. Ouvrez l’appareil et rétablissez la connexion.`,
};
const UNREACHABLE = {
  en: 'DPD is temporarily unreachable; showing the last known data',
  nl: 'DPD is tijdelijk niet bereikbaar; laatst bekende gegevens worden getoond',
  de: 'DPD ist vorübergehend nicht erreichbar; letzte bekannte Daten werden angezeigt',
  fr: 'DPD est temporairement inaccessible ; dernières données connues affichées',
};

function hasTimezone(value) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value || '').trim());
}

class DpdDevice extends Homey.Device {
  async onInit() {
    this._parcels = this.getStoreValue(STORE_PARCELS) || {};
    this._memory = this.getStoreValue(STORE_MEMORY) || {};
    this._details = this.getStoreValue(STORE_DETAILS) || {};
    this._client = null;
    this._clientKey = '';
    this._busy = null;
    this._timer = null;
    this._stopped = false;

    for (const capability of CAPABILITIES) {
      if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
    }
    if (!this.getSetting('bu')) await this.setSettings({ bu: 'DPD-NL' }).catch(this.error);
    // Devices from 0.3.2 and new pairings record their first sync silently (no "new parcel" storm).
    await this._updateCapabilities().catch(this.error);
    this._schedule(4000);
  }

  async onUninit() { this._stopped = true; this._clearTimer(); }

  async onDeleted() { this._stopped = true; this._clearTimer(); }

  async onSettings({ changedKeys }) {
    if (changedKeys.some(key => ['bu', 'email', 'password', 'phone'].includes(key))) {
      this._client = null;
      this._clientKey = '';
      if (changedKeys.includes('bu')) await this.resetParcels();
    }
    this.homey.setTimeout(() => this.refresh(true).catch(this.error), 1500);
  }

  async resetParcels() {
    this._parcels = {};
    this._details = {};
    await this.setStoreValue(STORE_PARCELS, {}).catch(this.error);
    await this.setStoreValue(STORE_DETAILS, {}).catch(this.error);
  }

  _lang() {
    try { return this.homey.i18n.getLanguage() || 'en'; } catch (_) { return 'en'; }
  }

  /* ------------------------------------------------------------ clients -- */

  _getClient() {
    const s = this.getSettings();
    const bu = COUNTRY_BY_CODE[s.bu] ? s.bu : 'DPD-NL';
    const backend = backendFor(bu);
    const key = `${bu}|${s.email || ''}|${s.password || ''}`;
    if (this._client && this._clientKey === key) return { client: this._client, backend, bu };
    if (backend === 'de') {
      let hw = this.getStoreValue(STORE_DE_HW);
      const client = new DpdDeClient({ email: s.email, password: s.password, hardwareId: hw });
      if (!hw) this.setStoreValue(STORE_DE_HW, client.hardwareId).catch(this.error);
      this._client = client;
    } else if (backend === 'pl') {
      this._client = new DpdPlClient({
        refreshToken: this.getStoreValue(STORE_PL_TOKEN) || null,
        onRefreshToken: token => { this.setStoreValue(STORE_PL_TOKEN, token).catch(this.error); },
      });
    } else {
      this._client = new DpdGeneralClient({ email: s.email, password: s.password, bu });
    }
    this._clientKey = key;
    return { client: this._client, backend, bu };
  }

  /* ------------------------------------------------------------ refresh -- */

  async refresh(force = false) {
    if (this._busy) return this._busy;
    this._busy = this._refresh(force).finally(() => { this._busy = null; });
    return this._busy;
  }

  async _fetch() {
    const { client, backend, bu } = this._getClient();
    const { incoming, outgoing } = await client.getParcels();
    if (backend === 'de') {
      return [
        ...incoming.map(raw => normalizeDe(raw, { direction: 'incoming' })),
        ...outgoing.map(raw => normalizeDe(raw, { direction: 'outgoing' })),
      ].filter(parcel => parcel.barcode);
    }
    if (backend === 'pl') return incoming.map(raw => normalizePl(raw)).filter(parcel => parcel.barcode);

    const ukCodes = { ...(this.getStoreValue(STORE_UK) || {}) };
    const out = [];
    const seenDetails = {};
    for (const [list, direction] of [[incoming, 'incoming'], [outgoing, 'outgoing']]) {
      for (const shipment of list) {
        const barcode = shipment?.parcelNumber ? String(shipment.parcelNumber) : '';
        if (!barcode) continue;
        const description = shipment?.status?.description || '';
        // Details (receiver/ParcelShop, weight, dimensions, history) only when the status changed.
        let cached = this._details[barcode];
        if (!cached || cached.description !== description) {
          const detail = await client.getDetail(barcode, { shipmentBUCode: shipment.shipmentBUCode || '', parcelType: direction === 'outgoing' ? 'OUTGOING' : 'INCOMING' });
          cached = detail
            ? { description, detail: { receiver: detail.receiver ? { name: detail.receiver.name } : null, weight: detail.weight, dimensions: detail.dimensions, parcelEvents: (detail.parcelEvents || []).slice(-25) } }
            : { description, detail: cached?.detail || null };
        }
        seenDetails[barcode] = cached;
        // Follow My Parcel window only for active incoming parcels.
        if (direction === 'incoming' && description !== 'DELIVERED') {
          const hash = fmpHashcode(shipment);
          if (hash) {
            const window = await client.getFmpWindow(hash);
            if (window) shipment.fmpDeliveryDateAndTime = window;
          }
        }
        if (bu === 'DPD-UK' && !ukCodes[barcode]) {
          const code = await client.getUkTrackingCode(barcode);
          if (code) ukCodes[barcode] = code;
        }
        out.push(normalizeGeneral(shipment, { detail: cached.detail, bu, ukCode: ukCodes[barcode] || null, direction }));
      }
    }
    this._details = seenDetails;
    await this.setStoreValue(STORE_DETAILS, seenDetails).catch(this.error);
    if (bu === 'DPD-UK') await this.setStoreValue(STORE_UK, ukCodes).catch(this.error);
    return out;
  }

  async _refresh() {
    this._clearTimer();
    const now = Date.now();
    let fetched;
    try {
      fetched = await this._fetch();
    } catch (error) {
      this.error('[DPD] refresh failed:', error.message);
      if (error instanceof DpdAuthError || error.auth) {
        this._client = null;
        await this.unsetWarning().catch(() => {});
        await this._notifyAuth();
        await this.setUnavailable('DPD login expired').catch(() => {});
      } else {
        await this.setWarning(UNREACHABLE[this._lang()] || UNREACHABLE.en).catch(() => {});
      }
      this._schedule(this._nextDelay(true));
      return false;
    }

    const country = this.getSetting('bu') || 'DPD-NL';
    const next = {};
    for (const parcel of fetched) {
      const prev = this._parcels[parcel.barcode];
      next[parcel.barcode] = {
        ...parcel,
        tracking: parcel.barcode,
        country,
        firstSeen: prev?.firstSeen || now,
        checkedAt: now,
      };
    }

    await this._processTriggers(next, now);

    // Only show delivered parcels for the configured number of days.
    const days = Math.max(1, Number(this.getSetting('delivered_days') || 7));
    for (const [key, parcel] of Object.entries(next)) {
      if (!parcel.delivered) continue;
      const at = Number(this._memory[key]?.deliveredSeenAt || 0) || Date.parse(parcel.deliveredAt || '');
      if (at && now - at > days * DAY_MS) delete next[key];
    }

    this._parcels = next;
    await this.setStoreValue(STORE_PARCELS, next).catch(this.error);
    await this.setStoreValue('authExpiredNotified', false).catch(() => {});
    if (this.getStoreValue('dpd_packages')) await this.unsetStoreValue('dpd_packages').catch(() => {});
    await this.unsetWarning().catch(() => {});
    await this.setAvailable().catch(() => {});
    await this._updateCapabilities(now);
    this._schedule(this._nextDelay(false));
    return true;
  }

  async _notifyAuth() {
    if (this.getStoreValue('authExpiredNotified') === true) return;
    const message = (AUTH_MESSAGES[this._lang()] || AUTH_MESSAGES.en)(this.getName());
    await this.homey.notifications.createNotification({ excerpt: message }).catch(() => {});
    await this.setStoreValue('authExpiredNotified', true).catch(() => {});
  }

  /* ----------------------------------------------------------- triggers -- */

  async _trigger(cardId, tokens) {
    try {
      await this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, tokens, {});
    } catch (error) {
      this.error(`[DPD] trigger ${cardId} failed:`, error.message);
    }
  }

  async _processTriggers(parcels, now) {
    const seeding = this.getStoreValue(STORE_SEEDED) !== true;
    const memory = { ...this._memory };

    for (const parcel of Object.values(parcels)) {
      const key = parcel.tracking;
      const seen = memory[key];
      const tokens = this._tokens(parcel);
      const outgoing = parcel.direction === 'outgoing';
      const window = `${this._date(parcel.plannedFrom)} ${this._window(parcel)}`.trim();

      if (!seen) {
        memory[key] = {
          status: parcel.status, rawStatus: parcel.rawStatus, window, direction: parcel.direction,
          firstSeen: now, lastSeen: now, deliveredNotified: parcel.delivered, deliveredSeenAt: parcel.delivered ? now : null,
        };
        if (seeding || parcel.delivered || outgoing) continue;
        await this._trigger('dpd_new_package', tokens);
        if (parcel.status === STATUS.OUT_FOR_DELIVERY) await this._trigger('dpd_out_for_delivery', tokens);
        else if (parcel.status === STATUS.AT_PICKUP_POINT) await this._trigger('dpd_ready_for_pickup', tokens);
        else if (parcel.status === STATUS.PROBLEM || parcel.status === STATUS.RETURNING) await this._trigger('dpd_package_problem', tokens);
        continue;
      }
      seen.lastSeen = now;
      if (seen.deliveredNotified) continue; // final: no repeats when DPD flips or re-lists a parcel

      const statusTokens = {
        ...tokens,
        previous_status: this._statusText(seen.status),
        old_status_code: seen.status || '',
      };
      if (outgoing) {
        if (parcel.status !== seen.status) {
          if (parcel.delivered) await this._trigger('dpd_outgoing_delivered', tokens);
          else await this._trigger('dpd_outgoing_status_changed', statusTokens);
        }
      } else {
        if (parcel.status !== seen.status) {
          if (parcel.status !== STATUS.DELIVERED) await this._trigger('dpd_status_changed', statusTokens);
          if (parcel.status === STATUS.OUT_FOR_DELIVERY) await this._trigger('dpd_out_for_delivery', tokens);
          else if (parcel.status === STATUS.AT_PICKUP_POINT) await this._trigger('dpd_ready_for_pickup', tokens);
          else if (parcel.status === STATUS.PROBLEM || parcel.status === STATUS.RETURNING) await this._trigger('dpd_package_problem', tokens);
        }
        const lastEvent = this._lastEventText(parcel);
        if (lastEvent && seen.lastEvent !== undefined && lastEvent !== seen.lastEvent) {
          await this._trigger('dpd_package_event_changed', { ...tokens, old_event: seen.lastEvent || '' });
        }
        seen.lastEvent = lastEvent;
        if (!parcel.delivered && window && seen.window !== window && parcel.plannedFrom) {
          await this._trigger('dpd_delivery_updated', { ...tokens, old_delivery_window: seen.window || '' });
        }
        if (parcel.delivered) await this._trigger('dpd_delivered', tokens);
      }
      if (parcel.delivered) {
        seen.deliveredNotified = true;
        seen.deliveredSeenAt = now;
      }
      seen.status = parcel.status;
      seen.rawStatus = parcel.rawStatus;
      seen.window = window;
    }

    for (const parcel of Object.values(parcels)) {
      if (memory[parcel.tracking] && memory[parcel.tracking].lastEvent === undefined) memory[parcel.tracking].lastEvent = this._lastEventText(parcel);
    }
    for (const [key, value] of Object.entries(memory)) {
      if (!parcels[key] && now - Number(value.lastSeen || 0) > 60 * DAY_MS) delete memory[key];
    }
    this._memory = memory;
    await this.setStoreValue(STORE_MEMORY, memory).catch(this.error);
    if (seeding) await this.setStoreValue(STORE_SEEDED, true).catch(this.error);
  }

  /* --------------------------------------------------------- formatting -- */

  _statusText(code) {
    if (code === STATUS.UNKNOWN || !code) return localizePackageStatus(this.homey, 'unknown') || 'Unknown';
    const row = i18n.STATUS_TEXT[code];
    return row ? (row[this._lang()] || row.en) : code;
  }

  _parts(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (hasTimezone(text)) {
      const date = new Date(text);
      if (Number.isNaN(date.getTime())) return null;
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: this.homey.clock.getTimezone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(date);
      const get = type => parts.find(part => part.type === type)?.value || '';
      return { date: `${get('day')}-${get('month')}-${get('year')}`, time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` };
    }
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!match) return null;
    return { date: `${match[3]}-${match[2]}-${match[1]}`, time: match[4] ? `${match[4]}:${match[5]}` : '' };
  }

  _date(value) { return this._parts(value)?.date || ''; }
  _time(value) { return this._parts(value)?.time || ''; }
  _dateTime(value) { const p = this._parts(value); return p ? `${p.date}${p.time ? ` ${p.time}` : ''}` : ''; }

  _window(parcel) {
    if (!parcel.windowKnown) return '';
    const start = this._time(parcel.plannedFrom);
    const end = this._time(parcel.plannedTo);
    if (start && end) return start === end ? start : `${start} - ${end}`;
    return start || end || '';
  }

  _lastEvent(parcel) {
    const history = parcel.history || [];
    return history.length ? history[history.length - 1] : null;
  }

  _lastEventText(parcel) {
    const last = this._lastEvent(parcel);
    if (last?.rawStatus) return String(last.rawStatus);
    return parcel.rawStatus ? (localizePackageStatus(this.homey, parcel.rawStatus) || parcel.rawStatus) : '';
  }

  _deliveryType(parcel) {
    const key = String(parcel.deliveryType || '').toUpperCase();
    if (!key) return '';
    return (DELIVERY_TYPE_TEXT[this._lang()] || DELIVERY_TYPE_TEXT.en)[key] || key;
  }

  _direction(parcel) {
    return (DIRECTION_TEXT[this._lang()] || DIRECTION_TEXT.en)[parcel.direction === 'outgoing' ? 1 : 0];
  }

  _tokens(parcel) {
    const last = this._lastEvent(parcel);
    const history = (parcel.history || []).slice(-5).map(event => {
      const p = this._parts(event.timestamp);
      return `${p ? `${p.date.slice(0, 5)} ${p.time}`.trim() : ''} ${event.rawStatus || this._statusText(event.status)}`.trim();
    }).join('\n');
    return {
      tracking: parcel.tracking || '',
      status: this._statusText(parcel.status),
      sender: parcel.sender || '',
      receiver: parcel.receiver || '',
      delivery_date: this._date(parcel.plannedFrom || parcel.deliveredAt),
      delivery_window: this._window(parcel),
      delivery_point: parcel.pickupPoint || '',
      weight: parcel.weight !== null && parcel.weight !== undefined ? `${parcel.weight} kg` : '',
      dimensions: parcel.dimensions?.text || '',
      delivery_type: this._deliveryType(parcel),
      last_event: this._lastEventText(parcel),
      direction: this._direction(parcel),
      status_code: parcel.status || STATUS.UNKNOWN,
      raw_status: parcel.rawStatus || '',
      window_start: parcel.windowKnown ? this._time(parcel.plannedFrom) : '',
      window_end: parcel.windowKnown ? this._time(parcel.plannedTo) : '',
      delivered_at: this._dateTime(parcel.deliveredAt),
      last_event_time: last ? this._dateTime(last.timestamp) : '',
      history,
      url: parcel.url || '',
      country: parcel.country || this.getSetting('bu') || '',
    };
  }

  /* ------------------------------------------------------- capabilities -- */

  _sortedParcels(filter = () => true) {
    return Object.values(this._parcels || {}).filter(filter).sort((a, b) => {
      if ((a.direction === 'outgoing') !== (b.direction === 'outgoing')) return a.direction === 'outgoing' ? 1 : -1;
      const pa = PRIORITY[a.status] ?? 6;
      const pb = PRIORITY[b.status] ?? 6;
      if (pa !== pb) return pa - pb;
      const ta = Date.parse(a.plannedFrom || '') || Number.MAX_SAFE_INTEGER;
      const tb = Date.parse(b.plannedFrom || '') || Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      return (Date.parse(b.deliveredAt || '') || 0) - (Date.parse(a.deliveredAt || '') || 0);
    });
  }

  async _set(capability, value) {
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch(error => this.error(`[DPD] ${capability}:`, error.message));
  }

  _formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(this._lang(), { timeZone: this.homey.clock.getTimezone(), dateStyle: 'short', timeStyle: 'medium' }).format(date);
  }

  async _updateCapabilities(updatedAt = null) {
    const all = this._sortedParcels();
    const incoming = all.filter(p => p.direction !== 'outgoing');
    const active = incoming.filter(p => !p.delivered);
    const focus = incoming[0] || all[0] || null;
    const next = active.filter(p => p.plannedFrom).sort((a, b) => Date.parse(a.plannedFrom) - Date.parse(b.plannedFrom))[0] || null;
    const text = value => (value === null || value === undefined || String(value).trim() === '' ? EMPTY : String(value));

    await this._set('dpd_parcel_count', active.length);
    await this._set('dpd_total_count', all.length);
    await this._set('dpd_out_for_delivery_count', active.filter(p => p.status === STATUS.OUT_FOR_DELIVERY).length);
    await this._set('dpd_pickup_count', active.filter(p => p.status === STATUS.AT_PICKUP_POINT).length);
    await this._set('dpd_en_route_pickup_count', active.filter(p => p.pickup && p.status !== STATUS.AT_PICKUP_POINT).length);
    await this._set('dpd_delivered_count', incoming.filter(p => p.delivered).length);
    await this._set('dpd_outgoing_count', all.filter(p => p.direction === 'outgoing' && !p.delivered).length);
    await this._set('dpd_status', focus ? this._statusText(focus.status) : EMPTY);
    await this._set('dpd_tracking', text(focus?.tracking));
    await this._set('dpd_sender', text(focus?.sender));
    await this._set('dpd_receiver', text(focus?.receiver));
    await this._set('dpd_delivery_date', text(focus ? this._date(focus.plannedFrom || focus.deliveredAt) : ''));
    await this._set('dpd_delivery_window', text(focus ? this._window(focus) : ''));
    await this._set('dpd_delivery_point', text(focus?.pickupPoint));
    await this._set('dpd_weight', text(focus && focus.weight !== null && focus.weight !== undefined ? `${focus.weight} kg` : ''));
    await this._set('dpd_dimensions', text(focus?.dimensions?.text));
    await this._set('dpd_delivery_type', text(focus ? this._deliveryType(focus) : ''));
    await this._set('dpd_last_event', text(focus ? this._lastEventText(focus) : ''));
    await this._set('dpd_direction', text(focus ? this._direction(focus) : ''));
    await this._set('dpd_next_delivery', next ? `${this._date(next.plannedFrom)} ${this._window(next)}`.trim() : EMPTY);
    if (updatedAt) await this._set('dpd_last_update', this._formatDateTime(updatedAt));
  }

  /* ----------------------------------------------------------- polling -- */

  _clearTimer() {
    if (this._timer) this.homey.clearTimeout(this._timer);
    this._timer = null;
  }

  _schedule(delayMs) {
    this._clearTimer();
    if (this._stopped || delayMs === null || delayMs === undefined) return;
    this._timer = this.homey.setTimeout(() => {
      this._timer = null;
      this.refresh(false).catch(this.error);
    }, Math.max(1000, delayMs));
  }

  _localMinutes(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: this.homey.clock.getTimezone(), hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
    return (Number(parts.find(p => p.type === 'hour')?.value || 0) % 24) * 60 + Number(parts.find(p => p.type === 'minute')?.value || 0);
  }

  _staggerMinutes() {
    let hash = 0;
    for (const char of String(this.getData()?.id || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % 7;
  }

  /** ha-dpd cadence: 15 min near a delivery, otherwise 45 min (also to discover new parcels), quiet 00–06. */
  _nextDelay(afterError = false) {
    const now = Date.now();
    const active = Object.values(this._parcels || {}).filter(p => !p.delivered);
    const hot = !afterError && active.some(parcel => {
      const from = Date.parse(parcel.plannedFrom || '');
      if (parcel.status === STATUS.OUT_FOR_DELIVERY) return !from || from - now <= HOT_LOOKAHEAD_MS;
      return from && parcel.windowKnown && from - now <= HOT_LOOKAHEAD_MS && from + 6 * 3600 * 1000 > now;
    });
    const tier = hot ? HOT_MINUTES : MID_MINUTES;
    const stagger = this._staggerMinutes();
    const minutesNow = this._localMinutes(new Date(now));
    const quietEnd = QUIET_END_HOUR * 60;
    if (minutesNow < quietEnd) return ((quietEnd - minutesNow) + stagger) * 60000;
    if (minutesNow + tier + stagger >= 24 * 60) return ((24 * 60 - minutesNow) + stagger) * 60000;
    return (tier + stagger) * 60000;
  }

  /* ------------------------------------------------------------ widgets -- */

  getWidgetData() {
    const parcels = this._sortedParcels().map(parcel => {
      const last = this._lastEvent(parcel);
      return {
        id: parcel.tracking,
        tracking: parcel.tracking,
        reference: '',
        sender: parcel.sender || '',
        receiver: parcel.receiver || '',
        status: parcel.status,
        statusText: this._statusText(parcel.status),
        deliveryDate: parcel.plannedFrom || parcel.deliveredAt || '',
        deliveryWindow: this._window(parcel),
        deliveryWindowFrom: parcel.windowKnown ? parcel.plannedFrom || '' : '',
        deliveryWindowTo: parcel.windowKnown ? parcel.plannedTo || '' : '',
        deliveryPoint: parcel.pickupPoint || '',
        accessPoint: parcel.pickupPoint || '',
        weight: parcel.weight !== null && parcel.weight !== undefined ? `${parcel.weight} kg` : '',
        dimensions: parcel.dimensions?.text || '',
        lastEvent: this._lastEventText(parcel),
        lastEventAt: last?.timestamp || parcel.deliveredAt || '',
        eventAt: last?.timestamp || '',
        updatedAt: last?.timestamp || (parcel.checkedAt ? new Date(parcel.checkedAt).toISOString() : ''),
        createdAt: parcel.firstSeen ? new Date(parcel.firstSeen).toISOString() : '',
        delivered: Boolean(parcel.delivered),
        direction: this._direction(parcel),
        shipmentType: this._deliveryType(parcel),
        detailsUrl: parcel.url || '',
      };
    });
    return { parcels, authenticated: this.getStoreValue('authExpiredNotified') !== true, carrier: 'dpd' };
  }

  /* -------------------------------------------------------- conditions -- */

  hasStatus(status) {
    return Object.values(this._parcels || {}).some(p => p.direction !== 'outgoing' && p.status === status && (status === STATUS.DELIVERED || !p.delivered));
  }

  hasOutgoingUnderway() {
    return Object.values(this._parcels || {}).some(p => p.direction === 'outgoing' && !p.delivered);
  }

  isDelivered(number) {
    const parcel = this._parcels?.[String(number || '').trim()];
    return Boolean(parcel && parcel.delivered);
  }

  autocompleteParcels(query = '') {
    const q = String(query || '').toLowerCase();
    return this._sortedParcels()
      .filter(p => !q || p.tracking.toLowerCase().includes(q) || String(p.sender || '').toLowerCase().includes(q))
      .map(p => ({ id: p.tracking, name: p.tracking, description: [this._statusText(p.status), p.sender, this._direction(p)].filter(Boolean).join(' · ') }));
  }
}

module.exports = DpdDevice;
