import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {validateRailwayPgProbe} from "../scripts/probe-render-railway-postgres.mjs";
const base={RENDER_RAILWAY_PG_PROBE_APPROVED:"YES_READ_ONLY_RAILWAY_TEST",
 RAILWAY_PG_TEST_URL:"postgresql://readonly:secret@monorail.proxy.rlwy.net:12345/railway?sslmode=require",
 RAILWAY_PG_EXPECTED_DB:"railway",
 DATABASE_URL:"postgresql://old:secret@ep-example.neon.tech/newchanges?sslmode=require"};
const v=validateRailwayPgProbe(base);
assert.equal(v.expectedDatabase,"railway");
assert.equal(v.hostClass,"railway-public");
const bad=(e,exp)=>assert.throws(()=>validateRailwayPgProbe(e),exp);
bad({...base,RENDER_RAILWAY_PG_PROBE_APPROVED:"no"},/approval/);
bad({...base,RAILWAY_PG_TEST_URL:base.DATABASE_URL},/Separate/);
bad({...base,RAILWAY_PG_TEST_URL:"postgresql://x:y@ep-test.neon.tech/railway?sslmode=require"},/public TLS/);
bad({...base,RAILWAY_PG_TEST_URL:"postgresql://x:y@postgres.railway.internal/railway?sslmode=require"},/public TLS/);
bad({...base,RAILWAY_PG_TEST_URL:base.RAILWAY_PG_TEST_URL.replace("sslmode=require","sslmode=disable")},/public TLS/);
bad({...base,RAILWAY_PG_EXPECTED_DB:"newchanges"},/public TLS/);
const proc=spawnSync(process.execPath,[new URL("../scripts/probe-render-railway-postgres.mjs",import.meta.url).pathname],{
 env:{...process.env,RENDER_RAILWAY_PG_PROBE_APPROVED:"",RAILWAY_PG_TEST_URL:base.RAILWAY_PG_TEST_URL},
 encoding:"utf8",timeout:8000});
assert.notEqual(proc.status,0);
assert(!String(proc.stderr+proc.stdout).includes("secret"));
assert.match(String(proc.stderr),/refused or failed/);
console.log("Railway PostgreSQL probe enforces separate TLS-only target, approval and secret-free failure");
