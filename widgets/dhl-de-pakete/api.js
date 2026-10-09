'use strict';
const { tr } = require('../../lib/i18n.js');
// User-facing widget texts (all 13 app languages; English is the fallback).
const SELECT_DEVICE = { en: 'Select a {carrier} device for this widget.', nl: 'Selecteer een {carrier}-apparaat voor deze widget.', de: 'Wähle ein {carrier}-Gerät für dieses Widget.', fr: 'Sélectionnez un appareil {carrier} pour ce widget.', it: 'Seleziona un dispositivo {carrier} per questo widget.', sv: 'Välj en {carrier}-enhet för den här widgeten.', no: 'Velg en {carrier}-enhet for denne widgeten.', es: 'Selecciona un dispositivo de {carrier} para este widget.', da: 'Vælg en {carrier}-enhed til denne widget.', ru: 'Выберите устройство {carrier} для этого виджета.', pl: 'Wybierz urządzenie {carrier} dla tego widżetu.', ko: '이 위젯에 사용할 {carrier} 기기를 선택하세요.', ar: 'اختر جهاز {carrier} لهذه الأداة.' };
const PACKSTATION = { en: 'Packstation / post office: {point}', nl: 'Packstation / postkantoor: {point}', de: 'Packstation / Filiale: {point}', fr: 'Packstation / bureau de poste : {point}', it: 'Packstation / ufficio postale: {point}', sv: 'Packstation / postkontor: {point}', no: 'Packstation / postkontor: {point}', es: 'Packstation / oficina de correos: {point}', da: 'Packstation / posthus: {point}', ru: 'Packstation / почтовое отделение: {point}', pl: 'Packstation / placówka pocztowa: {point}', ko: 'Packstation / 우체국: {point}', ar: 'Packstation / مكتب البريد: {point}' };
const { statusLabel, eventText } = require('../../lib/widget-status');

function timestamp(item) { const time = Date.parse(item?.deliveryDate || item?.updatedAt || item?.createdAt || ''); return Number.isFinite(time) ? time : 0; }
function str(...values) { for (const value of values) { if (value === 0) return '0'; if (value !== undefined && value !== null && String(value).trim()) return String(value).trim(); } return ''; }
function getDevice(homey, id) {
  const device = homey.drivers.getDriver('post-dhl-de').getDevices().find(d => d.getId() === id);
  if (!device) throw new Error(tr(homey, SELECT_DEVICE, { carrier: 'Post & DHL' }));
  return device;
}
const WIDGET_REFRESH_MIN_MS = 5 * 60 * 1000;
const lastRefresh = new Map();

module.exports = {
  async getData({ homey, query }) {
    const device = getDevice(homey, query?.deviceId);
    const data = device.getWidgetData();
    const packages = (data.parcels || []).map(parcel => ({
      carrier: 'DHL', account: device.getName(), tracking: str(parcel.tracking),
      status: statusLabel(homey, parcel), sender: str(parcel.sender), receiver: str(parcel.receiver),
      deliveryDate: str(parcel.deliveryDate), deliveryWindow: str(parcel.deliveryWindow), deliveryWindowFrom: str(parcel.deliveryWindowFrom), deliveryWindowTo: str(parcel.deliveryWindowTo),
      updatedAt: str(parcel.updatedAt), createdAt: str(parcel.createdAt), eventAt: str(parcel.lastEventAt, parcel.updatedAt), lastEventAt: str(parcel.lastEventAt, parcel.updatedAt),
      lastEvent: eventText(homey, str(parcel.lastEvent)), shipmentType: str(parcel.deliveryPoint ? tr(homey, PACKSTATION, { point: parcel.deliveryPoint }) : ''),
      direction: str(parcel.direction), title: str(parcel.sender, parcel.tracking), detailsUrl: str(parcel.detailsUrl), delivered: Boolean(parcel.delivered),
    })).sort((a, b) => Number(a.delivered) - Number(b.delivered) || timestamp(b) - timestamp(a)).slice(0, 8);
    return { authenticated: data.authenticated, packages, locale: homey.i18n.getLanguage(), timeZone: homey.clock.getTimezone() };
  },
  async sync({ homey, body }) {
    const device = getDevice(homey, body?.deviceId);
    const id = String(device.getId());
    if (Date.now() - (lastRefresh.get(id) || 0) >= WIDGET_REFRESH_MIN_MS) {
      lastRefresh.set(id, Date.now());
      await device.refresh(true);
    }
    return { ok: true };
  },
};
