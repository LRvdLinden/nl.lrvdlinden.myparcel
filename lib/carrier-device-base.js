'use strict';

/*
 * Shared device logic for the three DHL drivers (DHL, DHL Express, Post & DHL Germany),
 * following the ha-dhl / ha-dhl-nl model already used for GLS and DPD:
 *  - canonical statuses and per-parcel trigger memory that survives restarts
 *    (first sync recorded silently, "delivered" fired once and final),
 *  - dynamic polling (15 min near a delivery, otherwise 30/45 min, quiet 00–06),
 *  - delivered parcels hidden after N days,
 *  - Flow tokens built from the card's own declared token list (legacy cards keep working).
 *
 * Subclasses provide `static config` and implement `async _fetchParcels()`.
 */

const Homey = require('homey');
const i18n = require('./gls-i18n');
const { language, tr, formatDate, formatWeight, formatDimensions } = require('./i18n');
const { MESSAGES, errorText } = require('./messages-i18n');
const { STATUS, parseTrackingList, formatTrackingList, normalizeCode } = require('./dhl-tracking');

const PRIORITY = { out_for_delivery: 0, at_pickup_point: 1, in_transit: 2, registered: 3, problem: 4, returning: 5, unknown: 6, delivered: 7 };
const HOT_MINUTES = 15;
const HOT_LOOKAHEAD_MS = 60 * 60 * 1000;
const QUIET_END_HOUR = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMPTY = '—';

const DIRECTION_TEXT = {
  en: ['Incoming', 'Outgoing'], nl: ['Inkomend', 'Uitgaand'], de: ['Eingehend', 'Ausgehend'],
  fr: ['Entrant', 'Sortant'], it: ['In arrivo', 'In uscita'], sv: ['Inkommande', 'Utgående'],
  no: ['Innkommende', 'Utgående'], es: ['Entrante', 'Saliente'], da: ['Indgående', 'Udgående'],
  ru: ['Входящая', 'Исходящая'], pl: ['Przychodząca', 'Wychodząca'], ko: ['수신', '발신'], ar: ['وارد', 'صادر'],
};
function hasTimezone(value) { return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value || '').trim()); }

class CarrierDeviceBase extends Homey.Device {
  /* config ----------------------------------------------------------------
   * {
   *   carrier: 'DHL', log: '[DHL]', storePrefix: 'dhl',
   *   capabilities: [...ids], caps: { logical: id }, cards: { logical: cardId },
   *   midMinutes: 45, outgoing: true, pickup: true,
   * } */
  get cfg() { return this.constructor.config; }

  async onInit() {
    const p = this.cfg.storePrefix;
    this._storeParcels = `${p}_parcels_v3`;
    this._storeMemory = `${p}_flow_memory_v1`;
    this._storeSeeded = `${p}_memory_seeded`;
    this._parcels = this.getStoreValue(this._storeParcels) || {};
    this._memory = this.getStoreValue(this._storeMemory) || {};
    this._busy = null;
    this._timer = null;
    this._stopped = false;
    for (const capability of this.cfg.capabilities) {
      if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
    }
    await this.onDhlInit?.();
    await this._updateCapabilities().catch(this.error);
    this._schedule(this.cfg.firstDelay ?? 4000);
  }

  async onUninit() { this._stopped = true; this._clearTimer(); }

  async onDeleted() { this._stopped = true; this._clearTimer(); }

  async onSettings({ changedKeys }) {
    await this.onDhlSettings?.(changedKeys);
    this.homey.setTimeout(() => this.refresh(true).catch(this.error), 1500);
  }

  _lang() { return language(this.homey); }

  _t(table, vars = {}) { return tr(this.homey, table, vars); }

  /* ------------------------------------------------------------ tracking -- */

  /** Carriers may override: parse the tracking-number setting into [{ code, postcode, direction }]. */
  parseTracking(text) { return parseTrackingList(text); }

  /** Carriers may override how a tracking number is normalised (default: upper case, no spaces/dashes). */
  normalizeTrackingCode(code) { return normalizeCode(code); }

