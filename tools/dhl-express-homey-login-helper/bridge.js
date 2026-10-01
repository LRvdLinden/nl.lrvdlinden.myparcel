(() => {
  'use strict';
  const MARKER='__DHL_EXPRESS_HOMEY_HELPER_011__';
  const MAX=350000;
  const interesting=url=>/mydhl\.express\.dhl/i.test(String(url||''))&&/shipment|tracking|track|manage|history|list|dashboard|proview|waybill|awb|delivery|event/i.test(String(url||''));
  const post=(type,payload={})=>{try{window.postMessage({marker:MARKER,type,payload},'*')}catch(_){}};
  const text=value=>{try{const s=typeof value==='string'?value:JSON.stringify(value);return s.slice(0,MAX)}catch(_){return''}};

  function pageState(){
    const local={},session={};
    try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);local[k]=String(localStorage.getItem(k)||'').slice(0,120000)}}catch(_){}
    try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);session[k]=String(sessionStorage.getItem(k)||'').slice(0,120000)}}catch(_){}
    post('page_state',{url:location.href,localStorage:local,sessionStorage:session});
  }

  const originalFetch=window.fetch;
  if(typeof originalFetch==='function'){
    window.fetch=async function(input,init){
      const url=typeof input==='string'?input:(input&&input.url)||'';
      const method=(init&&init.method)||(input&&input.method)||'GET';
      const response=await originalFetch.apply(this,arguments);
      try{
        if(interesting(url)){
          const clone=response.clone();
          clone.text().then(body=>post('network_response',{
            url:String(response.url||url),method:String(method||'GET').toUpperCase(),
            status:response.status,body:text(body),requestBody:text(init&&init.body)
          })).catch(()=>{});
        }
      }catch(_){}
      return response;
    };
  }

  const XHR=window.XMLHttpRequest;
  if(XHR&&XHR.prototype){
    const open=XHR.prototype.open,send=XHR.prototype.send;
    XHR.prototype.open=function(method,url){this.__dhlHomey={method,url};return open.apply(this,arguments)};
    XHR.prototype.send=function(body){
      try{
        this.addEventListener('load',()=>{
          const meta=this.__dhlHomey||{};
          if(!interesting(meta.url))return;
          post('network_response',{
            url:String(this.responseURL||meta.url||''),method:String(meta.method||'GET').toUpperCase(),
            status:this.status,body:text(typeof this.responseText==='string'?this.responseText:''),
            requestBody:text(body)
          });
        });
      }catch(_){}
      return send.apply(this,arguments);
    };
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(pageState,300));
  else setTimeout(pageState,300);
  setTimeout(pageState,1800);
  setTimeout(pageState,4500);
  window.addEventListener('hashchange',()=>setTimeout(pageState,300));
  window.addEventListener('popstate',()=>setTimeout(pageState,300));
})();