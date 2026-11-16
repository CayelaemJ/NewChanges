// NewChanges — Cloudflare-compatible verification of existing Prisma sessions.
// This module deliberately does not create sessions or grant app access.
// The existing auth system stores SHA-256 digests of random 32-byte tokens
// in PostgreSQL. Do not ever log raw cookies, tokens, digests or DB rows.

const ROLES = new Set(["ADMIN","SUPERADMIN","EMPLOYER_MANAGER","PORTFOLIO_MANAGER","VIEWER"]);
const COOKIE_TOKEN=/^[a-f0-9]{64}$/i;

function safeSessionCookie(header) {
  if(typeof header!=="string"||header.length>8192)return null;
  let token=null;
  for(const part of header.split(";")){
    const [name,...rest]=part.trim().split("=");
    if(name!=="session")continue;
    if(token!==null||rest.length!==1||!COOKIE_TOKEN.test(rest[0]))return null;
    token=rest[0];
  }
  return token;
}

export async function legacyTokenDigest(cookie,subtle=globalThis.crypto?.subtle) {
  const token=safeSessionCookie(cookie);
  if(!token||!subtle)return null;
  const data=new TextEncoder().encode(token);
  const hash=await subtle.digest("SHA-256",data);
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,"0")).join("");
}

export function roleModules(role){
  return {
    admin:role==="ADMIN"||role==="SUPERADMIN",
    dashboard:ROLES.has(role),
    portfolio:role==="ADMIN"||role==="SUPERADMIN"||role==="PORTFOLIO_MANAGER",
    users:role==="ADMIN"||role==="SUPERADMIN"
  };
}

export async function readExistingSession({cookie,prisma,now=Date.now(),subtle}){
  // Missing or malformed session material must not query the database.
  const token=await legacyTokenDigest(cookie,subtle||globalThis.crypto?.subtle);
  if(!token)return {authenticated:false,reason:"missing_or_invalid_cookie"};
  if(!prisma?.session?.findUnique)throw new Error("Isolated Prisma session adapter unavailable");
  const row=await prisma.session.findUnique({
    where:{token},
    include:{user:{include:{links:true}}}
  });
  if(!row||!row.user||!row.user.active||row.user.deletedAt||
     row.revokedAt||row.endedAt||!Number.isFinite(new Date(row.expiresAt).getTime())||
     new Date(row.expiresAt).getTime()<=now||!ROLES.has(row.user.role)){
    return {authenticated:false,reason:"session_inactive"};
  }
  // Only non-sensitive identity metadata is returned. The caller must still
  // validate employer and dashboard permissions for every subsequent query.
  return {
    authenticated:true,
    userId:row.user.id,
    role:row.user.role,
    modules:roleModules(row.user.role),
    employerIds:row.user.role==="ADMIN"||row.user.role==="SUPERADMIN"
      ?null:(Array.isArray(row.user.links)?row.user.links.map(x=>x.employerId).filter(x=>typeof x==="string"):[])
  };
}

export function safeSessionResponse(result){
  if(!result?.authenticated)return {authenticated:false};
  return {authenticated:true,role:result.role,modules:result.modules};
}
