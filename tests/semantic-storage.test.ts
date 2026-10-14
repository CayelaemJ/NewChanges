import assert from "node:assert/strict";
import { presignS3Request } from "../src/services/semanticS3Broker.js";
import { publicSemanticStorageHealth } from "../src/services/semanticStorageSettings.js";
const env = {
 SEMANTIC_S3_ENDPOINT:"https://storage.example.com",
 SEMANTIC_S3_BUCKET:"semantic-snapshots",
 SEMANTIC_S3_REGION:"eu-west-1",
 SEMANTIC_S3_ACCESS_KEY_ID:"FAKE_TEST_KEY",
 SEMANTIC_S3_SECRET_ACCESS_KEY:"FAKE_TEST_SECRET",
} as NodeJS.ProcessEnv;
const now=new Date("2026-10-14T10:00:00.000Z");
const path="semantic/generation/employer/2026-10/a.json";
const a=presignS3Request({method:"GET",key:path,now},env);
const b=presignS3Request({method:"GET",key:path,now},env);
assert.equal(a,b,"Signing must be stable for deterministic inputs");
const url=new URL(a);
assert.equal(url.protocol,"https:");
assert.equal(url.pathname,"/semantic-snapshots/"+path);
assert.equal(url.searchParams.get("X-Amz-Algorithm"),"AWS4-HMAC-SHA256");
assert.equal(url.searchParams.get("X-Amz-Expires"),"300");
assert.match(url.searchParams.get("X-Amz-Signature")||"",/^[0-9a-f]{64}$/);
assert(!a.includes(env.SEMANTIC_S3_SECRET_ACCESS_KEY!));
const put=presignS3Request({method:"PUT",key:path,now},env);
assert.notEqual(a,put,"PUT and GET signatures must not be interchangeable");
assert.throws(()=>presignS3Request({method:"PUT",key:"../bad",now},env),/Invalid semantic object key/);
const virtual = presignS3Request({method:"GET",key:path,now}, {...env,SEMANTIC_S3_URL_STYLE:"virtual-host"});
const virtualUrl=new URL(virtual);
assert.equal(virtualUrl.host,"semantic-snapshots.storage.example.com");
assert.equal(virtualUrl.pathname,"/"+path);
assert.notEqual(virtual,a);
assert.throws(()=>presignS3Request({method:"GET",key:path,now},{...env,SEMANTIC_S3_URL_STYLE:"unknown"}),/Invalid S3 addressing style/);
assert.deepEqual(publicSemanticStorageHealth(env).missing,[]);
console.log("Semantic S3 signing checks passed");
