'use strict';

const Homey = require('homey');
const fs = require('fs');
const path = require('path');
const PostNLApi = require('../../lib/postnl-api');
const localizePackageStatus = require('../../lib/status-i18n');
const { renderDeliveryCard, renderNoPackageCard, loadDeliveryVan, hhmm } = require('../../lib/delivery-image');

const WIDGET_SYNC_MIN_MS = 5 * 60 * 1000;
const MAX_LIVE_LETTER_IMAGES = 10;

class PostNLDevice extends Homey.Device {
  async onInit() {
    this._latestMailImageId = null;
    this._latestPackageImageState = null;
    this._packageImageCache = new Map();
    this._packageCameraImage = null;
    this._packageImageBuffer = null;
    this._activePackageForImage = null;
    this._packageImageTimer = null;
    this._letterImageCache = new Map();
    this._syncing = null;
    this._storage = {
      get: key => this.getStoreValue(key),
      set: (key, value) => this.setStoreValue(key, value),
      unset: key => this.unsetStoreValue(key),
    };
    this.api = new PostNLApi({ homey: this.homey, log: (...args) => this.log(...args), storage: this._storage });
    this.snapshot = this.getStoreValue('snapshot') || { letters: [], liveLetters: [], packages: [], updatedAt: null };

    await this._ensureCapabilities();
    await this._ensurePackageCameraImage();
    this._startPackageImageRefresh();
    await this.applySnapshot(this.snapshot, null);
    if (this.api.hasCredentials()) this.homey.setTimeout(() => this.sync({ reason: 'device-init' }).catch(this.error), 5000);
  }

  async onUninit() {
    if (this._packageImageTimer) this.homey.clearInterval(this._packageImageTimer);
    this._packageImageTimer = null;
  }

  hasAccountCredentials() { return this.api?.hasCredentials() || Boolean(this.getStoreValue('auth')); }

  async _ensureCapabilities() {
    for (const capability of ['postnl_delivery_date', 'postnl_delivery_window', 'postnl_package_status', 'postnl_package_sender', 'postnl_package_receiver', 'postnl_package_tracking', 'postnl_package_event', 'postnl_package_status_time', 'postnl_package_delivered', 'postnl_package_shipment_type', 'postnl_package_weight', 'postnl_package_weight_kg', 'postnl_package_dimensions', 'postnl_package_length', 'postnl_package_width', 'postnl_package_height', 'postnl_package_status_history', 'postnl_package_observation_code', 'postnl_package_canonical_status', 'postnl_package_pickup', 'postnl_package_pickup_point']) {
      if (!this.hasCapability(capability)) await this.addCapability(capability);
    }
  }

  async importLegacyAccount(auth, snapshot) {
    await this.api.replaceAuth(auth);
    if (snapshot) {
      this.snapshot = snapshot;
      await this.setStoreValue('snapshot', snapshot);
    }
    await this.applySnapshot(this.snapshot, null);
  }

  async updateCredentials(auth, profile = null) {
    await this.api.replaceAuth(auth);
    if (profile?.username) await this.setStoreValue('username', profile.username);
    await this.setAvailable().catch(this.error);
    return this.sync({ reason: 'repair-login', force: true });
  }

  async sync({ reason = 'manual', force = false } = {}) {
    if (this._syncing) return this._syncing;
    // Widgets ask for a refresh every minute per open screen. Serve them the last
    // snapshot unless it is older than WIDGET_SYNC_MIN_MS.
    if (/^widget|myparcel-delivery-widget/.test(String(reason)) && Date.now() - (this._lastSyncAt || 0) < WIDGET_SYNC_MIN_MS) {
      return this.snapshot;
    }
    this._syncing = this._sync({ reason, force }).finally(() => { this._syncing = null; });
    return this._syncing;
  }

