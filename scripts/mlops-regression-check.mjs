import fs from "node:fs";
const schema=fs.readFileSync("prisma/schema.prisma","utf8");
const service=fs.readFileSync("src/services/mlopsService.ts","utf8");
const server=fs.readFileSync("src/server.ts","utf8");
const brand=fs.readFileSync("src/services/brandLearningService.ts","utf8");
const migration=fs.readFileSync("prisma/migrations/20261001120000_mlops_governance/migration.sql","utf8");
const failures=[]; const must=(ok,msg)=>{if(!ok) failures.push(msg);};
must(schema.includes("model MLOpsEvent") && schema.includes("model MLOpsModel"),"MLOps telemetry/model lifecycle models must exist");
must(migration.includes('"MLOpsEvent"') && migration.includes('"MLOpsModel"'),"MLOps migration must create both tables");
for(const name of ["runMLOpsAssessment","recordMLOpsFeedback","registerMLOpsModel","promoteMLOpsModel","rollbackMLOpsModel"]) must(service.includes(name),`MLOps service missing ${name}`);
for(const route of ["/api/admin/mlops/assessment/:employerId","/api/admin/mlops/models","/api/admin/mlops/feedback"]) must(server.includes(route),`MLOps API missing ${route}`);
must(service.includes("dataQuality") && service.includes("drift") && service.includes("anomaly") && service.includes("forecast"),"assessment must cover quality, drift, anomaly and forecasting");
must(brand.includes("BRAND_UPLOAD") && brand.includes("BRAND_CORRECTION"),"brand learner must emit upload and correction telemetry");
if(failures.length){console.error("MLOps regression check failed:\\n- "+failures.join("\\n- "));process.exit(1);}
console.log("MLOps regression checks passed.");
