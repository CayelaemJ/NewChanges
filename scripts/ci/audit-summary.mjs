import {spawnSync} from "node:child_process";
import {writeFileSync,mkdirSync} from "node:fs";
const r=spawnSync(process.platform==="win32"?"npm.cmd":"npm",["audit","--json","--audit-level=high"],{
 encoding:"utf8",maxBuffer:20*1024*1024,timeout:120000
});
let report;
try{report=JSON.parse(r.stdout||"")}catch{
  console.error("[dependency-audit] npm did not return valid JSON. Review registry access and npm audit command.");
  process.exit(1);
}
const counts=report.metadata?.vulnerabilities||{};
const severe=(counts.high||0)+(counts.critical||0);
const details=Object.entries(report.vulnerabilities||{}).filter(([,v])=>v?.severity==="high"||v?.severity==="critical")
 .map(([name,v])=>({name,severity:v.severity,fixAvailable:Boolean(v.fixAvailable)}))
 .sort((a,b)=>a.name.localeCompare(b.name));
const result={status:severe?"fail":r.status===0?"pass":"unknown",severityCounts:{
 low:counts.low||0,moderate:counts.moderate||0,high:counts.high||0,critical:counts.critical||0
},packages:details,commandExit:r.status,reportCode:report.error?.code||null};
mkdirSync("test-results",{recursive:true});
writeFileSync("test-results/dependency-audit-summary.json",JSON.stringify(result,null,2)+"\n");
console.log("[dependency-audit] Counts:",JSON.stringify(result.severityCounts));
console.log("[dependency-audit] High/critical packages (no secrets):",details.map(v=>v.name+" ("+v.severity+", fix="+v.fixAvailable+")").join(", ")||"none");
if(report.error?.code)console.error("[dependency-audit] Registry error code:",String(report.error.code).slice(0,40));
if(severe||r.status!==0||report.error)process.exit(1);
