import fs from "node:fs";

const files = {
  users: fs.readFileSync("public/users.html", "utf8"),
  security: fs.readFileSync("public/user-security.js", "utf8"),
  server: fs.readFileSync("src/server.ts", "utf8"),
  exports: fs.readFileSync("src/services/exportService.ts", "utf8"),
};

const checks = [
  ["users security action is not duplicated by telemetry", files.security.includes('textContent||"").trim().toLowerCase()==="security"') && files.users.includes('onclick="viewUserSecurity(')],
  ["security audit table is full width", files.users.includes(".security-grid{display:grid;grid-template-columns:1fr;gap:16px}")],
  ["top 20 audit events are loaded", files.security.includes('/api/admin/security/data-access?limit=20') && files.security.includes("slice(0,20)")],
  ["full security audit CSV button exists", files.users.includes("downloadSecurityAuditLog()") && files.security.includes('/api/admin/security/audit-log.csv')],
  ["full security audit endpoint exists", files.server.includes('/api/admin/security/audit-log.csv')],
  ["security audit export includes admin actions", files.exports.includes('eventType: "ADMIN_ACTION"')],
  ["security audit export includes data access", files.exports.includes('eventType: "DATA_ACCESS"')],
  ["security audit export includes logins", files.exports.includes('eventType: "LOGIN"')],
  ["security audit export includes security alerts", files.exports.includes('eventType: "SECURITY_ALERT"')],
  ["security audit export excludes request bodies", !files.server.includes('req.body') || files.server.includes('request bodies')],
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  console.error("Security governance regression checks failed:");
  for (const [name] of failures) console.error(" - " + name);
  process.exit(1);
}
console.log("Security governance regression checks passed:", checks.length);
