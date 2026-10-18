import assert from "node:assert/strict";
import {createFencedStagingLedger} from "../src/services/fencedStagingLedger.js";
const statements:string[]=[];
let granted=true;
const ledger=createFencedStagingLedger({query:async<T extends Record<string,unknown>>(sql:string,params:readonly unknown[])=>{
 statements.push(sql);
 assert(!sql.includes("DELETE FROM"));
 assert(!sql.includes("TRUNCATE"));
 if(sql.startsWith("INSERT"))return (granted?[{fence:"4",version:"2"}]:[]) as unknown as T[];
 if(sql.startsWith("UPDATE"))return (granted?[{version:"3"}]:[]) as unknown as T[];
 return [] as T[];
}});
const lease=await ledger.acquire("gen1","employers","railway");
assert.equal(lease.fence,4n);
assert.equal(lease.version,2n);
assert(statements[0].includes('ON CONFLICT ("generation","feed")'));
assert(statements[0].includes('"leaseExpiresAt" < now()'));
const sha="a".repeat(64);
const receipt={generation:"gen1",feed:"employers",snapshotId:"snap1",sha256:sha,
 objectKey:`semantic/staging/gen1/snap1/employers/${sha}.json`,
 cursor:{updatedAt:"2026-10-16T12:00:00Z",keys:["A"]},expectedVersion:2n};
const next=await ledger.commit(lease,receipt);
assert.equal(next.version,3n);
assert(statements[1].includes('"fence"=$4::bigint AND "version"=$5::bigint'));
assert(statements[1].includes('"snapshotId" IS NULL OR "snapshotId"=$6'));
assert(statements[1].includes('CASE WHEN "objectKey"=$7'));
assert(statements[1].includes('"cursor"<>$9::jsonb'));
assert(statements[1].includes("::timestamptz"));
await assert.rejects(ledger.commit(lease,{...receipt,cursor:{updatedAt:"not-a-date",keys:["A"]}}),/foreign/);
await assert.rejects(ledger.commit(lease,{...receipt,cursor:{updatedAt:"2026-10-16T12:00:00Z",keys:[]}}),/foreign/);
await assert.rejects(ledger.commit(lease,{...receipt,objectKey:"semantic/staging/other"}),/foreign/);
await assert.rejects(ledger.acquire("gen1","employers","root",1),/lifetime/);
const renewed=await ledger.renew(next,60);
assert.equal(renewed.fence,4n);
assert.equal(renewed.version,3n);
assert(statements[2].includes('"leaseExpiresAt"=now()'));
assert(statements[2].includes('"fence"=$4::bigint AND "version"=$5::bigint'));
await assert.rejects(ledger.renew(next,1),/renewal/);

granted=false;
await assert.rejects(ledger.acquire("gen1","employers","render"),/held/);
await assert.rejects(ledger.commit(lease,receipt),/Stale/);
await assert.rejects(ledger.renew(next,60),/expired or fenced-out/);
console.log("Fenced staging ledger protects versioned receipts and blocks stale writers");
