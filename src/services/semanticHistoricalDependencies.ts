// Conservative dependency expansion for retroactive corrections.
// Effective-dated facts may change every later snapshot, so expand from the
// earliest affected period through the current reporting period. Do not use
// the month a source row was edited as its only affected reporting period.
import type { RefreshPartition } from "./semanticRefreshPlanner.js";

const periodValid=/^\d{4}-(0[1-9]|1[0-2])$/;
function ordinal(period:string):number {
  if(!periodValid.test(period)) throw new Error("Invalid reporting month");
  return Number(period.slice(0,4))*12+Number(period.slice(5))-1;
}
function month(index:number):string {
  const year=Math.floor(index/12), mo=index%12+1;
  return `${year}-${String(mo).padStart(2,"0")}`;
}
export function expandHistoricalRefresh(partitions:RefreshPartition[], endPeriod:string, maxPartitions=500):RefreshPartition[] {
  const end=ordinal(endPeriod);
  const merged=new Map<string,{employerId:string;period:string;feeds:Set<string>;deleted:boolean}>();
  for(const part of partitions) {
    const first=ordinal(part.period);
    if(first>end) throw new Error("Change period cannot be after current reporting month");
    for(let p=first;p<=end;p++) {
      const period=month(p), key=JSON.stringify([part.employerId,period]);
      let row=merged.get(key);
      if(!row) {
        if(merged.size>=maxPartitions) throw new Error("Historical refresh budget exceeded; split into chunks or schedule reconciliation");
        row={employerId:part.employerId,period,feeds:new Set(),deleted:false};
        merged.set(key,row);
      }
      for(const feed of part.feeds) row.feeds.add(feed);
      row.deleted ||= part.deleted;
    }
  }
  return [...merged.values()].map(x=>({employerId:x.employerId,period:x.period,feeds:[...x.feeds].sort(),deleted:x.deleted}))
    .sort((a,b)=>a.employerId.localeCompare(b.employerId)||a.period.localeCompare(b.period));
}
