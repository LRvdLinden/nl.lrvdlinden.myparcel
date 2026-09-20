'use strict';

const API_BASE = 'https://tracking.budbee.com/api';

class BudbeeApiError extends Error {
  constructor(message, status = 0, body = null) {
    super(message); this.name = 'BudbeeApiError'; this.status = status; this.body = body;
  }
}

async function readJson(url, notFound = []) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (notFound.includes(res.status)) return null;
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { throw new BudbeeApiError('Budbee returned an invalid response', res.status); }
  if (!res.ok) throw new BudbeeApiError(`Budbee HTTP ${res.status}`, res.status, data);
  return data;
}

function unwrapV3(body) {
  if (!body) return null;
  if (body.errorCode === 'ORDER_NOT_FOUND') return null;
  if (body.errorCode || body.status === 'FAILED') throw new BudbeeApiError(body.errorMsg || body.errorCode || 'Budbee request failed', 200, body);
  return body.payload || body;
}

class BudbeeApi {
  async parcel(code) {
    const clean = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!clean) return null;
    const metaEnvelope = await readJson(`${API_BASE}/v3/orders/${encodeURIComponent(clean)}/meta`);
    const meta = unwrapV3(metaEnvelope);
    if (!meta) return null;
    let payload;
    if (meta.type === 'BOX') {
      payload = await readJson(`${API_BASE}/box/${encodeURIComponent(clean)}`, [404]);
    } else {
      const orderEnvelope = await readJson(`${API_BASE}/v3/orders/${encodeURIComponent(clean)}`);
      const order = unwrapV3(orderEnvelope);
      payload = order?.conspectus || order;
    }
    if (!payload) return null;
    return { ...payload, meta, trackingCode: clean };
  }
}

module.exports = { BudbeeApi, BudbeeApiError };
