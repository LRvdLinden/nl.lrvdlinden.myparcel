'use strict';

const CarrierDeviceBase = require('../../lib/carrier-device-base');
const { VintedGoClient, normalize } = require('../../lib/vintedgo-tracking');

/** Vinted Go (formerly Homerr) – like ha-vinted-go: account shipments + public timeline per parcel. */
class HomerrDevice extends CarrierDeviceBase {
  static config = {
    carrier: 'Vinted Go',
    log: '[Vinted Go]',
    storePrefix: 'homerr',
    widgetCarrier: 'homerr',
    capabilities: [
      'homerr_parcel_count', 'homerr_status', 'homerr_tracking', 'homerr_item', 'homerr_pickup_count', 'homerr_en_route_pickup_count',
      'homerr_pickup_point', 'homerr_pickup_code', 'homerr_delivered_count', 'homerr_outgoing_count', 'homerr_last_event',
      'myparcel_connection_status', 'homerr_last_update',
    ],
    caps: {
      count: 'homerr_parcel_count', status: 'homerr_status', tracking: 'homerr_tracking', item: 'homerr_item', pickupCount: 'homerr_pickup_count',
      enRouteCount: 'homerr_en_route_pickup_count', pickupPoint: 'homerr_pickup_point', pickupCode: 'homerr_pickup_code',
      deliveredCount: 'homerr_delivered_count', outgoingCount: 'homerr_outgoing_count', lastEvent: 'homerr_last_event', lastUpdate: 'homerr_last_update',
      total: null, sender: null, receiver: null, date: null, window: null, next: null, outCount: null,
    },
    cards: {
      newPackage: 'homerr_new_package', statusChanged: 'homerr_package_status_changed', delivered: 'homerr_delivered',
      outForDelivery: 'homerr_out_for_delivery', readyForPickup: 'homerr_ready_for_pickup', problem: 'homerr_package_problem',
      eventChanged: 'homerr_package_event_changed', outgoingStatus: 'homerr_outgoing_status_changed', outgoingDelivered: 'homerr_outgoing_delivered',
    },
  };

  async onDhlInit() {
    this._client = null;
    this._timelines = this.getStoreValue('homerr_timeline_cache') || {};
    // 0.3.4 and older kept the refresh token as a device setting.
    const legacy = this.getSetting('refresh_token');
    if (legacy && !this.getStoreValue('refresh_token')) {
      await this.setStoreValue('refresh_token', legacy).catch(this.error);
      await this.setSettings({ refresh_token: '' }).catch(() => {});
    }
  }

  hasUsableConfiguration() { return Boolean(this.getStoreValue('refresh_token')); }

  hasAccount() { return true; }

  async updateLogin(refreshToken, email) {
    await this.setStoreValue('refresh_token', refreshToken);
    if (email) await this.setSettings({ email }).catch(() => {});
    this._client = null;
    await this.setStoreValue('authExpiredNotified', false);
    await this.setAvailable().catch(() => {});
    return this.refresh(true);
  }

  _getClient() {
    if (!this._client) {
      this._client = new VintedGoClient({
        refreshToken: this.getStoreValue('refresh_token'),
        onRefreshToken: token => this.setStoreValue('refresh_token', token).catch(this.error),
      });
    }
    return this._client;
  }

  async _fetchParcels() {
    if (!this.hasUsableConfiguration()) return null;
    const client = this._getClient();
    let shipments;
    try { shipments = await client.shipments(); } catch (error) { if (error.auth) this._client = null; throw error; }
    const cache = {};
    const out = [];
    for (const shipment of shipments) {
      const code = shipment.tracking_code;
      if (!code) continue;
      const cached = this._timelines[code];
      let events;
      if (cached && cached.at === (shipment.last_tracking_event_at ?? null)) events = cached.events;
      else {
        const timeline = await client.timeline(code);
        events = Array.isArray(timeline?.tracking_events) ? timeline.tracking_events.slice(-30) : [];
      }
      cache[code] = { at: shipment.last_tracking_event_at ?? null, events };
      const parcel = normalize({ ...shipment, tracking_events: events });
      // Closed but never delivered (lost, disposed, cancelled): announce once, then hide.
      if (parcel.closed && this._memory[code] && this._memory[code].status === parcel.status) continue;
      out.push(parcel);
    }
    this._timelines = cache;
    await this.setStoreValue('homerr_timeline_cache', cache).catch(this.error);
    return out;
  }

  async onAuthFailure() { this._client = null; }
}

module.exports = HomerrDevice;
