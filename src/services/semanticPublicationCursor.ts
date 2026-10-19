// The first publication must not disappear when the audit table is empty.
// A null cursor tells the API to initialize from the newest existing event;
// the START sentinel explicitly means "fetch from the beginning".
export const EMPTY_SEMANTIC_PUBLICATION_CURSOR="START";

export function shouldLookupSemanticCursor(cursor:string|undefined):boolean {
  return Boolean(cursor && cursor!==EMPTY_SEMANTIC_PUBLICATION_CURSOR);
}

export function initialSemanticCursor(latestId:string|null|undefined):string {
  return latestId??EMPTY_SEMANTIC_PUBLICATION_CURSOR;
}

export function nextSemanticCursor(lastRowId:string|null|undefined,prior:string|undefined):string|null {
  return lastRowId??prior??null;
}
