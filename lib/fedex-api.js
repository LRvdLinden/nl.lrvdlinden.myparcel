'use strict';
const AUTH='https://apis.fedex.com/oauth/token';
const TRACK='https://apis.fedex.com/track/v1/trackingnumbers';
class FedExApiError extends Error{constructor(message,status=0,body=null){super(message);this.name='FedExApiError';this.status=status;this.body=body}}
async function read(res){const text=await res.text();try{return text?JSON.parse(text):{}}catch{return{text}}}
class FedExApi{
 constructor({clientId,clientSecret,accessToken='',expiresAt=0}){this.clientId=clientId||'';this.clientSecret=clientSecret||'';this.accessToken=accessToken||'';this.expiresAt=Number(expiresAt||0)}
 async authenticate(force=false){if(!force&&this.accessToken&&Date.now()<this.expiresAt-60000)return this.accessToken;const res=await fetch(AUTH,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'client_credentials',client_id:this.clientId,client_secret:this.clientSecret})});const data=await read(res);if(!res.ok||!data.access_token)throw new FedExApiError(data.errors?.[0]?.message||data.error_description||data.error||'FedEx authorization failed',res.status,data);this.accessToken=data.access_token;this.expiresAt=Date.now()+Number(data.expires_in||3600)*1000;return this.accessToken}
 async track(number){await this.authenticate();const payload={includeDetailedScans:true,trackingInfo:[{trackingNumberInfo:{trackingNumber:String(number)}}]};let res=await fetch(TRACK,{method:'POST',headers:{Authorization:`Bearer ${this.accessToken}`,'Content-Type':'application/json','X-locale':'en_US'},body:JSON.stringify(payload)});if(res.status===401){await this.authenticate(true);res=await fetch(TRACK,{method:'POST',headers:{Authorization:`Bearer ${this.accessToken}`,'Content-Type':'application/json','X-locale':'en_US'},body:JSON.stringify(payload)})}const data=await read(res);if(!res.ok)throw new FedExApiError(data.errors?.[0]?.message||`FedEx Track HTTP ${res.status}`,res.status,data);return data}
}
module.exports={FedExApi,FedExApiError};
