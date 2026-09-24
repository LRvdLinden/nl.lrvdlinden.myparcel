'use strict';

class BpostApiError extends Error {
  constructor(message,status=0,body=null){super(message);this.name='BpostApiError';this.status=status;this.body=body;}
}
const LOGIN='https://www.bpost.be/nl/saml_login?destination=%2Fnl%2Fmijn-bpost';
const HOME='https://www.bpost.be/nl/mijn-bpost?check_logged_in=1';
const HISTORY='https://www.bpost.be/nl/parcels-history';
const TRACK='https://track.bpost.cloud/track/items?itemIdentifier=';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function decode(s=''){return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function forms(html=''){
  const out=[]; for(const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)){
    const a=m[1],body=m[2],action=decode((a.match(/\baction=["']([^"']*)/i)||[])[1]||''),method=((a.match(/\bmethod=["']([^"']*)/i)||[])[1]||'get').toLowerCase(),inputs={};
    for(const i of body.matchAll(/<input\b([^>]*)>/gi)){const x=i[1],n=(x.match(/\bname=["']([^"']*)/i)||[])[1];if(n)inputs[decode(n)]=decode((x.match(/\bvalue=["']([^"']*)/i)||[])[1]||'');}
    out.push({action,method,inputs});
  } return out;
}
function trackingLinks(html=''){
  const rows=[],seen=new Set();
  for(const m of html.matchAll(/href=["']([^"']*(?:itemCode|itemCodes)[^"']*)["']/gi)){
    const href=decode(m[1]); let u; try{u=new URL(href,'https://www.bpost.be')}catch(_){continue}
    const queries=[u.searchParams]; if(u.hash.includes('?'))queries.push(new URLSearchParams(u.hash.split('?')[1]));
    for(const q of queries){const pc=q.get('postalCode')||'';for(const key of ['itemCode','itemCodes'])for(const raw of q.getAll(key))for(const id of raw.split(/[,;\s]+/)){if(/^(?:[A-Z]{2}\d{9}[A-Z]{2}|\d{10,30})$/.test(id)&&!seen.has(id)){seen.add(id);rows.push({barcode:id,postalCode:pc})}}}
  } return rows;
}
class BpostApi {
  constructor({email='',password='',cookies=''}={}){this.email=email;this.password=password;this.cookies=cookies||'';}
  headers(referer='',form=false){
    const h={'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8','Accept-Language':'nl-BE,nl;q=0.9,en-US;q=0.8,en;q=0.7','Cache-Control':'no-cache','Pragma':'no-cache','Upgrade-Insecure-Requests':'1','User-Agent':UA};
    if(this.cookies)h.Cookie=this.cookies;if(referer)h.Referer=referer;if(form)h['Content-Type']='application/x-www-form-urlencoded';return h;
  }
  absorb(res){
    const arr=typeof res.headers.getSetCookie==='function'?res.headers.getSetCookie():[res.headers.get('set-cookie')].filter(Boolean);
    const jar=new Map(this.cookies.split(/;\s*/).filter(Boolean).map(x=>[x.split('=')[0],x]));
    for(const line of arr){const c=line.split(';')[0];if(c.includes('='))jar.set(c.split('=')[0],c);}
    this.cookies=[...jar.values()].join('; ');
  }
  async req(url,{method='GET',data=null,referer=''}={}){
    for(let redirects=0;redirects<10;redirects++){
      const opts={method,headers:this.headers(referer,method==='POST'),redirect:'manual'};
      if(data)opts.body=new URLSearchParams(data).toString();
      const r=await fetch(url,opts);this.absorb(r);
      if([301,302,303,307,308].includes(r.status)){
        const loc=r.headers.get('location');if(!loc)break;referer=url;url=new URL(loc,url).toString();
        if([301,302,303].includes(r.status)){method='GET';data=null;} continue;
      }
      const text=await r.text();if(!r.ok)throw new BpostApiError(`bpost HTTP ${r.status}`,r.status,text);return{text,url};
    } throw new BpostApiError('Too many bpost redirects');
  }
  isLogin(text,url){return url.includes('login.bpost.be')||(text.includes('pf.username')&&text.includes('pf.pass'));}
  async login(){
    let {text,url}=await this.req(LOGIN);
    for(let n=0;n<6;n++){
      const fs=forms(text),f=fs.find(x=>'pf.username'in x.inputs&&'pf.pass'in x.inputs)||fs.find(x=>'SAMLResponse'in x.inputs);
      if(!f)break;const payload={...f.inputs};
      if('pf.username'in payload){payload['pf.username']=this.email;payload['pf.pass']=this.password;payload['pf.ok']='clicked';}
      ({text,url}=await this.req(new URL(f.action,url).toString(),{method:(f.method||'post').toUpperCase(),data:payload,referer:url}));
      if(!this.isLogin(text,url))return true;
    }
    if(this.isLogin(text,url))throw new BpostApiError('bpost rejected the supplied credentials',401);
    return true;
  }
  async accountParcels(){
    await this.login();
    let home=await this.req(HOME);if(this.isLogin(home.text,home.url)){await this.login();home=await this.req(HOME);}
    let h=await this.req(HISTORY);if(this.isLogin(h.text,h.url))throw new BpostApiError('bpost session expired',401);
    let html=h.text.trim();try{const x=JSON.parse(html);if(typeof x==='string')html=x}catch(_){}
    const refs=trackingLinks(html),rows=[];
    for(const ref of refs){const p=await this.publicParcel(ref.barcode,ref.postalCode);if(p)rows.push(p);}
    return rows;
  }
  async publicParcel(barcode,postalCode=''){
    let url=TRACK+encodeURIComponent(barcode);if(postalCode)url+='&postalCode='+encodeURIComponent(postalCode);
    const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':UA}});if(r.status===404)return null;
    const text=await r.text();let d={};try{d=JSON.parse(text)}catch(_){throw new BpostApiError('Invalid bpost tracking response',r.status)}
    if(!r.ok)throw new BpostApiError(`bpost HTTP ${r.status}`,r.status,d);
    return Array.isArray(d?.items)?d.items[0]||null:(Array.isArray(d)?d[0]||null:d);
  }
}
module.exports={BpostApi,BpostApiError};
