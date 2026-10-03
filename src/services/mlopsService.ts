import { prisma } from "./snapshotBuilder.js";

const VERSION = "1.0.0";
const MODEL_KEYS = {
  QUALITY: "data-quality",
  DRIFT: "data-drift",
  ANOMALY: "kpi-anomaly",
  FORECAST: "programme-forecast",
  BRAND: "brand-colour",
} as const;

type Snapshot = { period: string; optimiseScore: number | null; rawScore: number | null; payload: any };

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function numericPaths(value: any, prefix = "", out: Record<string, number> = {}): Record<string, number> {
  if (finite(value)) {
    if (prefix) out[prefix] = value;
    return out;
  }
  if (!value || typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Object.keys(out).length >= 250) break;
    numericPaths(child, path, out);
  }
  return out;
}

async function snapshots(employerId: string, limit = 18): Promise<Snapshot[]> {
  const rows = await prisma.scoreSnapshot.findMany({
    where: { employerId, payloadVersion: { gte: 4 } },
    orderBy: { period: "desc" },
    take: limit,
    select: { period: true, optimiseScore: true, rawScore: true, payload: true },
  });
  return rows.reverse().map((r: any) => ({ period: r.period, optimiseScore: finite(Number(r.optimiseScore)) ? Number(r.optimiseScore) : null, rawScore: finite(Number(r.rawScore)) ? Number(r.rawScore) : null, payload: r.payload }));
}

function seriesFor(rows: Snapshot[], metric = "optimiseScore") {
  return rows.map((r) => {
    if (metric === "optimiseScore" || metric === "rawScore") return { period: r.period, value: (r as any)[metric] };
    const flat = numericPaths(r.payload);
    const direct = flat[metric];
    if (finite(direct)) return { period: r.period, value: direct };
    const hit = Object.entries(flat).find(([k]) => k.toLowerCase().endsWith(metric.toLowerCase()));
    return { period: r.period, value: hit && finite(hit[1]) ? hit[1] : null };
  }).filter((x): x is { period: string; value: number } => finite(x.value));
}

function mean(a: number[]) { return a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0; }
function std(a: number[]) { if (a.length < 2) return 0; const m=mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2))); }

function linearForecast(values: number[], horizon = 1) {
  if (values.length < 3) return null;
  const n=values.length, xm=(n-1)/2, ym=mean(values);
  let num=0, den=0;
  for(let i=0;i<n;i++){ num+=(i-xm)*(values[i]-ym); den+=(i-xm)**2; }
  const slope=den ? num/den : 0, intercept=ym-slope*xm;
  return Array.from({length:horizon},(_,i)=>Number((intercept+slope*(n+i)).toFixed(4)));
}

async function event(data: any) {
  return prisma.mLOpsEvent.create({ data: {
    eventType:String(data.eventType), modelKey:String(data.modelKey), modelVersion:String(data.modelVersion||VERSION),
    employerId:data.employerId||null, period:data.period||null, metric:data.metric||null,
    actualValue:finite(data.actualValue)?data.actualValue:null, predictedValue:finite(data.predictedValue)?data.predictedValue:null,
    confidence:finite(data.confidence)?Math.max(0,Math.min(1,data.confidence)):null,
    driftScore:finite(data.driftScore)?data.driftScore:null, anomalyScore:finite(data.anomalyScore)?data.anomalyScore:null,
    status:data.status||null, feedback:data.feedback||null, features:data.features||undefined, metadata:data.metadata||undefined
  }});
}

