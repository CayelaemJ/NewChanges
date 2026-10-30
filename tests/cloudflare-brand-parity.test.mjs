import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('React page and visible product UI retain independent The Fixer brand',()=>{
 const index=fs.readFileSync('frontend/index.html','utf8');
 const app=fs.readFileSync('frontend/src/App.tsx','utf8');
 assert.match(index,/<title>The Fixer<\/title>/);
 assert.doesNotMatch(index,/EFS Optimise/i);
 assert.doesNotMatch(app,/>EFS Optimise</i);
 assert.match(app,/The Fixer/);
});

test('NewChanges preview and release gate use only its own Cloudflare Pages URLs',()=>{
 const generator=fs.readFileSync('scripts/cloudflare/build-isolated-preview.mjs','utf8');
 const readiness=fs.readFileSync('cloudflare/primary-readiness.mjs','utf8');
 assert.match(generator,/migration\.newchanges-app\.pages\.dev/);
 assert.match(readiness,/newchanges-app\.pages\.dev/);
 assert.doesNotMatch(generator,/workers\.dev/);
 assert.doesNotMatch(readiness,/workers\.dev/);
});

test('production routes cannot falsely claim Cloudflare implementation',()=>{
 const inv=JSON.parse(fs.readFileSync('cloudflare/production-route-inventory.json','utf8'));
 assert.ok(inv.routeCount>=60);
 assert.equal(inv.routes.length,inv.routeCount);
 assert.ok(inv.routes.every(r=>r.cloudflareStatus==='not_ported'||(r.cloudflareStatus==='ported'&&r.testEvidence)));
});
