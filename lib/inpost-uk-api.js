'use strict';
class InPostUkApiError extends Error {
  constructor(message,status=0,body=null){super(message);this.name='InPostUkApiError';this.status=status;this.body=body;}
}
class InPostUkApi {
  async parcel(number){
    const code=String(number||'').trim().replace(/\s+/g,'');
    if(!code)return null;
    const url=`https://tracking.inpost.co.uk/api/v2.0/${encodeURIComponent(code)}`;
    const res=await fetch(url,{headers:{Accept:'application/json','User-Agent':'Homey MyParcel'}});
    if(res.status===404)return null;
    const text=await res.text(); let data;
    try{data=text?JSON.parse(text):{};}catch(_){throw new InPostUkApiError('InPost UK returned an invalid response',res.status);}
    if(!res.ok)throw new InPostUkApiError(`InPost UK HTTP ${res.status}`,res.status,data);
    return data;
  }
}
module.exports={InPostUkApi,InPostUkApiError};
