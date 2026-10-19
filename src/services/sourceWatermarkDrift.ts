// Pure source-watermark drift classification. A source table reset, hard
// deletion or broken timestamp must NOT be interpreted as "unchanged".
export type SourceWatermarkDecision=
  "CHANGED"|"UNCHANGED"|"REGRESSED"|"MISSING"|"INVALID";
export function classifySourceWatermark(
 newest:string|null, cursor:Date|null,
):SourceWatermarkDecision{
 const cursorMs=cursor?.getTime()??null;
 if(cursorMs!==null&&!Number.isFinite(cursorMs))return "INVALID";
 if(newest===null||newest.trim()==="")return cursorMs===null?"UNCHANGED":"MISSING";
 const raw=newest.trim();
 const hasZone=/(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
 const ms=Date.parse(hasZone?raw:raw.replace(" ","T")+"Z");
 if(!Number.isFinite(ms))return "INVALID";
 if(cursorMs===null||ms>cursorMs)return "CHANGED";
 if(ms<cursorMs)return "REGRESSED";
 return "UNCHANGED";
}
