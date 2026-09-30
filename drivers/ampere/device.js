'use strict';
const Homey = require('homey');
module.exports = class AmpereDevice extends Homey.Device {
  async onInit() {
    this._parcels=[];
    this._timer=this.homey.setInterval(()=>this.refresh(false).catch(error=>this.error(error)),15*60*1000);
    this.homey.setTimeout(()=>this.refresh(true),3000);
  }
  async onDeleted(){if(this._timer)this.homey.clearInterval(this._timer);}
  async refresh(){
    const url=String(this.getSetting('tracking_url')||'').trim();
    const valid=/^https:\/\/bol\.prd\.amperebezorgt\.nl(?:\/|$)/i.test(url);
    this._parcels=[];
    await this.setCapabilityValue('ampere_parcel_count',0);
    await this.setCapabilityValue('ampere_status',valid?this.homey.__('common_status.connected'):this.homey.__('common_status.disconnected'));
    await this.setCapabilityValue('myparcel_connection_status',valid?this.homey.__('common_status.connected'):this.homey.__('common_status.disconnected')).catch(()=>{});
    await this.setCapabilityValue('ampere_last_update',new Date().toISOString());
    if(valid)await this.setAvailable();else await this.setUnavailable('Ampère Track & Trace link required').catch(()=>{});
    return valid;
  }
  getWidgetData(){return {parcels:this._parcels||[],authenticated:/^https:\/\/bol\.prd\.amperebezorgt\.nl(?:\/|$)/i.test(String(this.getSetting('tracking_url')||'')),carrier:'ampere'};}
};
