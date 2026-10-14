import assert from "node:assert/strict";
import { sealSourceSettings, openSourceSettings } from "../src/services/sourceConnectionVault.js";
const env={ SOURCE_CONNECTION_VAULT_KEY:"b".repeat(64) } as NodeJS.ProcessEnv;
const settings={sourceMode:"SQL",sqlDialect:"MSSQL",sqlHost:"reporting.internal",sqlDatabase:"Warehouse",
 sqlUsername:"readonly",sqlPassword:"test-secret-only",sqlPort:1433};
const saved=sealSourceSettings("source-generation-A",settings,env);
assert(!JSON.stringify(saved).includes("test-secret-only"));
assert.deepEqual(openSourceSettings("source-generation-A",saved,env),settings);
assert.throws(()=>openSourceSettings("source-generation-B",saved,env));
assert.throws(()=>openSourceSettings("source-generation-A",{...saved,ciphertext:saved.ciphertext.slice(1)+"A"},env));
assert.throws(()=>sealSourceSettings("source-generation-A",settings,{} as NodeJS.ProcessEnv),/VAULT_KEY/);
console.log("Source credential vault integrity tests passed");
