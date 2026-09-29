'use strict';
const localizePackageStatus = require('../../lib/status-i18n.js');

const DEFS = [
  ['postnl','PostNL','postnl'],['dhl-parcel','DHL','dhl'],['dpd','DPD','dpd'],['ups','UPS','ups'],
  ['budbee','Budbee','budbee'],['homerr','Homerr / Vinted Go','homerr'],['fedex','FedEx','fedex'],
  ['gls','GLS','gls'],['inpost-uk','InPost UK','inpost-uk'],['bpost','bpost','bpost'],
  ['royal-mail','Royal Mail','royal-mail'],['post-dhl-de','Post & DHL Germany','dhl-de'],
];
function selectedIds(value){if(Array.isArray(value))return value.map(String).filter(Boolean);if(typeof value!=='string')return[];return value.split(',').map(v=>v.trim()).filter(Boolean)}
function safeDevices(homey,id){try{return homey.drivers.getDriver(id).getDevices()}catch(_){return[]}}
function allDevices(homey){return DEFS.flatMap(([driver,carrier,carrierId])=>safeDevices(homey,driver).map(device=>({driver,carrier,carrierId,device})))}
function selectedDevices(homey,value){const ids=selectedIds(value),all=allDevices(homey);if(!ids.length)return all;const wanted=new Set(ids);return all.filter(({device})=>wanted.has(String(device.getId())))}
function str(...values){for(const value of values){if(value===0)return'0';if(value!==undefined&&value!==null&&String(value).trim())return String(value).trim()}return''}
function delivered(homey,p){if(p?.delivered===true)return true;const s=localizePackageStatus(homey,p?.status||'')||String(p?.status||'');return /delivered|bezorgd|zugestellt|livré|consegnato|levererad|levert|entregado|leveret|доставлен|dostarcz|배송\s*완료|تم\s*التسليم/i.test(s)}
function time(item){for(const v of [item.deliveryWindowFrom,item.deliveryDate,item.updatedAt,item.createdAt]){const n=Date.parse(v||'');if(Number.isFinite(n))return n}return Number.MAX_SAFE_INTEGER}
function normalize(homey,{driver,carrier,carrierId,device},parcel){
 const tracking=str(parcel.tracking,parcel.barcode,parcel.shipmentNumber,parcel.id);
 return {
  carrier,carrierId,carrierLogo:carrierId==='dhl-de'?'dhl.svg':`${carrierId}.svg`,account:device.getName(),deviceId:device.getId(),driver,
  tracking,status:localizePackageStatus(homey,parcel.status||'')||str(parcel.status),sender:str(parcel.sender,parcel.title,parcel.sourceDisplayName),receiver:str(parcel.receiver),
  deliveryDate:str(parcel.deliveryDate,parcel.deliveryWindowFrom),deliveryWindow:str(parcel.deliveryWindow),deliveryWindowFrom:str(parcel.deliveryWindowFrom),deliveryWindowTo:str(parcel.deliveryWindowTo),
  updatedAt:str(parcel.updatedAt,parcel.createdAt),createdAt:str(parcel.createdAt),lastEvent:localizePackageStatus(homey,str(parcel.lastEvent,parcel.status)),
  deliveryPoint:str(parcel.deliveryPoint),direction:str(parcel.direction),delivered:delivered(homey,parcel),title:str(parcel.title),
 };
}
async function collect(homey,value){
 const devices=selectedDevices(homey,value),rows=[];
 for(const def of devices){const data=def.device.getWidgetData?.()||{},list=def.driver==='postnl'?(data.packages||[]):(data.parcels||[]);for(const p of list){const row=normalize(homey,def,p);if(!row.delivered)rows.push(row)}}
 rows.sort((a,b)=>time(a)-time(b));
 return {devices,rows};
}
module.exports={
 async getData({homey,query}){const {devices,rows}=await collect(homey,query?.deviceIds||query?.deviceId);return{deliveries:rows.slice(0,25),selectedDeviceCount:devices.length,locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone()};},
 async refresh({homey,body}){const {devices}=await collect(homey,body?.deviceIds||body?.deviceId);await Promise.allSettled(devices.map(({driver,device})=>driver==='postnl'?device.sync({reason:'myparcel-delivery-widget',force:true}):device.refresh?.(true)));return{ok:true};},
};
