import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME='__Host-mfa-staging';
const TTL_MS=4*60*60*1000;
const signingKey=randomBytes(32);

export {COOKIE_NAME};

export function isMfaStagingPasswordValid(supplied:unknown,expected:unknown):boolean {
 if(typeof supplied!=='string'||typeof expected!=='string' ||
   Buffer.byteLength(expected,'utf8')<24||Buffer.byteLength(expected,'utf8')>256||
   Buffer.byteLength(supplied,'utf8')>256) return false;
 const first=Buffer.from(supplied,'utf8'),second=Buffer.from(expected,'utf8');
 return first.length===second.length && timingSafeEqual(first,second);
}

// Legacy HTTP Basic access is retained for CLI and scripted probes.
// Browsers can now use the separate branded staging-access form instead.
export function isMfaStagingAccessValid(header:unknown,password:unknown):boolean {
 if(typeof header!=='string'||header.length>512||
   !/^Basic [A-Za-z0-9+/]+=*$/.test(header))return false;
 let decoded:string;
 try {decoded=Buffer.from(header.slice(6),'base64').toString('utf8')}
 catch{return false}
 if(!decoded.startsWith('mfa-staging:'))return false;
 return isMfaStagingPasswordValid(decoded.slice('mfa-staging:'.length),password);
}

function signature(value:string,password:string){
 const passwordKey=createHmac('sha256',signingKey).update(password,'utf8').digest();
 return createHmac('sha256',passwordKey).update(value,'utf8').digest('hex');
}

export function createMfaStagingCookie(password:unknown,now=Date.now()):string|null {
 if(typeof password!=='string'||Buffer.byteLength(password,'utf8')<24||
    Buffer.byteLength(password,'utf8')>256||!Number.isSafeInteger(now))return null;
 const content=String(now)+'.'+randomBytes(16).toString('base64url');
 return content+'.'+signature(content,password);
}

export function isMfaStagingCookieValid(header:unknown,password:unknown,now=Date.now()):boolean {
 if(typeof header!=='string'||header.length>4096||typeof password!=='string'||
    Buffer.byteLength(password,'utf8')<24||Buffer.byteLength(password,'utf8')>256||
    !Number.isSafeInteger(now))return false;
 const token=header.split(';').map(x=>x.trim())
   .find(x=>x.startsWith(COOKIE_NAME+'='))?.slice(COOKIE_NAME.length+1);
 if(!token||token.length>200)return false;
 const match=/^(\d{13})\.([A-Za-z0-9_-]{22})\.([a-f0-9]{64})$/.exec(token);
 if(!match)return false;
 const issued=Number(match[1]);
 if(!Number.isSafeInteger(issued)||issued>now+30000||now-issued>TTL_MS)return false;
 const content=match[1]+'.'+match[2];
 const given=Buffer.from(match[3],'hex'),correct=Buffer.from(signature(content,password),'hex');
 return timingSafeEqual(given,correct);
}
