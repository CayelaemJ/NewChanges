// Real PostgreSQL import lifecycle tests; synthetic rows on disposable CI only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const fixture='postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci';
assert.equal(process.env.CI,'true');
assert.equal(process.env.CI_RLS_PROBE_APPROVED,'CI_DISPOSABLE_ONLY');
assert.equal(process.env.DATABASE_URL,fixture,'Refusing all non-disposable databases');
const {prisma}=await import('../../dist/services/database.js');
const {uploadAndValidate,commitBatch}=await import('../../dist/services/importService.js');
const suffix=randomUUID().slice(0,12);
const employer='ci-import-'+suffix;
const filenames=[];
const csv=(name,stamp)=>Buffer.from(
  'employer_ref,name,source_updated_at\n'+employer+','+name+','+stamp+'\n'
);
const filename=(label)=>{const f='ci-'+suffix+'-'+label+'.csv';filenames.push(f);return f};
const upload=async(label,buffer)=>uploadAndValidate({reportKey:'employers',filename:filename(label),buffer});
let triggerInstalled=false;
try{
  const good=await upload('valid',csv('Original','2026-01-01T00:00:00Z'));
  assert.equal(good.result.ok,true,'Valid feed passes upload validation');
  assert.equal(good.batch.status,'VALIDATED');
  assert.equal(await prisma.importBatchRow.count({where:{batchId:good.batch.id}}),1);
  const committed=await commitBatch(good.batch.id,{recompute:false});
  assert.equal(committed.inserted,1);
  assert.equal((await prisma.employer.findUniqueOrThrow({where:{id:employer}})).name,'Original');
  assert.equal((await prisma.importBatch.findUniqueOrThrow({where:{id:good.batch.id}})).status,'COMMITTED');
  await assert.rejects(commitBatch(good.batch.id,{recompute:false}),/not in VALIDATED state/);
  console.log('[import-ci] PASS validated import, commit and double-commit rejection');

  const duplicate=await upload('duplicates',
    Buffer.from('employer_ref,name,source_updated_at\n'+employer+',Duplicate,2026-02-01T00:00:00Z\n'+employer+',Duplicate again,2026-02-01T00:00:00Z\n'));
  assert.equal(duplicate.result.ok,false,'Duplicate natural keys must block commit');
  assert.equal(duplicate.batch.status,'FAILED');
  assert.equal(await prisma.importBatchRow.count({where:{batchId:duplicate.batch.id}}),0);
  await assert.rejects(commitBatch(duplicate.batch.id,{recompute:false}),/not in VALIDATED state/);
  assert.equal((await prisma.employer.findUniqueOrThrow({where:{id:employer}})).name,'Original');
  console.log('[import-ci] PASS duplicate rejection and staging cleanup');

  const stale=await upload('stale',csv('Stale','2025-01-01T00:00:00Z'));
  assert.equal(stale.result.ok,true);
  const old=await commitBatch(stale.batch.id,{recompute:false});
  assert.equal(old.skipped,1,'Older source watermark must be skipped');
  assert.equal((await prisma.employer.findUniqueOrThrow({where:{id:employer}})).name,'Original');
  console.log('[import-ci] PASS stale-source overwrite prevention');

  // Force a database error on the SECOND batch of staged rows (2000 + 1).
  // The application must fail the audit and remove the FIRST batch, too.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ci_import_stage_fail() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN IF NEW."rowIndex" >= 2000 THEN RAISE EXCEPTION 'synthetic staging outage'; END IF;
  RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER ci_import_stage_fault BEFORE INSERT ON "ImportBatchRow" FOR EACH ROW EXECUTE FUNCTION ci_import_stage_fail()');
  triggerInstalled=true;
  const overflow=Array.from({length:2001},(_,i)=>'ci-fault-'+suffix+'-'+i+',Example,2026-01-01T00:00:00Z');
  const faultFile=filename('staging-interrupted');
  await assert.rejects(
    uploadAndValidate({reportKey:'employers',filename:faultFile,buffer:Buffer.from(
      'employer_ref,name,source_updated_at\n'+overflow.join('\n')+'\n'
    )}),/synthetic staging outage/
  );
  const failed=await prisma.importBatch.findFirstOrThrow({where:{filename:faultFile}});
  assert.equal(failed.status,'FAILED','Staging outage must leave a FAILED audit');
  assert.equal(await prisma.importBatchRow.count({where:{batchId:failed.id}}),0,
    'First 2000 rows must be discarded when next chunk fails');
  assert.equal(await prisma.employer.count({where:{id:{startsWith:'ci-fault-'+suffix}}}),0);
  await assert.rejects(commitBatch(failed.id,{recompute:false}),/not in VALIDATED state/);
  console.log('[import-ci] PASS actual second-chunk database outage and orphan cleanup');

}finally{
  if(triggerInstalled) await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS ci_import_stage_fault ON "ImportBatchRow"').catch(()=>{});
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS ci_import_stage_fail()').catch(()=>{});
  await prisma.importBatch.deleteMany({where:{filename:{in:filenames}}}).catch(()=>{});
  await prisma.employer.deleteMany({where:{id:employer}}).catch(()=>{});
  await prisma.$disconnect();
}
