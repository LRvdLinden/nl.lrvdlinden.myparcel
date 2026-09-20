'use strict';
function timestamp(item){return Date.parse(item?.deliveryDate||item?.deliveryWindowFrom||item?.createdAt||item?.updatedAt||0)||0;}
function safeDevices(homey,id){try{return homey.drivers.getDriver(id).getDevices();}catch(_){return [];}}
function allDevices(homey){
  const defs=[['postnl','PostNL','postnl'],['dhl-parcel','DHL','dhl'],['dpd','DPD','dpd'],['ups','UPS','ups'],['budbee','Budbee','budbee'],['homerr','Homerr','homerr']];
  return defs.flatMap(([driver,carrier,carrierId])=>safeDevices(homey,driver).map(device=>({driver,carrier,carrierId,device})));
}
module.exports={
 async getData({homey}){
  const packages=[]; const devices=allDevices(homey);
  for(const {driver,carrier,carrierId,device} of devices){
   const data=device.getWidgetData?.()||{};
   const list=driver==='postnl'?(data.packages||[]):(data.parcels||[]);
   packages.push(...list.map(parcel=>({...parcel,carrier,carrierId,carrierLogo:`${carrierId}.svg`,account:device.getName(),deviceId:device.getId(),tracking:parcel.tracking||parcel.barcode||parcel.id||'',deliveryDate:parcel.deliveryDate||parcel.deliveryWindowFrom||'',deliveryWindow:parcel.deliveryWindow||'',updatedAt:parcel.updatedAt||parcel.createdAt||'',detailsUrl:parcel.detailsUrl||''})));
  }
  packages.sort((a,b)=>{if(Boolean(a.delivered)!==Boolean(b.delivered))return a.delivered?1:-1;return timestamp(a)-timestamp(b);});
  return {packages:packages.slice(0,100),selectedDeviceCount:devices.length,locale:homey.i18n.getLanguage(),timeZone:homey.clock.getTimezone()};
 },
 async refresh({homey}){
  const devices=allDevices(homey);
  await Promise.allSettled(devices.map(({driver,device})=>driver==='postnl'?device.sync({reason:'widget',force:true}):device.refresh(true)));
  return {ok:true};
 }
};