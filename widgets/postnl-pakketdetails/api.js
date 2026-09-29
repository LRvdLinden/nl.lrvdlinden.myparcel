'use strict';

function getDevice(homey, id) {
  const device = homey.drivers.getDriver('postnl').getDevices().find(item => item.getId() === id);
  if (!device) throw new Error('PostNL device not found.');
  return device;
}
function packageTime(item) {
  const raw = item?.deliveryWindowFrom || item?.deliveryDate || item?.createdAt || '';
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}
function selectPackage(packages = []) {
  const active = packages.filter(item => !item.delivered);
  return [...active].sort((a, b) => packageTime(a) - packageTime(b))[0] || null;
}
module.exports = {
  async getData({ homey, query }) {
    const device = getDevice(homey, query?.deviceId);
    const data = device.getWidgetData();
    return {
      authenticated: data.authenticated,
      package: selectPackage(data.packages || []),
      updatedAt: data.updatedAt || null,
      locale: homey.i18n.getLanguage(),
      timeZone: homey.clock.getTimezone(),
    };
  },
  async refresh({ homey, body }) {
    const device = getDevice(homey, body?.deviceId);
    await device.sync({ reason: 'package-detail-widget', force: true });
    const data = device.getWidgetData();
    return { package: selectPackage(data.packages || []), updatedAt: data.updatedAt || null };
  },
};
