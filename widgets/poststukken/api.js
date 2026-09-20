'use strict';

function timestamp(item) {
  const value = new Date(item?.deliveryDate || item?.archivedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function selectedIds(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function getSelectedDevice(homey, rawIds) {
  const ids = selectedIds(rawIds);
  const devices = homey.drivers.getDriver('postnl').getDevices();
  if (!ids.length) throw new Error('Select a PostNL device for this widget.');
  const device = devices.find(item => item.getId() === ids[0]);
  if (!device) throw new Error('Selected PostNL device not found.');
  return device;
}

module.exports = {
  async getData({ homey, query }) {
    const device = getSelectedDevice(homey, query?.deviceIds || query?.deviceId);
    const data = device.getWidgetData();
    return {
      authenticated: data.authenticated,
      mailApiStatus: data.mailApiStatus,
      mailApiError: data.mailApiError,
      letters: [...(data.letters || [])].sort((a, b) => timestamp(b) - timestamp(a)).slice(0, 20),
      account: device.getName(),
      locale: homey.i18n.getLanguage(),
      timeZone: homey.clock.getTimezone(),
    };
  },

  async sync({ homey, body }) {
    const device = getSelectedDevice(homey, body?.deviceIds || body?.deviceId);
    await device.sync({ reason: 'widget', force: true });
    return { ok: true };
  },
};
