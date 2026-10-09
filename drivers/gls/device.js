'use strict';

const Homey = require('homey');
const {
  GlsTracker, COUNTRIES, STATUS, parseTrackingList, formatTrackingList,
  normalizePostcode, normalizeTrackingNumber, validatePostcode, trackingUrl,
} = require('../../lib/gls-tracking');
const { GlsApi } = require('../../lib/gls-api');
const i18n = require('../../lib/gls-i18n');
const { formatDate, formatWeight, formatDimensions } = require('../../lib/i18n');
const { t } = require('../../lib/messages-i18n');

const CAPABILITIES = [
  'gls_parcel_count', 'gls_status', 'gls_next_delivery', 'gls_delivery_window', 'gls_tracking',
  'gls_sender', 'gls_receiver', 'gls_last_event', 'gls_out_for_delivery_count', 'gls_en_route_pickup_count',
  'gls_pickup_count', 'gls_pickup_point', 'gls_delivered_count', 'gls_weight', 'gls_dimensions',
  'myparcel_connection_status', 'gls_last_update',
];

// Most relevant parcel first: what the capabilities describe.
const PRIORITY = {
  out_for_delivery: 0, at_pickup_point: 1, in_transit: 2, registered: 3, problem: 4, returning: 5, unknown: 6, delivered: 7,
};

const HOT_MINUTES = 15;
const MID_MINUTES = 45;
const HOT_LOOKAHEAD_MS = 60 * 60 * 1000;
const QUIET_END_HOUR = 6;
const STORE_PARCELS = 'gls_parcels_v2';
const STORE_MEMORY = 'gls_flow_memory_v1';
const STORE_SEEDED = 'gls_memory_seeded';
const STORE_DE = 'gls_de_state';
const STORE_ACCOUNT = 'gls_account_numbers';
const EMPTY = '—';
const DAY_MS = 24 * 60 * 60 * 1000;

const POSTCODE_REQUIRED = new Set(['nl', 'group', 'ca', 'de']);

function legacyId(x) {
  return x?.TrackID || x?.trackID || x?.ParcelNumber || x?.parcelNumber || x?.ParcelNo || x?.parcelNo || x?.ShipmentUnitReference || x?.shipmentUnitReference || '';
}

