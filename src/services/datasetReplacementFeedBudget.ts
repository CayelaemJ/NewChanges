import { LOAD_ORDER, getFormat } from "./reportFormats.js";

export interface ReplacementFeedEstimate {
  reportKey:string;
  rowCount:number;
  sourceWatermark:string|null;
}
export interface ReplacementBudget {
  maxRowsPerFeed:number;
  maxTotalRows:number;
}
export function inspectReplacementFeedBudget(rows:ReplacementFeedEstimate[], budget:ReplacementBudget) {
  const problems:string[]=[];
  if(!Number.isSafeInteger(budget.maxRowsPerFeed)||budget.maxRowsPerFeed<1||
     !Number.isSafeInteger(budget.maxTotalRows)||budget.maxTotalRows<1)
    throw new Error("Replacement budget must use positive integer row limits");
  const seen=new Set<string>();
  let total=0;
  for(const item of rows){
    if(!LOAD_ORDER.includes(item.reportKey as (typeof LOAD_ORDER)[number])||!getFormat(item.reportKey))
      problems.push("Unrecognized canonical feed");
    if(seen.has(item.reportKey))problems.push("Duplicate canonical feed: "+item.reportKey);
    seen.add(item.reportKey);
    if(!Number.isSafeInteger(item.rowCount)||item.rowCount<0)
      problems.push("Invalid row count for "+item.reportKey);
    else {
      total+=item.rowCount;
      if(item.rowCount>budget.maxRowsPerFeed)
        problems.push("Per-feed row budget exceeded: "+item.reportKey);
    }
    if(item.sourceWatermark!==null && !Number.isFinite(Date.parse(item.sourceWatermark)))
      problems.push("Invalid source watermark: "+item.reportKey);
  }
  for(const feed of LOAD_ORDER)if(!seen.has(feed))problems.push("Missing canonical feed: "+feed);
  if(total>budget.maxTotalRows)problems.push("Total source row budget exceeded");
  return {valid:problems.length===0,issues:problems,totalRows:total,
    expectedFeeds:LOAD_ORDER.length,executionEnabled:false as const,
    note:"Read-only source estimate only. It neither loads rows nor approves replacement."};
}
