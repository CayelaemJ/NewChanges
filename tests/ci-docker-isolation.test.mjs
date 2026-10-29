import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');

test('CI workflow stays manual only and self-hosted',()=>{
 const y=read('.github/workflows/newchanges-manual-docker-ci.yml');
 assert.match(y,/workflow_dispatch:/);
 assert.doesNotMatch(y,/^\s+push:|^\s+pull_request:/m);
 assert.match(y,/runs-on:\s*\[self-hosted, linux, x64, newchanges-ci\]/);
 assert.doesNotMatch(y,/render deploy|wrangler deploy|cloudflare deploy|RAILWAY_TOKEN|NEON_/i);
});
test('isolated database Compose has no published ports or cloud secrets',()=>{
 const y=read('docker-compose.local-tests.yml');
 assert.match(y,/postgres:18-alpine/);
 assert.match(y,/internal:\s*true/);
 assert.match(y,/network_mode:\s*["']?service:db/);
 assert.doesNotMatch(y,/^\s+ports:/m);
 assert.doesNotMatch(y,/neon\.tech|railway\.app|onrender\.com|cloudflare\.com/i);
 assert.match(y,/ENABLE_SEMANTIC_OBJECT_PUBLISH:\s*["']?false/);
 assert.match(y,/ENABLE_SEMANTIC_SHADOW_WORKER:\s*["']?false/);
});
test('Docker context excludes local credentials and metadata',()=>{
 const lines=read('.dockerignore').split(/\r?\n/).map(x=>x.trim());
 for(const entry of ['.git','.env','.env.*'])assert.ok(lines.includes(entry),`Missing ignore ${entry}`);
});
test('self-hosted jobs never persist checkout credentials',()=>{
 const y=read('.github/workflows/newchanges-manual-docker-ci.yml');
 assert.match(y,/persist-credentials:\s*false/);
});

test('Docker test image drops root privileges after installation',()=>{
 const dockerfile=read('Dockerfile.test');
 const directives=dockerfile.split(/\r?\n/).map(line=>line.trim()).filter(line=>/^USER\s+/i.test(line));
 assert.ok(directives.length>0,'Test Dockerfile must declare a non-root user');
 assert.match(directives.at(-1),/^USER\s+node\s*$/i);
 assert.match(dockerfile,/PLAYWRIGHT_BROWSERS_PATH=\/ms-playwright/);
});
