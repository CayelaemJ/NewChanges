import assert from "node:assert/strict";
import {LOAD_ORDER} from "../src/services/reportFormats.js";
import {planReplacementStaging} from "../src/services/datasetReplacementStagingPlan.js";
const base={sourceFingerprint:"a".repeat(64),currentFingerprint:"b".repeat(64),
 feeds:LOAD_ORDER.map(reportKey=>({reportKey,rowCount:100,sourceWatermark:"2026-10-15T08:00:00Z"})),
 budget:{maxRowsPerFeed:1000,maxTotalRows:20000},existingEmployerIds:["OLD"],
 incomingEmployerIds:["NEW"],employerMapping:{OLD:"NEW"},evidence:{}};
const p=planReplacementStaging(base);
assert.equal(p.validForStagingReview,true);
assert.equal(p.executionEnabled,false);
assert.equal(p.sourceRows,1000);
assert.equal(p.planDigest,planReplacementStaging(base).planDigest);
assert.notEqual(p.planDigest,planReplacementStaging({...base,currentFingerprint:"c".repeat(64)}).planDigest);
assert.notEqual(p.planDigest,planReplacementStaging({...base,existingEmployerIds:["OLD","OLD2"]}).planDigest);
assert.notEqual(p.planDigest,planReplacementStaging({...base,incomingEmployerIds:["NEW","ANOTHER"]}).planDigest);
assert.equal(planReplacementStaging({...base,sourceFingerprint:base.currentFingerprint}).validForStagingReview,false);
assert.equal(planReplacementStaging({...base,incomingEmployerIds:["OLD"],employerMapping:{}}).validForStagingReview,false);
assert.equal(planReplacementStaging({...base,employerMapping:{OLD:"WRONG"}}).validForStagingReview,false);
assert.equal(planReplacementStaging({...base,employerMapping:{}}).validForStagingReview,false);
assert.equal(planReplacementStaging({...base,existingEmployerIds:["OLD","OLD2"],employerMapping:{OLD:"NEW"}}).validForStagingReview,false);
assert.equal(planReplacementStaging({...base,feeds:base.feeds.slice(1)}).validForStagingReview,false);
const estimated=LOAD_ORDER.map(reportKey=>({reportKey,rows:100,changedRows:2,averageBytesPerRow:1024}));
const limited={feeds:estimated,caps:{maxSourceReadBytes:1000,maxNeonWriteBytes:100000,
 maxNeonResidentBytes:100000,neonWriteAmplification:2,neonResidentAmplification:2}};
const rejected=planReplacementStaging({...base,transferEstimate:limited});
assert.equal(rejected.validForStagingReview,false);
assert(rejected.issues.some(x=>x.includes("source transfer")));
const accepted=planReplacementStaging({...base,transferEstimate:{...limited,
 caps:{...limited.caps,maxSourceReadBytes:2000000}}});
assert.equal(accepted.validForStagingReview,true);
assert.equal(accepted.transferBudget?.approvedForExecution,false);
assert.notEqual(accepted.planDigest,p.planDigest);
console.log("Different-source staging and optional transfer budget dry-run protections passed");
