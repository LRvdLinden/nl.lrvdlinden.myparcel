'use strict';
const Homey=require('homey');
const crypto=require('crypto');
const {decodeBundle}=require('../../lib/dhl-express-session');
function id(code){return crypto.createHash('sha1').update(code).digest('hex').slice(0,20)}
module.exports=class DHLExpressDriver extends Homey.Driver{
 async onInit(){
  const safe=(type,name,fn)=>{try{const c=type==='condition'?this.homey.flow.getConditionCard(name):this.homey.flow.getActionCard(name);c.registerRunListener(fn)}catch(e){this.error(name,e)}};
  safe('condition','dhl_express_packages_underway',async({device})=>device.hasPackagesUnderway());
  safe('condition','dhl_express_is_connected',async({device})=>device.isConnected());
  safe('condition','dhl_express_delivery_window_known',async({device})=>device.hasDeliveryWindow());
  safe('action','dhl_express_refresh',async({device})=>{await device.refresh(true);return true});
 }
 async onPair(session){
  session.setHandler('connect',async({sessionCode})=>{
    const code=String(sessionCode||'').trim();decodeBundle(code);
    return {device:{name:'DHL Express',data:{id:`dhl-express-${id(code)}`},settings:{session_bundle:code},capabilities:["dhl_express_parcel_count","dhl_express_total_count","dhl_express_status","dhl_express_tracking","dhl_express_sender","dhl_express_receiver","dhl_express_delivery_date","dhl_express_delivery_window","dhl_express_service","dhl_express_origin","dhl_express_destination","dhl_express_last_event","dhl_express_delivered","myparcel_connection_status","dhl_express_last_update"]}};
  });
 }
 async onRepair(session){session.setHandler('connect',async({sessionCode})=>{const code=String(sessionCode||'').trim();decodeBundle(code);const d=session.getDevice();await d.setSettings({session_bundle:code});await d.refresh(true);return true})}
};
