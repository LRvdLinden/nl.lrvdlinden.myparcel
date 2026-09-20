'use strict';

function timestamp(item) {
  return Date.parse(item?.deliveryDate || item?.deliveryWindowFrom || item?.createdAt || item?.updatedAt || 0) || 0;
}

function selectedIds(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function selectedDevices(homey, rawIds) {
  const ids = new Set(selectedIds(rawIds));
  if (!ids.size) return [];
  const devices = [];
  for (const device of homey.drivers.getDriver('postnl').getDevices()) {
    if (ids.has(device.getId())) devices.push({ carrier: 'PostNL', device });
  }
  for (const device of homey.drivers.getDriver('dhl-parcel').getDevices()) {
    if (ids.has(device.getId())) devices.push({ carrier: 'DHL', device });
  }
  return devices;
}

module.exports = {
  async getData({ homey, query }) {
    const selected = selectedDevices(homey, query?.deviceIds || query?.deviceId);
    let packages = [];

    for (const { carrier, device } of selected) {
      const data = device.getWidgetData();
      if (carrier === 'PostNL') {
        packages.push(...(data.packages || []).map(parcel => ({
          ...parcel,
          carrier: 'PostNL',
          carrierId: 'postnl',
          carrierLogo: 'postnl.svg',
          account: device.getName(),
          deviceId: device.getId(),
          tracking: parcel.barcode || parcel.id || '',
          deliveryDate: parcel.deliveryDate || parcel.deliveryWindowFrom || '',
          deliveryWindow: parcel.deliveryWindow || '',
          updatedAt: parcel.createdAt || '',
          detailsUrl: parcel.detailsUrl || '',
        })));
      } else {
        packages.push(...(data.parcels || []).map(parcel => ({
          ...parcel,
          carrier: 'DHL',
          carrierId: 'dhl',
          carrierLogo: 'dhl.svg',
          account: device.getName(),
          deviceId: device.getId(),
        })));
      }
    }

    packages.sort((a, b) => {
      if (Boolean(a.delivered) !== Boolean(b.delivered)) return a.delivered ? 1 : -1;
      return timestamp(a) - timestamp(b);
    });

    return {
      packages: packages.slice(0, 50),
      selectedDeviceCount: selected.length,
      locale: homey.i18n.getLanguage(),
      timeZone: homey.clock.getTimezone(),
    };
  },

  async refresh({ homey, body }) {
    const selected = selectedDevices(homey, body?.deviceIds || body?.deviceId);
    const jobs = selected.map(({ carrier, device }) => carrier === 'PostNL'
      ? device.sync({ reason: 'widget', force: true })
      : device.refresh(true));
    await Promise.allSettled(jobs);
    return { ok: true };
  },
};
