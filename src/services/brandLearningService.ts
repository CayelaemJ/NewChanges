import { prisma } from "./snapshotBuilder.js";

const BINS = 36;
const MODEL_VERSION = "1.1.0";
const EMPTY = () => Array.from({ length: BINS }, () => 1);

function hueOf(hex: string) {
  const h = String(hex || "").replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const r=parseInt(h.slice(0,2),16)/255, g=parseInt(h.slice(2,4),16)/255, b=parseInt(h.slice(4,6),16)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  if(d < 0.04) return null;
  let x=0;
  if(max===r) x=60*((g-b)/d%6);
  else if(max===g) x=60*((b-r)/d+2);
  else x=60*((r-g)/d+4);
  return x<0?x+360:x;
}

export async function getBrandLearningProfile() {
  const row=await prisma.brandLearningState.findUnique({where:{id:"global"}});
  const prior=Array.isArray(row?.huePrior)?row!.huePrior.map(Number):EMPTY();
  return {
    engineVersion: row?.engineVersion || "1.1.0",
    uploadCount: row?.uploadCount || 0,
    labelledCount: row?.labelledCount || 0,
    acceptedCount: row?.acceptedCount || 0,
    averageConfidence: row?.averageConfidence || 0,
    huePrior: prior
  };
}

/** Every upload contributes a small unsupervised update. The low learning rate prevents one logo from dominating the global prior. */
export async function learnFromBrandUpload(input:{engineVersion:string; palette:any[]; confidence:number; accepted?:boolean}) {
  const current=await getBrandLearningProfile();
  const prior=current.huePrior.length===BINS?current.huePrior:EMPTY();
  const signal=Array(BINS).fill(0);
  for(const item of Array.isArray(input.palette)?input.palette:[]){
    const hue=hueOf(item?.hex);
    if(hue==null) continue;
    signal[Math.floor(hue/(360/BINS))]+=Math.max(0.05,Math.min(1,Number(item?.share)||0));
  }
  const total=signal.reduce((a,b)=>a+b,0)||1;
  const normalized=signal.map(v=>v/total);
  const lr=0.08;
  const next=prior.map((v,i)=>Math.max(0.01,(1-lr)*Number(v||1)+lr*(normalized[i]||0.01)));
  const uploads=current.uploadCount+1;
  const accepted=current.acceptedCount+(input.accepted?1:0);
  const avg=((current.averageConfidence*current.uploadCount)+Math.max(0,Math.min(1,Number(input.confidence)||0)))/uploads;
  await prisma.mLOpsEvent.create({ data: { eventType: "BRAND_UPLOAD", modelKey: "brand-colour", modelVersion: input.engineVersion || MODEL_VERSION, confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)), status: input.accepted ? "AUTO_ACCEPTED" : "NEEDS_REVIEW", metadata: { paletteSize: Array.isArray(input.palette) ? input.palette.length : 0 } } });
  return prisma.brandLearningState.upsert({
    where:{id:"global"},
    create:{id:"global",engineVersion:input.engineVersion||"1.1.0",uploadCount:1,acceptedCount:input.accepted?1:0,averageConfidence:Number(avg.toFixed(4)),huePrior:next},
    update:{engineVersion:input.engineVersion||current.engineVersion,uploadCount:uploads,acceptedCount:accepted,averageConfidence:Number(avg.toFixed(4)),huePrior:next}
  });
}

export async function recordBrandCorrection(input:{engineVersion:string; palette:any[]}) {
  const current=await getBrandLearningProfile();
  const prior=current.huePrior.length===BINS?current.huePrior:EMPTY();
  const signal=Array(BINS).fill(0);
  for(const item of Array.isArray(input.palette)?input.palette:[]){
    const hue=hueOf(item?.hex);
    if(hue==null) continue;
    signal[Math.floor(hue/(360/BINS))]+=Math.max(0.1,Math.min(1,Number(item?.share)||0));
  }
  const total=signal.reduce((a,b)=>a+b,0)||1;
  const normalized=signal.map(v=>v/total);
  const lr=0.30;
  const next=prior.map((v,i)=>Math.max(0.01,(1-lr)*Number(v||1)+lr*(normalized[i]||0.01)));
  await prisma.mLOpsEvent.create({ data: { eventType: "BRAND_CORRECTION", modelKey: "brand-colour", modelVersion: input.engineVersion || MODEL_VERSION, feedback: "CORRECTED", status: "LABELLED", metadata: { paletteSize: Array.isArray(input.palette) ? input.palette.length : 0 } } });
  return prisma.brandLearningState.upsert({
    where:{id:"global"},
    create:{id:"global",engineVersion:input.engineVersion||"1.1.0",uploadCount:0,labelledCount:1,acceptedCount:0,averageConfidence:0,huePrior:next},
    update:{engineVersion:input.engineVersion||current.engineVersion,labelledCount:{increment:1},huePrior:next}
  });
}
