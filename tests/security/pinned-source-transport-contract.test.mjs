// Static integration gate: the real ingestion path must use the vetted,
// DNS-pinned HTTPS transport. Unit tests alone don't prove adoption.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";

const source=(path)=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const adapter=source("src/services/sourceAdapter.ts");
const pinned=source("src/services/pinnedSourceHttps.ts");
const body=source("src/services/boundedSourceJson.ts");

test("every canonical API feed page uses the verified TLS transport",()=>{
  const start=adapter.indexOf("async function fetchPage(");
  const end=adapter.indexOf("async function* iterateReportPages",start);
  assert.ok(start>0&&end>start);
  const page=adapter.slice(start,end);
  assert.match(adapter,/import \{ readPinnedSourceApiJson \} from "\.\/pinnedSourceHttps\.js"/);
  assert.match(page,/await readPinnedSourceApiJson\(url, token\)/);
  assert.doesNotMatch(page,/await fetch\(/);
  assert.match(page,/await assertSafeApiBaseUrl\(url\.toString\(\)\)/);
});

test("source TLS connection pins vetted DNS without re-resolution or redirects",()=>{
  assert.match(pinned,/const answers = await resolvePublicSourceAddresses\(hostname\)/);
  assert.match(pinned,/lookup: pinnedSourceLookup\(hostname, answers\)/);
  assert.match(pinned,/rejectUnauthorized: true/);
  assert.match(pinned,/agent: false/);
  assert.match(pinned,/response\.statusCode >= 300/);
  assert.match(pinned,/AbortSignal\.timeout\(timeoutMs\)/);
});

test("source adapter rejects unsafe public destination and unbounded responses",()=>{
  assert.match(pinned,/isBlockedSourceAddress\(item\.address\)/);
  assert.match(pinned,/await readSourceJson\(new Response\(body, \{ headers \}\)\)/);
  assert.match(body,/bytes>maxBytes/);
  assert.match(pinned,/response\.headers\["content-encoding"\] !== "identity"/);
});
