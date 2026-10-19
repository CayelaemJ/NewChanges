// Source refresh must not hide a partially imported ten-feed chain.
// Keep statuses distinct: a partial commit is not a healthy sync.
export function syncStatusNeedsAlert(status:unknown):boolean{
 return status==="FAILED"||status==="PARTIAL";
}
export function safeSyncAlertSummary(result:{status?:unknown;summary?:unknown}|null|undefined){
 const status=result?.status==="PARTIAL"?"PARTIAL":"FAILED";
 return {status,reason:status==="PARTIAL"?
  "Source refresh partially failed; some downstream feeds were blocked. Review Administration > Live Data Integration.":
  "Source refresh failed; review Administration > Live Data Integration."};
}
