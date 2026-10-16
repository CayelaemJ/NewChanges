import assert from "node:assert/strict";
import {createBoundedCloudStageHttp} from "../src/services/boundedCloudStageHttp.js";
const http=createBoundedCloudStageHttp(1000);
await assert.rejects(http.get("http://example.org/?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=a",10),/HTTPS/);
await assert.rejects(http.put("https://example.org/",new Uint8Array(1)),/SigV4/);
await assert.rejects(http.put("https://example.org/?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=a",new Uint8Array(17*1024*1024)),/budget/);
assert.throws(()=>createBoundedCloudStageHttp(31_000),/timeout/);
console.log("S3 staging transport rejects unsigned URLs, redirects by policy, and unbounded payloads");
