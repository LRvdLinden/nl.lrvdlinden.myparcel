'use strict';
const Homey=require('homey');
module.exports=class MyParcelApp extends Homey.App{
 async onInit(){
  this._postInterval=this.homey.setInterval(()=>this.syncPostNL('interval'),5*60*1000);
  this._midnightInterval=this.homey.setInterval(()=>this._midnightCheck(),60*1000);
  this.homey.setTimeout(()=>this.syncPostNL('startup'),10000);
  this.log(`MyParcel ${Homey.manifest.version} initialized`);
 }
 async onUninit(){if(this._postInterval)this.homey.clearInterval(this._postInterval);if(this._midnightInterval)this.homey.clearInterval(this._midnightInterval);}
 getPostNLDevices(){try{return this.homey.drivers.getDriver('postnl').getDevices();}catch(_){return[];}}
 getDHLDevices(){try{return this.homey.drivers.getDriver('dhl-parcel').getDevices();}catch(_){return[];}}
 async syncPostNL(reason='manual'){await Promise.allSettled(this.getPostNLDevices().map(d=>d.sync({reason,force:reason!=='interval'})));}
 async _midnightCheck(){const f=new Intl.DateTimeFormat('en-GB',{timeZone:this.homey.clock.getTimezone(),hour:'2-digit',minute:'2-digit',hour12:false});const [h,m]=f.format(new Date()).split(':').map(Number);if(h===0&&[1,6,11,16,21,31,46].includes(m))await this.syncPostNL('midnight');}
};
