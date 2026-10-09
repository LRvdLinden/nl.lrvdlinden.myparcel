'use strict';
const crypto=require('crypto');
const CLIENT_ID='QVozbVdwYkdXY0VFUnM2MXMwWVJxaWc2Y2JHaEZQWVhSSkxN';
const INTERFACE_KEY='a873620de9654fa4a86c83ae8cd431bd';
const API_VERSION='7';
const SCOPE='PARCELS PUSH LABELS BASIC ADDRESSES USERDATA PACKSTATION PAYMENT';
const b64=b=>Buffer.from(b).toString('base64url');
async function body(r){const t=await r.text();try{return t?JSON.parse(t):{}}catch{return{text:t}}}
class API{
 constructor({accessToken='',refreshToken='',expiresAt=0,onTokens=null}={}){this.accessToken=accessToken;this.refreshToken=refreshToken;this.expiresAt=expiresAt;this.onTokens=onTokens;this._refreshing=null}
 static createPkce(){const verifier=b64(crypto.randomBytes(32));return{state:b64(crypto.randomBytes(32)),verifier,challenge:b64(crypto.createHash('sha256').update(verifier).digest())}}
 static authUrl(p){const q=new URLSearchParams({response_type:'code',client_id:CLIENT_ID,scope:SCOPE,state:p.state,code_challenge:p.challenge,code_challenge_method:'S256'});return`https://mobil.dhl.de/oauth-web/oauth/grant?${q}`}
 static callback(raw){let u;try{u=new URL(String(raw).trim())}catch(_){return{state:null,code:null}}const h=new URLSearchParams((u.hash||'').replace(/^#/,'')),q=new URLSearchParams(u.search||'');return{state:h.get('state')||q.get('state'),code:h.get('code')||q.get('code')}}
 headers(auth=true){const h={'Client_id':CLIENT_ID,'Interface-Key':INTERFACE_KEY,'Emmi-Api-Version':API_VERSION,'Content-Type':'application/json; charset=utf-8'};if(auth&&this.accessToken)h.Authorization=`Bearer ${this.accessToken}`;return h}
 async exchange(code,verifier){const h=this.headers(false);h.Authorization=`Grant ${code}`;h.Code_verifier=verifier;const r=await fetch('https://app.dhl.de/oauth/grant/exchange',{method:'POST',headers:h,body:JSON.stringify({code_verifier:verifier})});const d=await body(r);if(!r.ok)throw Object.assign(new Error(d.errorText||d.message||`DHL HTTP ${r.status}`),{status:r.status});this.setTokens(d);return d}
 // Rotated tokens are handed to onTokens right away, so a failing request afterwards cannot lose them.
 setTokens(d){this.accessToken=d.accessToken||this.accessToken;this.refreshToken=d.refreshToken||this.refreshToken;this.expiresAt=Date.now()+Number(d.accessValidity||3600000)-60000;if(typeof this.onTokens==='function')this.onTokens({accessToken:this.accessToken,refreshToken:this.refreshToken,expiresAt:this.expiresAt})}
 async refreshTokenIfNeeded(force=false){if(!this.refreshToken)return;if(!force&&this.accessToken&&Date.now()<this.expiresAt)return;if(this._refreshing)return this._refreshing;this._refreshing=this._doRefresh().finally(()=>{this._refreshing=null});return this._refreshing}
 async _doRefresh(){const h=this.headers(false);h.Authorization=`Refresh ${this.refreshToken}`;const r=await fetch('https://app.dhl.de/oauth/token/request',{method:'POST',headers:h});const d=await body(r);if(!r.ok)throw Object.assign(new Error(d.errorText||d.message||`DHL HTTP ${r.status}`),{status:r.status});this.setTokens(d)}
 async request(url,opt={}){await this.refreshTokenIfNeeded();let r=await fetch(url,{...opt,headers:{...this.headers(),...(opt.headers||{})}});if(r.status===401&&this.refreshToken){await this.refreshTokenIfNeeded(true);r=await fetch(url,{...opt,headers:{...this.headers(),...(opt.headers||{})}})}const d=await body(r);if(!r.ok)throw Object.assign(new Error(d.errorText||d.message||`DHL HTTP ${r.status}`),{status:r.status});return d}
 async shipments(){return this.request('https://app.dhl.de/shipments',{method:'POST',body:JSON.stringify({shipmentsInCache:{archivedShipmentsInCache:[],completedShipmentsInCache:[]},includeCurrent:true,includeArchived:false,languageCode:'de'})})}
 async customer(){return this.request('https://app.dhl.de/customer-information')}
 // Briefankündigung is intentionally not guessed: current public documentation confirms the
 // feature but does not publish its consumer endpoint. A captured endpoint can be added here
 // without changing the driver/widget architecture.
 async letters(){return[]}
}
module.exports=API;
