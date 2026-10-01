'use strict';
const badge=document.getElementById('badge');
const detail=document.getElementById('detail');
const code=document.getElementById('code');
const copy=document.getElementById('copy');

async function load(){
  const s=await chrome.runtime.sendMessage({type:'get_state'});
  if(!s?.ok||!s.ready||!s.bundle){
    badge.textContent='Session not ready yet';
    detail.textContent='Return to MyDHL+, finish signing in and open Manage Shipments → All Shipments once.';
    code.value='';
    return;
  }
  badge.textContent='MyDHL+ session ready';
  detail.textContent=`Captured ${s.cookieCount||0} session cookies and ${s.requestCount||0} relevant shipment requests. The session remains stored in the helper until you reset it.`;
  code.value=s.bundle;
}
copy.addEventListener('click',async()=>{
  if(!code.value)return;
  await navigator.clipboard.writeText(code.value);
  const old=copy.textContent;copy.textContent='Copied';setTimeout(()=>copy.textContent=old,1400);
});
load();
let n=0;const timer=setInterval(async()=>{n++;await load();if(n>=10)clearInterval(timer)},1000);