  trackedEntries() { return this.parseTracking(this.getSetting('tracking_numbers') || ''); }

  isTracking(code) {
    const value = this.normalizeTrackingCode(code);
    return this.trackedEntries().some(entry => entry.code === value) || Boolean(this._parcels?.[value]);
  }

  async trackParcel(input, direction = 'incoming') {
    const [entry] = this.parseTracking(`${String(input || '').trim()}${direction === 'outgoing' ? ' out' : ''}`);
    if (!entry || !entry.code) throw new Error(this._t(MESSAGES.invalid_tracking, { carrier: this.cfg.carrier }));
    await this.validateTrackingCode?.(entry);
    const entries = this.trackedEntries().filter(item => item.code !== entry.code);
    entries.push(entry);
    await this.setSettings({ tracking_numbers: formatTrackingList(entries) });
    await this._refreshAfterChange();
    return true;
  }

  /** A poll that is already running used the old tracking list: run one more afterwards. */
  async _refreshAfterChange() {
    if (this._busy) await this._busy.catch(() => {});
    return this.refresh(true);
  }

  /** Delivered and already announced (also after it was hidden by the retention period). */
  wasDelivered(code) { return Boolean(this._memory?.[this.normalizeTrackingCode(code)]?.deliveredNotified); }

  async untrackParcel(input) {
    const code = this.normalizeTrackingCode(input);
    const entries = this.trackedEntries().filter(item => item.code !== code);
    await this.setSettings({ tracking_numbers: formatTrackingList(entries) });
    if (this._busy) await this._busy.catch(() => {});
    if (this._parcels[code] && this._parcels[code].source !== 'account') {
      delete this._parcels[code];
      await this.setStoreValue(this._storeParcels, this._parcels).catch(this.error);
    }
    await this._updateCapabilities().catch(this.error);
    return true;
  }

  async removeDelivered() {
    const delivered = new Set(Object.values(this._parcels).filter(p => p.delivered).map(p => p.tracking));
    if (!delivered.size) return true;
    const entries = this.trackedEntries().filter(item => !delivered.has(item.code));
    await this.setSettings({ tracking_numbers: formatTrackingList(entries) }).catch(this.error);
    for (const code of delivered) {
      if (this._memory[code]) this._memory[code].hidden = true;
      delete this._parcels[code];
    }
    await this.setStoreValue(this._storeMemory, this._memory).catch(this.error);
    await this.setStoreValue(this._storeParcels, this._parcels).catch(this.error);
    await this._updateCapabilities().catch(this.error);
    return true;
  }

  /* ------------------------------------------------------------- refresh -- */

  async refresh(force = false) {
    if (this._busy) return this._busy;
    this._busy = this._refresh(force).finally(() => { this._busy = null; });
    return this._busy;
  }

