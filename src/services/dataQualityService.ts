import { prisma } from "./snapshotBuilder.js";

const VERSION = "2.0.0";
const MAX_SCAN_ROWS = 50_000;
const MIN_BASELINE_ROWS = 30;
const ROBUST_Z_QUARANTINE = 12;
const ROBUST_Z_WARNING = 8;
const DRIFT_RATIO_QUARANTINE = 3;
const NEGATIVE_FIELD_RE = /(count|amount|balance|saving|income|salary|payment|value|total|eligible|activated|enrolled|headcount|employees?)/i;

type Finding = { severity:"WARNING"|"QUARANTINE"; code:string; field?:string; row?:number; message:string; action:string; score:number };
type NumericStats = { values:number[]; missing:number; invalid:number };

function finite(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function median(values:number[]) {
  if (!values.length) return 0;
  const a=[...values].sort((x,y)=>x-y), m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function mad(values:number[], m=median(values)) { return median(values.map(v=>Math.abs(v-m))); }
function flattenNumbers(row:Record<string,unknown>) {
  const out:Record<string,number>={};
  for (const [k,v] of Object.entries(row)) {
    if (finite(v)) out[k]=v;
    else if (typeof v==="string" && v.trim()!=="" && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())) {
      const n=Number(v); if (Number.isFinite(n)) out[k]=n;
    }
  }
  return out;
}

export async function assessIncomingRows(input:{reportKey:string; rows:Record<string,unknown>[]}) {
  const rows=input.rows.slice(0,MAX_SCAN_ROWS);
  const findings:Finding[]=[];
  const fields=new Map<string,NumericStats>();

for (let i=0;i<rows.length;i++) {
    const row=rows[i];
    for (const [field,value] of Object.entries(row)) {
      if (typeof value==="number" && !Number.isFinite(value)) {
        findings.push({severity:"QUARANTINE",code:"NON_FINITE",field,row:i+1,message:"Non-finite numeric value received.",action:"Fix the source value so it is a real finite number before reloading.",score:1});
        continue;
      }
      if (value == null || value==="") {
        const s=fields.get(field)||{values:[],missing:0,invalid:0}; s.missing++; fields.set(field,s);
      }
    }
    const nums=flattenNumbers(row);
    for (const [field,value] of Object.entries(nums)) {
      const s=fields.get(field)||{values:[],missing:0,invalid:0}; s.values.push(value); fields.set(field,s);
      if (NEGATIVE_FIELD_RE.test(field) && value < 0) {
        findings.push({severity:"QUARANTINE",code:"NEGATIVE_NON_NEGATIVE_FIELD",field,row:i+1,message:"Negative value received for a field expected to be non-negative.",action:"Check the source mapping, sign convention and upstream calculation; correct the source record before reloading.",score:1});
      }
    }
  }

  for (const [field,s] of fields) {
    if (s.values.length < 12) continue;
    const m=median(s.values), scale=Math.max(mad(s.values,m)*1.4826,Math.abs(m)*0.01,1e-9);
    let extreme=0;
    for (const v of s.values) if (Math.abs(v-m)/scale >= ROBUST_Z_QUARANTINE) extreme++;
    if (extreme >= Math.max(2,Math.ceil(s.values.length*0.02))) {
      findings.push({severity:"QUARANTINE",code:"ROBUST_OUTLIERS",field,message:`${extreme} values are extreme outliers versus the incoming distribution.`,action:"Inspect the affected field and source extract for a unit, decimal, mapping or population change before approving the load.",score:Math.min(1,extreme/s.values.length*10)});
    } else if (extreme) {
      findings.push({severity:"WARNING",code:"ROBUST_OUTLIER",field,message:`${extreme} extreme outlier detected in the incoming distribution.`,action:"Verify whether the outlier is a genuine business value or a source/data-entry error.",score:0.5});
    }
    const missingRate=s.missing/Math.max(rows.length,1);
    if (missingRate >= 0.35) findings.push({severity:"QUARANTINE",code:"MISSINGNESS_SPIKE",field,message:`${Math.round(missingRate*100)}% of incoming rows have no value for this field.`,action:"Restore the missing source values or explicitly update the feed contract if the field is no longer supplied.",score:missingRate});
  }

  // Compare the new distribution with the most recent committed batch when available.
  // This is deliberately advisory unless the shift is extreme, reducing false positives
  // when a legitimate employer population changes.
  const previous=await prisma.importBatch.findFirst({
    where:{reportKey:input.reportKey,status:"COMMITTED"},
    orderBy:{committedAt:"desc"},
    select:{id:true},
  });
  if (previous) {
    const priorRows=await prisma.importBatchRow.findMany({
      where:{batchId:previous.id},
      take:Math.min(MIN_BASELINE_ROWS*20,2000),
      orderBy:{rowIndex:"asc"},
      select:{data:true},
    });
    if (priorRows.length>=MIN_BASELINE_ROWS) {
      const priorFields=new Map<string,number[]>();
      for (const r of priorRows) for (const [k,v] of Object.entries(flattenNumbers(r.data as Record<string,unknown>))) {
        const a=priorFields.get(k)||[]; a.push(v); priorFields.set(k,a);
      }
      for (const [field,s] of fields) {
        const base=priorFields.get(field);
        if (!base || base.length<MIN_BASELINE_ROWS || s.values.length<MIN_BASELINE_ROWS) continue;
        const oldM=median(base), newM=median(s.values);
        if (Math.abs(oldM)>1e-9 && Math.abs(newM/oldM)>=DRIFT_RATIO_QUARANTINE) {
          findings.push({severity:"QUARANTINE",code:"DISTRIBUTION_SHIFT",field,message:`Median changed from ${oldM} to ${newM}, an extreme distribution shift.`,action:"Check for a source schema change, unit change, duplicated population, missing cohort or legitimate business event before approving the load.",score:Math.min(1,Math.abs(newM/oldM)/DRIFT_RATIO_QUARANTINE)});
        } else if (Math.abs(oldM)>1e-9 && Math.abs(newM/oldM)>=2) {
          findings.push({severity:"WARNING",code:"DISTRIBUTION_SHIFT_WARNING",field,message:`Median changed materially from ${oldM} to ${newM} versus the previous committed batch.`,action:"Review the period-over-period change and confirm it against the source system before approving the load.",score:0.5});
        }
      }
    }
  }

  const quarantine=findings.filter(f=>f.severity==="QUARANTINE");
  const warnings=findings.filter(f=>f.severity==="WARNING");
  const status=quarantine.length?"QUARANTINE":warnings.length?"REVIEW":"PASS";

  await prisma.mLOpsEvent.create({data:{
    eventType:"DATA_QUALITY_GATE",
    modelKey:"data-quality",
    modelVersion:VERSION,
    status,
    metadata:{
      reportKey:input.reportKey,
      scannedRows:rows.length,
      truncated:input.rows.length>MAX_SCAN_ROWS,
      findings:findings.slice(0,100),
      findingCount:findings.length
    }
  }});
  return {status,version:VERSION,scannedRows:rows.length,findings};
}

export const DATA_QUALITY_VERSION=VERSION;
