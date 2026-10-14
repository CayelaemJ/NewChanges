import assert from "node:assert/strict";
import { LOAD_ORDER } from "../src/services/reportFormats.js";
import { verifyContinuity } from "../src/services/sourceActivation.js";
const checkpoint=new Date("2026-10-14T08:00:00.000Z");
const make=()=>({cursors:LOAD_ORDER.map(reportKey=>({
 reportKey,digest:"a".repeat(64),rowCount:10,lastSourceUpdatedAt:checkpoint,reconciledAt:checkpoint,
}))});
assert.doesNotThrow(()=>verifyContinuity(make(),make()));
const wrong=make();wrong.cursors[0].digest="b".repeat(64);
assert.throws(()=>verifyContinuity(make(),wrong),/continuity is unverified/);
const missing=make();missing.cursors.pop();
assert.throws(()=>verifyContinuity(make(),missing),/continuity is unverified/);
const count=make();count.cursors[2].rowCount=9;
assert.throws(()=>verifyContinuity(make(),count),/continuity is unverified/);
const cursor=make();cursor.cursors[3].lastSourceUpdatedAt=new Date("2026-10-14T08:00:01.000Z");
assert.throws(()=>verifyContinuity(make(),cursor),/continuity is unverified/);
console.log("Equivalent source cutover continuity tests passed");