  async _refresh(force) {
    this._clearTimer();
    const now = Date.now();
    let fetched;
    try {
      fetched = await this._fetchParcels({ force, now });
    } catch (error) {
      this.error(`${this.cfg.log} refresh failed:`, error.message);
      if (error.auth) {
        await this.unsetWarning().catch(() => {});
        await this._notifyAuth();
        await this.onAuthFailure?.(error);
        if (this.cfg.unavailableOnAuth !== false) await this.setUnavailable(this._unavailableText(error)).catch(() => {});
      } else {
        await this.setWarning(this._t(MESSAGES.unreachable, { name: this.cfg.carrier })).catch(() => {});
      }
      if (error.status === 429 || error.retryAfter) {
        // ha-parcel-integrations: honour Retry-After, otherwise 60 s · 2ⁿ up to an hour
        this._consecutive429 = (this._consecutive429 || 0) + 1;
        const seconds = Number(error.retryAfter) > 0 ? Number(error.retryAfter) : Math.min(60 * (2 ** this._consecutive429), 3600);
        this._schedule(seconds * 1000);
      } else {
        this._schedule(this._nextDelay(true));
      }
      return false;
    }
    if (fetched === null) { // nothing configured yet
      await this._updateCapabilities(now);
      this._schedule(this._nextDelay(false));
      return true;
    }

    const next = {};
    for (const parcel of fetched) {
      if (!parcel || !parcel.barcode) continue;
      if (this._memory[parcel.barcode]?.hidden && parcel.delivered) continue;
      const prev = this._parcels[parcel.barcode];
      next[parcel.barcode] = {
        ...prev,
        ...parcel,
        tracking: parcel.barcode,
        pending: parcel.pending === true,
        history: parcel.history || prev?.history || null,
        firstSeen: prev?.firstSeen || now,
        checkedAt: now,
      };
    }
    // Delivered parcels that are no longer polled stay visible until the retention period ends.
    for (const [code, prev] of Object.entries(this._parcels || {})) {
      if (next[code] || !prev?.delivered || !this.wasDelivered(code) || this._memory[code]?.hidden) continue;
      next[code] = { ...prev };
    }

    await this._processTriggers(next, now);

    const days = Math.max(1, Number(this.getSetting('delivered_days') || 7));
    for (const [key, parcel] of Object.entries(next)) {
      if (!parcel.delivered) continue;
      const at = Number(this._memory[key]?.deliveredSeenAt || 0) || Date.parse(parcel.deliveredAt || '');
      if (at && now - at > days * DAY_MS) delete next[key];
    }

    this._consecutive429 = 0;
    this._parcels = next;
    await this.setStoreValue(this._storeParcels, next).catch(this.error);
    await this.setStoreValue('authExpiredNotified', false).catch(() => {});
    await this.unsetWarning().catch(() => {});
    await this.setAvailable().catch(() => {});
    await this.onRefreshed?.(next);
    await this._updateCapabilities(now);
    this._schedule(this._nextDelay(false));
    return true;
  }

  /** Text shown while the device is unavailable after a login failure (translated carrier message). */
  _unavailableText(error) {
    const carrier = this.cfg.carrier;
    const text = errorText(this.homey, error, carrier);
    return text.includes(carrier) ? text : `${carrier}: ${text}`;
  }

  async _notifyAuth() {
    if (this.getStoreValue('authExpiredNotified') === true) return;
    const excerpt = this._t(MESSAGES.auth_notification, { carrier: this.cfg.carrier, name: this.getName() });
    await this.homey.notifications.createNotification({ excerpt }).catch(() => {});
    await this.setStoreValue('authExpiredNotified', true).catch(() => {});
  }

  /* ------------------------------------------------------------ triggers -- */

  _cardDefinition(cardId) {
    let manifest = this.homey.manifest;
    if (!manifest?.flow) {
      try { manifest = require('../app.json'); } catch (_) { manifest = null; }
    }
    const list = manifest?.flow?.triggers || [];
    return list.find(card => card.id === cardId) || null;
  }

  /** Only the tokens the card declares, typed as declared (keeps old Flows working). */
  _cardTokens(cardId, values) {
    const card = this._cardDefinition(cardId);
    if (!card) return values;
    const out = {};
    for (const token of card.tokens || []) {
      const value = values[token.name];
      if (token.type === 'number') out[token.name] = Number.isFinite(Number(value)) ? Number(value) : 0;
      else if (token.type === 'boolean') out[token.name] = Boolean(value);
      else out[token.name] = value === undefined || value === null ? '' : String(value);
    }
    return out;
  }

