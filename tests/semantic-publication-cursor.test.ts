import assert from "node:assert/strict";
import {
  EMPTY_SEMANTIC_PUBLICATION_CURSOR,
  shouldLookupSemanticCursor,
  initialSemanticCursor,
  nextSemanticCursor,
} from "../src/services/semanticPublicationCursor.js";

assert.equal(initialSemanticCursor(null),EMPTY_SEMANTIC_PUBLICATION_CURSOR);
assert.equal(initialSemanticCursor(undefined),EMPTY_SEMANTIC_PUBLICATION_CURSOR);
assert.equal(shouldLookupSemanticCursor(undefined),false);
assert.equal(shouldLookupSemanticCursor(EMPTY_SEMANTIC_PUBLICATION_CURSOR),false);
assert.equal(nextSemanticCursor(null,EMPTY_SEMANTIC_PUBLICATION_CURSOR),EMPTY_SEMANTIC_PUBLICATION_CURSOR,
  "An empty history must retain its cursor, not reinitialize");
assert.equal(nextSemanticCursor("first-publication-id",EMPTY_SEMANTIC_PUBLICATION_CURSOR),"first-publication-id",
  "The first published event must advance the initially empty feed");
assert.equal(shouldLookupSemanticCursor("first-publication-id"),true,
  "A real publication cursor must use chronological pagination");
assert.equal(initialSemanticCursor("previous-publication-id"),"previous-publication-id");
assert.equal(nextSemanticCursor(undefined,"previous-publication-id"),"previous-publication-id");
console.log("First semantic publication event is not skipped by an empty-history cursor");
