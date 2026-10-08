'use strict';
const localizePackageStatus = require('../../lib/status-i18n');
function ids(v){if(Array.isArray(v))return v.map(String).filter(Boolean);if(typeof v!=='string')return[];return v.split(',').map(x=>x.trim()).filter(Boolean)}
function str(...v){for(const x of v){if(x===0)return'0';if(x!==undefined&&x!==null&&String(x).trim())return String(x).trim()}return''}
function shipmentType(homey,value){const raw=str(value);if(!raw)return'';return homey.i18n.getLanguage()==='nl'&&/^parcel$/i.test(raw)?'Pakket':raw}
function device(homey,raw){const wanted=ids(raw),list=homey.drivers.getDriver('postnl').getDevices(),id=wanted[0]||String(raw||'').trim(),d=list.find(x=>x.getId()===id);if(!d)throw new Error('Select a PostNL device for this widget.');return d}
function rank(p){const raw=p?.deliveryWindowFrom||p?.deliveryDate||p?.createdAt||'';const t=Date.parse(raw);return Number.isFinite(t)?t:Number.MAX_SAFE_INTEGER}
module.exports={
 async getData({homey,query}){
  const d=device(homey,query?.deviceIds||query?.deviceId),data=d.getWidgetData();
  const active=(data.packages||[]).filter(p=>!p.delivered).sort((a,b)=>rank(a)-rank(b));
  const map=p=>({id:str(p.id),sender:str(p.sender,p.title,p.sourceDisplayName,'PostNL'),receiver:str(p.receiver),tracking:str(p.barcode,p.id),status:str(p.statusRaw,p.latestStatusEvent,localizePackageStatus(homey,p.status||''),p.status),deliveryDate:str(p.deliveryDate,p.deliveryWindowFrom),deliveryWindow:str(p.deliveryWindow),deliveryWindowFrom:str(p.deliveryWindowFrom),deliveryWindowTo:str(p.deliveryWindowTo),detailsUrl:str(p.detailsUrl),createdAt:str(p.createdAt),shipmentType:shipmentType(homey,p.shipmentType),direction:str(p.direction),weight:str(p.weight),weightKg:typeof p.weightKg==='number'?p.weightKg:null,dimensions:str(p.dimensions),dimensionLengthCm:typeof p.dimensionLengthCm==='number'?p.dimensionLengthCm:null,dimensionWidthCm:typeof p.dimensionWidthCm==='number'?p.dimensionWidthCm:null,dimensionHeightCm:typeof p.dimensionHeightCm==='number'?p.dimensionHeightCm:null,canonicalStatus:str(p.canonicalStatus),observationCode:str(p.observationCode),pickup:Boolean(p.pickup),pickupPoint:str(p.pickupPoint),statusHistory:Array.isArray(p.statusHistory)?p.statusHistory.slice(-20):[]});
  return{authenticated:data.authenticated,locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone(),updatedAt:data.updatedAt||null,parcel:active[0]?map(active[0]):null,parcels:active.map(map)};
 },
 async sync({homey,body}){const d=device(homey,body?.deviceIds||body?.deviceId);await d.sync({reason:'widget',force:true});return{ok:true}}
};
