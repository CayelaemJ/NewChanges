import test from "node:test";
import assert from "node:assert/strict";
import {legacyTokenDigest,readExistingSession,roleModules,safeSessionResponse} from "../cloudflare/session-compat.mjs";

const TOKEN="b".repeat(64);
const future=new Date("2040-01-01T00:00:00.000Z");
const user={id:"synthetic-user",role:"VIEWER",active:true,deletedAt:null,
 links:[{employerId:"employer-a"}],email:"hidden@example.test",passwordHash:"SHOULD_NEVER_RETURN"};
const makePrisma=(row,cb=()=>{})=>({session:{findUnique:async q=>{cb(q);return row}}});
const row={expiresAt:future,endedAt:null,revokedAt:null,user};
const kwargs={cookie:"session="+TOKEN,now:Date.parse("2030-01-01")};

test("SHA-256 digest matches existing token scheme without exposing it",async()=>{
 const d=await legacyTokenDigest("session="+TOKEN);
 assert.match(d,/^[a-f0-9]{64}$/);
 const nodeDigest=(await import("node:crypto")).createHash("sha256").update(TOKEN).digest("hex");
 assert.equal(d,nodeDigest);
 assert.equal(d.includes(TOKEN),false);
});
test("duplicates, oversized, malformed and absent session cookies fail closed before SQL",async()=>{
 let calls=0;
 const prisma=makePrisma(row,()=>calls++);
 for(const cookie of ["","junk=1","session=bad","session="+TOKEN+"; session="+TOKEN,
   "session="+TOKEN+"; session=invalid","session="+TOKEN+"; extra="+("a".repeat(9000))]){
  assert.equal((await readExistingSession({...kwargs,cookie,prisma})).authenticated,false,cookie.slice(0,100));
 }
 assert.equal(calls,0);
});
test("valid session looks up only digest, not raw token",async()=>{
 let seen=null;
 const res=await readExistingSession({...kwargs,prisma:makePrisma(row,q=>seen=q)});
 assert.equal(res.authenticated,true);
 assert.equal(res.role,"VIEWER");
 assert.deepEqual(res.employerIds,["employer-a"]);
 assert.equal(seen.where.token,await legacyTokenDigest("session="+TOKEN));
 assert.equal(JSON.stringify(seen).includes(TOKEN),false);
 assert.deepEqual(safeSessionResponse(res),{authenticated:true,role:"VIEWER",modules:roleModules("VIEWER")});
 assert.equal(JSON.stringify(safeSessionResponse(res)).includes("hidden@example.test"),false);
});
test("expired, revoked, ended, deleted, disabled, unknown roles deny",async()=>{
 const variants=[
  {expiresAt:new Date("2020-01-01")},{endedAt:new Date()},{revokedAt:new Date()},
  {user:{...user,deletedAt:new Date()}},{user:{...user,active:false}},
  {user:{...user,role:"ATTACKER"}}
 ];
 for(const variant of variants)assert.equal((await readExistingSession({...kwargs,prisma:makePrisma({...row,...variant})})).authenticated,false);
});
test("admins and employer viewers cannot gain cross-tenant permissions by metadata",async()=>{
 const admin=await readExistingSession({...kwargs,prisma:makePrisma({...row,user:{...user,role:"SUPERADMIN"}})});
 assert.equal(admin.employerIds,null);
 assert.equal(admin.modules.admin,true);
 assert.equal(roleModules("VIEWER").admin,false);
 assert.equal(roleModules("EMPLOYER_MANAGER").portfolio,false);
 assert.equal(roleModules("PORTFOLIO_MANAGER").portfolio,true);
 const viewer=await readExistingSession({...kwargs,prisma:makePrisma(row)});
 assert.deepEqual(viewer.employerIds,["employer-a"]);
 assert.equal(viewer.employerIds.includes("employer-b"),false);
});
test("no Prisma binding fails closed if a real cookie arrives",async()=>{
 await assert.rejects(()=>readExistingSession(kwargs),/adapter unavailable/);
 assert.deepEqual(safeSessionResponse({authenticated:false}),{authenticated:false});
});
