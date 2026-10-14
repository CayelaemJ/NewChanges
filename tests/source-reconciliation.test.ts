import assert from "node:assert/strict";
import { fingerprintCanonicalRecords } from "../src/services/sourceReconciliation.js";
const a=[
 {id:"1",name:"Alpha",source_updated_at:new Date("2026-10-14T08:00:00Z")},
 {id:"2",name:"Beta",score:3.5},
];
const b=[
 {score:3.5,name:"Beta",id:"2"},
 {source_updated_at:"2026-10-14T08:00:00.000Z",name:"Alpha",id:"1"},
];
assert.equal(fingerprintCanonicalRecords(a),fingerprintCanonicalRecords(b),"Equivalent feeds must not depend on physical row or field order");
const changed=[...a.slice(0,1),{...a[1],score:3.6}];
assert.notEqual(fingerprintCanonicalRecords(a),fingerprintCanonicalRecords(changed),"A changed business value must invalidate its content proof");
assert.notEqual(fingerprintCanonicalRecords(a),fingerprintCanonicalRecords(a.slice(0,1)),"A missing record must invalidate proof");
console.log("Full-source canonical reconciliation digest tests passed");
