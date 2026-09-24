'use strict';

class RoyalMailApiError extends Error {
  constructor(message, status = 0, body = null) {
    super(message);
    this.name = 'RoyalMailApiError';
    this.status = status;
    this.body = body;
  }
}

class RoyalMailApi {
  constructor({ apiKey, baseUrl = 'https://api.parcel.royalmail.com/api/v1' } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.baseUrl = String(baseUrl || 'https://api.parcel.royalmail.com/api/v1').replace(/\/+$/, '');
  }

  headers() {
    return {
      Accept: 'application/json',
      Authorization: this.apiKey,
      'User-Agent': 'Homey MyParcel',
    };
  }

  async request(path) {
    if (!this.apiKey) throw new RoyalMailApiError('Royal Mail Click & Drop API key is missing.');
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { text }; }
    if (!res.ok) {
      const message = data?.message || data?.error || data?.title || `Royal Mail HTTP ${res.status}`;
      throw new RoyalMailApiError(message, res.status, data);
    }
    return data;
  }

  async version() {
    return this.request('/version');
  }

  async orders({ days = 30, pageSize = 100 } = {}) {
    const end = new Date();
    const start = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000);
    const all = [];
    let token = '';

    for (let page = 0; page < 10; page += 1) {
      const q = new URLSearchParams({
        pageSize: String(Math.min(100, Math.max(1, Number(pageSize) || 100))),
        startDateTime: start.toISOString(),
        endDateTime: end.toISOString(),
      });
      if (token) q.set('continuationToken', token);

      const data = await this.request(`/orders?${q.toString()}`);
      const rows = Array.isArray(data) ? data : (data.orders || data.items || data.results || []);
      if (Array.isArray(rows)) all.push(...rows);
      token = data?.continuationToken || data?.nextContinuationToken || '';
      if (!token || !rows.length) break;
    }

    return all;
  }
}

module.exports = { RoyalMailApi, RoyalMailApiError };