  async _sync({ reason }) {
    if (!this.api.hasCredentials()) {
      const error = new Error(this.homey.__('errors.not_authenticated'));
      error.code = 'AUTH_REAUTH_REQUIRED';
      if (!['interval', 'startup', 'device-init', 'midnight'].includes(reason)) throw error;
      return this.snapshot;
    }

    const previous = this.snapshot || { letters: [], liveLetters: [], packages: [] };
    try {
      const live = await this.api.fetchAll({ previousPackages: previous.packages || [] });
      // My Post is live-only: keep only the mail items currently returned by PostNL.
      // Images are hydrated for the current response only; removed items are not archived locally.
      const liveLetters = [];
      // Fetch scans sequentially. Promise.all briefly held every JPEG buffer and
      // every base64 copy at once, which could push Homey over its memory limit.
      // Scans are only downloaded once per letter and kept in RAM (not in the store).
      if (!this._letterDataCache) this._letterDataCache = new Map();
      for (const item of (live.letters || []).slice(0, MAX_LIVE_LETTER_IMAGES)) {
        const next = { ...item };
        if (item.imageUrl) {
          const cacheKey = `${item.id}|${item.imageUrl}`;
          if (this._letterDataCache.has(cacheKey)) next.imageData = this._letterDataCache.get(cacheKey);
          else {
            try {
              next.imageData = await this.api.fetchImage(item.imageUrl);
              this._letterDataCache.set(cacheKey, next.imageData);
            } catch (error) { this.log('Live mail image fetch failed', item.id, error.message); }
          }
        }
        liveLetters.push(next);
      }
      const liveKeys = new Set(liveLetters.map(item => `${item.id}|${item.imageUrl}`));
      for (const key of this._letterDataCache.keys()) if (!liveKeys.has(key)) this._letterDataCache.delete(key);
      const current = {
        letters: liveLetters,
        liveLetters,
        packages: live.packages,
        updatedAt: new Date().toISOString(),
        account: live.account || null,
        mailApiStatus: live.mailApiStatus || 'unknown',
        mailApiError: live.mailApiError || null,
        reason,
      };
      this.snapshot = current;
      // Do not persist base64 scans in Homey's device store. They are fetched
      // again on the next live sync; keeping them in RAM is enough for widgets.
      const storedSnapshot = {
        ...current,
        letters: (current.letters || []).map(({ imageData, ...item }) => item),
        liveLetters: (current.liveLetters || []).map(({ imageData, ...item }) => item),
      };
      await this.setStoreValue('snapshot', storedSnapshot);
      this._lastSyncAt = Date.now();
      this._pruneLetterImageCache(current.liveLetters || []);
      await this.handleSnapshotChanges(previous, current);
      if (current.mailApiStatus === 'temporarily_unavailable') {
        const previousMailError = String(previous.mailApiError || '');
        const currentMailError = String(current.mailApiError || 'Mijn PostNL is tijdelijk niet beschikbaar');
        if (previous.mailApiStatus !== 'temporarily_unavailable' || previousMailError !== currentMailError) {
          await this.triggerSyncFailed(currentMailError).catch(this.error);
        }
      }
      await this.setStoreValue('loginExpiredFlowNotified', false);
      await this.applySnapshot(current, null);
      return current;
    } catch (error) {
      const authExpired = error?.code === 'AUTH_REAUTH_REQUIRED' || error?.code === 'AUTH_EXPIRED' || [401, 403].includes(Number(error?.statusCode));
      this.error('[PostNLDevice] sync_failed', JSON.stringify({ reason, ...this.api.safeErrorInfo(error), ...this.api.getAuthDiagnostics() }));
      if (authExpired) {
        const alreadyTriggered = this.getStoreValue('loginExpiredFlowNotified') === true;
        if (!alreadyTriggered) {
          await this.triggerLoginExpired().catch(this.error);
          await this.setStoreValue('loginExpiredFlowNotified', true);
        }
      }
      await this.triggerSyncFailed(error.message).catch(this.error);
      // Never expose stale mail when live PostNL retrieval fails.
      const failed = {
        ...previous,
        letters: [],
        liveLetters: [],
        updatedAt: new Date().toISOString(),
        mailApiStatus: 'temporarily_unavailable',
        mailApiError: error.message || String(error),
      };
      this.snapshot = failed;
      await this.setStoreValue('snapshot', failed);
      await this.applySnapshot(failed, error);
      throw error;
    }
  }


  _flowDriver() {
    return this.driver || this.homey.drivers.getDriver('postnl');
  }

  async _triggerDeviceFlow(cardId, tokens = {}, state = {}) {
    const { __parcel: parcel, ...cleanTokens } = tokens || {};
    if (parcel && 'package_image_available' in cleanTokens) {
      const image = await this.getPackageDeliveryImage(parcel).catch(() => null);
      cleanTokens.package_image_available = Boolean(image);
      if (image) cleanTokens.package_image = image;
    }
    return this._flowDriver().triggerDeviceFlow(cardId, this, cleanTokens, state);
  }

  async triggerNewMail(tokens = {}) { return this._triggerDeviceFlow('new_mail', tokens); }
  async triggerNewPackage(tokens = {}) { return this._triggerDeviceFlow('new_package', tokens); }
  async triggerDeliveryWindowKnown(tokens = {}) { return this._triggerDeviceFlow('delivery_window_known', tokens); }
  async triggerPackageStatusChanged(tokens = {}) { return this._triggerDeviceFlow('package_status_changed', tokens); }
  async triggerPackageDelivered(tokens = {}) { return this._triggerDeviceFlow('package_delivered', tokens); }
  async triggerDeliveryWindowChanged(tokens = {}) { return this._triggerDeviceFlow('delivery_window_changed', tokens); }
  async triggerPackageEventChanged(tokens = {}) { return this._triggerDeviceFlow('package_event_changed', tokens); }
  async triggerPackageWeightKnown(tokens = {}) { return this._triggerDeviceFlow('package_weight_known', tokens); }
  async triggerPackageDimensionsKnown(tokens = {}) { return this._triggerDeviceFlow('package_dimensions_known', tokens); }
  async triggerSyncFailed(message = '') { return this._triggerDeviceFlow('sync_failed', { error: String(message || '') }); }
  async triggerLoginExpired() { return this._triggerDeviceFlow('login_expired', {}); }

  _localizeShipmentType(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const language = this.homey.i18n.getLanguage() === 'nl' ? 'nl' : 'en';
    if (language === 'nl' && /^parcel$/i.test(raw)) return 'Pakket';
    return raw;
  }

