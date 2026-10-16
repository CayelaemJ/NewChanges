import assert from "node:assert/strict";
import {createBoundedCloudStageHttp} from "../src/services/boundedCloudStageHttp.js";
const env={SEMANTIC_S3_ENDPOINT:"https://storage.example.test",
 SEMANTIC_S3_BUCKET:"testbucket",SEMANTIC_S3_REGION:"auto",
 SEMANTIC_S3_ACCESS_KEY_ID:"test",SEMANTIC_S3_SECRET_ACCESS_KEY:"testsecret"};
const http=createBoundedCloudStageHttp(1000,env);
const signed="https://storage.example.test/testbucket/semantic/staging/g1/s1/employers/abc.json?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=a";
await assert.rejects(http.get("http://example.org/?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=a",10),/signed/);
await assert.rejects(http.put("https://example.org/",new Uint8Array(1)),/signed/);
await assert.rejects(http.get("https://attacker.example.test/testbucket/semantic/staging/x?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=a",10),/signed/);
await assert.rejects(http.get("https://storage.example.test/testbucket/private?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=a",10),/signed/);
await assert.rejects(http.put(signed,new Uint8Array(17*1024*1024)),/budget/);
assert.throws(()=>createBoundedCloudStageHttp(31_000,env),/timeout/);
console.log("S3 staging transport pins approved bucket paths, rejects foreign hosts and unbounded payloads");
