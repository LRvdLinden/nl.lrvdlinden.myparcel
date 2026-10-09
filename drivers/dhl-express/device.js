'use strict';

const DhlDeviceBase = require('../../lib/dhl-device-base');
const DHLExpressAccountApi = require('../../lib/dhl-express-account');
const { DHLExpressSessionClient } = require('../../lib/dhl-express-session');
const {
  STATUS, ExpressBudget, fetchExpress, normalizeExpress, mapExpressCheckpoint, normalizeCode, isExpressAwb,
} = require('../../lib/dhl-tracking');

const BUDGET_SETTING = 'dhl_express_budget_v1'; // app-wide: DHL throttles per IP, not per device
const FETCHED_STORE = 'dhl_express_fetched_at';

/** DHL Express – air waybills without an account (ha-dhl's Express backend) plus the optional MyDHL+ account. */
class DhlExpressDevice extends DhlDeviceBase {
  static config = {
    carrier: 'DHL Express',
    log: '[DHL Express]',
    storePrefix: 'dhl_express',
    widgetCarrier: 'dhl-express',
    midMinutes: 45,
    firstDelay: 2500,
    unavailableOnAuth: false,
    capabilities: [
      'dhl_express_parcel_count', 'dhl_express_total_count', 'dhl_express_status', 'dhl_express_tracking', 'dhl_express_sender',
      'dhl_express_receiver', 'dhl_express_delivery_date', 'dhl_express_delivery_window', 'dhl_express_next_delivery',
      'dhl_express_service', 'dhl_express_origin', 'dhl_express_destination', 'dhl_express_pieces', 'dhl_express_last_event',
      'dhl_express_out_for_delivery_count', 'dhl_express_delivered_count', 'dhl_express_delivered',
      'myparcel_connection_status', 'dhl_express_last_update',
    ],
    caps: {
      count: 'dhl_express_parcel_count', total: 'dhl_express_total_count', status: 'dhl_express_status', tracking: 'dhl_express_tracking',
      sender: 'dhl_express_sender', receiver: 'dhl_express_receiver', date: 'dhl_express_delivery_date', window: 'dhl_express_delivery_window',
      next: 'dhl_express_next_delivery', outCount: 'dhl_express_out_for_delivery_count', deliveredCount: 'dhl_express_delivered_count',
      lastEvent: 'dhl_express_last_event', lastUpdate: 'dhl_express_last_update',
      pickupCount: null, enRouteCount: null, outgoingCount: null, pickupPoint: null,
    },
    cards: {
      newPackage: 'dhl_express_new_package',
      statusChanged: 'dhl_express_status_changed',
      delivered: 'dhl_express_delivered',
      outForDelivery: 'dhl_express_out_for_delivery',
      problem: 'dhl_express_package_problem',
      eventChanged: 'dhl_express_package_event_changed',
      deliveryUpdated: 'dhl_express_delivery_updated',
      outgoingStatus: 'dhl_express_outgoing_status_changed',
      outgoingDelivered: 'dhl_express_outgoing_delivered',
    },
  };

  async onDhlInit() {
    this._directApi = null;
    // 0.3.3 kept the raw list here; the new parcel store seeds its trigger memory silently.
    if (Array.isArray(this.getStoreValue('snapshot'))) await this.unsetStoreValue('snapshot').catch(() => {});
  }

  async onDhlSettings(changedKeys) {
    if (changedKeys.includes('tracking_numbers')) {
      const codes = new Set(this.trackedEntries().map(entry => entry.code));
      for (const [code, parcel] of Object.entries(this._parcels)) if (parcel.source === 'express' && !codes.has(code)) delete this._parcels[code];
    }
    if (changedKeys.includes('session_bundle')) this._directApi = null;
  }

  /* --------------------------------------------------------------- auth -- */

  _mode() {
    const mode = String(this.getStoreValue('auth_mode') || '').trim();
    if (mode) return mode;
    if (this.getStoreValue('email') && this.getStoreValue('password')) return 'direct';
    return this._code() ? 'helper' : 'tracking';
  }

  _code() { return String(this.getStoreValue('session_bundle') || this.getSetting('session_bundle') || '').trim(); }

  hasAccount() {
    const mode = this._mode();
    if (mode === 'direct') return Boolean(this.getStoreValue('email') && this.getStoreValue('password'));
    if (mode === 'helper') return Boolean(this._code());
    return false;
  }

