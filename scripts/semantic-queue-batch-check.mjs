import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const code=readFileSync("src/services/semanticRefreshQueue.ts","utf8");
const enqueue=code.slice(code.indexOf("export async function enqueueSemanticRefresh"),code.indexOf("export async function claimSemanticRefresh"));
assert(enqueue.includes("partitions.length>500"),"Queue must have a partition budget");
assert(enqueue.includes("i+=100"),"Queue must batch bounded chunks");
assert(enqueue.includes("records.slice(i,i+100)"),"Queue batch must not exceed 100");
assert(enqueue.includes("skipDuplicates:true"),"Queue must deduplicate across hosts");
assert(enqueue.includes("partitions.length-queued"),"Dedup count must include coalesced and pre-existing jobs");
assert(enqueue.includes("grouped=new Map"),"Same employer-period must coalesce changed feeds before writes");
assert(!enqueue.includes("for (const part of partitions) {"),"Do not make individual database calls per semantic partition");

const monthRegexSource=enqueue.match(/!\s*(\/\^[^\n]+?\$\/)\.test\(part\.period\)/)?.[1];
assert(monthRegexSource,"Queue must validate canonical YYYY-MM partitions");
const monthRegex=new RegExp(monthRegexSource.slice(1,-1));
for(const period of ["2026-01","2026-10","2026-12"])
 assert(monthRegex.test(period),`Valid semantic period rejected: ${period}`);
for(const period of ["2026-00","2026-13","2026-1","invalid","2026-12-extra"])
 assert(!monthRegex.test(period),`Invalid semantic period accepted: ${period}`);
console.log("Batched semantic refresh queue safety assertions passed");
