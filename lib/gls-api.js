'use strict';
class GlsApiError extends Error{constructor(message,status=0,body=null){super(message);this.name='GlsApiError';this.status=status;this.body=body}}
async function read(res){const text=await res.text();try{return text?JSON.parse(text):{}}catch{return{text}}}
class GlsApi{
 constructor({username,password,subscriptionKey,trackUrlTemplate,parcelListUrl}){this.username=username||'';this.password=password||'';this.subscriptionKey=subscriptionKey||'';this.trackUrlTemplate=trackUrlTemplate||'';this.parcelListUrl=parcelListUrl||''}
 headers(){return{Accept:'application/json','Content-Type':'application/json','Ocp-Apim-Subscription-Key':this.subscriptionKey,'X-MyGLS-Username':this.username,'X-MyGLS-Password':this.password}}
 url(number){const n=encodeURIComponent(String(number));if(!this.trackUrlTemplate)throw new GlsApiError('GLS Track & Trace endpoint is missing');if(this.trackUrlTemplate.includes('{tracking}'))return this.trackUrlTemplate.replaceAll('{tracking}',n);return `${this.trackUrlTemplate}${this.trackUrlTemplate.includes('?')?'&':'?'}parcelNo=${n}`}
 async track(number){const res=await fetch(this.url(number),{headers:this.headers()});const data=await read(res);if(!res.ok)throw new GlsApiError(data.message||data.error||data.title||`GLS HTTP ${res.status}`,res.status,data);return data}
 async findParcels(days=21){
   if(!this.parcelListUrl)throw new GlsApiError('GLS parcel-list endpoint is missing');
   const to=new Date(),from=new Date(Date.now()-Math.max(1,Number(days)||21)*86400000);
   const date=d=>d.toISOString().slice(0,10);
   const res=await fetch(this.parcelListUrl,{method:'POST',headers:this.headers(),body:JSON.stringify({DateFrom:date(from),DateTo:date(to)})});
   const data=await read(res);if(!res.ok)throw new GlsApiError(data.message||data.error||data.title||`GLS HTTP ${res.status}`,res.status,data);
   const list=data.UnitItems||data.unitItems||data.parcels||data.items||[];
   return Array.isArray(list)?list:[];
 }
}
module.exports={GlsApi,GlsApiError};