  async _packageTokens(parcel = {}) {
    // No image here: computing tokens for every parcel on every sync must stay cheap.
    // _triggerDeviceFlow() attaches the (lazily rendered) image when a card fires.
    const packageImage = null;
    const status = String(parcel.statusRaw || parcel.latestStatusEvent || parcel.status || localizePackageStatus(this.homey, parcel.status) || '').trim();
    const deliveryDate = parcel.deliveryDate ? this.api.formatDateDMY(parcel.deliveryDate) : '';
    const deliveryWindow = parcel.deliveryWindow || this.api.formatWindow(parcel.deliveryWindowFrom, parcel.deliveryWindowTo) || '';
    const sender = parcel.sender || parcel.title || '';
    const tracking = parcel.barcode || parcel.id || '';
    const statusRaw = String(parcel.statusRaw || parcel.status || status || '');
    const statusEventTime = parcel.statusChangedAt ? this.api.formatDateTime(parcel.statusChangedAt) || String(parcel.statusChangedAt) : '';
    const tokens = {
      id: parcel.id || '', sender, receiver: parcel.receiver || '',
      title: parcel.title || parcel.sender || parcel.barcode || 'PostNL', barcode: parcel.barcode || '', status,
      status_raw: statusRaw,
      status_code: String(parcel.statusCode || ''),
      status_event: String(parcel.latestStatusEvent || statusRaw || ''),
      status_event_time: statusEventTime,
      delivery_date: deliveryDate, delivery_window: deliveryWindow,
      delivery_window_from: parcel.deliveryWindowFrom ? this.api.formatTime(parcel.deliveryWindowFrom) : '',
      delivery_window_to: parcel.deliveryWindowTo ? this.api.formatTime(parcel.deliveryWindowTo) : '',
      delivery_window_type: parcel.deliveryWindowType || '', details_url: parcel.detailsUrl || '', shipment_type: this._localizeShipmentType(parcel.shipmentType),
      delivery_address_type: parcel.deliveryAddressType || '', direction: parcel.direction || '',
      created_at: parcel.createdAt ? this.api.formatDateTime(parcel.createdAt) : '',
      delivered: Boolean(parcel.delivered), shared_from: parcel.sourceDisplayName || '', source_account_id: parcel.sourceAccountId || '',
      weight: String(parcel.weight || ''), weight_kg: Number.isFinite(Number(parcel.weightKg)) ? Number(parcel.weightKg) : 0, dimensions: String(parcel.dimensions || ''),
      dimension_length: Number.isFinite(Number(parcel.dimensionLengthCm)) ? Number(parcel.dimensionLengthCm) : 0, dimension_width: Number.isFinite(Number(parcel.dimensionWidthCm)) ? Number(parcel.dimensionWidthCm) : 0, dimension_height: Number.isFinite(Number(parcel.dimensionHeightCm)) ? Number(parcel.dimensionHeightCm) : 0,
      status_history: JSON.stringify(parcel.statusHistory || []), observation_code: String(parcel.observationCode || ''), canonical_status: String(parcel.canonicalStatus || 'unknown'), pickup: Boolean(parcel.pickup), pickup_point: String(parcel.pickupPoint || ''),
      package_status_text: status, package_window_text: deliveryWindow, package_delivery_date: deliveryDate,
      package_sender: sender, package_tracking: tracking, package_image_available: Boolean(packageImage),
    };
    Object.defineProperty(tokens, '__parcel', { value: parcel, enumerable: true, configurable: true });
    return tokens;
  }

  async _mailTokens(letter = {}, count = 1) {
    const image = await this.getLetterImage(letter).catch(() => null);
    const tokens = {
      count: Number(count || 0), id: letter.id || '', title: letter.title || '', sender: letter.sender || '',
      date: letter.deliveryDate ? this.api.formatDate(letter.deliveryDate) : '', unread: Boolean(letter.unread), image_available: Boolean(image),
    };
    if (image) tokens.image = image;
    return tokens;
  }

  _hasDeliveryWindow(parcel = {}) {
    return Boolean(
      String(parcel.deliveryWindow || '').trim()
      || String(parcel.deliveryWindowFrom || '').trim()
      || String(parcel.deliveryWindowTo || '').trim()
    );
  }

  _packageStatusFingerprint(parcel = {}) {
    return String(parcel.statusFingerprint || [
      parcel.statusRaw || parcel.status || '',
      parcel.statusCode || '',
      parcel.statusChangedAt || '',
      parcel.latestStatusEvent || '',
      parcel.deliveryWindow || '',
      parcel.deliveryDate || '',
    ].join('|'));
  }

