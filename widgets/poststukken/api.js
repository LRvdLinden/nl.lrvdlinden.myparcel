'use strict';

function timestamp(item) {
  const t = new Date(item?.deliveryDate || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function getDevice(homey, id) {
  const device = homey.drivers.getDriver('postnl').getDevices().find(d => d.getId() === id);
  if (!device) throw new Error('PostNL device not found.');
  return device;
}

module.exports = {
  async getData({ homey, query }) {
    const device = getDevice(homey, query?.deviceId);
    // Opening/refreshing the widget performs a real PostNL sync first so removed
    // mail disappears immediately instead of waiting for the app-wide interval.
    await device.sync({ reason: 'widget', force: true }).catch(error => device.error('[PostNL widget live sync]', error));
    const data = device.getWidgetData();
    return {
      authenticated: data.authenticated,
      mailApiStatus: data.mailApiStatus,
      mailApiError: data.mailApiError,
      letters: [...(data.letters || [])].sort((a, b) => timestamp(b) - timestamp(a)),
      locale: homey.i18n.getLanguage(),
      timeZone: homey.clock.getTimezone(),
      updatedAt: data.updatedAt || null,
    };
  },

  async sync({ homey, body }) {
    const device = getDevice(homey, body?.deviceId);
    await device.sync({ reason: 'widget', force: true });
    return { ok: true };
  },
};
