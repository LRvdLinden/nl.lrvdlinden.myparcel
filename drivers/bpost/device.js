const localizePackageStatus = require('../../lib/status-i18n.js');
'use strict';
const Homey=require('homey');const {BpostApi}=require('../../lib/bpost-api');
function refs(s){try{const a=JSON.parse(s.tracking_numbers_json||'[]');return Array.isArray(a)?a:[]}catch(_){return[]}}
function pick(o,...ks){for(const k of ks){const v=o?.[k];if(v!==undefined&&v!==null&&v!=='')return v}return''}
function objText(v){if(!v)return'';if(typeof v==='string'||typeof v==='number')return String(v);return String(pick(v,'name','description','label','value','code')||'')}
function normalize(p,fallback=''){
 const events=Array.isArray(p?.events)?p.events:[],last=events[0]||events.at(-1)||{},eta=p?.eta||{},dp=p?.deliveryPoint||{},sender=p?.sender||{},product=p?.product||{};
 const tracking=String(pick(p,'itemCode','barcode','trackingCode','senderBarcode','itemId','uniqueID')||fallback);
 const status=objText(pick(p,'currentStatus','parcelMainStatus','status','activeStep'))||objText(last)||'Unknown';
 const delivered=/delivered|geleverd|livré|zugestellt|afgeleverd/i.test(status)||Boolean(p?.actualDeliveryTime);
 const date=objText(pick(p,'estimatedDeliveryDateTime','currentDeliveryDate','expectedDeliveryDate','deliveryDate'))||objText(pick(eta,'day','date'));
 const t1=objText(pick(eta,'time1','from','start')),t2=objText(pick(eta,'time2','to','end'));
 const point=[pick(dp,'name'),[pick(dp,'street'),pick(dp,'streetNumber')].filter(Boolean).join(' '),[pick(dp,'postcode'),pick(dp,'municipality')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
 const eventAt=pick(last,'dateTime','timestamp','date')||pick(p,'latestEventTime');return{id:String(pick(p,'uniqueID','itemId','parcelId')||tracking),tracking,sender:objText(sender)||String(pick(p,'senderName','sellerName')||'bpost'),status,deliveryDate:date,deliveryWindow:[t1,t2].filter(Boolean).join(' - '),deliveryWindowFrom:String(t1||''),deliveryWindowTo:String(t2||''),deliveryPoint:point,weight:String(pick(p,'weightInGrams','weight')||''),product:objText(product)||String(pick(p,'productDescription','productCode','productType')||''),partner:String(pick(p,'partnerName','serviceProvider')||''),lastEvent:objText(last)||status,lastEventAt:String(eventAt||''),createdAt:String(pick(p,'itemCreatedOn','orderCreationDate')||''),updatedAt:String(eventAt||pick(p,'itemCreatedOn','orderCreationDate')||new Date().toISOString()),delivered,detailsUrl:tracking?`https://track.bpost.cloud/btr/web/#/search?lang=en&itemCode=${encodeURIComponent(tracking)}`:''}
}
module.exports=class BpostDevice extends Homey.Device{
 async onInit(){this._packages=[];this._timer=this.homey.setInterval(()=>this.refresh(false),5*60*1000);this.homey.setTimeout(()=>this.refresh(true),3000)}
 async onDeleted(){if(this._timer)this.homey.clearInterval(this._timer)}
 async authNotice(){if(this.getStoreValue('bpostAuthNotice'))return;await this.homey.notifications.createNotification({excerpt:'Reconnect My bpost – the saved login was rejected.'}).catch(()=>{});await this.setStoreValue('bpostAuthNotice',true)}
 async accountRows(settings){
  const api=new BpostApi({email:settings.account_email,password:settings.account_password});
  const parcels=await api.accountParcels();
  return parcels.map(p=>normalize(p));
 }
 async manualRows(settings){const api=new BpostApi(),out=[];for(const r of refs(settings)){try{const p=await api.publicParcel(r.barcode,r.postalCode);if(p)out.push(normalize(p,r.barcode))}catch(e){this.error(`bpost ${r.barcode}:`,e)}}return out}
 async refresh(){
  const s=this.getSettings();let rows=[],connected=false;
  try{
   if(s.account_email&&s.account_password){rows=await this.accountRows(s);connected=true}else rows=await this.manualRows(s);
   await this.setStoreValue('bpostAuthNotice',false);await this.setAvailable();
  }catch(e){this.error(e);if([401,403].includes(e.status)){await this.authNotice();await this.setUnavailable('My bpost account must be reconnected').catch(()=>{})}else await this.setUnavailable(`bpost: ${e.message}`).catch(()=>{});return false}
  rows.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const old=new Map((this._packages||[]).map(x=>[x.id,x]));this._packages=rows;
  for(const p of rows){const x=old.get(p.id),t=this.tokens(p);if(!x)await this.homey.flow.getDeviceTriggerCard('bpost_new_package').trigger(this,t,{}).catch(()=>{});else if(x.status!==p.status)await this.homey.flow.getDeviceTriggerCard('bpost_status_changed').trigger(this,{...t,previous_status:localizePackageStatus(this.homey,x.status)||''},{}).catch(()=>{});if(!p.delivered&&p.deliveryDate&&(!x||x.deliveryDate!==p.deliveryDate))await this.homey.flow.getDeviceTriggerCard('bpost_delivery_updated').trigger(this,t,{}).catch(()=>{});if(p.delivered&&x&&!x.delivered)await this.homey.flow.getDeviceTriggerCard('bpost_delivered').trigger(this,t,{}).catch(()=>{})}
  const active=rows.filter(x=>!x.delivered),n=active[0]||rows[0]||{};
  const vals={bpost_parcel_count:active.length,bpost_total_count:rows.length,bpost_status:n.status?localizePackageStatus(this.homey,n.status):'No parcels',bpost_tracking:n.tracking||'',bpost_sender:n.sender||'',bpost_delivery_date:n.deliveryDate||'',bpost_delivery_window:n.deliveryWindow||'',bpost_delivery_point:n.deliveryPoint||'',bpost_weight:n.weight?`${n.weight} g`:'',bpost_product:n.product||'',bpost_partner:n.partner||'',bpost_last_event:n.lastEvent||'',bpost_account_status:this.homey.app.getConnectionLabel(true),bpost_last_update:new Date().toISOString()};
  for(const [k,v] of Object.entries(vals))if(this.hasCapability(k))await this.setCapabilityValue(k,v);
  return true
 }
 tokens(p){return{tracking:p.tracking||'',status:localizePackageStatus(this.homey, p.status)||'',sender:p.sender||'',delivery_date:p.deliveryDate||'',delivery_window:p.deliveryWindow||'',delivery_point:p.deliveryPoint||'',weight:p.weight||'',product:p.product||'',partner:p.partner||'',last_event:p.lastEvent||''}}
 getWidgetData(){return{parcels:this._packages||[],authenticated:this.getCapabilityValue('bpost_account_status')!=='Reconnect required',carrier:'bpost'}}
};