  async handleSnapshotChanges(previous = {}, current = {}) {
    const previousLiveLetters = Array.isArray(previous.liveLetters) ? previous.liveLetters : (previous.letters || []);
    const todayKey = this._localDateKey();
    const currentLiveLetters = (current.liveLetters || []).filter(item => {
      const key = this._localDateKey(item.deliveryDate);
      return key && key >= todayKey;
    });
    const previousCurrentLetters = previousLiveLetters.filter(item => {
      const key = this._localDateKey(item.deliveryDate);
      return key && key >= todayKey;
    });
    const oldLetterIds = new Set(previousCurrentLetters.map(item => item.id));
    const newLetters = currentLiveLetters.filter(item => !oldLetterIds.has(item.id));
    const oldPackages = new Map((previous.packages || []).map(item => [item.id, item]));

    // On the first successful sync after install/upgrade, seed a baseline rather
    // than firing every existing PostNL item as if it had just appeared.
    if (this.getStoreValue('flowBaselineInitialized') !== true) {
      await this.setStoreValue('flowBaselineInitialized', true);
      const seed = this._loadFlowMemory();
      for (const parcel of current.packages || []) {
        const key = this._flowKey(parcel);
        if (key) seed[key] = { firstSeen: Date.now(), lastSeen: Date.now(), deliveredNotified: Boolean(parcel.delivered) };
      }
      await this._saveFlowMemory(seed);
      this.log('[FlowTrigger] baseline initialized; existing mail/parcels suppressed once');
      return;
    }

    if (newLetters.length) {
      const newest = [...newLetters].sort((a, b) => new Date(b.deliveryDate || 0) - new Date(a.deliveryDate || 0))[0];
      await this.triggerNewMail(await this._mailTokens(newest, newLetters.length));
    }
    const memory = this._loadFlowMemory();
    for (const parcel of current.packages || []) {
      const key = this._flowKey(parcel);
      const seen = key ? memory[key] : null;
      const old = oldPackages.get(parcel.id);
      if (key) memory[key] = { ...(seen || { firstSeen: Date.now() }), lastSeen: Date.now() };

      // Already delivered and already reported (or delivered before we ever saw it):
      // never fire anything again for this parcel.
      const alreadyDelivered = Boolean(seen?.deliveredNotified || old?.delivered);
      if (parcel.delivered && (alreadyDelivered || (!seen && !old))) {
        if (key) memory[key].deliveredNotified = true;
        continue;
      }
      // Parcel was delivered before, PostNL briefly reports it as "not delivered": ignore.
      if (!parcel.delivered && seen?.deliveredNotified) continue;

      const tokens = await this._packageTokens(parcel);
      if (!old && !seen) await this.triggerNewPackage(tokens);

      const hasWindow = !parcel.delivered && this._hasDeliveryWindow(parcel);
      const hadWindow = Boolean(old && !old.delivered && this._hasDeliveryWindow(old));
      if (hasWindow && !hadWindow) await this.triggerDeliveryWindowKnown(tokens);

      if (!old && parcel.delivered && key && !memory[key].deliveredNotified) {
        memory[key].deliveredNotified = true;
        await this.triggerPackageDelivered(tokens);
      }
      if (old) {
        const oldWindow = old.deliveryWindow || this.api.formatWindow(old.deliveryWindowFrom, old.deliveryWindowTo) || '';
        const newWindow = parcel.deliveryWindow || this.api.formatWindow(parcel.deliveryWindowFrom, parcel.deliveryWindowTo) || '';
        if (newWindow && oldWindow && newWindow !== oldWindow && !parcel.delivered) await this.triggerDeliveryWindowChanged({ ...tokens, old_delivery_window: oldWindow });
        const oldEvent = String(old.latestStatusEvent || old.statusRaw || old.status || '');
        const newEvent = String(parcel.latestStatusEvent || parcel.statusRaw || parcel.status || '');
        if (newEvent && newEvent !== oldEvent) await this.triggerPackageEventChanged({ ...tokens, old_event: oldEvent });
        if (!String(old.weight || '').trim() && String(parcel.weight || '').trim()) await this.triggerPackageWeightKnown(tokens);
        if (!String(old.dimensions || '').trim() && String(parcel.dimensions || '').trim()) await this.triggerPackageDimensionsKnown(tokens);
        if (parcel.delivered && key && !memory[key].deliveredNotified) {
          memory[key].deliveredNotified = true;
          await this.triggerPackageDelivered(tokens);
        }
        if (this._packageStatusFingerprint(old) !== this._packageStatusFingerprint(parcel)) {
          await this.triggerPackageStatusChanged({
            ...tokens,
            old_status: String(old.statusRaw || localizePackageStatus(this.homey, old.status) || old.status || ''),
          });
        }
      }
    }

    // A parcel can disappear from the account list immediately after delivery.
    // Refresh such a previously active parcel once via Track & Trace so the final
    // official status (for example "Bezorgd") is not missed by the Flow trigger.
    const currentIds = new Set((current.packages || []).map(item => item.id));
    for (const old of oldPackages.values()) {
      if (currentIds.has(old.id) || old.delivered || !old.detailsUrl) continue;
      const key = this._flowKey(old);
      if (key && memory[key]?.deliveredNotified) continue;
      if (key && memory[key]?.finalRefreshDone) continue;
      if (key) memory[key] = { ...(memory[key] || { firstSeen: Date.now() }), lastSeen: Date.now(), finalRefreshDone: true };
      try {
        const refreshed = await this.api.refreshPackageTracking(old);
        if (this._packageStatusFingerprint(old) !== this._packageStatusFingerprint(refreshed)) {
          const tokens = await this._packageTokens(refreshed);
          const oldEvent = String(old.latestStatusEvent || old.statusRaw || old.status || '');
          const newEvent = String(refreshed.latestStatusEvent || refreshed.statusRaw || refreshed.status || '');
          if (newEvent && newEvent !== oldEvent) await this.triggerPackageEventChanged({ ...tokens, old_event: oldEvent });
          if (refreshed.delivered && !(key && memory[key]?.deliveredNotified)) {
            if (key) memory[key].deliveredNotified = true;
            await this.triggerPackageDelivered(tokens);
          }
          if (!String(old.weight || '').trim() && String(refreshed.weight || '').trim()) await this.triggerPackageWeightKnown(tokens);
          if (!String(old.dimensions || '').trim() && String(refreshed.dimensions || '').trim()) await this.triggerPackageDimensionsKnown(tokens);
          await this.triggerPackageStatusChanged({
            ...tokens,
            old_status: String(old.statusRaw || localizePackageStatus(this.homey, old.status) || old.status || ''),
          });
        }
      } catch (error) {
        this.log('Final PostNL status refresh failed', old.barcode || old.id, error.message);
      }
    }
    await this._saveFlowMemory(memory);
  }

  _flowKey(parcel = {}) {
    return String(parcel.barcode || parcel.id || parcel.key || '').trim().toUpperCase();
  }

  _loadFlowMemory() {
    const stored = this.getStoreValue('flowParcelMemory');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
  }

  async _saveFlowMemory(memory = {}) {
    // Forget parcels not seen for 45 days so the store stays small.
    const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
    const pruned = {};
    for (const [key, value] of Object.entries(memory)) {
      if (value && Number(value.lastSeen || 0) >= cutoff) pruned[key] = value;
    }
    await this.setStoreValue('flowParcelMemory', pruned).catch(this.error);
  }


