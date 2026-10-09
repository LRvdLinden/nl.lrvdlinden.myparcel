'use strict';
const { statusLabel, statusKey, eventText } = require('../../lib/widget-status.js');

function timestamp(item) {
  const value = item?.deliveryDate || item?.deliveryWindowFrom || item?.updatedAt || item?.createdAt || 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}
function selectedIds(value) { if (Array.isArray(value)) return value.map(String).filter(Boolean); if (typeof value !== 'string') return []; return value.split(',').map(item => item.trim()).filter(Boolean); }
function safeDevices(homey, id) { try { return homey.drivers.getDriver(id).getDevices(); } catch (_) { return []; } }
function allDevices(homey) {
  const defs = [['postnl','PostNL','postnl'],['dhl-parcel','DHL','dhl'],['dhl-express','DHL Express','dhl-express'],['dpd','DPD','dpd'],['ups','UPS','ups'],['budbee','Budbee','budbee'],['homerr','Homerr','homerr'],['fedex','FedEx','fedex'],['gls','GLS','gls'],['inpost-uk','InPost UK','inpost-uk'],['bpost','bpost','bpost'],['royal-mail','Royal Mail','royal-mail'],['post-dhl-de','DHL Germany','dhl-de'],['ampere','Ampère','ampere']];
  return defs.flatMap(([driver,carrier,carrierId]) => safeDevices(homey,driver).map(device => ({driver,carrier,carrierId,device})));
}
function wantsAll(value){return value===true||value==='1'||value==='true'}
function selectedDevices(homey, value, all=false) { const ids=selectedIds(value),devices=allDevices(homey); if(all)return devices; if(!ids.length)return[];const wanted=new Set(ids);return devices.filter(({device})=>wanted.has(String(device.getId()))); }
function str(...values){for(const value of values){if(value===0)return'0';if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim();}return'';}
const WIDGET_REFRESH_MIN_MS=5*60*1000,lastRefresh=new Map();
function due(device){const id=String(device.getId?.()||'');const last=lastRefresh.get(id)||0;if(Date.now()-last<WIDGET_REFRESH_MIN_MS)return false;lastRefresh.set(id,Date.now());return true}
module.exports={
 async getData({homey,query}){
  const devices=selectedDevices(homey,query?.deviceIds||query?.deviceId,wantsAll(query?.all)),packages=[];
  for(const {driver,carrier,carrierId,device} of devices){
   const data=device.getWidgetData?.()||{},list=driver==='postnl'?(data.packages||[]):(data.parcels||[]);
   packages.push(...list.map(parcel=>{
    const tracking=str(parcel.tracking,parcel.barcode,parcel.shipmentNumber,parcel.id);
    return {
     carrier,carrierId,carrierLogo:carrierId==='dhl-de'?'dhl.svg':carrierId==='ampere'?'ampere.png':`${carrierId}.svg`,account:device.getName(),deviceId:device.getId(),
     tracking,reference:str(parcel.reference),status:statusLabel(homey,parcel),statusKey:statusKey(parcel),sender:str(parcel.sender,parcel.title,parcel.sourceDisplayName),receiver:str(parcel.receiver),
     deliveryDate:str(parcel.deliveryDate,parcel.deliveryWindowFrom),deliveryWindow:str(parcel.deliveryWindow),deliveryWindowFrom:str(parcel.deliveryWindowFrom),deliveryWindowTo:str(parcel.deliveryWindowTo),
     updatedAt:str(parcel.updatedAt,parcel.createdAt),createdAt:str(parcel.createdAt),eventAt:str(parcel.lastEventAt,parcel.eventAt,parcel.delivered?parcel.deliveryDate:'',parcel.updatedAt,parcel.createdAt),lastEventAt:str(parcel.lastEventAt,parcel.eventAt,parcel.delivered?parcel.deliveryDate:'',parcel.updatedAt,parcel.createdAt),
     service:str(parcel.service),deliveryPoint:str(parcel.deliveryPoint),weight:str(parcel.weight),dimensions:str(parcel.dimensions),product:str(parcel.product),partner:str(parcel.partner),lastEvent:eventText(homey,str(parcel.lastEvent,parcel.latestStatusEvent,parcel.statusRaw,parcel.status)),carrierState:str(parcel.carrierState),carrierResolution:str(parcel.carrierResolution),
     shipFrom:str(parcel.shipFrom),shipTo:str(parcel.shipTo),accessPoint:str(parcel.accessPoint),shipmentType:str(parcel.shipmentType),direction:str(parcel.direction),
     title:str(parcel.title),delivered:Boolean(parcel.delivered),
    };
   }));
  }
  packages.sort((a,b)=>timestamp(b)-timestamp(a));
  return {packages:packages.slice(0,100),selectedDeviceCount:devices.length,locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone()};
 },
 async refresh({homey,body}){const devices=selectedDevices(homey,body?.deviceIds||body?.deviceId,wantsAll(body?.all));await Promise.allSettled(devices.filter(({device})=>due(device)).map(({driver,device})=>driver==='postnl'?device.sync({reason:'widget',force:true}):device.refresh(true)));return{ok:true};}
};
