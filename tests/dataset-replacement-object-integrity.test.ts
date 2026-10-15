import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {verifyReplacementObject} from "../src/services/datasetReplacementObjectIntegrity.js";
const content=Buffer.from('{"rows":[]}',"utf8");
const sha=createHash("sha256").update(content).digest("hex");
const g="gen1", fp="a".repeat(64);
const good={feed:"employees" as const,generationId:g,sourceFingerprint:fp,
  objectKey:`staging/${g}/${fp}/employees/${sha}.json`,expectedSha256:sha,
  expectedBytes:content.byteLength,rowCount:0,content};
assert.equal(verifyReplacementObject(good).validated,true);
assert.throws(()=>verifyReplacementObject({...good,content:Buffer.from('{"rows":[1]}')}),/length|digest/);
assert.throws(()=>verifyReplacementObject({...good,expectedSha256:"b".repeat(64)}),/digest/);
assert.throws(()=>verifyReplacementObject({...good,expectedBytes:0}),/bounded/);
assert.throws(()=>verifyReplacementObject({...good,objectKey:"production/employees.json"}),/lineage/);
assert.throws(()=>verifyReplacementObject({...good,objectKey:`staging/${g}/${fp}/employees/../x.json`}),/lineage/);
assert.throws(()=>verifyReplacementObject({...good,sourceFingerprint:"b".repeat(64)}),/lineage/);
console.log("Staged replacement object-integrity checks passed");
