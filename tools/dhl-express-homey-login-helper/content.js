'use strict';
const MARKER='__DHL_EXPRESS_HOMEY_HELPER_013__';
window.addEventListener('message',event=>{
  const data=event?.data;
  if(!data||data.marker!==MARKER||!data.type)return;
  chrome.runtime.sendMessage({type:data.type,...(data.payload||{})}).catch(()=>{});
});
