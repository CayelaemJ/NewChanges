// Pure incremental semantic refresh planner: no DB calls on normal dashboard GETs.
// Coalesce changed natural keys to affected employer/period partitions.
export type ChangedCanonicalRow = {
  feed: string;
  employerId: string;
  observedAt?: string | null;
  sourceUpdatedAt?: string | null;
  isDeleted?: boolean;
};
export type RefreshPartition = { employerId: string; period: string; feeds: string[]; deleted: boolean };
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const FEEDS = new Set(["employers","workforce_snapshots","employees","platform_users","journeys","debt_accounts","policies","ratings","referrals","salary_advances"]);
export function affectedSemanticPartitions(changes: ChangedCanonicalRow[], maxPartitions=500): RefreshPartition[] {
  if (!Number.isInteger(maxPartitions) || maxPartitions < 1 || maxPartitions > 5000) throw new Error("Invalid partition budget");
  const map = new Map<string,{ employerId:string; period:string; feeds:Set<string>; deleted:boolean }>();
  for (const c of changes) {
    if (!FEEDS.has(c.feed)) throw new Error("Unrecognized canonical feed");
    if (!c.employerId || c.employerId.length > 200) throw new Error("Invalid employer key");
    const time = c.observedAt || c.sourceUpdatedAt;
    if (!time || !Number.isFinite(Date.parse(time))) throw new Error("Missing or invalid change time");
    const period = time.slice(0,7);
    if (!PERIOD.test(period)) throw new Error("Invalid reporting period");
    const key=JSON.stringify([c.employerId,period]);
    let item=map.get(key);
    if (!item) {
      if (map.size >= maxPartitions) throw new Error("Refresh budget exceeded; split the input into bounded batches");
      item={employerId:c.employerId,period,feeds:new Set(),deleted:false};
      map.set(key,item);
    }
    item.feeds.add(c.feed);
    item.deleted ||= c.isDeleted === true;
  }
  return [...map.values()].map(x=>({employerId:x.employerId,period:x.period,feeds:[...x.feeds].sort(),deleted:x.deleted}))
    .sort((a,b)=>a.employerId.localeCompare(b.employerId)||a.period.localeCompare(b.period));
}
