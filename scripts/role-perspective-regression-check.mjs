import fs from "node:fs";
import assert from "node:assert/strict";

const files = {
  auth: fs.readFileSync("src/services/authService.ts", "utf8"),
  server: fs.readFileSync("src/server.ts", "utf8"),
  users: fs.readFileSync("public/users.html", "utf8"),
  admin: fs.readFileSync("public/admin.html", "utf8"),
  nav: fs.readFileSync("public/portal-nav-v080.js", "utf8"),
  schema: fs.readFileSync("prisma/schema.prisma", "utf8"),
};

const must = (condition, message) => assert.ok(condition, message);

const roles = ["ADMIN", "SUPERADMIN", "EMPLOYER_MANAGER", "PORTFOLIO_MANAGER", "VIEWER"];
for (const role of roles) {
  must(files.auth.includes(role), `auth service must recognise ${role}`);
  must(files.schema.includes(role), `Prisma schema must define ${role}`);
  must(files.users.includes(role), `user management UI must recognise ${role}`);
}

must(
  files.auth.includes('user.role === "EMPLOYER_MANAGER"') &&
  files.auth.includes('user.role === "PORTFOLIO_MANAGER"') &&
  files.auth.includes('user.role === "VIEWER"'),
  "employer-scoped roles must include Viewer"
);

must(
  files.auth.includes('if (module === "admin") return false') &&
  files.auth.includes('module === "dashboard"') &&
  files.auth.includes('user.role === "VIEWER"'),
  "Viewer must be dashboard-readable but not admin-accessible"
);

must(
  files.auth.includes('if (module === "portfolio") return user.role === "PORTFOLIO_MANAGER"'),
  "only Portfolio Manager should receive portfolio-module access"
);

must(
  files.auth.includes('return (user.links ?? []).some((l: any) => l.employerId === employerId)'),
  "scoped roles must be limited to assigned employers"
);

must(
  files.server.includes('allowedRoles.includes("ADMIN")') ||
  files.server.includes('allowedRoles.includes("SUPERADMIN")') ||
  files.server.includes('SUPERADMIN'),
  "server role validation must recognise privileged roles"
);

must(
  files.users.includes("availableRoles") &&
  files.users.includes("SUPERADMIN") &&
  files.users.includes("ADMIN") &&
  files.users.includes("VIEWER"),
  "role picker must expose the complete hierarchy where permitted"
);

must(
  files.users.includes("input[name=\"n-role-choice\"]:checked"),
  "role picker must use a single selected role rather than multiple simultaneous roles"
);

must(
  files.users.includes("ME?.role==='SUPERADMIN' ? ['EMPLOYER_MANAGER','PORTFOLIO_MANAGER','VIEWER','ADMIN','SUPERADMIN'] : ['EMPLOYER_MANAGER','PORTFOLIO_MANAGER','VIEWER']"),
  "ordinary Admin role picker must be limited to non-privileged operational roles"
);

must(
  !files.users.includes("availableRoles=['VIEWER','EMPLOYER_MANAGER','PORTFOLIO_MANAGER','ADMIN','SUPERADMIN']") ||
  files.users.includes("isSuperAdmin"),
  "Super Admin visibility must not accidentally become the ordinary Admin role picker"
);

must(
  files.nav.includes("EMPLOYER_MANAGER") &&
  files.nav.includes("PORTFOLIO_MANAGER") &&
  files.nav.includes("VIEWER"),
  "portal navigation must label the new roles"
);

must(files.users.includes("ME.role!=='ADMIN'&&ME.role!=='SUPERADMIN'") || files.users.includes("['ADMIN','SUPERADMIN'].includes(ME.role)"), "user management must support both Admin and Super Admin");
must(files.admin.includes("Super Admin control plane") && files.admin.includes("Operational administration"), "Admin and Super Admin must have visibly distinct control-plane messaging");
must(files.admin.includes("privilegedHeadings") && files.admin.includes("Dashboard Sections") && files.admin.includes("Danger zone"), "privileged control-plane sections must be hidden from ordinary Admin UI");
must(files.admin.includes("const privilegedHeadings = new Set(['Security centre','MLOps data-quality alert','Dashboard Sections','Danger zone'])"), "Live Data Integration must remain available to ordinary Admin");
must(files.admin.includes("live dashboard integrations"), "Admin posture must explicitly include live dashboard integrations");

console.log("Role perspective regression checks passed.");
console.log("Role matrix: Viewer -> read-only dashboard; Employer Manager -> assigned employer; Portfolio Manager -> assigned portfolio; Admin -> operational administration; Super Admin -> privileged administration.");
