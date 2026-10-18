import assert from "node:assert/strict";
import {openPlaygroundMysqlSnapshot} from "../src/services/playgroundMysqlSnapshot.js";
const base={host:"mysql.example.org",database:"reporting",user:"reader",password:"test",
 ssl:true as const,rejectUnauthorized:true as const};
await assert.rejects(openPlaygroundMysqlSnapshot({...base,ssl:false as true}),/TLS/);
await assert.rejects(openPlaygroundMysqlSnapshot({...base,user:"root"}),/TLS/);
await assert.rejects(openPlaygroundMysqlSnapshot({...base,host:"mysql;drop"}),/TLS/);
await assert.rejects(openPlaygroundMysqlSnapshot({...base,queryTimeoutMs:60000}),/timeout/);
console.log("MySQL snapshot requires TLS, safe connection settings and bounded timeouts");
