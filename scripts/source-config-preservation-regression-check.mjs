import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const deploy=readFileSync(new URL("./deploy-db.mjs",import.meta.url),"utf8");
const bootstrap=readFileSync(new URL("./configure-mysql-sync.mjs",import.meta.url),"utf8");
assert(!deploy.includes('["scripts/configure-mysql-sync.mjs"]'));
assert(deploy.includes("Source sync settings preserved"));
assert(!bootstrap.includes('"scheduleHours"'));
assert(!bootstrap.includes('"sqlSsl" = false'));
assert(bootstrap.includes('ALLOW_INITIAL_SOURCE_BOOTSTRAP'));
assert(bootstrap.includes('btrim("sqlHost")'));
assert(bootstrap.includes('btrim("sqlUsername")'));
assert(bootstrap.includes('restricted read-only MySQL'));
assert(bootstrap.includes('SOURCE_SQL_SSL'));
const check=spawnSync(process.execPath,[new URL("./configure-mysql-sync.mjs",import.meta.url).pathname],{
 encoding:"utf8",
 env:{...process.env,ALLOW_INITIAL_SOURCE_BOOTSTRAP:"",MYSQLPASSWORD:"NEVER_PRINT_THIS_TEST_SECRET"}
});
assert.equal(check.status,1);
assert(!String(check.stdout+check.stderr).includes("NEVER_PRINT_THIS_TEST_SECRET"));
console.log("Production deploys preserve source configuration; bootstrap requires explicit restricted TLS approval");