  hasUsableConfiguration() { return this.hasAccount() || this.trackedEntries().length > 0; }

  isConnected() { return this.hasUsableConfiguration() && this.getStoreValue('connected') !== false; }

  async updateDirectCredentials(email, password) {
    await this.setStoreValue('auth_mode', 'direct');
    await this.setStoreValue('email', String(email || '').trim());
    await this.setStoreValue('password', String(password || ''));
    await this.setStoreValue('session_bundle', '');
    this._directApi = null;
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  async updateHelperSession(code) {
    await this.setStoreValue('auth_mode', 'helper');
    await this.setStoreValue('session_bundle', String(code || '').trim());
    await this.setStoreValue('email', '');
    await this.setStoreValue('password', '');
    this._directApi = null;
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  async validateTrackingCode(entry) {
    if (!isExpressAwb(entry.code)) {
      throw new Error(this._lang() === 'nl'
        ? 'Een DHL Express-luchtvrachtbriefnummer bestaat uit 10 cijfers. Andere DHL-nummers horen bij het DHL-apparaat.'
        : 'A DHL Express air waybill has 10 digits. Other DHL numbers belong on the DHL device.');
    }
  }

  /* -------------------------------------------------------------- budget -- */

  _budget() { return new ExpressBudget(this.homey.settings.get(BUDGET_SETTING) || {}); }

  _saveBudget(budget) { const state = budget.toJSON(); delete state.fetchedAt; this.homey.settings.set(BUDGET_SETTING, state); }

  adjustDelay(delay) {
    const active = this.trackedEntries().filter(entry => !this._parcels[entry.code]?.delivered && !this.wasDelivered(entry.code));
    if (!active.length) return this.hasAccount() ? delay : 6 * 3600 * 1000;
    if (this.hasAccount()) return delay;
    const wait = this._budget().waitMs();
    return Math.max(delay, wait + this._staggerMinutes() * 60000);
  }

  /* ------------------------------------------------------------- fetching -- */

  _accountParcel(p) {
    const tracking = normalizeCode(p.tracking || p.id);
    let status = p.delivered ? STATUS.DELIVERED : mapExpressCheckpoint(p.status || p.lastEvent);
    if (status === STATUS.UNKNOWN) status = STATUS.IN_TRANSIT;
    if (!p.delivered && status === STATUS.DELIVERED) status = STATUS.OUT_FOR_DELIVERY;
    const from = p.deliveryWindowFrom || p.deliveryDate || null;
    return {
      source: 'account',
      barcode: tracking,
      sender: p.sender || '',
      receiver: p.receiver || '',
      status,
      rawStatus: p.status || '',
      delivered: Boolean(p.delivered),
      deliveredAt: p.delivered ? (p.lastEventAt || p.updatedAt || null) : null,
      plannedFrom: p.delivered ? null : from,
      plannedTo: p.delivered ? null : (p.deliveryWindowTo || null),
      windowKnown: Boolean(!p.delivered && p.deliveryWindowFrom && p.deliveryWindowTo),
      pickup: false,
      pickupPoint: '',
      url: `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(tracking)}`,
      history: p.lastEvent ? [{ timestamp: p.lastEventAt || p.updatedAt || null, status, rawStatus: p.lastEvent }] : [],
      direction: 'incoming',
      service: p.service || '',
      origin: p.origin || '',
      destination: p.destination || '',
    };
  }

  async _accountShipments() {
    const mode = this._mode();
    try {
      if (mode === 'direct') {
        const email = this.getStoreValue('email');
        const password = this.getStoreValue('password');
        if (!this._directApi || this._directApi.email !== email || this._directApi.password !== password) {
          this._directApi = new DHLExpressAccountApi({ fetch, email, password, log: (...a) => this.log('[DHL Express direct]', ...a) });
        }
        return await this._directApi.getParcels();
      }
      const client = new DHLExpressSessionClient({ sessionCode: this._code(), fetchFn: fetch, log: (...a) => this.log(...a) });
      return await client.fetchShipments();
    } catch (error) {
      if (error.code === 'NO_SHIPMENT_DATA') return []; // signed in, but no shipments on the account
      // An expired MyDHL+ session redirects to the login page: sign in again next time.
      this._directApi = null;
      if (/session rejected|401|403|OTP_REQUIRED|AUTH_FAILED|BROWSER_LOGIN_REQUIRED/i.test(`${error.code || ''} ${error.message}`)) error.auth = true;
      throw error;
    }
  }

  async _fetchParcels({ force }) {
    const entries = this.trackedEntries();
    const account = this.hasAccount();
    if (!account && !entries.length) return null;
    const out = [];
    let accountError = null;

    if (account) {
      try {
        for (const shipment of await this._accountShipments()) {
          const parcel = this._accountParcel(shipment);
          if (parcel.barcode) out.push(parcel);
        }
        await this.setStoreValue('connected', true).catch(() => {});
      } catch (error) {
        accountError = error;
        await this.setStoreValue('connected', false).catch(() => {});
      }
    }

    // Air waybills: at most one Express request per poll, within ha-dhl's 40-minute budget.
    // The request budget is app-wide (DHL throttles per IP); which waybill is next is per device.
    const tracked = entries.filter(entry => !out.some(p => p.barcode === entry.code) && !this.wasDelivered(entry.code));
    const waiting = tracked.filter(entry => !this._parcels[entry.code]?.delivered).map(entry => entry.code);
    const fetchedAt = { ...(this.getStoreValue(FETCHED_STORE) || {}) };
    for (const key of Object.keys(fetchedAt)) if (!entries.some(entry => entry.code === key)) delete fetchedAt[key];
    const hot = waiting.filter(c => this._parcels[c]?.status === STATUS.OUT_FOR_DELIVERY);
    const budget = this._budget();
    budget.fetchedAt = fetchedAt;
    const code = budget.pick(waiting, hot);
    if (code && budget.take()) {
      this._saveBudget(budget); // claim the slot before awaiting, so another device cannot use it too
      try {
        const raw = await fetchExpress(code);
        const entry = entries.find(item => item.code === code);
        if (raw) this._parcels[code] = { ...this._parcels[code], ...normalizeExpress(raw, { direction: entry?.direction }), pending: false };
        else this._parcels[code] = { ...(this._parcels[code] || {}), notFound: true };
        fetchedAt[code] = Date.now();
        const after = this._budget();
        after.success();
        this._saveBudget(after);
      } catch (error) {
        if (error.throttled) {
          const after = this._budget();
          after.throttled(Date.now(), this._staggerMinutes() * 60000);
          this._saveBudget(after);
        } else {
          fetchedAt[code] = Date.now();
          this.error('[DHL Express] air waybill lookup failed:', error.message);
        }
      }
      await this.setStoreValue(FETCHED_STORE, fetchedAt).catch(this.error);
    }

    for (const entry of tracked) {
      const known = this._parcels[entry.code];
      if (known && known.source === 'express' && !known.pending) out.push({ ...known, direction: entry.direction });
      else out.push({ source: 'express', barcode: entry.code, status: STATUS.REGISTERED, rawStatus: '', delivered: false, direction: entry.direction, history: [], pending: true });
    }

    if (accountError && !entries.length) throw accountError;
    if (accountError) this.error('[DHL Express] account refresh failed:', accountError.message);
    return out;
  }

  async onRefreshed() {
    const label = this.homey.app?.getConnectionLabel?.(this.isConnected());
    if (label && this.hasCapability('myparcel_connection_status')) await this.setCapabilityValue('myparcel_connection_status', label).catch(() => {});
  }

  /* ------------------------------------------------------------ extras -- */

  extraTokens(parcel) {
    return {
      carrier: 'DHL Express',
      service: parcel.service || '',
      origin: parcel.origin || '',
      destination: parcel.destination || '',
      pieces: parcel.pieces || 0,
      proof_of_delivery: parcel.proofOfDelivery || '',
    };
  }

  async updateExtraCapabilities({ focus, text }) {
    await this._set('dhl_express_service', text(focus?.service));
    await this._set('dhl_express_origin', text(focus?.origin));
    await this._set('dhl_express_destination', text(focus?.destination));
    await this._set('dhl_express_pieces', Number(focus?.pieces || 0));
    await this._set('dhl_express_delivered', Boolean(focus?.delivered));
  }

  extraWidgetFields(parcel) {
    return { origin: parcel.origin || '', destination: parcel.destination || '', pieces: parcel.pieces || '', proofOfDelivery: parcel.proofOfDelivery || '' };
  }

  hasDeliveryWindow() {
    return Object.values(this._parcels || {}).some(p => !p.delivered && p.plannedFrom);
  }
}

module.exports = DhlExpressDevice;
