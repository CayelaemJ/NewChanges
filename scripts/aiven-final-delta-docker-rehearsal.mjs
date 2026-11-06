#!/usr/bin/env node
// Synthetic-only Docker test of the *same* SQL plan used by final Aiven sync.
// No published ports, no Neon/Aiven connections, no production credentials.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAivenDeltaSql } from './aiven-final-delta-plan.mjs';

const name='newchanges-final-delta-test-'+randomUUID().slice(0,8);
const dir=mkdtempSync(join(tmpdir(),'newchanges-delta-synthetic-'));
function run(exe,args,options={}) {
  const r=spawnSync(exe,args,{encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024,...options});
  return r;
}
function docker(args,options={}) {
  const r=run('docker',args,options);
  if (r.status!==0||r.error) throw Error('Synthetic Docker rehearsal failed ('+args[0]+')');
  return r.stdout.trim();
}
function db(sql,allowError=false) {
  const r=run('docker',['exec','-i',name,'psql','-U','postgres','-d','defaultdb','-X','-A','-t','-v','ON_ERROR_STOP=1','-f','-'],{input:sql});
  if (!allowError && (r.status!==0||r.error)) throw Error('Synthetic PostgreSQL statement failed');
  return r;
}
const fields = [
  'id','userId','actorEmail','method','route','resource','employerId',
  'ipAddress','deviceKey','deviceType','statusCode','durationMs','createdAt'
];
function csv(values) {
  return values.map(v=>{
    if(v===null)return '\\N';
    const s=String(v);
    return /[,"\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
  }).join(',')+'\n';
}
function audit(id,status=200) {
  return csv([id,'synthetic-user',null,'GET','/ready',null,null,
    '127.0.0.1',null,'synthetic-device',status,3,'2026-11-05 10:00:00']);
}
const auditLocal=join(dir,'audit.csv'), sessionLocal=join(dir,'sessions.csv');
const auditIn='/tmp/rehearsal-audit.csv', sessionIn='/tmp/rehearsal-sessions.csv';
function stage(auditText,sessionText) {
  writeFileSync(auditLocal,auditText,{mode:0o600});
  writeFileSync(sessionLocal,sessionText,{mode:0o600});
  docker(['cp',auditLocal,name+':'+auditIn]);
  docker(['cp',sessionLocal,name+':'+sessionIn]);
  // The fixtures are synthetic and may be readable by container's postgres user.
  docker(['exec','-u','root',name,'chmod','0644',auditIn,sessionIn]);
}
try {
  if (run('docker',['version','--format','{{.Server.Version}}']).status!==0)
    throw Error('A running local Docker engine is required');
  docker(['run','-d','--rm','--network','none','--name',name,
    '--memory','512m','-e','POSTGRES_PASSWORD=synthetic-local-only',
    '-e','POSTGRES_DB=defaultdb','postgres:18-alpine']);
  let ready=false;
  for(let attempt=0;attempt<35;attempt++){
    if(run('docker',['exec',name,'pg_isready','-U','postgres','-d','defaultdb']).status===0){ready=true;break}
    run('sleep',['0.5']);
  }
  if(!ready)throw Error('Disposable PostgreSQL did not start');
  const create=[
    'CREATE TABLE public."Session" ("id" text PRIMARY KEY, "lastSeenAt" timestamp without time zone);',
    'CREATE TABLE public."DataAccessEvent" ("id" text PRIMARY KEY, "userId" text, "actorEmail" text,',
    '"method" text, "route" text, "resource" text, "employerId" text, "ipAddress" text,',
    '"deviceKey" text, "deviceType" text, "statusCode" integer, "durationMs" integer, "createdAt" timestamp without time zone);',
    "INSERT INTO public.\"Session\" VALUES ('session-1','2026-11-05 09:00:00');",
    "INSERT INTO public.\"DataAccessEvent\" (\"id\",\"userId\",\"method\",\"route\",\"ipAddress\",\"deviceType\",\"statusCode\",\"durationMs\",\"createdAt\")",
    "VALUES ('audit-1','synthetic-user','GET','/ready','127.0.0.1','synthetic-device',200,3,'2026-11-05 10:00:00');"
  ].join('\n');
  db(create);
  stage(audit('audit-1')+audit('audit-2'),csv(['session-1','2026-11-05 11:00:00']));
  const plan=buildAivenDeltaSql(auditIn,sessionIn);
  db(plan);
  const query="SELECT (SELECT count(*) FROM public.\"DataAccessEvent\")::text || '|' || "+
    "(SELECT to_char(\"lastSeenAt\",'YYYY-MM-DD HH24:MI:SS') FROM public.\"Session\" WHERE id='session-1');";
  assert.equal(db(query).stdout.trim(),'2|2026-11-05 11:00:00');
  db(plan); // Replaying the same audit/session delta must be idempotent.
  assert.equal(db(query).stdout.trim(),'2|2026-11-05 11:00:00');
  stage(audit('audit-1',500)+audit('audit-3'),csv(['session-1','2026-11-05 12:00:00']));
  assert.notEqual(db(plan,true).status,0,'Conflicting existing audit history must abort');
  assert.equal(db(query).stdout.trim(),'2|2026-11-05 11:00:00','Rollback must preserve both audit and session state');
  stage(audit('audit-3'),''); // Missing session keys must not update audit.
  assert.notEqual(db(plan,true).status,0,'Incomplete session inventory must abort');
  assert.equal(db(query).stdout.trim(),'2|2026-11-05 11:00:00');
  console.log('PASS: isolated PG18 delta insert, idempotency, audit-conflict rollback and session-inventory rollback');
} catch(err) {
  console.error('FAIL:',err.message);
  process.exitCode=1;
} finally {
  run('docker',['rm','-f',name]);
  rmSync(dir,{recursive:true,force:true});
}
