// Fails when the production source changes routes without migration inventory refresh.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync('src/server.ts','utf8');
const manifest=JSON.parse(fs.readFileSync('cloudflare/production-route-inventory.json','utf8'));
const regex=/\bapp\.(get|post|put|patch|delete|options|head)\(\s*([`"'])(.*?)\2/g;
const found=[...source.matchAll(regex)].map(m=>({method:m[1].toUpperCase(),path:m[3]}))
  .sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
const expected=manifest.routes.map(({method,path})=>({method,path}))
  .sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
assert.deepEqual(found,expected,'Application API routes changed. Review full parity inventory before release.');
assert.equal(manifest.routeCount,found.length);
if(manifest.routes.some(r=>r.cloudflareStatus==='ported'&&!r.testEvidence))throw Error('A route cannot claim ported without test evidence');
console.log('NewChanges feature parity inventory verified:',found.length,'explicit Fastify routes.');
