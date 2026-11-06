#!/usr/bin/env node
// Read-only, encrypted PostgreSQL recovery archive for a controlled production migration.
// Does not restore, change database objects, stop writers, or authorize cutover.
// Requires pg_dump, age, pg_restore and an AGE_RECIPIENT public key.
// Credentials must be provided by DR_SOURCE_DATABASE_URL / DR_TARGET_DATABASE_URL environment.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, chmodSync, rmSync, renameSync, statSync, realpathSync } from 'node:fs';
import { once } from 'node:events';
import { resolve, join, isAbsolute, relative, sep } from 'node:path';
import process from 'node:process';

const side=process.argv[2];
const mode=process.argv[3] || '--preflight';
const ALLOWED=new Set(['source','target']);
if (!ALLOWED.has(side) || !['--preflight','--backup','--portable-backup'].includes(mode) || (mode==='--portable-backup' && side!=='source')) {
  console.error('Usage: node scripts/production-encrypted-backup.mjs source|target --preflight|--backup|--portable-backup (source only)');
  process.exit(2);
}
function parseConnection(raw, selected) {
  if (!raw) throw Error('Missing '+selected+' DB URL environment variable');
  const u=new URL(raw);
  const db=decodeURIComponent(u.pathname.slice(1));
  if (!['postgres:','postgresql:'].includes(u.protocol)) throw Error('Invalid database protocol');
  if (selected==='source' && (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/i.test(u.hostname)||db!=='newchanges'))
    throw Error('Unexpected Neon endpoint; backup blocked');
  if (selected==='target' &&
      (u.hostname!=='the-fixer-postgres-cay-bed7.b.aivencloud.com'||u.port!=='26029'||db!=='defaultdb'))
    throw Error('Unexpected Aiven endpoint; backup blocked');
  if (!u.username || !u.password) throw Error('Missing database username or password');
  const tlsMode=u.searchParams.get('sslmode')||'require';
  if (!['require','verify-ca','verify-full'].includes(tlsMode)) throw Error('Database TLS mode must be require, verify-ca, or verify-full');
  const env={...process.env};
  for (const k of ['PGHOST','PGHOSTADDR','PGPORT','PGUSER','PGPASSWORD','PGDATABASE',
    'PGSSLMODE','PGCHANNELBINDING','PGOPTIONS','PGSERVICE','PGSERVICEFILE']) delete env[k];
  Object.assign(env,{
    PGHOST:u.hostname,PGPORT:u.port||'5432',
    PGUSER:decodeURIComponent(u.username),
    PGPASSWORD:decodeURIComponent(u.password),
    PGDATABASE:db,
    PGSSLMODE:tlsMode,
    PGCONNECT_TIMEOUT:'15',
    PGOPTIONS:'-c default_transaction_read_only=on'
  });
  if (u.searchParams.has('channel_binding')) env.PGCHANNELBINDING=u.searchParams.get('channel_binding');
  return env;
}
const checked=(exe)=>{
  const r=spawnSync(exe,['--version'],{stdio:'ignore',timeout:10000});
  if (r.error||r.status!==0) throw Error('Required local tool missing: '+exe);
};
const finish=(child,name)=>new Promise((yes,no)=>{
  child.on('error',()=>no(Error(name+' failed to start')));
  child.on('close',code=>code===0?yes():no(Error(name+' failed with status '+code)));
});
async function main() {
  const env=process.env;
  const selected=side==='source'?'DR_SOURCE_DATABASE_URL':'DR_TARGET_DATABASE_URL';
  const pg= parseConnection(env[selected],side);
  for (const executable of ['pg_dump','age','pg_restore']) checked(executable);
  const recipient=env.AGE_RECIPIENT;
  if (typeof recipient!=='string'||!recipient.startsWith('age1')||!/^[a-z0-9]+$/.test(recipient))
    throw Error('AGE_RECIPIENT must contain a valid-looking age public recipient (never provide private key)');
  const folder=env.NEWCHANGES_BACKUP_DIR;
  if (!folder || !isAbsolute(folder)) throw Error('NEWCHANGES_BACKUP_DIR must be an absolute local directory');
  console.log('PREFLIGHT PASS: side='+side+' TLS='+pg.PGSSLMODE+'; streaming pg_dump to age, no plaintext archive.');
  if (mode==='--preflight') return;
  mkdirSync(folder,{recursive:true,mode:0o700});
  const backupDirectory=realpathSync(folder);
  const repository=realpathSync(new URL('..', import.meta.url));
  const location=relative(repository,backupDirectory);
  if (location==='' || (location!=='..' && !location.startsWith('..'+sep) && !isAbsolute(location)))
    throw Error('Backup output must be outside the repository checkout');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const portable=mode==='--portable-backup';
  const out=join(backupDirectory,side+(portable?'-portable-public':'-full')+'-'+stamp+'.pgdump.age');
  const tmp=out+'.incomplete';
  let completed=false;
  let dump, encrypt;
  try {
    const destination=createWriteStream(tmp,{flags:'wx',mode:0o600});
    // Never put database URLs or passwords on CLI args; pg_dump reads PG* env.
    const dumpArgs=['--format=custom','--no-owner','--no-acl','--serializable-deferrable'];
    // This *additional* backup is intentionally not a full disaster-recovery image.
    // Neon-owned pg_session_jwt cannot be restored in stock postgres:18-alpine.
    if (portable) dumpArgs.push('--schema=public','--exclude-extension=pg_session_jwt');
    dump=spawn('pg_dump',dumpArgs,{
      env:pg,stdio:['ignore','pipe','ignore']
    });
    encrypt=spawn('age',['-r',recipient],{stdio:['pipe','pipe','ignore']});
    dump.stdout.pipe(encrypt.stdin);
    encrypt.stdout.pipe(destination);
    // Handle normal broken-pipe errors if either stage fails.
    dump.stdout.on('error',()=>{});
    encrypt.stdin.on('error',()=>{});
    encrypt.stdout.on('error',()=>{});
    const save=once(destination,'finish');
    await Promise.all([finish(dump,'pg_dump'),finish(encrypt,'age encryption'),save]);
    renameSync(tmp,out);
    chmodSync(out,0o600);
    completed=true;
    const sha=createHash('sha256');
    for await(const chunk of createReadStream(out))sha.update(chunk);
    console.log('BACKUP ENCRYPTED: side='+side+' scope='+(portable?'PORTABLE_PUBLIC_APPLICATION_ONLY':'FULL_DATABASE')+' bytes='+statSync(out).size);
    console.log('SHA256 (encrypted archive): '+sha.digest('hex'));
    console.log('LOCAL PATH: '+out);
    if (portable) console.log('PORTABILITY LIMIT: public application schema only; excludes pg_session_jwt and non-public schemas. Keep the original full Neon archive.');
    console.log('NOT RESTORE-VERIFIED: decrypt and restore this archive into a separate disposable PG18 before marking backup verified.');
  } finally {
    if(!completed) {
      dump?.kill('SIGTERM');encrypt?.kill('SIGTERM');
      rmSync(tmp,{force:true});
    }
  }
}
main().catch(err=>{ console.error('BLOCKED:',err.message);process.exitCode=2;});
