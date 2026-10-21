import assert from "node:assert/strict";
import { requireMonotonicSemanticWatermark } from "../src/services/semanticPublicationOrdering.js";

const old = new Date("2026-10-19T10:00:00.000Z");
const current = new Date("2026-10-19T10:01:00.000Z");
assert.doesNotThrow(()=>requireMonotonicSemanticWatermark(old,undefined),
  "First publication must accept valid source provenance");
assert.doesNotThrow(()=>requireMonotonicSemanticWatermark(current,old),
  "A later source cursor must be publishable");
assert.doesNotThrow(()=>requireMonotonicSemanticWatermark(old,old),
  "Equal source cursor may be republished with CAS for verified content");
assert.throws(()=>requireMonotonicSemanticWatermark(old,current),/cannot regress source watermark/);
for(const invalid of [null,new Date(NaN)])
  assert.throws(()=>requireMonotonicSemanticWatermark(invalid,undefined),/valid source watermark/);
for(const invalid of [null,new Date(NaN)])
  assert.throws(()=>requireMonotonicSemanticWatermark(current,invalid),/Previous semantic publication/);
console.log("Semantic publication lineage ordering tests passed");
