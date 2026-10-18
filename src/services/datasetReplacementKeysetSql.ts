// Read-only SQL plan for indexed keyset extraction. This does not open a
// connection or guarantee snapshot isolation; the caller must bind a fixed
// source snapshot/transaction and persist an idempotent durable checkpoint.
import {getFormat,LOAD_ORDER} from "./reportFormats.js";
export type KeysetDialect="POSTGRESQL"|"MYSQL"|"MSSQL";
export interface KeysetCursor {
 updatedAt:string;
 keys:readonly (string|number)[];
}
export interface KeysetPlan {
 dialect:KeysetDialect;
 feed:string;
 schema?:string;
 viewPrefix?:string;
 upperWatermark:string;
 after?:KeysetCursor|null;
 limit:number;
}
const ident=/^[A-Za-z_][A-Za-z0-9_]*$/;
const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
function validDate(value:string):boolean {
 return timestamp.test(value)&&Number.isFinite(Date.parse(value));
}
export function buildCanonicalKeysetQuery(plan:KeysetPlan):{sql:string;params:(string|number)[];keyColumns:string[]}{
 const format=getFormat(plan.feed);
 if(!format||!LOAD_ORDER.includes(plan.feed))throw new Error("Unknown canonical feed");
 if(!["POSTGRESQL","MYSQL","MSSQL"].includes(plan.dialect))throw new Error("Unsupported SQL dialect");
 if(!Number.isSafeInteger(plan.limit)||plan.limit<1||plan.limit>1000)
  throw new Error("Invalid keyset page size");
 if(!validDate(plan.upperWatermark))throw new Error("Invalid upper source watermark");
 if(plan.after&&(!validDate(plan.after.updatedAt)||plan.after.keys.length!==format.naturalKey.length||
   plan.after.keys.some(v=>typeof v==="string"?v.length===0||v.length>2048:
     typeof v!=="number"||!Number.isSafeInteger(v))))
  throw new Error("Invalid keyset cursor");
 if(plan.after&&Date.parse(plan.after.updatedAt)>Date.parse(plan.upperWatermark))
  throw new Error("Cursor exceeds upper source watermark");
 const schema=plan.schema??"",prefix=plan.viewPrefix??"v_";
 if(schema&&!ident.test(schema))throw new Error("Invalid SQL schema");
 if(!ident.test(prefix))throw new Error("Invalid view prefix");
 const view=prefix+plan.feed;
 if(!ident.test(view))throw new Error("Invalid view name");
 const quote=(name:string)=>plan.dialect==="MYSQL"?"`"+name+"`":
    plan.dialect==="MSSQL"?"["+name+"]":'"'+name+'"';
 const table=(schema?quote(schema)+".":"")+quote(view);
 const params:(string|number)[]=[];
 const bind=(value:string|number)=>{params.push(value);return plan.dialect==="POSTGRESQL"?"$"+params.length:
   plan.dialect==="MSSQL"?"@p"+params.length:"?";};
 const updated=quote("source_updated_at");
 const upper=bind(plan.upperWatermark);
 const predicates=[updated+" <= "+upper];
 const keyColumns=[...format.naturalKey];
 if(plan.after){
  const ts=bind(plan.after.updatedAt);
  // Build a lexicographic disjunction for multi-column natural keys.
  // Stable unique keys are required upstream; ties cannot be disambiguated otherwise.
  const branches:string[]=[];
  for(let i=0;i<keyColumns.length;i++){
   const prefixEqual:string[]=[];
   for(let j=0;j<i;j++)prefixEqual.push(quote(keyColumns[j])+" = "+bind(plan.after.keys[j]));
   const greater=quote(keyColumns[i])+" > "+bind(plan.after.keys[i]);
   branches.push("("+[...prefixEqual,greater].join(" AND ")+")");
  }
  predicates.push("("+updated+" > "+ts+" OR ("+updated+" = "+bind(plan.after.updatedAt)+
   " AND ("+branches.join(" OR ")+")))");
 }
 const order=[updated,...keyColumns.map(quote)].join(", ");
 const limit=bind(plan.limit);
 const pageSuffix=plan.dialect==="MSSQL"?" OFFSET 0 ROWS FETCH NEXT "+limit+" ROWS ONLY":" LIMIT "+limit;
 const sql="SELECT * FROM "+table+" WHERE "+predicates.join(" AND ")+
   " ORDER BY "+order+" ASC"+pageSuffix;
 // ORDER BY col1, col2 ASC is valid on supported dialects: all columns ASC by default.
 return {sql,params,keyColumns};
}
