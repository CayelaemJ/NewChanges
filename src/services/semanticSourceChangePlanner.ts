// Pure, bounded mapping from validated SQL incremental records to the
// business periods whose semantic snapshots must be reconsidered.
// Source update timestamps are transport cursors, NOT reporting dates.
import { affectedSemanticPartitions, type RefreshPartition } from "./semanticRefreshPlanner.js";
import { expandHistoricalRefresh } from "./semanticHistoricalDependencies.js";

const BUSINESS_DATES: Record<string,readonly string[]> = {
  employers:["eligible_count_as_at"],
  workforce_snapshots:["as_of_date"],
  employees:["observed_at","eligible_from","eligible_to"],
  platform_users:["enrolled_at","activated_at"],
  journeys:["started_at","completed_at"],
  debt_accounts:["observed_at","closed_at"],
  policies:["observed_at","effective_from","effective_to","resolved_at"],
  ratings:["created_at"],
  referrals:["shared_at","converted_at"],
  salary_advances:["advanced_at"],
};
function dateString(raw: unknown):string|null {
  if(raw == null || raw === "")return null;
  if(typeof raw==="string"){
    // Reject rolled-over dates (e.g. February 31) and timezone-less timestamps.
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
      const parsed=new Date(raw+"T00:00:00Z");
      if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==raw)
        throw new Error("Invalid business date in canonical source row");
      return parsed.toISOString();
    }
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(raw))
      throw new Error("Invalid business date in canonical source row");
    const parsed=new Date(raw);
    if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==raw.slice(0,10))
      throw new Error("Invalid business date in canonical source row");
    return parsed.toISOString();
  }
  if(!(raw instanceof Date) || !Number.isFinite(raw.getTime()))
    throw new Error("Invalid business date in canonical source row");
  return raw.toISOString();
}
export function partitionsFromCanonicalSourceRows(feed:string,rows:Record<string,unknown>[],maxPartitions=500):RefreshPartition[] {
  const fields=BUSINESS_DATES[feed];
  if(!fields)throw new Error("Unrecognized canonical feed");
  const changes=rows.map(row=>{
    if(!row || typeof row!=="object" || Array.isArray(row)) throw new Error("Invalid canonical source row");
    if(typeof row.employer_ref!=="string" || !row.employer_ref.trim() || row.employer_ref.length>200)
      throw new Error("Invalid canonical employer key");
    const employerId=row.employer_ref;
    const businessDates=fields.map(key=>dateString(row[key])).filter((x):x is string=>x!=null);
    const earliest=businessDates.length?businessDates.sort()[0]:dateString(row.source_updated_at);
    if(!earliest)throw new Error("Missing business and source change timestamp");
    return {feed,employerId,observedAt:earliest,isDeleted:row.is_deleted===true};
  });
  return affectedSemanticPartitions(changes,maxPartitions);
}
export function mergeAndExpandSemanticPartitions(partitions:RefreshPartition[],endPeriod:string,maxPartitions=500):RefreshPartition[] {
  // Merge duplicates BEFORE historical expansion, otherwise repeated source
  // rows needlessly inflate the partition budget.
  const merged=new Map<string,{employerId:string;period:string;feeds:Set<string>;deleted:boolean}>();
  for(const p of partitions){
    const key=JSON.stringify([p.employerId,p.period]);
    let item=merged.get(key);
    if(!item){
      if(merged.size>=maxPartitions)throw new Error("Semantic change budget exceeded");
      item={employerId:p.employerId,period:p.period,feeds:new Set(),deleted:false};
      merged.set(key,item);
    }
    for(const feed of p.feeds)item.feeds.add(feed);
    item.deleted ||= p.deleted;
  }
  return expandHistoricalRefresh([...merged.values()].map(x=>({...x,feeds:[...x.feeds]})),endPeriod,maxPartitions);
}
