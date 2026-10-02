'use strict';

const LOGIN_URL='https://dhlpass.dhl.com/nl-nl/login/?CountryCode=nl&LangCode=nl&client_id=mydhlplus&additional_params=isMobileDHL_EQtrue&redirect_uri=https://mydhl.express.dhl/index/en/login-redirect.html&response_type=code&rt=1&oidc-auth=true';
const MYDHL='https://mydhl.express.dhl';

function clean(v){return String(v??'').trim()}
function decodeHtml(s){return String(s||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function attr(tag,name){const m=String(tag).match(new RegExp(name+'\\s*=\\s*["\\\']([^"\\\']*)["\\\']','i'));return m?decodeHtml(m[1]):''}
function forms(html){return [...String(html||'').matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map(m=>m[0])}
function inputs(form){return [...String(form||'').matchAll(/<input\b[^>]*>/gi)].map(m=>({tag:m[0],name:attr(m[0],'name'),type:(attr(m[0],'type')||'text').toLowerCase(),value:attr(m[0],'value')})).filter(x=>x.name)}
function formScore(form){const s=String(form||'').toLowerCase();let n=0;if(/password/.test(s))n+=10;if(/email|username|login/.test(s))n+=6;if(/otp|verification|code/.test(s))n+=4;return n}
function pickForm(html){return forms(html).sort((a,b)=>formScore(b)-formScore(a))[0]||''}
function absolute(base,url){try{return new URL(url||base,base).toString()}catch(_){return base}}
function cookieSplit(raw){return String(raw||'').split(/,(?=\s*[^;,=]+=[^;,]+)/g)}
function first(...v){for(const x of v){if(x!==undefined&&x!==null&&String(x).trim())return String(x).trim()}return''}

class DHLExpressAccountApi{
  constructor({fetch,email,password,otp='',log=()=>{}}={}){
    this.fetch=fetch;this.email=clean(email);this.password=String(password||'');this.otp=clean(otp);this.log=log;
    this.cookies=new Map();this.loggedIn=false;this.lastUrl='';this.lastHtml='';
  }
  _cookieHeader(){return [...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}
  _captureCookies(res){
    let values=[];
    try{if(typeof res.headers.getSetCookie==='function')values=res.headers.getSetCookie()}catch(_){}
    if(!values.length){const raw=res.headers.get('set-cookie');if(raw)values=cookieSplit(raw)}
    for(const line of values){const firstPart=String(line).split(';',1)[0],i=firstPart.indexOf('=');if(i>0)this.cookies.set(firstPart.slice(0,i).trim(),firstPart.slice(i+1).trim())}
  }
  async _request(url,options={},depth=0){
    if(depth>12)throw new Error('DHLPass redirect loop.');
    const headers={
      'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
      Accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language':'nl-NL,nl;q=0.9,en;q=0.8',
      ...(options.headers||{})
    };
    const cookie=this._cookieHeader();if(cookie)headers.Cookie=cookie;
    const res=await this.fetch(url,{...options,headers,redirect:'manual'});
    this._captureCookies(res);
    const location=res.headers.get('location');
    if(location&&res.status>=300&&res.status<400){
      const next=absolute(url,location);
      this.lastUrl=next;
      const method=res.status===307||res.status===308?(options.method||'GET'):'GET';
      return this._request(next,{method,headers:{Referer:url}},depth+1);
    }
    this.lastUrl=url;
    return res;
  }
  _loginPayload(form,url){
    const data=new URLSearchParams();
    const list=inputs(form);
    for(const i of list){
      if(['submit','button','image','file'].includes(i.type))continue;
      if(['hidden'].includes(i.type)&&i.value)data.set(i.name,i.value);
    }
    const emailInput=list.find(i=>/email|username|user(name)?|login/i.test(i.name)&&i.type!=='hidden')||list.find(i=>i.type==='email')||list.find(i=>i.type==='text');
    const passInput=list.find(i=>i.type==='password'||/password|passwd|pwd/i.test(i.name));
    const otpInput=list.find(i=>/otp|verification|verify|code|token/i.test(i.name)&&i.type!=='hidden');
    if(emailInput)data.set(emailInput.name,this.email);
    if(passInput)data.set(passInput.name,this.password);
    if(otpInput&&this.otp)data.set(otpInput.name,this.otp);
    return {data,emailInput,passInput,otpInput,action:absolute(url,attr(form,'action')||url),method:(attr(form,'method')||'POST').toUpperCase()};
  }
  _challenge(html){
    const s=String(html||'').toLowerCase();
    return /one[- ]time|verification code|authenticator|two[- ]factor|multi[- ]factor|otp|sms code|security code|verificatiecode|eenmalige code/.test(s);
  }
  async login(){
    if(!this.email||!this.password)throw new Error('Vul je DHL Express e-mailadres en wachtwoord in.');
    this.cookies.clear();

    let res=await this._request(LOGIN_URL,{method:'GET'});
    let html=await res.text();
    this.lastHtml=html;
    let sentEmail=false,sentPassword=false,sentOtp=false;

    // DHLPass can present email/password on one form or in multiple consecutive
    // steps. Walk through a small number of login forms and keep the cookie jar.
    for(let step=0;step<5;step++){
      const form=pickForm(html);
      if(!form) break;

      const data=new URLSearchParams();
      const list=inputs(form);
      for(const input of list){
        if(input.type==='hidden'&&input.value)data.set(input.name,input.value);
      }

      const emailInput=list.find(i=>/email|username|user(name)?|login/i.test(i.name)&&i.type!=='hidden')
        ||list.find(i=>i.type==='email');
      const passInput=list.find(i=>i.type==='password'||/password|passwd|pwd/i.test(i.name));
      const otpInput=list.find(i=>/otp|verification|verify|code|token|pin/i.test(i.name)&&i.type!=='hidden');

      if(emailInput&&!sentEmail){data.set(emailInput.name,this.email);sentEmail=true}
      if(passInput&&!sentPassword){data.set(passInput.name,this.password);sentPassword=true}
      if(otpInput){
        if(!this.otp){
          const e=new Error('DHLPass vraagt om een verificatiecode. Vul de ontvangen code in en probeer opnieuw.');
          e.code='OTP_REQUIRED';throw e;
        }
        data.set(otpInput.name,this.otp);sentOtp=true;
      }

      // Stop before accidentally submitting an unrelated post-login form.
      if(!emailInput&&!passInput&&!otpInput) break;

      const action=absolute(this.lastUrl||LOGIN_URL,attr(form,'action')||this.lastUrl||LOGIN_URL);
      const method=(attr(form,'method')||'POST').toUpperCase();
      res=await this._request(action,{
        method,
        headers:{
          'Content-Type':'application/x-www-form-urlencoded',
          Origin:new URL(action).origin,
          Referer:this.lastUrl||LOGIN_URL
        },
        body:data.toString()
      });
      html=await res.text();this.lastHtml=html;

      if(/invalid|incorrect|wrong password|ongeldig|onjuist|falsches passwort|mot de passe incorrect/i.test(html)){
        const e=new Error('DHL Express inloggen is mislukt. Controleer e-mailadres en wachtwoord.');
        e.code='AUTH_FAILED';throw e;
      }
      if(this._challenge(html)&&!this.otp){
        const e=new Error('DHLPass vraagt om een verificatiecode. Vul de ontvangen code in en probeer opnieuw.');
        e.code='OTP_REQUIRED';throw e;
      }
    }

    if(!sentEmail||!sentPassword){
      const e=new Error('DHLPass gebruikt voor deze login een interactieve browserstap. Gebruik de DHL Express Homey Login Helper als fallback.');
      e.code='BROWSER_LOGIN_REQUIRED';throw e;
    }

    const probe=await this._request(MYDHL+'/index/en.html',{method:'GET',headers:{Referer:this.lastUrl||LOGIN_URL}});
    const probeHtml=await probe.text();this.lastHtml=probeHtml;

    // A successful account session should leave us with DHL session cookies.
    if(!this.cookies.size){
      const e=new Error('DHLPass heeft geen bruikbare sessie teruggegeven. Gebruik de helper als fallback.');
      e.code='BROWSER_LOGIN_REQUIRED';throw e;
    }

    this.loggedIn=true;
    this.log('[DHL Express direct] login completed', {
      cookies:this.cookies.size,
      otpUsed:sentOtp,
      finalUrl:this.lastUrl
    });
    return true;
  }
  _extractEmbedded(html){
    const found=[];
    for(const m of String(html||'').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
      const t=m[1].trim();if(!t)continue;
      for(const piece of [t,...(t.match(/\{[\s\S]*\}/g)||[])]){
        try{found.push(JSON.parse(piece))}catch(_){}
      }
    }
    return found;
  }
  async getParcels(){
    if(!this.loggedIn)await this.login();
    const {extractShipments}=require('./dhl-express-session');
    let best=[];
    for(const embedded of this._extractEmbedded(this.lastHtml)){const x=extractShipments(embedded);if(x.length>best.length)best=x}
    const pages=[
      '/index/en/manage-shipments.html',
      '/index/en/shipment.html',
      '/index/en.html'
    ];
    for(const path of pages){
      try{
        const res=await this._request(MYDHL+path,{method:'GET',headers:{Referer:MYDHL+'/index/en.html'}});
        const body=await res.text();
        for(const embedded of this._extractEmbedded(body)){const x=extractShipments(embedded);if(x.length>best.length)best=x}
        const direct=extractShipments(body);if(direct.length>best.length)best=direct;
        const urls=[...body.matchAll(new RegExp('[\"\\\']([^\"\\\'<>]*(?:shipment|track|waybill|awb)[^\"\\\'<>]*)[\"\\\']','gi'))].map(m=>decodeHtml(m[1]));
        for(const raw of urls.slice(0,25)){
          const u=absolute(MYDHL,raw);
          if(!/dhl/i.test(u))continue;
          try{
            const rr=await this._request(u,{method:'GET',headers:{Accept:'application/json,text/plain,*/*',Referer:MYDHL+path}});
            const txt=await rr.text();const x=extractShipments(txt);if(x.length>best.length)best=x;
          }catch(_){}
        }
      }catch(e){this.log('[DHL Express direct page]',path,e.message)}
      if(best.length)break;
    }
    if(!best.length){
      const e=new Error('DHL Express-account is ingelogd, maar er kon nog geen zendingenlijst uit MyDHL+ worden gelezen. Gebruik eventueel de helper als fallback en open daar All Shipments.');
      e.code='NO_SHIPMENT_DATA';throw e;
    }
    return best;
  }
}

module.exports=DHLExpressAccountApi;
