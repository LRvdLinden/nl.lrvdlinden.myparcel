'use strict';
const $=id=>document.getElementById(id);

async function getState(){
  const s=await chrome.runtime.sendMessage({type:'get_state'});
  if(!s?.ok){
    $('status').textContent=s?.error||'Could not read captured session.';
    $('code').value='';
    return;
  }
  $('code').value=s.bundle||'';
  if(s.ready){
    $('status').textContent=`Ready: verified MyDHL+ session · ${s.cookieCount||0} cookies · ${s.requestCount||0} shipment requests`;
  }else if(s.cookieCount){
    $('status').textContent=`Session found (${s.cookieCount} cookies), but MyDHL+ has not been verified yet. Open Manage Shipments → All Shipments once.`;
  }else{
    $('status').textContent='No usable MyDHL+ session captured yet.';
  }
}

$('start').addEventListener('click',async()=>{
  const r=await chrome.runtime.sendMessage({type:'start_login'});
  $('status').textContent=r?.ok?'DHLPass login opened. Complete login and open All Shipments.':(r?.error||'Could not start login.');
});
$('refresh').addEventListener('click',getState);
$('copy').addEventListener('click',async()=>{
  const value=$('code').value.trim();
  if(!value)return;
  await navigator.clipboard.writeText(value);
  $('status').textContent='Homey session code copied.';
});
$('reset').addEventListener('click',async()=>{
  await chrome.runtime.sendMessage({type:'reset'});
  $('code').value='';
  $('status').textContent='Captured session reset.';
});
getState();
