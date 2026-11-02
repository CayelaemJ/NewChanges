import {createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS=30000;

export function requireTotpEncryptionKey(env=process.env):Buffer {
  const input=env.ADMIN_MFA_TOTP_ENCRYPTION_KEY;
  if(typeof input!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(input))
    throw new Error('TOTP encryption key must be 32 random bytes encoded as base64url');
  const bytes=Buffer.from(input,'base64url');
  if(bytes.length!==32)throw new Error('Invalid TOTP encryption key length');
  return bytes;
}
export function totpIsEnabled(env=process.env):boolean {
  return env.ADMIN_MFA_TOTP_ENABLED==='true';
}
export function generateTotpSecret():string {
  const bytes=randomBytes(20);
  let value=0,bits=0,out='';
  for(const byte of bytes){
    value=(value<<8)|byte;bits+=8;
    while(bits>=5){out+=ALPHABET[(value>>>(bits-=5))&31];}
  }
  if(bits>0)out+=ALPHABET[(value<<(5-bits))&31];
  return out;
}
export function decodeTotpSecret(secret:string):Buffer {
 if(typeof secret!=='string'|| !/^[A-Z2-7]{32}$/.test(secret))
   throw new Error('Invalid authenticator secret');
 let bits=0,value=0;const bytes:number[]=[];
 for(const char of secret){value=(value<<5)|ALPHABET.indexOf(char);bits+=5;
  if(bits>=8){bits-=8;bytes.push((value>>bits)&255);}}
 if(bytes.length!==20)throw new Error('Invalid authenticator secret length');
 return Buffer.from(bytes);
}
export function encryptTotpSecret(secret:string,key:Buffer):string {
 decodeTotpSecret(secret);
 if(key.length!==32)throw new Error('Invalid encryption key');
 const iv=randomBytes(12);
 const cipher=createCipheriv('aes-256-gcm',key,iv);
 const content=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
 return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),content.toString('base64url')].join(':');
}
export function decryptTotpSecret(encrypted:string,key:Buffer):string {
 if(key.length!==32||typeof encrypted!=='string')throw new Error('Invalid encrypted secret');
 const parts=encrypted.split(':');
 if(parts.length!==4||parts[0]!=='v1')throw new Error('Unsupported authenticator secret format');
 const iv=Buffer.from(parts[1],'base64url'),tag=Buffer.from(parts[2],'base64url');
 if(iv.length!==12||tag.length!==16)throw new Error('Invalid secret authentication tag');
 const decipher=createDecipheriv('aes-256-gcm',key,iv);
 decipher.setAuthTag(tag);
 const secret=Buffer.concat([decipher.update(Buffer.from(parts[3],'base64url')),decipher.final()]).toString('utf8');
 decodeTotpSecret(secret);
 return secret;
}
export function totpCode(secret:string,step:number,digits=6):string {
 if(!Number.isSafeInteger(step)||step<0||!Number.isInteger(digits)||digits<6||digits>8)
   throw new Error('Invalid TOTP counter or digits');
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
 const hmac=createHmac('sha1',decodeTotpSecret(secret)).update(counter).digest();
 const pos=hmac[hmac.length-1]&15;
 const value=(hmac.readUInt32BE(pos)&0x7fffffff)%(10**digits);
 return String(value).padStart(digits,'0');
}
export function findTotpStep(secret:string,code:unknown,now=Date.now(),lastUsedStep:bigint|null=null):bigint|null {
 if(typeof code!=='string'||!/^[0-9]{6}$/.test(code)||!Number.isFinite(now))return null;
 const current=Math.floor(now/STEP_MS);
 const given=Buffer.from(code,'ascii');
 for(let i=-1;i<=1;i++){
   const step=current+i;if(step<0 ||(lastUsedStep!==null&&BigInt(step)<=lastUsedStep))continue;
   const expected=Buffer.from(totpCode(secret,step),'ascii');
   if(timingSafeEqual(given,expected))return BigInt(step);
 }
 return null;
}
export function makeTotpUri(email:string,secret:string):string {
 decodeTotpSecret(secret);
 const issuer='The Fixer';
 const label=issuer+':'+email.toLowerCase().trim();
 return 'otpauth://totp/'+encodeURIComponent(label)+'?secret='+secret+
  '&issuer='+encodeURIComponent(issuer)+'&algorithm=SHA1&digits=6&period=30';
}
export async function makeTotpQrSvgDataUri(otpauth:string):Promise<string> {
 if(!/^otpauth:\/\/totp\//.test(otpauth)||otpauth.length>512)
   throw new Error('Invalid QR provisioning data');
 // Dependency is pinned with a verified integrity digest. QR generation runs
 // entirely in this server; the enrollment secret is never sent to an image API.
 const mod:any=await import('qrcode-generator');
 const factory=mod.default??mod;
 const qr=factory(0,'M');
 qr.addData(otpauth,'Byte');qr.make();
 return 'data:image/svg+xml;base64,'+
   Buffer.from(qr.createSvgTag({cellSize:5,margin:20,scalable:false}),'utf8').toString('base64');
}
