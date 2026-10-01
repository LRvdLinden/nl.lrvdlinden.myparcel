'use strict';

const LOGIN_URL='https://dhlpass.dhl.com/nl-nl/login/?CountryCode=nl&LangCode=nl&client_id=mydhlplus&additional_params=isMobileDHL_EQtrue&redirect_uri=https://mydhl.express.dhl/index/en/login-redirect.html&response_type=code&rt=1&oidc-auth=true';
const RESULT_URL=chrome.runtime.getURL('result.html');
const KEY='dhlExpressHomeySession011';

const fresh=()=>({
  schema:'nl.lrvdlinden.myparcel.dhl-express-session',
  version:2,
  helperVersion:'0.1.1',
  createdAt:null,
  updatedAt:null,
  lastUrl:'',
  cookies:[],
  storage:{local:{},session:{}},
  requests:[],
  verifiedAt:null
});

let state=fresh();
let ready=(async()=>{
  try{
    const saved=await chrome.storage.local.get(KEY);
    if(saved?.[KEY]) state={...fresh(),...saved[KEY]};
  }catch(_){}
})();

async function save(){
  state.updatedAt=new Date().toISOString();
  await chrome.storage.local.set({[KEY]:state});
}

async function refreshCookies(){
  const out=[];
  for(const url of ['https://dhlpass.dhl.com/','https://mydhl.express.dhl/']){
    try{
      for(const c of await chrome.cookies.getAll({url})){
        const id=`${c.name}|${c.domain}|${c.path}`;
        if(out.some(x=>`${x.name}|${x.domain}|${x.path}`===id)) continue;
        out.push({
          name:c.name,value:c.value,domain:c.domain,path:c.path,
          secure:!!c.secure,httpOnly:!!c.httpOnly,sameSite:c.sameSite||'unspecified',
          expirationDate:c.expirationDate||null,session:!!c.session
        });
      }
    }catch(_){}
  }
  state.cookies=out;
}

function interesting(url){
  return /^https:\/\/mydhl\.express\.dhl\//i.test(String(url||'')) &&
    /shipment|tracking|track|manage|history|list|dashboard|proview|waybill|awb|delivery|event/i.test(String(url||''));
}

function addRequest(row){
  if(!interesting(row?.url)) return;
  const item={
    url:String(row.url||'').slice(0,3000),
    method:String(row.method||'GET').toUpperCase(),
    body:String(row.body||'').slice(0,120000),
    responseText:String(row.responseText||'').slice(0,350000),
    headers:row.headers&&typeof row.headers==='object'?row.headers:{},
    referer:String(row.referer||state.lastUrl||'https://mydhl.express.dhl/').slice(0,3000),
    capturedAt:new Date().toISOString()
  };
  const key=`${item.method}|${item.url}`;
  const index=state.requests.findIndex(x=>`${x.method}|${x.url}`===key);
  if(index>=0) state.requests[index]={...state.requests[index],...item};
  else state.requests.push(item);
  state.requests=state.requests.slice(-80);
}

function b64url(text){
  const bytes=new TextEncoder().encode(text);
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}

function bundle(){
  return 'DHLEXPRESS1.'+b64url(JSON.stringify(state));
}

function usable(){
  return Boolean(state.verifiedAt && state.cookies.length);
}

chrome.webRequest.onBeforeSendHeaders.addListener(details=>{
  ready.then(async()=>{
    if(!interesting(details.url)) return;
    const headers={};
    for(const h of details.requestHeaders||[]){
      const name=String(h?.name||'').toLowerCase();
      const value=String(h?.value||'');
      if(!value) continue;
      if(/^(accept|accept-language|content-type|x-[a-z0-9-]+)$/i.test(name)) headers[name]=value;
      if(name==='referer') headers.referer=value;
    }
    addRequest({url:details.url,method:details.method,headers,referer:headers.referer||''});
    await save();
  }).catch(()=>{});
},{urls:['https://mydhl.express.dhl/*']},['requestHeaders','extraHeaders']);

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  (async()=>{
    await ready;

    if(message?.type==='start_login'){
      state=fresh();
      state.createdAt=new Date().toISOString();
      await save();
      await chrome.tabs.create({url:LOGIN_URL});
      return sendResponse({ok:true});
    }

    if(message?.type==='page_state'){
      state.lastUrl=String(message.url||'');
      if(message.localStorage&&typeof message.localStorage==='object')
        state.storage.local={...state.storage.local,...message.localStorage};
      if(message.sessionStorage&&typeof message.sessionStorage==='object')
        state.storage.session={...state.storage.session,...message.sessionStorage};

      try{
        const u=new URL(state.lastUrl);
        if(u.hostname.toLowerCase()==='mydhl.express.dhl'&&!/login/i.test(u.pathname+u.hash))
          state.verifiedAt=new Date().toISOString();
      }catch(_){}

      await refreshCookies();
      await save();

      if(usable()){
        try{await chrome.tabs.create({url:RESULT_URL});}catch(_){}
      }
      return sendResponse({ok:true});
    }

    if(message?.type==='network_response'){
      const p=message.payload||{};
      addRequest({
        url:p.url,method:p.method,body:p.requestBody,
        responseText:p.body,headers:p.headers,referer:p.referer
      });
      await refreshCookies();
      await save();
      return sendResponse({ok:true});
    }

    if(message?.type==='get_state'){
      await refreshCookies();
      await save();
      return sendResponse({
        ok:true,
        ready:usable(),
        bundle:usable()?bundle():'',
        cookieCount:state.cookies.length,
        requestCount:state.requests.length,
        verified:!!state.verifiedAt,
        updatedAt:state.updatedAt,
        lastUrl:state.lastUrl
      });
    }

    if(message?.type==='reset'){
      state=fresh();
      await chrome.storage.local.remove(KEY);
      return sendResponse({ok:true});
    }

    sendResponse({ok:false});
  })().catch(error=>sendResponse({ok:false,error:String(error?.message||error)}));
  return true;
});
