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
assert(!code.includes(String.raw`\\n\\nexport async function`),"Queue source must not contain literal escaped newline tokens");
const canonicalFeeds=["employers","workforce_snapshots","employees","platform_users","journeys","debt_accounts","policies","ratings","referrals","salary_advances"];
const feedSetSource=code.match(/const CANONICAL_FEEDS = new Set\((\[[^;]+?\])\);/)?.[1];
assert(feedSetSource,"Queue must declare supported canonical feeds");
const feedSet=JSON.parse(feedSetSource.replaceAll("'",'"'));
assert.deepEqual([...feedSet].sort(),[...canonicalFeeds].sort(),"Queue must accept exactly ten canonical feeds");
assert(enqueue.includes("!CANONICAL_FEEDS.has(feed)"),"Queue must reject unknown feeds before writes");
assert(enqueue.includes("generationId?.trim()"),"Queue must reject blank source generations");
assert(enqueue.includes("watermark instanceof Date"),"Queue must validate the watermark type before attempting queue writes");
assert(enqueue.includes("part.employerId.length > 200"),"Queue employer keys must honour the canonical planner length limit");
console.log("Batched semantic refresh queue safety assertions passed");
