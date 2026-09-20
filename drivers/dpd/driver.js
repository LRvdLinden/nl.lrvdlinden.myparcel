'use strict';
const Homey=require('homey'); const {DpdApi}=require('../../lib/dpd-api');
module.exports=class DpdDriver extends Homey.Driver{
 async onInit(){this.homey.flow.getConditionCard('dpd_packages_underway').registerRunListener(async({device})=>(device.getCapabilityValue('dpd_parcel_count')||0)>0);this.homey.flow.getActionCard('dpd_refresh').registerRunListener(async({device})=>device.refresh(true));}
 async onPair(session){session.setHandler('login',async({email,password})=>{const api=new DpdApi(email,password);await api.login();return {device:{name:`DPD / myDPD (${email})`,data:{id:'dpd-'+email.toLowerCase()},settings:{email,password,bu:'DPD-NL'},capabilities:['dpd_parcel_count','dpd_status','dpd_last_update']}}});}
 async onRepair(session){session.setHandler('login',async({email,password})=>{const api=new DpdApi(email,password);await api.login();const d=session.getDevice();await d.setSettings({email,password,bu:'DPD-NL'});await d.setAvailable();await d.refresh(true);return true});}
};