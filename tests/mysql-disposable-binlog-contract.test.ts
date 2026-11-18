import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";

const harness=readFileSync(new URL("../scripts/run-cdc-disposable-mysql-integration.sh",import.meta.url),"utf8");
const fixture=readFileSync(new URL("../simulation/ops/disposable_mysql_binlog_integration.py",import.meta.url),"utf8");
const packageJson=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));

test("real binlog fixture is opt-in and never runs in ordinary CDC regression suite",()=>{
  assert.equal(packageJson.scripts["check:cdc-binlog-disposable"],
    "FIXER_CDC_TEST_MODE=binlog bash scripts/run-cdc-disposable-mysql-integration.sh");
  assert(!packageJson.scripts["check:cdc-dashboard"].includes("check:cdc-binlog-disposable"));
  assert(!packageJson.scripts["check:all"].includes("check:cdc-binlog-disposable"));
  assert(harness.includes('FIXER_CDC_RUN_DISPOSABLE_MYSQL:-'));
  assert(harness.includes('--publish 127.0.0.1::3306'));
  assert(harness.includes('--binlog-format=ROW'));
  assert(harness.includes('--binlog-row-image=FULL'));
  assert(harness.includes('trap cleanup EXIT'));
});

test("binlog exercise restricts source and persists only committed row metadata",()=>{
  assert(fixture.includes('FIXER_CDC_TEST_HOST") != "127.0.0.1"'));
  assert(fixture.includes('FIXER_CDC_DISPOSABLE_MYSQL_TEST'));
  assert(fixture.includes("BinLogStreamReader("));
  assert(fixture.includes('only_schemas=["ingest_stage"]'));
  assert(fixture.includes('only_tables=["journeys"]'));
  assert(fixture.includes("accept_parsed_event("));
  assert(fixture.includes('observed.count("COMMITTED") == 3'));
  assert(fixture.includes("connection.rollback()"));
  assert(fixture.includes("store.generations("));
  assert(!fixture.includes("FIXER_RDS_TEST_HOST"));
  assert(!fixture.includes("DATABASE_URL"));
  assert(!fixture.includes("print(event.rows)"));
});