function hasTimezone(value) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value || '').trim());
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class GlsDevice extends Homey.Device {
  async onInit() {
    this._parcels = this.getStoreValue(STORE_PARCELS) || {};
    this._memory = this.getStoreValue(STORE_MEMORY) || {};
    this._busy = null;
    this._timer = null;
    this._stopped = false;

    for (const capability of CAPABILITIES) {
      if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
    }
    // Devices paired with 0.3.x (MyGLS account only) have no country yet.
    if (!this.getSetting('country')) await this.setSettings({ country: 'NL' }).catch(this.error);

    await this._updateCapabilities().catch(this.error);
    this._schedule(5000);
  }

  async onUninit() {
    this._stopped = true;
    this._clearTimer();
  }

  async onDeleted() {
    this._stopped = true;
    this._clearTimer();
  }

  async onSettings({ newSettings, changedKeys }) {
    const country = newSettings.country || 'NL';
    if ((changedKeys.includes('postal_code') || changedKeys.includes('country')) && String(newSettings.postal_code || '').trim()) {
      if (!validatePostcode(country, newSettings.postal_code)) {
        throw new Error(i18n.text(this.homey, 'invalid_postcode', {
          country: i18n.countryName(this.homey, country),
          example: COUNTRIES[country]?.postcode_example || '',
        }));
      }
    }
    // A different country means a different GLS backend; forget cached results.
    if (changedKeys.includes('country')) await this.resetParcels();
    // Settings are applied after this handler returns.
    this.homey.setTimeout(() => this.refresh(true).catch(this.error), 1500);
  }

  /* ----------------------------------------------------------- tracking -- */

  _settingsRows() {
    return parseTrackingList(this.getSetting('tracking_numbers'));
  }

  _trackingRows() {
    const rows = this._settingsRows();
    const known = new Set(rows.map(row => row.parcelNo));
    const account = this.getStoreValue(STORE_ACCOUNT) || {};
    for (const number of Object.keys(account)) {
      if (!known.has(number)) { rows.push({ parcelNo: number, postcode: '', fromAccount: true }); known.add(number); }
    }
    return rows;
  }

  getTrackedNumbers() {
    return this._trackingRows().map(row => row.parcelNo);
  }

  async addTracking(input) {
    const [parsed] = parseTrackingList(String(input || ''));
    if (!parsed) throw new Error(t(this.homey, 'enter_tracking'));
    const country = this.getSetting('country') || 'NL';
    if (parsed.postcode && !validatePostcode(country, parsed.postcode)) {
      throw new Error(i18n.text(this.homey, 'invalid_postcode', { country: i18n.countryName(this.homey, country), example: COUNTRIES[country]?.postcode_example || '' }));
    }
    const rows = this._settingsRows().filter(row => row.parcelNo !== parsed.parcelNo);
    rows.push(parsed);
    await this.setSettings({ tracking_numbers: formatTrackingList(rows) });
    await this.refresh(true);
    return true;
  }

  async removeTracking(number) {
    const target = normalizeTrackingNumber(number);
    const rows = this._settingsRows();
    const remaining = rows.filter(row => row.parcelNo !== target);
    if (remaining.length !== rows.length) await this.setSettings({ tracking_numbers: formatTrackingList(remaining) });
    const account = { ...(this.getStoreValue(STORE_ACCOUNT) || {}) };
    if (account[target]) { delete account[target]; await this.setStoreValue(STORE_ACCOUNT, account).catch(this.error); }
    delete this._parcels[target];
    await this.setStoreValue(STORE_PARCELS, this._parcels).catch(this.error);
    await this._updateCapabilities();
    return true;
  }

  async removeDelivered() {
    const delivered = Object.values(this._parcels).filter(p => p.delivered).map(p => p.tracking);
    await this._dropNumbers(delivered);
    await this._updateCapabilities();
    return true;
  }

  async _dropNumbers(numbers) {
    if (!numbers.length) return;
    const drop = new Set(numbers);
    const rows = this._settingsRows();
    const remaining = rows.filter(row => !drop.has(row.parcelNo));
    if (remaining.length !== rows.length) await this.setSettings({ tracking_numbers: formatTrackingList(remaining) }).catch(this.error);
    const account = { ...(this.getStoreValue(STORE_ACCOUNT) || {}) };
    let accountChanged = false;
    for (const number of drop) {
      delete this._parcels[number];
      if (account[number]) { delete account[number]; accountChanged = true; }
    }
    if (accountChanged) await this.setStoreValue(STORE_ACCOUNT, account).catch(this.error);
    await this.setStoreValue(STORE_PARCELS, this._parcels).catch(this.error);
  }

  async resetParcels() {
    this._parcels = {};
    await this.setStoreValue(STORE_PARCELS, {}).catch(this.error);
    await this.unsetStoreValue(STORE_DE).catch(() => {});
  }

  /* ------------------------------------------------------------ refresh -- */

  async refresh(force = false) {
    if (this._busy) return this._busy;
    this._busy = this._refresh(force).finally(() => { this._busy = null; });
    return this._busy;
  }

  async _discoverAccountParcels(settings) {
    if (!(settings.username && settings.password && settings.subscription_key && settings.parcel_list_url)) return;
    try {
      const api = new GlsApi({
        username: settings.username,
        password: settings.password,
        subscriptionKey: settings.subscription_key,
        trackUrlTemplate: settings.track_url_template,
        parcelListUrl: settings.parcel_list_url,
      });
      const found = await api.findParcels(settings.discovery_days || 21);
      const account = { ...(this.getStoreValue(STORE_ACCOUNT) || {}) };
      let changed = false;
      for (const item of found) {
        const number = normalizeTrackingNumber(legacyId(item));
        if (number && !account[number]) { account[number] = Date.now(); changed = true; }
      }
      if (changed) await this.setStoreValue(STORE_ACCOUNT, account);
      await this.setStoreValue('authExpiredNotified', false).catch(() => {});
    } catch (error) {
      this.error('[GLS] MyGLS account discovery failed:', error.message);
      if ([400, 401, 403, 490].includes(error.status)) await this.setStoreValue('authExpiredNotified', true).catch(() => {});
    }
  }

  async _refresh(force) {
    this._clearTimer();
    const settings = this.getSettings();
    const country = COUNTRIES[settings.country] ? settings.country : 'NL';
    const transport = COUNTRIES[country].transport;
    const hubPostcode = normalizePostcode(settings.postal_code);
    const hubPostcodeValid = validatePostcode(country, hubPostcode);
    const now = Date.now();

    await this._discoverAccountParcels(settings);
    const rows = this._trackingRows();

    const tracker = new GlsTracker({
      country,
      state: this.getStoreValue(STORE_DE) || {},
      onStateChange: state => { this.setStoreValue(STORE_DE, state).catch(this.error); },
      log: (...args) => this.log(...args),
    });

    const previous = this._parcels || {};
    const next = {};
    let attempted = 0;
    let failed = 0;
    let missingPostcode = false;

    for (const row of rows) {
      const key = row.parcelNo;
      const postcode = row.postcode || (hubPostcodeValid ? hubPostcode : '');
      const prev = previous[key];
      // Delivered is final: keep the cached result instead of polling GLS again.
      if (prev && prev.delivered && prev.found) { next[key] = prev; continue; }
      if (!postcode && POSTCODE_REQUIRED.has(transport)) {
        missingPostcode = true;
        next[key] = prev || this._placeholder(key, country, postcode);
        continue;
      }
      attempted++;
      try {
        const parcel = await tracker.track(key, postcode);
        if (parcel) next[key] = this._compact(parcel, key, postcode, prev, now);
        else next[key] = prev && prev.found ? { ...prev, checkedAt: now } : this._placeholder(key, country, postcode, prev);
      } catch (error) {
        failed++;
        this.error(`[GLS] ${key}:`, error.message);
        next[key] = prev || this._placeholder(key, country, postcode);
      }
      if (rows.length > 1) await sleep(300);
    }

    await this._processTriggers(next, now);

    // Delivered parcels drop out of the list after the configured number of days.
    const retentionDays = Number(settings.remove_delivered_after_days ?? 7);
    if (retentionDays > 0) {
      const expired = Object.values(next).filter(parcel => {
        if (!parcel.delivered) return false;
        // Count from the moment MyParcel saw the delivery, so a late-added parcel is still shown.
        const at = Number(this._memory[parcel.tracking]?.deliveredSeenAt || 0) || Date.parse(parcel.deliveredAt || '');
        return at && now - at > retentionDays * DAY_MS;
      }).map(parcel => parcel.tracking);
      for (const number of expired) delete next[number];
      if (expired.length) {
        this.log('[GLS] removing delivered parcels after retention:', expired.join(', '));
        this._parcels = next;
        await this._dropNumbers(expired);
      }
    }

    this._parcels = next;
    await this.setStoreValue(STORE_PARCELS, next).catch(this.error);

    if (rows.length && missingPostcode) await this.setWarning(i18n.text(this.homey, 'setup_needed')).catch(() => {});
    else if (attempted && failed === attempted) await this.setWarning(t(this.homey, 'unreachable', { name: 'GLS' })).catch(() => {});
    else await this.unsetWarning().catch(() => {});
    if (!(attempted && failed === attempted)) await this.setCapabilityValue('gls_last_update', formatDate(this.homey, now, { dateStyle: 'short', timeStyle: 'medium' }, this.homey.clock.getTimezone())).catch(this.error);
    await this.setAvailable().catch(() => {});

    await this._updateCapabilities();
    this._schedule(this._nextDelay());
    return !(attempted && failed === attempted);
  }

  _placeholder(key, country, postcode, prev = null) {
    return {
      tracking: key,
      parcelNumber: key,
      found: false,
      country,
      postcode: postcode || '',
      status: STATUS.UNKNOWN,
      rawStatus: null,
      delivered: false,
      deliveredAt: null,
      plannedFrom: null,
      plannedTo: null,
      pickup: false,
      pickupPoint: null,
      sender: null,
      receiver: null,
      weight: null,
      dimensions: null,
      history: [],
      url: trackingUrl(country, key, postcode),
      firstSeen: prev?.firstSeen || Date.now(),
      checkedAt: Date.now(),
    };
  }

  _compact(parcel, key, postcode, prev, now) {
    return {
      tracking: key,
      parcelNumber: parcel.parcelNumber || parcel.barcode || key,
      found: true,
      country: parcel.country,
      postcode: postcode || '',
      status: parcel.status,
      rawStatus: parcel.rawStatus,
      delivered: Boolean(parcel.delivered),
      deliveredAt: parcel.deliveredAt,
      plannedFrom: parcel.plannedFrom,
      plannedTo: parcel.plannedTo,
      pickup: Boolean(parcel.pickup),
      pickupPoint: parcel.pickupPoint,
      sender: parcel.sender,
      receiver: parcel.receiver,
      weight: typeof parcel.weight === 'number' && Number.isFinite(parcel.weight) ? parcel.weight : null,
      dimensions: parcel.dimensions ? parcel.dimensions.text || null : null,
      history: (parcel.history || []).slice(-20),
      url: parcel.url,
      firstSeen: prev?.firstSeen || now,
      checkedAt: now,
    };
  }

  /* ----------------------------------------------------------- triggers -- */

  async _trigger(cardId, tokens) {
    try {
      await this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, tokens, {});
    } catch (error) {
      this.error(`[GLS] trigger ${cardId} failed:`, error.message);
    }
  }

  async _statusTriggers(status, tokens) {
    if (status === STATUS.OUT_FOR_DELIVERY) await this._trigger('gls_out_for_delivery', tokens);
    else if (status === STATUS.AT_PICKUP_POINT) await this._trigger('gls_ready_for_pickup', tokens);
    else if (status === STATUS.PROBLEM || status === STATUS.RETURNING) await this._trigger('gls_package_problem', tokens);
  }

  async _processTriggers(parcels, now) {
    // First successful run after pairing/upgrade: record a baseline without firing
    // anything, so existing parcels don't all trigger as "new".
    const seeding = this.getStoreValue(STORE_SEEDED) !== true;
    const memory = { ...this._memory };

    for (const parcel of Object.values(parcels)) {
      const key = parcel.tracking;
      const seen = memory[key];
      if (seen) seen.lastSeen = now;
      if (!parcel.found) continue;

      const tokens = this._tokens(parcel);
      if (!seen || !seen.found) {
        memory[key] = {
          found: true, status: parcel.status, rawStatus: parcel.rawStatus, firstSeen: now, lastSeen: now,
          deliveredNotified: parcel.delivered, deliveredSeenAt: parcel.delivered ? now : null,
        };
        if (seeding || parcel.delivered) continue;
        await this._trigger('gls_new_package', tokens);
        await this._statusTriggers(parcel.status, tokens);
        continue;
      }
      if (seen.deliveredNotified) continue; // final: never fire again for this parcel

      if (parcel.status !== seen.status) {
        if (parcel.status !== STATUS.DELIVERED) {
          await this._trigger('gls_status_changed', {
            ...tokens,
            previous_status: i18n.statusText(this.homey, seen.status),
            old_status_code: seen.status || '',
          });
        }
        await this._statusTriggers(parcel.status, tokens);
      }
      if (parcel.rawStatus && parcel.rawStatus !== seen.rawStatus) {
        await this._trigger('gls_package_event_changed', { ...tokens, old_event: seen.rawStatus || '' });
      }
      if (parcel.delivered) {
        seen.deliveredNotified = true;
        seen.deliveredSeenAt = now;
        await this._trigger('gls_package_delivered', tokens);
      }
      seen.status = parcel.status;
      seen.rawStatus = parcel.rawStatus;
    }

    // Forget parcels that are no longer tracked and haven't been seen for 60 days.
    for (const [key, value] of Object.entries(memory)) {
      if (!parcels[key] && now - Number(value.lastSeen || 0) > 60 * DAY_MS) delete memory[key];
    }
    this._memory = memory;
    await this.setStoreValue(STORE_MEMORY, memory).catch(this.error);
    if (seeding) await this.setStoreValue(STORE_SEEDED, true).catch(this.error);
  }

  /* --------------------------------------------------------- formatting -- */

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
    // Naive timestamps from GLS are local wall-clock times.
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!match) return null;
    return { date: `${match[3]}-${match[2]}-${match[1]}`, time: match[4] ? `${match[4]}:${match[5]}` : '' };
  }

  _date(value) { return this._parts(value)?.date || ''; }

  /** Display-only date for capabilities; Flow tokens keep dd-mm-yyyy. */
  _displayDate(value) {
    const p = this._parts(value);
    if (!p) return '';
    const [d, m, y] = p.date.split('-').map(Number);
    return formatDate(this.homey, new Date(Date.UTC(y, m - 1, d, 12)), { day: 'numeric', month: 'short', year: 'numeric' }, 'UTC');
  }
  _time(value) { return this._parts(value)?.time || ''; }
  _dateTime(value) { const p = this._parts(value); return p ? `${p.date}${p.time ? ` ${p.time}` : ''}` : ''; }

  _window(parcel) {
    const start = this._time(parcel.plannedFrom);
    const end = this._time(parcel.plannedTo);
    if (start && end) return start === end ? start : `${start} - ${end}`;
    return start || end || '';
  }

  _lastEvent(parcel) {
    const history = parcel.history || [];
    return history.length ? history[history.length - 1] : null;
  }

  _tokens(parcel) {
    const last = this._lastEvent(parcel);
    const history = (parcel.history || []).slice(-5).map(event => {
      const p = this._parts(event.timestamp);
      return `${p ? `${p.date.slice(0, 5)} ${p.time}`.trim() : ''} ${event.rawStatus || i18n.statusText(this.homey, event.status)}`.trim();
    }).join('\n');
    return {
      tracking: parcel.tracking || '',
      status: parcel.found ? i18n.statusText(this.homey, parcel.status) : i18n.statusText(this.homey, STATUS.UNKNOWN),
      status_code: parcel.status || STATUS.UNKNOWN,
      raw_status: parcel.rawStatus || '',
      sender: parcel.sender || '',
      receiver: parcel.receiver || '',
      delivery_date: this._date(parcel.plannedFrom || parcel.deliveredAt),
      delivery_window: this._window(parcel),
      window_start: this._time(parcel.plannedFrom),
      window_end: this._time(parcel.plannedTo),
      pickup_point: parcel.pickupPoint || '',
      weight: parcel.weight !== null && parcel.weight !== undefined ? `${parcel.weight} kg` : '',
      dimensions: parcel.dimensions || '',
      delivered_at: this._dateTime(parcel.deliveredAt),
      last_event_time: last ? this._dateTime(last.timestamp) : '',
      history,
      url: parcel.url || '',
      country: parcel.country || this.getSetting('country') || '',
    };
  }

  /* ------------------------------------------------------- capabilities -- */

  _sortedParcels() {
    return Object.values(this._parcels || {}).sort((a, b) => {
      const pa = PRIORITY[a.status] ?? 6;
      const pb = PRIORITY[b.status] ?? 6;
      if (pa !== pb) return pa - pb;
      const ta = Date.parse(a.plannedFrom || '') || Number.MAX_SAFE_INTEGER;
      const tb = Date.parse(b.plannedFrom || '') || Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      const la = Date.parse(this._lastEvent(a)?.timestamp || '') || 0;
      const lb = Date.parse(this._lastEvent(b)?.timestamp || '') || 0;
      return lb - la;
    });
  }

  async _set(capability, value) {
    if (!this.hasCapability(capability)) return;
    if (this.getCapabilityValue(capability) === value) return;
    await this.setCapabilityValue(capability, value).catch(error => this.error(`[GLS] ${capability}:`, error.message));
  }

  async _updateCapabilities() {
    const list = this._sortedParcels();
    const active = list.filter(parcel => !parcel.delivered);
    const focus = list[0] || null;
    const next = active.filter(parcel => parcel.plannedFrom).sort((a, b) => Date.parse(a.plannedFrom) - Date.parse(b.plannedFrom))[0] || null;
    const text = value => (value === null || value === undefined || String(value).trim() === '' ? EMPTY : String(value));

    await this._set('gls_parcel_count', active.length);
    await this._set('gls_out_for_delivery_count', active.filter(parcel => parcel.status === STATUS.OUT_FOR_DELIVERY).length);
    await this._set('gls_pickup_count', active.filter(parcel => parcel.status === STATUS.AT_PICKUP_POINT).length);
    await this._set('gls_en_route_pickup_count', active.filter(parcel => parcel.pickup && parcel.status !== STATUS.AT_PICKUP_POINT).length);
    await this._set('gls_delivered_count', list.filter(parcel => parcel.delivered).length);
    await this._set('gls_status', focus ? i18n.statusText(this.homey, focus.found ? focus.status : STATUS.UNKNOWN) : i18n.text(this.homey, 'no_parcels'));
    await this._set('gls_next_delivery', next ? `${this._displayDate(next.plannedFrom)} ${this._window(next)}`.trim() : EMPTY);
    await this._set('gls_delivery_window', text(focus && !focus.delivered ? this._window(focus) : ''));
    await this._set('gls_tracking', text(focus?.tracking));
    await this._set('gls_sender', text(focus?.sender));
    await this._set('gls_receiver', text(focus?.receiver));
    await this._set('gls_last_event', text(focus?.rawStatus));
    await this._set('gls_pickup_point', text(focus?.pickupPoint));
    await this._set('gls_weight', focus && typeof focus.weight === 'number' ? focus.weight : null);
    await this._set('gls_dimensions', text(formatDimensions(this.homey, focus?.dimensions)));
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
    const hour = Number(parts.find(part => part.type === 'hour')?.value || 0) % 24;
    const minute = Number(parts.find(part => part.type === 'minute')?.value || 0);
    return hour * 60 + minute;
  }

  _staggerMinutes() {
    const id = String(this.getData()?.id || '');
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % 7;
  }

  /** Dynamic polling like ha-gls: 15 min when a delivery is near, 45 min otherwise, quiet at night, paused when nothing is underway. */
  _nextDelay() {
    const active = Object.values(this._parcels || {}).filter(parcel => !parcel.delivered);
    if (!active.length) return null;
    const now = Date.now();
    const hot = active.some(parcel => {
      const from = Date.parse(parcel.plannedFrom || '');
      if (parcel.status === STATUS.OUT_FOR_DELIVERY) return !from || from - now <= HOT_LOOKAHEAD_MS;
      return from && from - now <= HOT_LOOKAHEAD_MS && from + 6 * 3600 * 1000 > now;
    });
    const stagger = this._staggerMinutes();
    const tier = hot ? HOT_MINUTES : MID_MINUTES;
    const minutesNow = this._localMinutes(new Date(now));
    const quietEnd = QUIET_END_HOUR * 60;
    if (minutesNow < quietEnd) return ((quietEnd - minutesNow) + stagger) * 60000;
    const candidate = minutesNow + tier + stagger;
    if (candidate >= 24 * 60) return ((24 * 60 - minutesNow) + stagger) * 60000; // one catch-up run around midnight
    return (tier + stagger) * 60000;
  }

  /* ------------------------------------------------------------ widgets -- */

  getWidgetData() {
    const parcels = this._sortedParcels().map(parcel => {
      const last = this._lastEvent(parcel);
      return {
        tracking: parcel.tracking,
        barcode: parcel.parcelNumber,
        reference: parcel.parcelNumber && parcel.parcelNumber !== parcel.tracking ? parcel.parcelNumber : '',
        sender: parcel.sender || '',
        receiver: parcel.receiver || '',
        status: parcel.found ? parcel.status : STATUS.UNKNOWN,
        statusText: i18n.statusText(this.homey, parcel.found ? parcel.status : STATUS.UNKNOWN),
        deliveryDate: parcel.plannedFrom || parcel.deliveredAt || '',
        deliveryWindow: this._window(parcel),
        deliveryWindowFrom: parcel.plannedFrom || '',
        deliveryWindowTo: parcel.plannedTo || '',
        lastEvent: parcel.rawStatus || '',
        lastEventAt: last?.timestamp || '',
        updatedAt: last?.timestamp || (parcel.checkedAt ? new Date(parcel.checkedAt).toISOString() : ''),
        createdAt: parcel.firstSeen ? new Date(parcel.firstSeen).toISOString() : '',
        delivered: Boolean(parcel.delivered),
        weight: parcel.weight !== null && parcel.weight !== undefined ? formatWeight(this.homey, parcel.weight) : '',
        dimensions: formatDimensions(this.homey, parcel.dimensions),
        deliveryPoint: parcel.pickupPoint || '',
        detailsUrl: parcel.url || '',
      };
    });
    return { parcels, authenticated: this.getStoreValue('authExpiredNotified') !== true, carrier: 'gls' };
  }

  /* -------------------------------------------------------- conditions -- */

  hasStatus(status) {
    return Object.values(this._parcels || {}).some(parcel => parcel.found && parcel.status === status && (status === STATUS.DELIVERED || !parcel.delivered));
  }

  isDelivered(number) {
    const parcel = this._parcels?.[normalizeTrackingNumber(number)];
    return Boolean(parcel && parcel.delivered);
  }

  isTracking(number) {
    return this.getTrackedNumbers().includes(normalizeTrackingNumber(number));
  }

  autocompleteParcels(query = '') {
    const q = String(query || '').toLowerCase();
    return this._sortedParcels()
      .filter(parcel => !q || parcel.tracking.toLowerCase().includes(q) || String(parcel.sender || '').toLowerCase().includes(q))
      .map(parcel => ({
        id: parcel.tracking,
        name: parcel.tracking,
        description: [i18n.statusText(this.homey, parcel.found ? parcel.status : STATUS.UNKNOWN), parcel.sender].filter(Boolean).join(' · '),
      }));
  }
}

module.exports = GlsDevice;