  async _trigger(logical, values) {
    const ids = [].concat(this.cfg.cards[logical] || []);
    for (const cardId of ids) {
      try {
        await this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, this._cardTokens(cardId, values), {});
      } catch (error) {
        this.error(`${this.cfg.log} trigger ${cardId} failed:`, error.message);
      }
    }
  }

  async _processTriggers(parcels, now) {
    const seeding = this.getStoreValue(this._storeSeeded) !== true;
    const memory = { ...this._memory };
    const all = Object.values(parcels);

    for (const parcel of all) {
      const key = parcel.tracking;
      // A tracking number DHL does not know yet: wait for real data. Numbers that were already
      // tracked when the device was set up / updated stay silent when their first data arrives.
      if (parcel.pending) {
        if (seeding && !memory[key]) memory[key] = { seedPending: true, firstSeen: now, lastSeen: now };
        else if (memory[key]?.seedPending) memory[key].lastSeen = now;
        continue;
      }
      const seen = memory[key]?.seedPending ? null : memory[key];
      const silent = seeding || Boolean(memory[key]?.seedPending);
      const tokens = this._tokens(parcel, all);
      const outgoing = parcel.direction === 'outgoing';
      const window = `${this._date(parcel.plannedFrom)} ${this._window(parcel)}`.trim();
      const lastEvent = this._lastEventText(parcel);

      if (!seen) {
        const deliveredAt = Date.parse(parcel.deliveredAt || '');
        memory[key] = {
          status: parcel.status, window, lastEvent, direction: parcel.direction,
          firstSeen: now, lastSeen: now, deliveredNotified: parcel.delivered,
          // retention counts from the real delivery moment when DHL reports one
          deliveredSeenAt: parcel.delivered ? (Number.isFinite(deliveredAt) && deliveredAt <= now ? deliveredAt : now) : null,
        };
        if (silent || parcel.delivered) continue;
        if (outgoing) continue;
        await this._trigger('newPackage', tokens);
        if (parcel.status === STATUS.OUT_FOR_DELIVERY) await this._trigger('outForDelivery', tokens);
        else if (parcel.status === STATUS.AT_PICKUP_POINT) await this._trigger('readyForPickup', tokens);
        else if (parcel.status === STATUS.PROBLEM || parcel.status === STATUS.RETURNING) await this._trigger('problem', tokens);
        continue;
      }
      seen.lastSeen = now;
      if (seen.deliveredNotified) continue; // final: no repeats when DHL flips or re-lists a parcel

      const statusTokens = { ...tokens, previous_status: this._statusText(seen.status), old_status_code: seen.status || '' };
      if (outgoing) {
        if (parcel.status !== seen.status) {
          if (parcel.delivered) await this._trigger('outgoingDelivered', tokens);
          else await this._trigger('outgoingStatus', statusTokens);
        }
      } else {
        if (parcel.status !== seen.status) {
          if (parcel.status !== STATUS.DELIVERED) await this._trigger('statusChanged', statusTokens);
          if (parcel.status === STATUS.OUT_FOR_DELIVERY) await this._trigger('outForDelivery', tokens);
          else if (parcel.status === STATUS.AT_PICKUP_POINT) await this._trigger('readyForPickup', tokens);
          else if (parcel.status === STATUS.PROBLEM || parcel.status === STATUS.RETURNING) await this._trigger('problem', tokens);
        }
        if (lastEvent && seen.lastEvent && lastEvent !== seen.lastEvent && !parcel.delivered) {
          await this._trigger('eventChanged', { ...tokens, old_event: this._eventText(seen.lastEvent || '') });
        }
        if (!parcel.delivered && window && seen.window !== window && parcel.plannedFrom) {
          await this._trigger('deliveryUpdated', { ...tokens, old_delivery_window: seen.window || '' });
        }
        if (parcel.delivered) await this._trigger('delivered', { ...statusTokens, status: this._statusText(STATUS.DELIVERED) });
      }
      if (parcel.delivered) {
        seen.deliveredNotified = true;
        seen.deliveredSeenAt = now;
      }
      seen.status = parcel.status;
      seen.window = window;
      seen.lastEvent = lastEvent;
    }

    for (const [key, value] of Object.entries(memory)) {
      if (!parcels[key] && now - Number(value.lastSeen || 0) > 60 * DAY_MS) delete memory[key];
    }
    this._memory = memory;
    await this.setStoreValue(this._storeMemory, memory).catch(this.error);
    if (seeding) await this.setStoreValue(this._storeSeeded, true).catch(this.error);
  }

  /* ---------------------------------------------------------- formatting -- */

  _statusText(code) { return i18n.statusText(this.homey, code || STATUS.UNKNOWN, this.cfg.carrier); }

  /** Display text for a carrier event label; carriers with their own label tables override this. */
  _eventText(text) { return text; }

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
      const hour = get('hour') === '24' ? '00' : get('hour');
      const time = `${hour}:${get('minute')}`;
      return { date: `${get('day')}-${get('month')}-${get('year')}`, time: /T00:00(:00)?(\.0+)?(Z|\+00:?00)$/.test(text) ? '' : time };
    }
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!match) return null;
    return { date: `${match[3]}-${match[2]}-${match[1]}`, time: match[4] ? `${match[4]}:${match[5]}` : '' };
  }

  _date(value) { return this._parts(value)?.date || ''; }

  _time(value) { return this._parts(value)?.time || ''; }

  _dateTime(value) { const p = this._parts(value); return p ? `${p.date}${p.time ? ` ${p.time}` : ''}` : ''; }

  _window(parcel) {
    if (parcel.windowText) return parcel.windowText;
    if (!parcel.windowKnown) return parcel.plannedFrom && !parcel.plannedTo ? this._time(parcel.plannedFrom) : '';
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
    return parcel.rawStatus || '';
  }

  _direction(parcel) { return (DIRECTION_TEXT[this._lang()] || DIRECTION_TEXT.en)[parcel.direction === 'outgoing' ? 1 : 0]; }

  _formatDateTime(value) {
    return formatDate(this.homey, value, { dateStyle: 'short', timeStyle: 'medium' }, this.homey.clock.getTimezone());
  }

  /** Display-only date for capabilities ("29 Apr 2026", "29 апр. 2026 г."); Flow tokens keep dd-mm-yyyy. */
  _displayDate(value) {
    const p = this._parts(value);
    if (!p) return '';
    const [d, m, y] = p.date.split('-').map(Number);
    return formatDate(this.homey, new Date(Date.UTC(y, m - 1, d, 12)), { day: 'numeric', month: 'short', year: 'numeric' }, 'UTC');
  }

  _displayWeight(parcel) { return parcel?.weight ? formatWeight(this.homey, parcel.weight) : ''; }

  _displayDimensions(parcel) {
    const dims = parcel?.dimensions;
    if (!dims) return '';
    const size = typeof dims === 'object' && !Number.isFinite(Number(dims.length)) && /^Size /.test(String(dims.text || '')) ? String(dims.text).slice(5) : '';
    return size ? this._t(MESSAGES.size, { size }) : formatDimensions(this.homey, dims);
  }

  _tokens(parcel, all = Object.values(this._parcels || {})) {
    const last = this._lastEvent(parcel);
    const history = (parcel.history || []).slice(-5).map(event => {
      const p = this._parts(event.timestamp);
      return `${p ? `${p.date.slice(0, 5)} ${p.time}`.trim() : ''} ${event.rawStatus ? this._eventText(event.rawStatus) : this._statusText(event.status)}`.trim();
    }).join('\n');
    const incoming = all.filter(p => p.direction !== 'outgoing');
    const active = incoming.filter(p => !p.delivered);
    const tokens = {
      carrier: this.cfg.carrier,
      tracking: parcel.tracking || '',
      status: this._statusText(parcel.status),
      status_code: parcel.status || STATUS.UNKNOWN,
      raw_status: parcel.rawStatus || '',
      sender: parcel.sender || '',
      receiver: parcel.receiver || '',
      delivery_date: this._date(parcel.plannedFrom || parcel.deliveredAt),
      delivery_window: this._window(parcel),
      window_start: parcel.windowKnown ? this._time(parcel.plannedFrom) : '',
      window_end: parcel.windowKnown ? this._time(parcel.plannedTo) : '',
      pickup_point: parcel.pickupPoint || '',
      delivery_point: parcel.pickupPoint || '',
      last_event: this._eventText(this._lastEventText(parcel)),
      last_event_time: last ? this._dateTime(last.timestamp) : '',
      delivered_at: this._dateTime(parcel.deliveredAt),
      direction: this._direction(parcel),
      history,
      url: parcel.url || '',
      service: parcel.service || parcel.product || '',
      delivered: Boolean(parcel.delivered),
      active_parcels: active.length,
      active_count: active.length,
      total_count: all.length,
      last_update: this._formatDateTime(Date.now()),
      weight: parcel.weight ? `${parcel.weight} kg` : '',
      dimensions: parcel.dimensions?.text || '',
      origin: parcel.origin || '',
      destination: parcel.destination || '',
      pickup_code: parcel.pickupCode || '',
      pickup_deadline: this._dateTime(parcel.pickupDeadline),
      item: parcel.item || '',
      stops: Number.isFinite(parcel.stopsUntilYou) ? parcel.stopsUntilYou : 0,
      track_url: parcel.url || '',
    };
    return this.extraTokens ? { ...tokens, ...this.extraTokens(parcel, tokens) } : tokens;
  }

  /* -------------------------------------------------------- capabilities -- */

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

  async _set(logical, value) {
    const capability = logical in this.cfg.caps ? this.cfg.caps[logical] : logical;
    if (!capability || !this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch(error => this.error(`${this.cfg.log} ${capability}:`, error.message));
  }

  async _updateCapabilities(updatedAt = null) {
    const all = this._sortedParcels();
    const incoming = all.filter(p => p.direction !== 'outgoing');
    const active = incoming.filter(p => !p.delivered);
    const focus = active[0] || incoming[0] || all[0] || null;
    const next = active.filter(p => p.plannedFrom).sort((a, b) => Date.parse(a.plannedFrom) - Date.parse(b.plannedFrom))[0] || null;
    const text = value => (value === null || value === undefined || String(value).trim() === '' ? EMPTY : String(value));

    await this._set('count', active.length);
    await this._set('total', all.length);
    await this._set('outCount', active.filter(p => p.status === STATUS.OUT_FOR_DELIVERY).length);
    await this._set('pickupCount', active.filter(p => p.status === STATUS.AT_PICKUP_POINT).length);
    await this._set('enRouteCount', active.filter(p => p.pickup && p.status !== STATUS.AT_PICKUP_POINT).length);
    await this._set('deliveredCount', incoming.filter(p => p.delivered).length);
    await this._set('outgoingCount', all.filter(p => p.direction === 'outgoing' && !p.delivered).length);
    await this._set('status', focus ? this._statusText(focus.status) : EMPTY);
    await this._set('tracking', text(focus?.tracking));
    await this._set('sender', text(focus?.sender));
    await this._set('receiver', text(focus?.receiver));
    await this._set('date', text(focus ? this._displayDate(focus.plannedFrom || focus.deliveredAt) : ''));
    await this._set('window', text(focus ? this._window(focus) : ''));
    await this._set('pickupPoint', text(focus?.pickupPoint));
    await this._set('lastEvent', text(focus ? this._eventText(this._lastEventText(focus)) : ''));
    await this._set('next', next ? `${this._displayDate(next.plannedFrom)} ${this._window(next)}`.trim() : EMPTY);
    await this._set('weight', text(this._displayWeight(focus)));
    await this._set('dimensions', text(this._displayDimensions(focus)));
    await this._set('service', text(focus?.service || focus?.product));
    await this._set('pickupCode', text(focus?.pickupCode));
    await this._set('item', text(focus?.item));
    if (updatedAt) await this._set('lastUpdate', this._formatDateTime(updatedAt));
    await this.updateExtraCapabilities?.({ all, incoming, active, focus, next, text });
  }

  /* ------------------------------------------------------------- polling -- */

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

  /** ha-dhl cadence: 15 min near a delivery, otherwise the mid tier, quiet 00–06 with a catch-up at both ends. */
  _nextDelay(afterError = false) {
    const now = Date.now();
    const active = Object.values(this._parcels || {}).filter(p => !p.delivered);
    const hot = !afterError && active.some(parcel => {
      const from = Date.parse(parcel.plannedFrom || '');
      if (parcel.status === STATUS.OUT_FOR_DELIVERY) return !from || from - now <= HOT_LOOKAHEAD_MS;
      return from && parcel.windowKnown && from - now <= HOT_LOOKAHEAD_MS && from + 6 * 3600 * 1000 > now;
    });
    const tier = hot ? HOT_MINUTES : (this.cfg.midMinutes || 45);
    const stagger = this._staggerMinutes();
    const minutesNow = this._localMinutes(new Date(now));
    const quietEnd = QUIET_END_HOUR * 60;
    let delay;
    if (minutesNow < quietEnd) delay = ((quietEnd - minutesNow) + stagger) * 60000;
    else if (minutesNow + tier + stagger >= 24 * 60) delay = ((24 * 60 - minutesNow) + stagger) * 60000;
    else delay = (tier + stagger) * 60000;
    if (!afterError && this.cfg.idleWhenNothingActive && !active.length && !(this.hasAccount?.())) delay = Math.max(delay, 6 * 3600 * 1000);
    return this.adjustDelay ? this.adjustDelay(delay, { hot, afterError }) : delay;
  }

  /* ------------------------------------------------------------- widgets -- */

  getWidgetData() {
    const parcels = this._sortedParcels().map(parcel => {
      const last = this._lastEvent(parcel);
      return {
        id: parcel.tracking,
        tracking: parcel.tracking,
        barcode: parcel.tracking,
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
        weight: this._displayWeight(parcel),
        dimensions: this._displayDimensions(parcel),
        lastEvent: this._eventText(this._lastEventText(parcel)),
        lastEventAt: last?.timestamp || parcel.deliveredAt || '',
        eventAt: last?.timestamp || '',
        updatedAt: last?.timestamp || (parcel.checkedAt ? new Date(parcel.checkedAt).toISOString() : ''),
        createdAt: parcel.firstSeen ? new Date(parcel.firstSeen).toISOString() : '',
        delivered: Boolean(parcel.delivered),
        direction: this._direction(parcel),
        service: parcel.service || '',
        product: parcel.product || '',
        shipFrom: parcel.origin || '',
        shipTo: parcel.destination || '',
        detailsUrl: parcel.url || '',
        pickupCode: parcel.pickupCode || '',
        item: parcel.item || '',
        ...(this.extraWidgetFields ? this.extraWidgetFields(parcel) : {}),
      };
    });
    return { parcels, authenticated: this.getStoreValue('authExpiredNotified') !== true, carrier: this.cfg.widgetCarrier || this.cfg.storePrefix, updatedAt: new Date().toISOString() };
  }

  /* ---------------------------------------------------------- conditions -- */

  hasStatus(status) {
    return Object.values(this._parcels || {}).some(p => p.direction !== 'outgoing' && p.status === status && (status === STATUS.DELIVERED || !p.delivered));
  }

  hasPackagesUnderway() { return Object.values(this._parcels || {}).some(p => p.direction !== 'outgoing' && !p.delivered); }

  hasOutgoingUnderway() { return Object.values(this._parcels || {}).some(p => p.direction === 'outgoing' && !p.delivered); }

  allDelivered() {
    const list = Object.values(this._parcels || {}).filter(p => p.direction !== 'outgoing');
    return list.length > 0 && list.every(p => p.delivered);
  }

  isDelivered(number) {
    const parcel = this._parcels?.[this.normalizeTrackingCode(number)];
    return Boolean(parcel && parcel.delivered);
  }

  autocompleteParcels(query = '') {
    const q = String(query || '').toLowerCase();
    return this._sortedParcels()
      .filter(p => !q || p.tracking.toLowerCase().includes(q) || String(p.sender || '').toLowerCase().includes(q))
      .map(p => ({ id: p.tracking, name: p.tracking, description: [this._statusText(p.status), p.sender, this._direction(p)].filter(Boolean).join(' · ') }));
  }
}

CarrierDeviceBase.EMPTY = EMPTY;
CarrierDeviceBase.STATUS = STATUS;
module.exports = CarrierDeviceBase;
