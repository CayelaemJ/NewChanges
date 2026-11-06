#!/usr/bin/env node
// Offline evidence manifest checker. Does not perform a database operation,
// stop old writers, or approve a production deployment.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

function fail(message) { console.error('BLOCKED:',message); process.exitCode=2; }
const candidate=process.argv[2];
if (!candidate) {
  fail('Provide an absolute path to a locally maintained JSON evidence manifest. No production action was attempted.');
} else {
  try {
    const path=resolve(candidate);
    if (!existsSync(path)) throw Error('Evidence manifest does not exist');
    const doc=JSON.parse(readFileSync(path,'utf8'));
    const required=[
      'sourceBackup','targetBackup','sourceWritersFenced',
      'backgroundJobsFenced','finalDeltaComplete',
      'contentReconciliation','authenticationAndMfaVerified',
      'singleWriterVerified','rollbackReviewed'
    ];
    const issues=[];
    for (const key of required) {
      const item=doc[key];
      if (!item || item.verified!==true || typeof item.evidence!=='string' ||
          !item.evidence.trim() || !item.checkedAt || !Number.isFinite(Date.parse(item.checkedAt))) {
        issues.push(key+': missing verifiable evidence or timestamp');
      }
    }
    for (const key of ['sourceBackup','targetBackup']) {
      const backup=doc[key];
      if (!backup || !backup.restoreTested || !backup.offsiteCopy ||
          typeof backup.sha256!=='string' || !/^[a-f0-9]{64}$/i.test(backup.sha256))
        issues.push(key+': restore test, independent copy and SHA-256 required');
    }
    // A portable public-schema archive cannot recover Neon-managed extensions,
    // non-public schema objects or all authentication behavior. Never equate
    // the 57-table application drill with complete source disaster recovery.
    const scope={sourceBackup:'full_database',targetBackup:'full_database'};
    const method={sourceBackup:'neon_compatible_full_restore',
      targetBackup:'isolated_postgresql18_full_restore'};
    for (const key of ['sourceBackup','targetBackup']) {
      const backup=doc[key];
      if (!backup || backup.scope!==scope[key] ||
          backup.recoveryMethod!==method[key] ||
          backup.extensionCompatibilityVerified!==true ||
          backup.authenticationRecoveryVerified!==true)
        issues.push(key+': full database scope, compatible restore, extensions and authentication recovery evidence required');
    }
    if (doc.environment!=='production' ||
        doc.source!=='Neon:newchanges' ||
        doc.target!=='Aiven:the-fixer-postgres/defaultdb')
      issues.push('unexpected production source/target identity');
    if (!doc.oldWriterStoppedAt || !doc.finalDeltaFinishedAt ||
        !Number.isFinite(Date.parse(doc.oldWriterStoppedAt)) ||
        !Number.isFinite(Date.parse(doc.finalDeltaFinishedAt)) ||
        Date.parse(doc.finalDeltaFinishedAt)<Date.parse(doc.oldWriterStoppedAt))
      issues.push('final delta must follow source writer fencing');
    if (issues.length) {
      for (const issue of issues) console.error('  -',issue);
      fail('Cutover evidence INCOMPLETE; do not enable Render database writers or Cloudflare routing.');
    } else {
      const digest=createHash('sha256').update(readFileSync(path)).digest('hex');
      console.log('EVIDENCE MANIFEST STRUCTURE PASS (sha256='+digest+').');
      console.log('NOT AUTHORIZATION: This tool validates declarations, not actual backups, DB state, MFA or writer fencing.');
      console.log('Independent technical and operator verification is still required before any production cutover.');
    }
  } catch(err) {
    fail('Cannot validate evidence manifest ('+(err instanceof SyntaxError?'invalid JSON':'unavailable or invalid file')+').');
  }
}
