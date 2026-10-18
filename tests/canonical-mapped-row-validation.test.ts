import assert from "node:assert/strict";
import {validateMappedCanonicalPage} from "../src/services/canonicalMappedRowValidation.js";
const now=new Date("2026-10-16T12:00:00Z");
const good=validateMappedCanonicalPage("employers",[
 {employer_ref:"A",name:"Company A",source_updated_at:now},
 {employer_ref:"B",name:"Company B",source_updated_at:"2026-10-16T13:00:00Z"}
]);
assert.equal(good.length,2);
assert(good[0].source_updated_at instanceof Date);
await assert.rejects(Promise.resolve().then(()=>validateMappedCanonicalPage("employers",[
 {employer_ref:"A",name:"Company A",source_updated_at:"invalid"}
])),/source_updated_at/);
assert.throws(()=>validateMappedCanonicalPage("employers",[
 {employer_ref:"A",name:"A",source_updated_at:now},
 {employer_ref:"A",name:"A",source_updated_at:now}
]),/duplicate natural key/);
assert.throws(()=>validateMappedCanonicalPage("employees",[
 {employer_ref:"A",payroll_ref:"p",observed_at:"not-a-date",eligible_from:"2026-01-01",source_updated_at:now}
]),/observed_at/);
assert.throws(()=>validateMappedCanonicalPage("employers",[
 {employer_ref:"A",name:"A",source_updated_at:new Date(NaN)}
]),/invalid date/);
console.log("Mapped canonical business validation handles dates, required fields, and page duplicates");
