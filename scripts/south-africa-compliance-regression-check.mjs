import fs from "node:fs";

const schema=fs.readFileSync("prisma/schema.prisma","utf8");
const server=fs.readFileSync("src/server.ts","utf8");
const compliance=fs.readFileSync("src/services/complianceService.ts","utf8");
const security=fs.readFileSync("src/services/securityService.ts","utf8");
const admin=fs.readFileSync("public/admin.html","utf8");
const privacy=fs.readFileSync("public/privacy.html","utf8");
const migration=fs.readFileSync("prisma/migrations/20260930150000_popia_data_governance/migration.sql","utf8");

const checks=[
  ["processing activity register",schema.includes("model ProcessingActivity") && migration.includes('"ProcessingActivity"')],
  ["party role is recorded",schema.includes("partyRole             String")],
  ["lawful basis is recorded",schema.includes("lawfulBasis           String")],
  ["data subject request workflow",schema.includes("model DataSubjectRequest") && server.includes("/api/admin/compliance/requests")],
  ["operator/vendor register",schema.includes("model ComplianceVendor") && server.includes("/api/admin/compliance/vendors")],
  ["retention register",schema.includes("model RetentionPolicy") && server.includes("/api/admin/compliance/retention")],
  ["security incident register",schema.includes("model SecurityIncident") && server.includes("/api/admin/compliance/incidents")],
  ["cross-border basis is mandatory when enabled",compliance.includes("cross-border processing requires a documented transfer basis")],
  ["operator agreement is mandatory for operator activities",compliance.includes("operator processing requires an operator agreement reference")],
  ["external IP geolocation is opt-in",security.includes("ENABLE_EXTERNAL_IP_GEOLOCATION") && security.includes("externalGeoEnabled")],
  ["compliance UI exists",admin.includes('id="admin-compliance-strip"') && admin.includes("POPIA &amp; Data Governance")],
  ["privacy notice avoids fixed responsible-party conclusion",privacy.includes("Our role under the Protection of Personal Information Act") && privacy.includes("responsible party or co-responsible party") && privacy.includes("act as an operator")],
  ["privacy notice covers security compromises",privacy.includes("security-compromise process")],
  ["privacy notice covers data-subject requests",privacy.includes("Data subject requests")],
  ["privacy notice covers automated decision-making",privacy.includes("Automated decision-making and profiling")],
  ["privacy notice covers cross-border basis",privacy.includes("section 72")],
  ["privacy notice has no em dash",!privacy.includes(" — ")],
  ["compliance documentation exists",fs.existsSync("SOUTH_AFRICA_COMPLIANCE.md")],
];
const failures=checks.filter(([,ok])=>!ok);
if(failures.length){
 console.error("South Africa compliance regression checks failed:");
 for(const [name] of failures) console.error(" - "+name);
 process.exit(1);
}
console.log("South Africa compliance regression checks passed:",checks.length);
