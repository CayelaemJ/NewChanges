import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";

const root=new URL("../",import.meta.url);
const read=(path:string)=>readFileSync(new URL(path,root),"utf8");
const packageJson=JSON.parse(read("package.json"));
const runner=read("scripts/run-cdc-disposable-mysql-integration.sh");
const python=read("simulation/ops/disposable_mysql_binlog_integration.py");
const handoff=read("scripts/cdc-disposable-binlog-shared-handoff.ts");

test("real XID to shared MySQL handoff is disabled by default",()=>{
  assert.equal(packageJson.scripts["check:cdc-binlog-shared-disposable"],
    "FIXER_CDC_TEST_MODE=binlog-shared bash scripts/run-cdc-disposable-mysql-integration.sh");
  assert(!packageJson.scripts["check:cdc-dashboard"].includes("binlog-shared"));
  assert(!packageJson.scripts["check:all"].includes("binlog-shared"));
  assert(runner.includes('FIXER_CDC_RUN_DISPOSABLE_MYSQL:-'));
  assert(runner.includes('--publish 127.0.0.1::3306'));
  assert(runner.includes('trap cleanup EXIT'));
  assert(runner.includes('FIXER_CDC_BINLOG_HANDOFF_MODE='));
});

test("Python forwards only metadata from actually observed XID transactions",()=>{
  assert(python.includes('if committed == "PERSISTED":'));
  assert(python.includes('xid_pos = event.packet.log_pos'));
  assert(python.includes('xid_handoffs.append({'));
  assert(python.includes('"digest": hashlib.sha256(payload).hexdigest()'));
  assert(python.includes('"observed": xid_handoffs'));
  assert(python.includes('subprocess.run('));
  assert(python.includes('input=json.dumps(handoff'));
  assert(!python.includes('print(event.rows)'));
});

test("shared handoff verifies source and coordinates, uses production writer and read-only reader",()=>{
  assert(handoff.includes('FIXER_CDC_DISPOSABLE_MYSQL_TEST'));
  assert(handoff.includes('FIXER_CDC_TEST_HOST!=="127.0.0.1"'));
  assert(handoff.includes('const operations=["WRITE_ROWS","UPDATE_ROWS","DELETE_ROWS"]'));
  assert(handoff.includes("commitCdcMetadata(connector,plan)"));
  assert(handoff.includes("readCommittedFeedSnapshot(connector,envelope.sourceId)"));
  assert(handoff.includes("createCommittedFeedSnapshotRelay("));
  assert(handoff.includes('assert.equal(await relay.poll(),2)'));
  assert(handoff.includes('assert.equal(await commitCdcMetadata(connector,plan),"REPLAYED")'));
  assert(handoff.includes("checkpointGeneration,3"));
  assert(!handoff.includes("FIXER_RDS_TEST_HOST"));
  assert(!handoff.includes("DATABASE_URL"));
});
