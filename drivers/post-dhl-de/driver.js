'use strict';
const Homey=require('homey'),crypto=require('crypto'),API=require('../../lib/post-dhl-de-api');
module.exports=class extends Homey.Driver{
 async onPair(session){let pkce=null;
  session.setHandler('get_auth_url',async()=>{pkce=API.createPkce();return{url:API.authUrl(pkce)}});
  session.setHandler('login',async({callback}={})=>{if(!pkce)throw new Error('Start the DHL login first.');const c=API.callback(callback);if(!c.code||c.state!==pkce.state)throw new Error('Invalid DHL login callback.');const api=new API();const t=await api.exchange(c.code,pkce.verifier);const info=await api.customer().catch(()=>({}));const shipments=await api.shipments();const key=String(info.email||info.postNumber||c.state);return{device:{name:'Post & DHL Germany',data:{id:'post-dhl-de-'+crypto.createHash('sha256').update(key).digest('hex').slice(0,24)},store:{access_token:t.accessToken,refresh_token:t.refreshToken,expires_at:api.expiresAt,postnumber:info.postNumber||'',snapshot:{parcels:shipments,letters:[],updatedAt:new Date().toISOString()}}}}});
 }
 async onRepair(session,device){let pkce=null;session.setHandler('get_auth_url',async()=>{pkce=API.createPkce();return{url:API.authUrl(pkce)}});session.setHandler('repair',async({callback}={})=>{const c=API.callback(callback);if(!pkce||c.state!==pkce.state)throw new Error('Invalid DHL login callback.');const api=new API();const t=await api.exchange(c.code,pkce.verifier);await device.updateTokens(t,api.expiresAt);return{ok:true}})}
};