export async function runMLOpsAssessment(employerId: string) {
  const rows=await snapshots(employerId,18);
  const latest=rows.at(-1);
  const values=seriesFor(rows);
  const nums=values.map(x=>x.value);
  const recent=nums.slice(-3), baseline=nums.slice(0,-3);
  const drift=Math.abs(mean(recent)-mean(baseline))/(std(baseline)||1);
  const z=nums.length>3 ? Math.abs((nums.at(-1)!-mean(nums.slice(0,-1)))/(std(nums.slice(0,-1))||1)) : 0;
  const qualityIssues:string[]=[];
  if(!rows.length) qualityIssues.push("No persisted monthly snapshots are available.");
  if(rows.length && rows.some((r,i)=>i>0 && r.period===rows[i-1].period)) qualityIssues.push("Duplicate reporting periods detected.");
  if(rows.length<6) qualityIssues.push("Fewer than six historical periods are available for stable model evaluation.");
  if(nums.some(v=>!Number.isFinite(v))) qualityIssues.push("Non-finite KPI values detected.");
  const forecast=linearForecast(nums,3);
  const result={
    modelVersion:VERSION, generatedAt:new Date().toISOString(), latestPeriod:latest?.period||null,
    dataQuality:{status:qualityIssues.length?"REVIEW":"PASS", issues:qualityIssues, periods:rows.length},
    drift:{score:Number(drift.toFixed(4)), status:drift>=2?"DRIFT":"STABLE", baselinePeriods:Math.max(0,rows.length-3)},
    anomaly:{score:Number(z.toFixed(4)), status:z>=3?"ANOMALY":"NORMAL", latestValue:nums.at(-1)??null},
    forecast:{metric:"optimiseScore", history:nums.slice(-12), next3:forecast, confidence:nums.length>=8?0.72:0.45},
    models:Object.values(MODEL_KEYS).map(modelKey=>({modelKey,version:VERSION,status:"SHADOW"}))
  };
  await event({eventType:"ASSESSMENT",modelKey:MODEL_KEYS.QUALITY,employerId,period:latest?.period,metadata:result});
  await event({eventType:"DRIFT_CHECK",modelKey:MODEL_KEYS.DRIFT,employerId,period:latest?.period,driftScore:result.drift.score,status:result.drift.status});
  await event({eventType:"ANOMALY_CHECK",modelKey:MODEL_KEYS.ANOMALY,employerId,period:latest?.period,anomalyScore:result.anomaly.score,status:result.anomaly.status,actualValue:result.anomaly.latestValue});
  if(forecast) await event({eventType:"FORECAST",modelKey:MODEL_KEYS.FORECAST,employerId,period:latest?.period,predictedValue:forecast[0],confidence:result.forecast.confidence,status:"SHADOW"});
  return result;
}

export async function getMLOpsPortfolioAssessment(employerIds: string[]) {
  const results=[] as any[];
  for(let i=0;i<employerIds.length;i+=4){
    const batch=employerIds.slice(i,i+4);
    results.push(...await Promise.all(batch.map(async id=>({employerId:id,assessment:await runMLOpsAssessment(id)}))));
  }
  return {modelVersion:VERSION,employers:results};
}

export async function recordMLOpsFeedback(input:{modelKey:string; eventId?:string; employerId?:string; feedback:"CORRECT"|"INCORRECT"|"REVIEWED"; actualValue?:number; notes?:string}) {
  if(!["CORRECT","INCORRECT","REVIEWED"].includes(input.feedback)) throw new Error("Invalid feedback.");
  const result=await event({eventType:"HUMAN_FEEDBACK",modelKey:input.modelKey,employerId:input.employerId,actualValue:input.actualValue,feedback:input.feedback,status:"LABELLED",metadata:{eventId:input.eventId,notes:input.notes}});
  return {ok:true,feedbackId:result.id};
}

export async function listMLOpsModels() {
  return prisma.mLOpsModel.findMany({orderBy:[{modelKey:"asc"},{createdAt:"desc"}]});
}

export async function registerMLOpsModel(input:{modelKey:string;version:string;modelType:string;trainingVersion?:string;metrics?:any;featureSchema?:any}) {
  return prisma.mLOpsModel.upsert({
    where:{modelKey_version:{modelKey:input.modelKey,version:input.version}},
    create:{modelKey:input.modelKey,version:input.version,modelType:input.modelType,trainingVersion:input.trainingVersion||null,metrics:input.metrics||undefined,featureSchema:input.featureSchema||undefined,status:"SHADOW"},
    update:{modelType:input.modelType,trainingVersion:input.trainingVersion||null,metrics:input.metrics||undefined,featureSchema:input.featureSchema||undefined}
  });
}

export async function promoteMLOpsModel(modelKey:string,version:string) {
  const candidate=await prisma.mLOpsModel.findUnique({where:{modelKey_version:{modelKey,version}}});
  if(!candidate) throw new Error("Model version not found.");
  const active=await prisma.mLOpsModel.findMany({where:{modelKey,status:"ACTIVE"}});
  await prisma.$transaction([
    ...active.map((m:any)=>prisma.mLOpsModel.update({where:{id:m.id},data:{status:"RETIRED",retiredAt:new Date()}})),
    prisma.mLOpsModel.update({where:{id:candidate.id},data:{status:"ACTIVE",promotedAt:new Date()}})
  ]);
  return prisma.mLOpsModel.findUnique({where:{id:candidate.id}});
}

export async function rollbackMLOpsModel(modelKey:string,version:string) {
  const candidate=await prisma.mLOpsModel.findUnique({where:{modelKey_version:{modelKey,version}}});
  if(!candidate) throw new Error("Model version not found.");
  return prisma.mLOpsModel.update({where:{id:candidate.id},data:{status:"RETIRED",retiredAt:new Date()}});
}

export async function listMLOpsEvents(modelKey?:string,limit=100) {
  return prisma.mLOpsEvent.findMany({where:modelKey?{modelKey}:undefined,orderBy:{createdAt:"desc"},take:Math.min(500,Math.max(1,limit))});
}

export const MLOPS_MODEL_VERSION=VERSION;
