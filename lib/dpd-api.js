'use strict';
const KC='https://login.dpdgroup.com/auth/realms/login/protocol/openid-connect/token';
const BASE='https://www.dpdgroup.com/concept/webservice';
const BASIC='bXlEUEQgTW9iaWxlIEFwcDpaMVdzeTQ4RGpseWcweDdVWjhvWTlYdmZIT2xIbW4yTmpJdnYycmpVVjY3N1hDOGhiTGlkNHY2OWpCQzlvZnpU';
const UA='okhttp/4.12.0';
async function json(res){let t=await res.text();let b={};try{b=JSON.parse(t)}catch{};if(!res.ok){let e=new Error(b.error_description||b.error||`HTTP ${res.status}`);e.status=res.status;throw e}return b}
class DpdApi{
 constructor(email,password,bu='DPD-NL'){this.email=email;this.password=password;this.bu=bu;this.token=null}
 async login(){let r=await fetch(KC,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','user-agent':UA},body:new URLSearchParams({client_id:'MOBILE-APP-PROD',grant_type:'password',scope:'openid',username:this.email,password:this.password})});let k=await json(r);if(!k.access_token){let e=new Error('DPD login failed');e.auth=true;throw e}
  r=await fetch(`${BASE}/oauth/token?grant_type=client_credentials`,{method:'POST',headers:{authorization:`Basic ${BASIC}`,'content-type':'application/json','user-agent':UA}});let g=await json(r);
  r=await fetch(`${BASE}/users/login/consignee-sso?bu=${encodeURIComponent(this.bu)}`,{method:'POST',headers:{authorization:`Bearer ${g.access_token}`,'content-type':'text/plain','user-agent':UA},body:k.access_token});let d=await json(r);if(!d.access_token){let e=new Error('DPD account token missing');e.auth=true;throw e}this.token=d.access_token;return d.access_token}
 async parcels(){if(!this.token)await this.login();let body={incomingParcels:[],sendingParcels:[],confirmedParcels:null,shipmentCollections:[],confirmedShipmentCollections:null};let r=await fetch(`${BASE}/v7/parcels?bu=${encodeURIComponent(this.bu)}&lang=en`,{method:'POST',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json','user-agent':UA},body:JSON.stringify(body)});if(r.status===401||r.status===403){await this.login();r=await fetch(`${BASE}/v7/parcels?bu=${encodeURIComponent(this.bu)}&lang=en`,{method:'POST',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json','user-agent':UA},body:JSON.stringify(body)})}return json(r)}
}
module.exports={DpdApi};
