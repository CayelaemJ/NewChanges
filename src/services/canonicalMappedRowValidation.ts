// Canonical business/type gate for mapped source rows, bounded to one page.
// Coerces source driver Date objects deterministically; never invents data.
import {getFormat} from "./reportFormats.js";
import {validateRecordEarly} from "./validationStrategies.js";

export function validateMappedCanonicalPage(feed:string,records:readonly Record<string,unknown>[]){
 const format=getFormat(feed);
 if(!format)throw new Error("Unknown canonical validation feed");
 if(!Array.isArray(records)||records.length>1000)throw new Error("Canonical page exceeds row limit");
 const errors:string[]=[];
 const normalized:Record<string,unknown>[]=[];
 const seen=new Set<string>();
 for(let i=0;i<records.length;i++){
  const raw=records[i];
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
   throw new Error("Invalid mapped canonical row");
  const normalizedRaw:Record<string,unknown>={...raw};
  for(const field of format.fields){
   const value=raw[field.name];
   if(value instanceof Date){
    if(!Number.isFinite(value.getTime()))errors.push("row "+(i+1)+": invalid date "+field.name);
    else if(field.type==="date")normalizedRaw[field.name]=value.toISOString().slice(0,10);
    else if(field.type==="datetime")normalizedRaw[field.name]=value.toISOString();
   }
  }
  const rowErrors:Parameters<typeof validateRecordEarly>[3]=[];
  const row=validateRecordEarly(format,normalizedRaw,i+1,rowErrors);
  for(const error of rowErrors)errors.push("row "+error.row+" / "+error.column+": "+error.reason);
  if(rowErrors.length)continue;
  const identity=JSON.stringify(format.naturalKey.map(key=>{
   const x=row[key];return x instanceof Date?x.toISOString():x;
  }));
  if(seen.has(identity))errors.push("duplicate natural key within mapped page");
  seen.add(identity);
  normalized.push(row);
 }
 if(errors.length)throw new Error("Canonical mapping validation failed: "+errors.slice(0,8).join("; "));
 return normalized;
}
