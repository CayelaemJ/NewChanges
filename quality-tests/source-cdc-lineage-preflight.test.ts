import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LOAD_ORDER } from "../src/services/reportFormats.js";
import { evaluateSourceCdcLineage } from "../src/services/sourceCdcLineagePreflight.js";

const db = "ingest_stage";
const views = LOAD_ORDER.map(feed => "v_" + feed);
const objects = [
  ...views.map(TABLE_NAME => ({ TABLE_NAME, TABLE_TYPE: "VIEW" })),
  ...LOAD_ORDER.map(feed => ({ TABLE_NAME: "raw_" + feed, TABLE_TYPE: "BASE TABLE" })),
];
const usages = LOAD_ORDER.map(feed => ({
  VIEW_SCHEMA: db, VIEW_NAME: "v_" + feed, TABLE_SCHEMA: db,
  TABLE_NAME: "raw_" + feed,
}));

describe("MySQL VIEW_TABLE_USAGE dependency audit", () => {
  it("discovers all ten canonical physical feeds without reading business data", () => {
    const result = evaluateSourceCdcLineage(db, "v_", objects, usages);
    expect(result.metadataComplete).toBe(true);
    expect(result.cdcApproved).toBe(false);
    expect(result.feeds).toHaveLength(10);
    expect(result.feeds[0].physicalTables).toHaveLength(1);
  });
  it("traverses nested views, exposes shared physical dependencies", () => {
    const updated = [
      ...objects, { TABLE_NAME: "v_employers_inner", TABLE_TYPE: "VIEW" },
    ];
    const links = [
      ...usages.filter(x => x.VIEW_NAME !== "v_employers"),
      { VIEW_SCHEMA: db, VIEW_NAME: "v_employers", TABLE_SCHEMA: db, TABLE_NAME: "v_employers_inner" },
      { VIEW_SCHEMA: db, VIEW_NAME: "v_employers_inner", TABLE_SCHEMA: db, TABLE_NAME: "raw_employers" },
      { VIEW_SCHEMA: db, VIEW_NAME: "v_journeys", TABLE_SCHEMA: db, TABLE_NAME: "raw_employers" },
    ];
    const result = evaluateSourceCdcLineage(db, "v_", updated, links);
    expect(result.metadataComplete).toBe(true);
    expect(result.sharedPhysicalTables).toContainEqual({
      table: "ingest_stage.raw_employers", feeds: ["employers", "journeys"],
    });
  });
  it("does not claim completeness when privileges conceal a dependency", () => {
    const result = evaluateSourceCdcLineage(db, "v_", objects,
      usages.filter(x => x.VIEW_NAME !== "v_policies"));
    expect(result.metadataComplete).toBe(false);
    expect(result.feeds.find(x => x.feed === "policies")?.unresolved)
      .toContain("ingest_stage.v_policies (no visible dependencies)");
  });
  it("requires admin authentication before reading source metadata", () => {
    const server = readFileSync("src/server.ts", "utf8");
    const at = server.indexOf('"/api/admin/integration/direct-reporting/cdc-lineage"');
    expect(at).toBeGreaterThan(-1);
    const route = server.slice(at, at + 750);
    expect(route.indexOf("requireAdmin(req, reply)")).toBeLessThan(route.indexOf("getSyncConfig()"));
    expect(route.indexOf("directReportingEnabled()")).toBeLessThan(route.indexOf("getSyncConfig()"));
    expect(route).toContain("inspectSourceCdcLineage(await getSyncConfig())");
  });

  it("rejects cross-database and cyclic lineage", () => {
    const cross = evaluateSourceCdcLineage(db, "v_", objects, [
      ...usages.filter(x => x.VIEW_NAME !== "v_debt_accounts"),
      { VIEW_SCHEMA: db, VIEW_NAME: "v_debt_accounts",
        TABLE_SCHEMA: "other_db", TABLE_NAME: "debts" },
    ]);
    expect(cross.metadataComplete).toBe(false);
    expect(cross.feeds.find(x => x.feed === "debt_accounts")?.unresolved[0])
      .toContain("cross-schema");

    const cycle = evaluateSourceCdcLineage(db, "v_", objects, [
      ...usages.filter(x => x.VIEW_NAME !== "v_referrals"),
      { VIEW_SCHEMA: db, VIEW_NAME: "v_referrals",
        TABLE_SCHEMA: db, TABLE_NAME: "v_referrals" },
    ]);
    expect(cycle.metadataComplete).toBe(false);
    expect(cycle.feeds.find(x => x.feed === "referrals")?.unresolved[0])
      .toContain("cycle");
  });
});
