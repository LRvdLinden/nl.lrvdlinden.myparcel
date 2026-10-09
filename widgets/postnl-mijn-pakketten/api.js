'use strict';
const { tr } = require('../../lib/i18n.js');
// User-facing widget texts (all 13 app languages; English is the fallback).
const SELECT_DEVICE = { en: 'Select a {carrier} device for this widget.', nl: 'Selecteer een {carrier}-apparaat voor deze widget.', de: 'Wähle ein {carrier}-Gerät für dieses Widget.', fr: 'Sélectionnez un appareil {carrier} pour ce widget.', it: 'Seleziona un dispositivo {carrier} per questo widget.', sv: 'Välj en {carrier}-enhet för den här widgeten.', no: 'Velg en {carrier}-enhet for denne widgeten.', es: 'Selecciona un dispositivo de {carrier} para este widget.', da: 'Vælg en {carrier}-enhed til denne widget.', ru: 'Выберите устройство {carrier} для этого виджета.', pl: 'Wybierz urządzenie {carrier} dla tego widżetu.', ko: '이 위젯에 사용할 {carrier} 기기를 선택하세요.', ar: 'اختر جهاز {carrier} لهذه الأداة.' };
const PARCEL_TYPE = { en: 'Parcel', nl: 'Pakket', de: 'Paket', fr: 'Colis', it: 'Pacco', sv: 'Paket', no: 'Pakke', es: 'Paquete', da: 'Pakke', ru: 'Посылка', pl: 'Paczka', ko: '택배', ar: 'طرد' };
const localizePackageStatus = require('../../lib/status-i18n');
function timestamp(item){const value=item?.deliveryDate||item?.deliveryWindowFrom||item?.updatedAt||item?.createdAt||0;const time=Date.parse(value);return Number.isFinite(time)?time:0;}
function str(...values){for(const value of values){if(value===0)return'0';if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();}return'';}
function shipmentType(homey,value){const raw=str(value);if(!raw)return'';return /^parcel$/i.test(raw)?tr(homey,PARCEL_TYPE):raw;}
function getDevice(homey,id){const device=homey.drivers.getDriver('postnl').getDevices().find(d=>d.getId()===id);if(!device)throw new Error(tr(homey,SELECT_DEVICE,{carrier:'PostNL'}));return device;}
module.exports={
 async getData({homey,query}){
  const device=getDevice(homey,query?.deviceId);const data=device.getWidgetData();
  const packages=(data.packages||[]).map(parcel=>({
   carrier:'PostNL',carrierLogo:'icon.svg',account:device.getName(),tracking:str(parcel.barcode,parcel.id),status:str(parcel.statusRaw,parcel.latestStatusEvent,parcel.status,localizePackageStatus(homey,parcel.status||'')),
   sender:str(parcel.sender,parcel.title,parcel.sourceDisplayName),receiver:str(parcel.receiver),deliveryDate:str(parcel.deliveryDate,parcel.deliveryWindowFrom),deliveryWindow:str(parcel.deliveryWindow),deliveryWindowFrom:str(parcel.deliveryWindowFrom),deliveryWindowTo:str(parcel.deliveryWindowTo),
   updatedAt:str(parcel.updatedAt,parcel.createdAt),createdAt:str(parcel.createdAt),eventAt:str(parcel.lastEventAt,parcel.eventAt,parcel.delivered?parcel.deliveryDate:'',parcel.updatedAt,parcel.createdAt),lastEventAt:str(parcel.lastEventAt,parcel.eventAt,parcel.delivered?parcel.deliveryDate:'',parcel.updatedAt,parcel.createdAt),lastEvent:str(parcel.latestStatusEvent,parcel.lastEvent,parcel.statusRaw,parcel.status),
   shipmentType:shipmentType(homey,parcel.shipmentType),deliveryAddressType:str(parcel.deliveryAddressType),direction:str(parcel.direction),sharedFrom:str(parcel.sourceDisplayName),sourceAccountId:str(parcel.sourceAccountId),title:str(parcel.title),detailsUrl:str(parcel.detailsUrl),delivered:Boolean(parcel.delivered)
  })).sort((a,b)=>timestamp(b)-timestamp(a)).slice(0,5);
  return{authenticated:data.authenticated,packages,locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone()};
 },
 async sync({homey,body}){await getDevice(homey,body?.deviceId).sync({reason:'widget',force:true});return{ok:true};}
};
