import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/services/snapshotBuilder.ts", import.meta.url), "utf8");
const section = source.slice(source.indexOf("async function warmDashboardCohorts"), source.indexOf("export async function snapshotEmployer"));
assert(section.includes("MAX_PREWARM_QUERIES = 24"), "prewarming must have a hard limit");
assert(!section.includes("for (const site of sites) for (const income of incomes)"), "prewarming must not enumerate site/income Cartesian combinations");
assert(source.includes('process.env.DASHBOARD_COHORT_PREWARM === "true"'), "prewarming must default to off");
assert(source.includes('SELECT DISTINCT ev."siteName"'), "historical-site deduplication must happen in PostgreSQL");
assert(!source.includes('distinct: ["siteName"]'), "Prisma client-side historical site distinct must not return");
assert(source.includes("k.includes(`,"), "refresh must invalidate version-prefixed in-memory keys");
console.log("Neon egress regression safeguards passed");