  async _updateGlobalSnapshotTokens(snapshot = {}) {
    const letters = Array.isArray(snapshot.liveLetters) ? snapshot.liveLetters : [];
    const packages = (snapshot.packages || []).filter(item => !item.delivered);
    const newestMail = [...letters].sort((a, b) => new Date(b.deliveryDate || 0) - new Date(a.deliveryDate || 0))[0] || {};
    const activePackage = this._selectActivePackage(snapshot) || {};
    const status = activePackage.id ? (localizePackageStatus(this.homey, activePackage.status) || '') : '';
    const statusRaw = activePackage.id ? String(activePackage.statusRaw || activePackage.latestStatusEvent || activePackage.status || status || '') : '';
    const deliveryDate = activePackage.deliveryDate ? this.api.formatDateDMY(activePackage.deliveryDate) : '';
    const deliveryWindow = activePackage.deliveryWindow || this.api.formatWindow(activePackage.deliveryWindowFrom, activePackage.deliveryWindowTo) || '';
    const dates = [...letters.map(item => item.deliveryDate).filter(Boolean), ...packages.map(item => item.deliveryDate).filter(Boolean)]
      .sort((a, b) => new Date(a) - new Date(b));
    const connected = this.api.hasCredentials();
    await this._flowDriver().updateGlobalTokens(this, {
      mail_expected: letters.length > 0, mail_count: letters.length, mail_id: newestMail.id || '',
      mail_title: newestMail.title || '', mail_sender: newestMail.sender || '',
      mail_date: newestMail.deliveryDate ? this.api.formatDate(newestMail.deliveryDate) : '', mail_unread: Boolean(newestMail.unread),
      package_count: packages.length, package_id: activePackage.id || '', package_sender: activePackage.sender || activePackage.title || '',
      package_receiver: activePackage.receiver || '', package_title: activePackage.title || activePackage.sender || activePackage.barcode || '',
      package_barcode: activePackage.barcode || '', package_status: status, package_status_raw: statusRaw,
      package_status_code: activePackage.statusCode || '', package_status_event: activePackage.latestStatusEvent || statusRaw,
      package_status_event_time: activePackage.statusChangedAt ? (this.api.formatDateTime(activePackage.statusChangedAt) || String(activePackage.statusChangedAt)) : '',
      package_delivery_date: deliveryDate, package_delivery_window: deliveryWindow,
      package_delivery_window_from: activePackage.deliveryWindowFrom ? this.api.formatTime(activePackage.deliveryWindowFrom) : '',
      package_delivery_window_to: activePackage.deliveryWindowTo ? this.api.formatTime(activePackage.deliveryWindowTo) : '',
      package_delivery_window_type: activePackage.deliveryWindowType || '', package_details_url: activePackage.detailsUrl || '',
      package_shipment_type: this._localizeShipmentType(activePackage.shipmentType), package_delivery_address_type: activePackage.deliveryAddressType || '',
      package_direction: activePackage.direction || '', package_created_at: activePackage.createdAt ? this.api.formatDateTime(activePackage.createdAt) : '',
      package_delivered: Boolean(activePackage.delivered), package_shared_from: activePackage.sourceDisplayName || '',
      package_source_account_id: activePackage.sourceAccountId || '', package_tracking: activePackage.barcode || activePackage.id || '',
      package_weight: activePackage.weight || '', package_dimensions: activePackage.dimensions || '',
      next_delivery: dates[0] ? this.api.formatDate(dates[0]) : '',
      connection_status: connected ? (this.homey.i18n.getLanguage() === 'nl' ? 'Verbonden' : 'Connected') : (this.homey.i18n.getLanguage() === 'nl' ? 'Niet verbonden' : 'Not connected'),
      last_update: snapshot.updatedAt ? this.api.formatDateTime(snapshot.updatedAt) : '',
    });
  }

  _parseLocalOrZonedParts(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
    if (localMatch && !hasZone) {
      const [, year, month, day, hour, minute] = localMatch;
      return {
        date: `${year}-${month}-${day}`,
        minutes: Number(hour) * 60 + Number(minute),
        time: `${hour}:${minute}`,
      };
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.homey.clock.getTimezone(),
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      minutes: Number(get('hour')) * 60 + Number(get('minute')),
      time: `${get('hour')}:${get('minute')}`,
    };
  }

