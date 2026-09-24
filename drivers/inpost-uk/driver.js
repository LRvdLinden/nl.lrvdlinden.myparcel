'use strict';
const Homey=require('homey');const crypto=require('crypto');const {InPostUkApi}=require('../../lib/inpost-uk-api');
const parse=v=>[...new Set(String(v||'').split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean))];
module.exports=class InPostUkDriver extends Homey.Driver{
 async onInit(){this.homey.flow.getConditionCard('inpost_uk_packages_underway').registerRunListener(async({device})=>(device.getCapabilityValue('inpost_uk_parcel_count')||0)>0);this.homey.flow.getActionCard('inpost_uk_refresh').registerRunListener(async({device})=>device.refresh(true));}
 async onPair(s){s.setHandler('connect',async data=>{const codes=parse(data.trackingCodes);if(!codes.length)throw new Error('Enter at least one InPost UK parcel number.');const p=await new InPostUkApi().parcel(codes[0]);if(!p)throw new Error('InPost UK does not know this parcel number yet.');return{device:{name:'InPost UK',data:{id:`inpost-uk-${crypto.randomBytes(8).toString('hex')}`},settings:{tracking_numbers_json:JSON.stringify(codes)},capabilities:['inpost_uk_parcel_count','inpost_uk_status','inpost_uk_last_update']}}});}
 async onRepair(s){s.setHandler('connect',async data=>{const d=s.getDevice(),codes=parse(data.trackingCodes);if(!codes.length)throw new Error('Enter at least one InPost UK parcel number.');await d.setSettings({tracking_numbers_json:JSON.stringify(codes)});await d.refresh(true);return true;});}
};