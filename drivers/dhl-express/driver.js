'use strict';
const Homey=require('homey');
const crypto=require('crypto');
const DHLExpressAccountApi=require('../../lib/dhl-express-account');
const {decodeBundle}=require('../../lib/dhl-express-session');

function stableId(value){return crypto.createHash('sha256').update(String(value||'').trim().toLowerCase()).digest('hex').slice(0,24)}

module.exports=class DHLExpressDriver extends Homey.Driver{
  async onInit(){
    const safe=(type,name,fn)=>{try{const c=type==='condition'?this.homey.flow.getConditionCard(name):this.homey.flow.getActionCard(name);c.registerRunListener(fn)}catch(e){this.error(name,e)}};
    safe('condition','dhl_express_packages_underway',async({device})=>device.hasPackagesUnderway());
    safe('condition','dhl_express_is_connected',async({device})=>device.isConnected());
    safe('condition','dhl_express_delivery_window_known',async({device})=>device.hasDeliveryWindow());
    safe('action','dhl_express_refresh',async({device})=>{await device.refresh(true);return true});
  }

  async _validateDirect(email,password,otp=''){
    const api=new DHLExpressAccountApi({fetch,email,password,otp,log:(...args)=>this.log('[DHLExpressPair]',...args)});
    await api.login();
    const parcels=await api.getParcels();
    return {api,parcels};
  }

  async onPair(session){
    session.setHandler('login_dhl_express',async({email,password,otp}={})=>{
      const normalized=String(email||'').trim().toLowerCase();
      if(!normalized||!password)throw new Error('Vul je DHL Express e-mailadres en wachtwoord in.');
      const result=await this._validateDirect(normalized,password,otp||'');
      return {device:{
        name:'DHL Express',
        data:{id:`dhl-express-${stableId(normalized)}`},
        store:{
          auth_mode:'direct',
          email:normalized,
          password:String(password),
          otp:'',
          snapshot:Array.isArray(result.parcels)?result.parcels:[],
          connected:true
        }
      }};
    });

    session.setHandler('connect_helper',async({sessionCode}={})=>{
      const code=String(sessionCode||'').trim();
      decodeBundle(code);
      return {device:{
        name:'DHL Express',
        data:{id:`dhl-express-helper-${stableId(code)}`},
        store:{auth_mode:'helper',session_bundle:code,snapshot:[],connected:false}
      }};
    });
  }

  async onRepair(session,device){
    session.setHandler('login_dhl_express',async({email,password,otp}={})=>{
      const normalized=String(email||'').trim().toLowerCase();
      await this._validateDirect(normalized,password,otp||'');
      await device.updateDirectCredentials(normalized,password);
      return {ok:true};
    });
    session.setHandler('connect_helper',async({sessionCode}={})=>{
      const code=String(sessionCode||'').trim();decodeBundle(code);
      await device.updateHelperSession(code);
      return {ok:true};
    });
  }
};