  _nowLocalParts() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.homey.clock.getTimezone(),
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type)?.value || '0';
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    const second = Number(get('second'));
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      seconds: (hour * 3600) + (minute * 60) + second,
    };
  }

  _deliveryHeadline(parcel = {}, language = 'nl') {
    const fromParts = this._parseLocalOrZonedParts(parcel.deliveryWindowFrom);
    const toParts = this._parseLocalOrZonedParts(parcel.deliveryWindowTo);
    const dateKey = fromParts?.date || this._localDateKey(parcel.deliveryDate);
    const todayKey = this._localDateKey();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = this._localDateKey(tomorrow);
    if (fromParts?.time && toParts?.time) {
      if (dateKey === todayKey) return language === 'nl' ? `Vandaag tussen ${fromParts.time} en ${toParts.time}` : `Today between ${fromParts.time} and ${toParts.time}`;
      if (dateKey === tomorrowKey) return language === 'nl' ? `Morgen tussen ${fromParts.time} en ${toParts.time}` : `Tomorrow between ${fromParts.time} and ${toParts.time}`;
      const dateText = parcel.deliveryDate ? this.api.formatDate(parcel.deliveryDate) : dateKey;
      return language === 'nl' ? `${dateText} tussen ${fromParts.time} en ${toParts.time}` : `${dateText} between ${fromParts.time} and ${toParts.time}`;
    }
    if (parcel.deliveryWindow) return parcel.deliveryWindow;
    if (parcel.deliveryDate) return this.api.formatDate(parcel.deliveryDate);
    return language === 'nl' ? 'Pakket onderweg' : 'Parcel on the way';
  }

  _selectActivePackage(snapshot = this.snapshot) {
    return [...((snapshot && snapshot.packages) || [])]
      .filter(item => !item.delivered)
      .sort((a, b) => {
        const left = Date.parse(a.deliveryWindowFrom || a.deliveryDate || a.createdAt || '') || Number.MAX_SAFE_INTEGER;
        const right = Date.parse(b.deliveryWindowFrom || b.deliveryDate || b.createdAt || '') || Number.MAX_SAFE_INTEGER;
        return left - right;
      })[0] || null;
  }

  async _ensurePackageCameraImage() {
    if (this._packageCameraImage) return this._packageCameraImage;
    this._packageCameraImage = await this.homey.images.createImage();
    // Rendered lazily: only when Homey actually requests the camera image.
    this._packageCameraImage.setStream(async stream => {
      const parcel = this._activePackageForImage !== undefined ? this._activePackageForImage : this._selectActivePackage();
      const buffer = this._renderPackageCard(parcel, { cache: 'camera' });
      if (!buffer?.length) throw new Error('PostNL delivery PNG buffer is empty');
      stream.contentType = 'image/png';
      stream.filename = 'postnl-my-delivery.png';
      stream.end(buffer);
      return stream;
    });
    const language = this.homey.i18n.getLanguage() === 'nl' ? 'nl' : 'en';
    await this.setCameraImage('latest_package', language === 'nl' ? 'Mijn Bezorging' : 'My Delivery', this._packageCameraImage);
    return this._packageCameraImage;
  }

  _startPackageImageRefresh() {
    // The delivery PNG is rendered on demand (see _renderPackageCard); no timer needed.
    if (this._packageImageTimer) this.homey.clearInterval(this._packageImageTimer);
    this._packageImageTimer = null;
  }

  _packageCardOptions(activePackage) {
    const language = this.homey.i18n.getLanguage() === 'nl' ? 'nl' : 'en';
    if (!activePackage) return { empty: true, language };
    const from = this._parseLocalOrZonedParts(activePackage.deliveryWindowFrom);
    const to = this._parseLocalOrZonedParts(activePackage.deliveryWindowTo);
    let progress = 0;
    let windowStartPct = 0.25;
    let windowEndPct = 0.75;
    let timelineStart = '';
    let timelineMid = '';
    let timelineEnd = '';
    if (from && to) {
      const displayStart = from.minutes - 60;
      const displayEnd = to.minutes + 60;
      const spanMinutes = Math.max(1, displayEnd - displayStart);
      windowStartPct = (from.minutes - displayStart) / spanMinutes;
      windowEndPct = (to.minutes - displayStart) / spanMinutes;
      timelineStart = hhmm(displayStart);
      timelineMid = hhmm(Math.round((displayStart + displayEnd) / 2));
      timelineEnd = hhmm(displayEnd);
      const now = this._nowLocalParts();
      if (now.date < from.date) progress = 0;
      else if (now.date > from.date) progress = 1;
      else {
        const startSeconds = displayStart * 60;
        const endSeconds = displayEnd * 60;
        progress = Math.max(0, Math.min(1, (now.seconds - startSeconds) / Math.max(1, endSeconds - startSeconds)));
      }
    }
    return {
      sender: activePackage.sender || activePackage.title || activePackage.sourceDisplayName || 'PostNL',
      status: String(activePackage.statusRaw || activePackage.latestStatusEvent || activePackage.status || localizePackageStatus(this.homey, activePackage.status) || '').trim(),
      headline: this._deliveryHeadline(activePackage, language),
      tracking: activePackage.barcode || activePackage.id || '',
      progress,
      windowStartPct, windowEndPct, timelineStart, timelineMid, timelineEnd,
    };
  }

  /** Render (or reuse) the 800x800 delivery card. Identical input -> cached buffer, no new PNG. */
  _renderPackageCard(activePackage, { cache = 'camera' } = {}) {
    const options = this._packageCardOptions(activePackage);
    // Cache key uses the van position in whole percents, so the PNG is redrawn at most
    // when the van visibly moves; the drawing itself uses the exact position.
    const key = JSON.stringify({ ...options, progress: Math.round(Number(options.progress || 0) * 100) });
    if (!this._renderCache) this._renderCache = new Map();
    const hit = this._renderCache.get(cache);
    if (hit && hit.key === key) return hit.buffer;
    const buffer = options.empty
      ? renderNoPackageCard({ language: options.language, vanPng: loadDeliveryVan() })
      : renderDeliveryCard({ ...options, vanPng: loadDeliveryVan() });
    this._renderCache.set(cache, { key, buffer });
    // Keep at most the camera image plus a few Flow images in memory.
    while (this._renderCache.size > 4) this._renderCache.delete(this._renderCache.keys().next().value);
    return buffer;
  }

  async _refreshPackageImageBuffer(force = false, parcel = undefined) {
    // Kept for compatibility: marks the active parcel; the PNG itself is rendered on demand.
    const activePackage = parcel === undefined ? (this._activePackageForImage || this._selectActivePackage()) : parcel;
    this._activePackageForImage = activePackage || null;
    return null;
  }

  /**
   * Image token for one parcel. The Image object is cheap; the PNG is only drawn
   * when a Flow (or the Homey app) actually opens the image.
   */
  async getPackageDeliveryImage(parcel = null) {
    const target = parcel || this._selectActivePackage();
    if (!target) return this._ensurePackageCameraImage();
    const id = String(target.id || target.barcode || 'parcel');
    if (!this._parcelImages) this._parcelImages = new Map();
    let entry = this._parcelImages.get(id);
    if (!entry) {
      const image = await this.homey.images.createImage();
      entry = { image, parcel: target };
      image.setStream(async stream => {
        const buffer = this._renderPackageCard(entry.parcel, { cache: `parcel:${id}` });
        stream.contentType = 'image/png';
        stream.filename = `postnl-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
        stream.end(buffer);
        return stream;
      });
      this._parcelImages.set(id, entry);
      while (this._parcelImages.size > 8) this._parcelImages.delete(this._parcelImages.keys().next().value);
    }
    entry.parcel = target;
    return entry.image;
  }

  async getLetterImage(letter) {
    if (!letter?.imageData || !String(letter.imageData).startsWith('data:')) return null;
    const cacheKey = `${letter.id || 'mail'}:${letter.imageData.length}`;
    if (this._letterImageCache.has(cacheKey)) return this._letterImageCache.get(cacheKey);
    const match = String(letter.imageData).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return null;
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return null;
    const image = await this.homey.images.createImage();
    image.setStream(async stream => {
      stream.contentType = match[1] || 'image/jpeg';
      stream.filename = `postnl-${String(letter.id || 'mail').replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
      stream.end(buffer);
      return stream;
    });
    this._letterImageCache.set(cacheKey, image);
    if (this._letterImageCache.size > 6) this._letterImageCache.delete(this._letterImageCache.keys().next().value);
    return image;
  }


  _pruneLetterImageCache(letters = []) {
    const ids = new Set((letters || []).map(item => String(item?.id || 'mail')));
    for (const key of this._letterImageCache.keys()) {
      if (String(key).startsWith('no-mail-placeholder:')) continue;
      const id = String(key).split(':')[0];
      if (!ids.has(id)) this._letterImageCache.delete(key);
    }
    while (this._letterImageCache.size > 6) this._letterImageCache.delete(this._letterImageCache.keys().next().value);
  }

  async getNoMailPlaceholderImage() {
    const language = this.homey.i18n.getLanguage() === 'nl' ? 'nl' : 'en';
    const cacheKey = `no-mail-placeholder:${language}`;
    if (this._letterImageCache.has(cacheKey)) return this._letterImageCache.get(cacheKey);

    const filePath = path.join(__dirname, '..', '..', 'assets', `no-mail-${language}.png`);
    const buffer = await fs.promises.readFile(filePath);
    if (!buffer?.length) throw new Error('PostNL fallback image is empty');

    const image = await this.homey.images.createImage();
    image.setStream(async stream => {
      stream.contentType = 'image/png';
      stream.filename = `postnl-no-mail-${language}.png`;
      stream.end(buffer);
      return stream;
    });
    this._letterImageCache.set(cacheKey, image);
    return image;
  }

  async _imageFromFile(cache, cacheKey, filePath, contentType, filename) {
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const buffer = await fs.promises.readFile(filePath);
    if (!buffer?.length) throw new Error(`PostNL image is empty: ${filename}`);
    const image = await this.homey.images.createImage();
    image.setStream(async stream => {
      stream.contentType = contentType;
      stream.filename = filename;
      stream.end(buffer);
      return stream;
    });
    cache.set(cacheKey, image);
    return image;
  }

  async getPackageVanImage() {
    return this.getPackageDeliveryImage(this._selectActivePackage());
  }

  async getNoPackagePlaceholderImage() {
    const language = this.homey.i18n.getLanguage() === 'nl' ? 'nl' : 'en';
    const cacheKey = `no-package:${language}`;
    if (this._packageImageCache.has(cacheKey)) return this._packageImageCache.get(cacheKey);
    const buffer = renderNoPackageCard({ language, vanPng: loadDeliveryVan() });
    const image = await this.homey.images.createImage();
    image.setStream(async stream => {
      stream.contentType = 'image/png';
      stream.filename = `postnl-no-package-${language}.png`;
      stream.end(buffer);
      return stream;
    });
    this._packageImageCache.set(cacheKey, image);
    return image;
  }

  _localDateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.homey.clock.getTimezone(), year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  async applySnapshot(snapshot = {}, error = null) {
    // Only mail currently returned by PostNL drives device capabilities and images.
    const letters = Array.isArray(snapshot.liveLetters) ? snapshot.liveLetters : [];
    const packages = (snapshot.packages || []).filter(item => !item.delivered);
    const todayKey = this._localDateKey();
    const currentMail = letters.filter(item => {
      const key = this._localDateKey(item.deliveryDate);
      return key && key >= todayKey;
    });
    const mailDates = currentMail.map(item => item.deliveryDate).filter(Boolean);
    const packageDates = packages.map(item => item.deliveryDate).filter(Boolean).filter(value => this._localDateKey(value) >= todayKey);
    const dates = [...mailDates, ...packageDates].sort((a, b) => new Date(a) - new Date(b));
    const nextDelivery = dates[0] ? this.api.formatDate(dates[0]) : '—';
    const nextPackage = [...packages]
      .filter(item => item.deliveryDate || item.deliveryWindowFrom || item.deliveryWindowTo)
      .sort((a, b) => {
        const left = Date.parse(a.deliveryWindowFrom || a.deliveryDate || a.createdAt || '') || Number.MAX_SAFE_INTEGER;
        const right = Date.parse(b.deliveryWindowFrom || b.deliveryDate || b.createdAt || '') || Number.MAX_SAFE_INTEGER;
        return left - right;
      })[0] || null;
    const packageDeliveryDate = nextPackage?.deliveryDate || nextPackage?.deliveryWindowFrom || nextPackage?.deliveryWindowTo || null;
    const packageDeliveryWindow = nextPackage?.deliveryWindow || this.api.formatWindow(nextPackage?.deliveryWindowFrom, nextPackage?.deliveryWindowTo) || '';
    const updated = snapshot.updatedAt
      ? new Intl.DateTimeFormat(this.homey.i18n.getLanguage() === 'nl' ? 'nl-NL' : 'en-GB', { timeZone: this.homey.clock.getTimezone(), dateStyle: 'short', timeStyle: 'short' }).format(new Date(snapshot.updatedAt))
      : '—';
    const connected = this.api.hasCredentials();
    const officialPackageStatus = nextPackage
      ? String(nextPackage.statusRaw || nextPackage.latestStatusEvent || localizePackageStatus(this.homey, nextPackage.status) || nextPackage.status || '')
      : '—';
    const packageSender = nextPackage ? String(nextPackage.sender || nextPackage.title || nextPackage.sourceDisplayName || '—') : '—';
    const packageReceiver = nextPackage ? String(nextPackage.receiver || '—') : '—';
    const packageTracking = nextPackage ? String(nextPackage.barcode || nextPackage.id || '—') : '—';
    const packageEvent = nextPackage ? String(nextPackage.latestStatusEvent || nextPackage.statusRaw || localizePackageStatus(this.homey, nextPackage.status) || nextPackage.status || '—') : '—';
    const packageStatusTime = nextPackage?.statusChangedAt ? (this.api.formatDateTime(nextPackage.statusChangedAt) || String(nextPackage.statusChangedAt)) : '—';
    const values = {
      postnl_mail_expected: currentMail.length > 0,
      postnl_mail_count: currentMail.length,
      postnl_package_count: packages.length,
      postnl_next_delivery: nextDelivery,
      postnl_delivery_date: packageDeliveryDate ? this.api.formatDateDMY(packageDeliveryDate) : '—',
      postnl_delivery_window: packageDeliveryWindow || '—',
      postnl_package_status: officialPackageStatus,
      postnl_package_sender: packageSender,
      postnl_package_receiver: packageReceiver,
      postnl_package_tracking: packageTracking,
      postnl_package_event: packageEvent,
      postnl_package_status_time: packageStatusTime,
      postnl_package_delivered: Boolean(nextPackage?.delivered),
      postnl_package_shipment_type: nextPackage ? (this._localizeShipmentType(nextPackage.shipmentType) || '—') : '—',
      postnl_package_weight: nextPackage?.weight || '—',
      postnl_package_weight_kg: typeof nextPackage?.weightKg === 'number' && Number.isFinite(nextPackage.weightKg) ? nextPackage.weightKg : null,
      postnl_package_dimensions: nextPackage?.dimensions || '—',
      postnl_package_length: typeof nextPackage?.dimensionLengthCm === 'number' && Number.isFinite(nextPackage.dimensionLengthCm) ? nextPackage.dimensionLengthCm : null,
      postnl_package_width: typeof nextPackage?.dimensionWidthCm === 'number' && Number.isFinite(nextPackage.dimensionWidthCm) ? nextPackage.dimensionWidthCm : null,
      postnl_package_height: typeof nextPackage?.dimensionHeightCm === 'number' && Number.isFinite(nextPackage.dimensionHeightCm) ? nextPackage.dimensionHeightCm : null,
      postnl_package_status_history: JSON.stringify(nextPackage?.statusHistory || []),
      postnl_package_observation_code: nextPackage?.observationCode || '—',
      postnl_package_canonical_status: nextPackage?.canonicalStatus || 'unknown',
      postnl_package_pickup: Boolean(nextPackage?.pickup),
      postnl_package_pickup_point: nextPackage?.pickupPoint || '—',
      postnl_status: connected ? (this.homey.i18n.getLanguage() === 'nl' ? 'Verbonden' : 'Connected') : (this.homey.i18n.getLanguage() === 'nl' ? 'Niet verbonden' : 'Not connected'),
      postnl_last_update: updated,
    };
    for (const [capability, value] of Object.entries(values)) if (this.hasCapability(capability)) await this.setCapabilityValue(capability, value).catch(this.error);

    const language = this.homey.i18n.getLanguage() === 'nl' ? 'nl' : 'en';
    const imageTitle = language === 'nl' ? 'Laatste poststuk' : 'Latest mail item';
    const latestWithImage = [...currentMail]
      .sort((a, b) => new Date(b.deliveryDate || 0) - new Date(a.deliveryDate || 0))
      .find(item => item?.imageData);
    if (latestWithImage && latestWithImage.id !== this._latestMailImageId) {
      const image = await this.getLetterImage(latestWithImage).catch(() => null);
      if (image) {
        await this.setCameraImage('latest_mail_item', imageTitle, image);
        this._latestMailImageId = latestWithImage.id;
      }
    }
    if (!latestWithImage) {
      const placeholderId = `__no_mail__:${language}`;
      if (this._latestMailImageId !== placeholderId) {
        const image = await this.getNoMailPlaceholderImage().catch(() => null);
        if (image) {
          await this.setCameraImage('latest_mail_item', imageTitle, image);
          this._latestMailImageId = placeholderId;
        }
      }
    }
    const activePackage = this._selectActivePackage(snapshot);
    this._activePackageForImage = activePackage;
    await this._ensurePackageCameraImage().catch(this.error);
    const cardOptions = this._packageCardOptions(activePackage);
    const cardKey = JSON.stringify({ ...cardOptions, progress: Math.round(Number(cardOptions.progress || 0) * 100) });
    if (cardKey !== this._lastCameraCardKey) {
      this._lastCameraCardKey = cardKey;
      await this._packageCameraImage?.update?.().catch(() => {});
    }
    await this._updateGlobalSnapshotTokens(snapshot).catch(error => this.error('[GlobalToken] snapshot update failed', error));


    if (error) await this.setUnavailable(error.message).catch(this.error);
    else await this.setAvailable().catch(this.error);
  }

  isMailExpected() { return Boolean(this.getCapabilityValue('postnl_mail_expected')); }
  hasPackagesUnderway() { return Number(this.getCapabilityValue('postnl_package_count') || 0) > 0; }
  hasDeliveryWindowKnown() { return (this.snapshot.packages || []).some(parcel => !parcel.delivered && this._hasDeliveryWindow(parcel)); }
  isPostNLConnected() { return Boolean(this.api && this.api.hasCredentials()); }
  currentPackageHasWeight() { const parcel = this._selectActivePackage(); return Boolean(parcel && String(parcel.weight || '').trim()); }
  currentPackageHasDimensions() { const parcel = this._selectActivePackage(); return Boolean(parcel && String(parcel.dimensions || '').trim()); }
  currentPackageStatusIs(expected = '') {
    const parcel = this._selectActivePackage();
    if (!parcel) return false;
    const actual = String(parcel.statusRaw || parcel.latestStatusEvent || localizePackageStatus(this.homey, parcel.status) || parcel.status || '').trim().toLocaleLowerCase();
    return actual === String(expected || '').trim().toLocaleLowerCase();
  }

  getWidgetData() {
    return {
      authenticated: this.api.hasCredentials(),
      // My Post is live-only; no local mail history is exposed or retained.
      letters: (this.snapshot.liveLetters || []).slice(0, 60),
      liveLetters: (this.snapshot.liveLetters || []).slice(0, 60),
      packages: (this.snapshot.packages || []).slice(0, 40),
      updatedAt: this.snapshot.updatedAt || null, mailApiStatus: this.snapshot.mailApiStatus || 'unknown', mailApiError: this.snapshot.mailApiError || null,
    };
  }
}

module.exports = PostNLDevice;
