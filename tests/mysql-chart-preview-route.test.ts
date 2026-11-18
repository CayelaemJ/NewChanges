import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { mysqlChartPreviewEnabled, mysqlChartPreviewSettings } from "../src/services/mysqlChartPreviewSettings.js";

const full = {
  FIXER_CDC_MYSQL_CHART_PREVIEW_ENABLED: "true",
  FIXER_CDC_MYSQL_SOURCE_ACCESS_REVIEWED: "true",
  FIXER_CDC_MYSQL_BASELINE_VERIFIED: "true",
  FIXER_CDC_MYSQL_EMPLOYER_MAPPING_APPROVED: "true",
  FIXER_CDC_MYSQL_SOURCE_ID: "reporting_rds",
  FIXER_CDC_MYSQL_HOST: "fixture.abcdef.eu-north-1.rds.amazonaws.com",
  FIXER_CDC_MYSQL_PORT: "3306",
  FIXER_CDC_MYSQL_READ_USER: "fixer_cdc_reader",
  FIXER_CDC_MYSQL_READ_PASSWORD: "SYNTHETIC_TEST_ONLY",
  FIXER_CDC_MYSQL_CA_PATH: "/not-used-in-offline-tests.pem",
};

test("MySQL chart endpoint is off without all independent rollout gates",()=>{
  assert.equal(mysqlChartPreviewEnabled({}),false);
  assert.throws(()=>mysqlChartPreviewSettings({}),/CDC_CHART_PREVIEW_DISABLED/);
  for(const key of [
    "FIXER_CDC_MYSQL_CHART_PREVIEW_ENABLED",
    "FIXER_CDC_MYSQL_SOURCE_ACCESS_REVIEWED",
    "FIXER_CDC_MYSQL_BASELINE_VERIFIED",
    "FIXER_CDC_MYSQL_EMPLOYER_MAPPING_APPROVED",
  ]){
    assert.equal(mysqlChartPreviewEnabled({...full,[key]:"false"}),false);
    assert.throws(()=>mysqlChartPreviewSettings({...full,[key]:"false"}),
      /CDC_CHART_PREVIEW_DISABLED/);
  }
});

test("approved settings expose no app database configuration or write options",()=>{
  assert.equal(mysqlChartPreviewEnabled(full),true);
  const config=mysqlChartPreviewSettings(full);
  assert.equal(config.sourceId,"reporting_rds");
  assert.equal(config.hostname,full.FIXER_CDC_MYSQL_HOST);
  assert.equal(config.queryTimeoutMs,5000);
  assert.equal(config.maxRows,100);
  assert.equal(config.snapshotVerified,true);
  assert.equal(config.accessReviewed,true);
  assert(!("DATABASE_URL" in config));
  assert(!("prisma" in config));
});

test("real API route gates session/employer authorization before reporting reads",()=>{
  const source=readFileSync(new URL("../src/server.ts",import.meta.url),"utf8");
  const start=source.indexOf('"/api/reporting/mysql/charts/:employerId"');
  assert(start>=0);
  const route=source.slice(start,start+1600);
  const checks=["await requireUser(req, reply)","canAccessModule(user, \"dashboard\")",
    "canViewEmployer(user, req.params.employerId)","mysqlChartPreviewEnabled()",
    "readMysqlChart("];
  for(const check of checks)assert(route.includes(check),check);
  for(let i=1;i<checks.length;i++)assert(route.indexOf(checks[i-1])<route.indexOf(checks[i]));
  assert(!route.includes("prisma."));
  assert(!route.includes("runSync("));
  assert(!route.includes("INSERT INTO"));
  assert(!route.includes("UPDATE "));
});
