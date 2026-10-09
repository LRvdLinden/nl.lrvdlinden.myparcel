'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { MondialRelayOAuth, MondialRelayClient, normalize, normalizeCode, dedupeByShipmentUid, marketOf } = require('../../lib/mondial-relay-tracking');

/**
 * Mondial Relay – like ha-mondial-relay: an InPost Group account (OAuth/PKCE browser-paste sign-in) whose
 * received and shipped parcel lists are polled. The refresh token (rotating) and the device-uid used for
 * request signing live in the store; no password is ever kept.
 */
class MondialRelayDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'Mondial Relay',
    log: '[Mondial Relay]',
    storePrefix: 'mondial_relay',
    widgetCarrier: 'mondial-relay',
    capabilities: [
      'mondial_relay_parcel_count', 'mondial_relay_status', 'mondial_relay_tracking', 'mondial_relay_sender', 'mondial_relay_delivery_date',
      'mondial_relay_delivery_window', 'mondial_relay_next_delivery', 'mondial_relay_out_for_delivery_count', 'mondial_relay_delivered_count',
      'mondial_relay_outgoing_count', 'mondial_relay_last_event', 'myparcel_connection_status', 'mondial_relay_last_update',
    ],
    caps: {
      count: 'mondial_relay_parcel_count', status: 'mondial_relay_status', tracking: 'mondial_relay_tracking', sender: 'mondial_relay_sender', receiver: null,
      date: 'mondial_relay_delivery_date', window: 'mondial_relay_delivery_window', next: 'mondial_relay_next_delivery',
      outCount: 'mondial_relay_out_for_delivery_count', enRouteCount: null, pickupCount: null, pickupPoint: null,
      deliveredCount: 'mondial_relay_delivered_count', outgoingCount: 'mondial_relay_outgoing_count', lastEvent: 'mondial_relay_last_event',
      lastUpdate: 'mondial_relay_last_update', total: null,
    },
    cards: {
      newPackage: 'mondial_relay_new_package', statusChanged: 'mondial_relay_status_changed', eventChanged: 'mondial_relay_package_event_changed',
      outForDelivery: 'mondial_relay_out_for_delivery', delivered: 'mondial_relay_delivered', problem: 'mondial_relay_package_problem',
      outgoingStatus: 'mondial_relay_outgoing_status_changed', outgoingDelivered: 'mondial_relay_outgoing_delivered',
    },
  };

  async onDhlInit() {
    this._client = null;
    this._signingWarned = false;
    this._raw = this.getStoreValue('mondial_relay_raw_cache') || null;
  }

  /** Account feed, not user-entered codes: the tracked list is whatever the account returns. */
  trackedEntries() { return []; }

  normalizeTrackingCode(code) { return normalizeCode(code); }

  hasAccount() { return Boolean(this.getStoreValue('mondial_relay_refresh_token')); }

  hasUsableConfiguration() { return this.hasAccount() && Boolean(this.getStoreValue('mondial_relay_device_uid')); }

  isTracking(code) { return Boolean(this._parcels?.[this.normalizeTrackingCode(code)]); }

  extraTokens() { return { market: this.market() }; }

  market() { return marketOf(this.getStoreValue('mondial_relay_market') || this.getSetting('country')); }

  _getClient() {
    if (!this._client) {
      const oauth = new MondialRelayOAuth({ refreshToken: this.getStoreValue('mondial_relay_refresh_token') });
      this._client = new MondialRelayClient({ oauth, deviceUid: this.getStoreValue('mondial_relay_device_uid') });
    }
    return this._client;
  }

  /** A silently rotated refresh token must be persisted after every poll, or it is lost on restart. */
  async _persistToken() {
    const oauth = this._client?.oauth;
    if (oauth && oauth.popRefreshTokenChanged() && oauth.refreshToken) await this.setStoreValue('mondial_relay_refresh_token', oauth.refreshToken).catch(this.error);
  }

  /** Called by the repair flow after a fresh sign-in. The device-uid never changes (signed requests must stay one device). */
  async updateAccount({ refreshToken, market, subject, accountType }) {
    await this.setStoreValue('mondial_relay_refresh_token', refreshToken);
    if (market) {
      await this.setStoreValue('mondial_relay_market', marketOf(market));
      await this.setSettings({ country: marketOf(market) }).catch(this.error);
    }
    if (subject) await this.setStoreValue('mondial_relay_subject', subject);
    if (accountType !== undefined) await this.setStoreValue('mondial_relay_account_type', accountType || '');
    this._client = null;
    await this.setStoreValue('authExpiredNotified', false);
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  _normalizeLists({ received = [], shipped = [] }) {
    const out = [];
    const seen = new Set();
    // Each list is deduplicated on its own; a shipment in both lists stays in the bucket the server returned first (incoming).
    for (const item of dedupeByShipmentUid(received)) { const p = normalize(item, '', { direction: 'incoming' }); if (p.barcode && !seen.has(p.barcode)) { seen.add(p.barcode); out.push(p); } }
    for (const item of dedupeByShipmentUid(shipped)) { const p = normalize(item, '', { direction: 'outgoing' }); if (p.barcode && !seen.has(p.barcode)) { seen.add(p.barcode); out.push(p); } }
    return out;
  }

  async _fetchParcels() {
    if (!this.hasUsableConfiguration()) return null;
    const client = this._getClient();
    let received;
    let shipped;
    try {
      received = await client.received();
      shipped = await client.shipped();
    } catch (error) {
      await this._persistToken();
      if (error.code === 'signing_rejected') {
        // Not the user's session: never a re-login. Keep last-good data, log once.
        if (!this._signingWarned) {
          this._signingWarned = true;
          this.error('[Mondial Relay] request signature rejected (HTTP 403) – an app update is likely needed');
        }
        if (this._raw) return this._normalizeLists(this._raw);
      }
      throw error;
    }
    await this._persistToken();
    this._raw = { received, shipped };
    await this.setStoreValue('mondial_relay_raw_cache', this._raw).catch(this.error);
    return this._normalizeLists(this._raw);
  }

  async onAuthFailure() { this._client = null; }
}

module.exports = MondialRelayDevice;
