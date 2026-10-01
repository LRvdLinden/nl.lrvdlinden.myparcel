'use strict';

function clean(v){return String(v??'').trim()}
function b64urlDecode(value){let s=String(value||'').replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Buffer.from(s,'base64').toString('utf8')}
function decodeBundle(code){
  const raw=clean(code); if(!raw) throw new Error('DHL Express session code is empty.');
  let parsed;
  if(raw.startsWith('DHLEXPRESS1.')) parsed=JSON.parse(b64urlDecode(raw.slice(12)));
  else parsed=JSON.parse(raw);
  if(!parsed||typeof parsed!=='object') throw new Error('Invalid DHL Express session code.');
  return parsed;
}
function cookieHeader(cookies=[]){return cookies.filter(c=>c&&c.name).map(c=>`${c.name}=${c.value||''}`).join('; ')}
function usefulHeader(name){return /^(accept|accept-language|content-type|x-[a-z0-9-]+|authorization)$/i.test(name||'') && !/^authorization$/i.test(name||'')}
function text(v){return v==null?'':String(v).trim()}
function first(...vals){for(const v of vals){if(v===0)return'0';if(text(v))return text(v)}return''}
function isDelivered(s){return /delivered|bezorgd|zugestellt|livr[eé]|consegnato|levererad|levert|entregado|leveret|доставлен|dostarcz|배송.?완료|تم.?التسليم/i.test(text(s))}
function looksLikeAwb(v){return /^\d{10,11}$/.test(text(v))}
function statusOf(o){return first(o.statusDescription,o.statusText,o.status,o.shipmentStatus,o.currentStatus?.description,o.currentStatus?.status,o.eventDescription,o.lastEvent?.description,o.lastEvent?.status)}
function trackingOf(o){return first(o.awb,o.awbNumber,o.waybill,o.waybillNumber,o.shipmentNumber,o.trackingNumber,o.trackingNo,o.trackingId,o.pieceId,o.id && looksLikeAwb(o.id)?o.id:'')}
function normalizeShipment(o){
  const tracking=trackingOf(o); if(!tracking) return null;
  const status=statusOf(o);
  const from=first(o.deliveryWindowFrom,o.estimatedDeliveryFrom,o.etaFrom,o.windowStart,o.estimatedDelivery?.from);
  const to=first(o.deliveryWindowTo,o.estimatedDeliveryTo,o.etaTo,o.windowEnd,o.estimatedDelivery?.to);
  const deliveryDate=first(o.deliveryDate,o.estimatedDeliveryDate,o.estimatedDelivery?.date,o.eta,o.expectedDeliveryDate);
  const last=o.lastEvent||o.latestEvent||o.events?.[0]||{};
  const sender=first(o.senderName,o.shipperName,o.shipper?.name,o.origin?.name,o.from?.name,o.shipFrom?.name);
  const receiver=first(o.receiverName,o.consigneeName,o.consignee?.name,o.destination?.name,o.to?.name,o.shipTo?.name);
  const origin=first(o.origin?.city,o.originCity,o.shipper?.city,o.from?.city,o.shipFrom?.city,o.origin?.countryCode);
  const destination=first(o.destination?.city,o.destinationCity,o.consignee?.city,o.to?.city,o.shipTo?.city,o.destination?.countryCode);
  return {
    id:tracking,tracking,sender,receiver,status:status||'DHL Express',deliveryDate,
    deliveryWindow:[from,to].filter(Boolean).join(' - '),deliveryWindowFrom:from,deliveryWindowTo:to,
    service:first(o.productName,o.service,o.serviceType,o.product?.name,o.productCode),
    origin,destination,lastEvent:first(last.description,last.status,last.eventDescription,status),
    lastEventAt:first(last.timestamp,last.dateTime,last.datetime,o.lastUpdated,o.updatedAt),
    updatedAt:first(o.updatedAt,o.lastUpdated,last.timestamp,new Date().toISOString()),
    delivered:Boolean(o.delivered)||isDelivered(status),carrier:'dhl-express',raw:o,
  };
}
function collectObjects(value,out=[],depth=0){if(depth>10||value==null)return out;if(Array.isArray(value)){for(const v of value)collectObjects(v,out,depth+1);return out}if(typeof value==='object'){out.push(value);for(const v of Object.values(value))collectObjects(v,out,depth+1)}return out}
function extractShipments(payload){
  let value=payload;if(typeof value==='string'){try{value=JSON.parse(value)}catch(_){return[]}}
  const seen=new Map();
  for(const o of collectObjects(value)){
    const p=normalizeShipment(o); if(!p)continue;
    const score=Object.values(p).filter(v=>typeof v==='string'&&v).length;
    const existing=seen.get(p.tracking); if(!existing||score>existing._score)seen.set(p.tracking,{...p,_score:score});
  }
  return [...seen.values()].map(({_score,...p})=>p);
}
function candidateScore(r){const u=text(r?.url).toLowerCase();let s=0;if(/shipment|tracking|waybill|awb|manage/.test(u))s+=8;if(/api|rest|graphql|ajax/.test(u))s+=4;if(/mydhl\.express\.dhl/.test(u))s+=2;if(r?.responseText&&extractShipments(r.responseText).length)s+=30;return s}
class DHLExpressSessionClient{
  constructor({sessionCode,fetchFn=fetch,log=()=>{}}={}){this.bundle=decodeBundle(sessionCode);this.fetch=fetchFn;this.log=log}
  async _request(c){
    const headers={};for(const [k,v] of Object.entries(c.headers||{}))if(usefulHeader(k))headers[k]=v;
    const cookie=cookieHeader(this.bundle.cookies||[]);if(cookie)headers.Cookie=cookie;
    headers['User-Agent']=this.bundle.userAgent||'Mozilla/5.0';headers.Referer=c.referer||'https://mydhl.express.dhl/';
    const method=String(c.method||'GET').toUpperCase();const opts={method,headers,redirect:'follow'};if(!['GET','HEAD'].includes(method)&&c.body)opts.body=c.body;
    const res=await this.fetch(c.url,opts);const body=await res.text();if(res.status===401||res.status===403)throw new Error(`DHL Express session rejected (${res.status}).`);return{status:res.status,body,headers:Object.fromEntries(res.headers.entries())}
  }
  async fetchShipments(){
    const captured=Array.isArray(this.bundle.requests)?this.bundle.requests:[];
    const sorted=[...captured].filter(r=>/^https:\/\/mydhl\.express\.dhl\//i.test(r.url||'')).sort((a,b)=>candidateScore(b)-candidateScore(a));
    let best=[];let lastError=null;
    for(const candidate of sorted.slice(0,30)){
      try{const result=await this._request(candidate);if(result.status<200||result.status>=400)continue;const shipments=extractShipments(result.body);if(shipments.length>best.length)best=shipments;if(best.length)break}catch(e){lastError=e;this.log('[DHL Express replay]',candidate.url,e.message)}
    }
    if(!best.length){for(const c of sorted){const x=extractShipments(c.responseText||'');if(x.length>best.length)best=x}}
    if(!best.length&&lastError)throw lastError;
    return best;
  }
}
module.exports={decodeBundle,extractShipments,normalizeShipment,DHLExpressSessionClient};
