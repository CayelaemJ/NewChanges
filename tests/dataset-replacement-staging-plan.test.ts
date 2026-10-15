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
assert.equal(planReplacementStaging({...base,sourceFingerprint:base.currentFingerprint}).validForStagingReview,false);
assert.equal(planReplacementStaging({...base,incomingEmployerIds:["OLD"],employerMapping:{}}).validForStagingReview,false);
assert.equal(planReplacementStaging({...base,employerMapping:{OLD:"WRONG"}}).validForStagingReview,false);
assert.equal(planReplacementStaging({...base,feeds:base.feeds.slice(1)}).validForStagingReview,false);
console.log("Different-source staging dry-run protections passed");
