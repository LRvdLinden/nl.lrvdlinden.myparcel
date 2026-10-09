'use strict';
const { tr } = require('../../lib/i18n.js');
// User-facing widget texts (all 13 app languages; English is the fallback).
const SELECT_DEVICE = { en: 'Select a {carrier} device for this widget.', nl: 'Selecteer een {carrier}-apparaat voor deze widget.', de: 'Wähle ein {carrier}-Gerät für dieses Widget.', fr: 'Sélectionnez un appareil {carrier} pour ce widget.', it: 'Seleziona un dispositivo {carrier} per questo widget.', sv: 'Välj en {carrier}-enhet för den här widgeten.', no: 'Velg en {carrier}-enhet for denne widgeten.', es: 'Selecciona un dispositivo de {carrier} para este widget.', da: 'Vælg en {carrier}-enhed til denne widget.', ru: 'Выберите устройство {carrier} для этого виджета.', pl: 'Wybierz urządzenie {carrier} dla tego widżetu.', ko: '이 위젯에 사용할 {carrier} 기기를 선택하세요.', ar: 'اختر جهاز {carrier} لهذه الأداة.' };
function timestamp(item){const t=new Date(item?.deliveryDate||0).getTime();return Number.isFinite(t)?t:0;}
function getDevice(homey,id){const device=homey.drivers.getDriver('postnl').getDevices().find(d=>d.getId()===id);if(!device)throw new Error(tr(homey,SELECT_DEVICE,{carrier:'PostNL'}));return device;}
module.exports={
 async getData({homey,query}){
  const device=getDevice(homey,query?.deviceId);
  // Return the latest live snapshot immediately. A fresh PostNL sync is started
  // separately by the widget so opening the widget never waits on the network.
  const data=device.getWidgetData();
  return{authenticated:data.authenticated,mailApiStatus:data.mailApiStatus,mailApiError:data.mailApiError,letters:[...(data.liveLetters||[])].sort((a,b)=>timestamp(b)-timestamp(a)).slice(0,10),locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone()};
 },
 async sync({homey,body}){await getDevice(homey,body?.deviceId).sync({reason:'widget-live',force:true});return{ok:true};}
};
