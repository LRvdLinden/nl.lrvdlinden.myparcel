'use strict';
const BASE='https://carrier.vintedgo.com/members';
async function j(res){let t=await res.text(),b={};try{b=JSON.parse(t)}catch{};if(!res.ok){let e=new Error(b.message||b.error||`HTTP ${res.status}`);e.status=res.status;throw e}return b}
class HomerrApi{constructor(refresh){this.refreshToken=refresh;this.sessionToken=null}
 async register(email){return j(await fetch(`${BASE}/registrations`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})}))}
 async confirm(token){let b=await j(await fetch(`${BASE}/registrations/confirm`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})}));this._store(b);return b}
 _store(b){if(!b.session_token||!b.refresh_token)throw new Error('Homerr/Vinted Go token response incomplete');this.sessionToken=b.session_token;this.refreshToken=b.refresh_token}
 async refresh(){if(!this.refreshToken){let e=new Error('No refresh token');e.status=401;throw e}let b=await j(await fetch(`${BASE}/sessions/refresh`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:this.refreshToken})}));this._store(b);return b}
 async get(url){if(!this.sessionToken)await this.refresh();let r=await fetch(url,{headers:{authorization:`Bearer ${this.sessionToken}`}});if(r.status===401){await this.refresh();r=await fetch(url,{headers:{authorization:`Bearer ${this.sessionToken}`}})}return j(r)}
 async me(){return this.get(`${BASE}/users/me`)} async shipments(){return this.get(`${BASE}/shipments`)}
}
module.exports={HomerrApi};
