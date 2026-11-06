import test from 'node:test';
import assert from 'node:assert/strict';
import {coerce} from '../../src/services/validationStrategies.js';
import {getFormat} from '../../src/services/reportFormats.js';
import {parseFile,parseAndValidateCsvStreaming,validate} from '../../src/services/importParser.js';

const employers=getFormat('employers');
assert.ok(employers);
const field=name=>{
 const spec=employers.fields.find(x=>x.name===name);
 assert.ok(spec,'Missing canonical field '+name);
 return spec;
};
test('reject impossible source timestamps and absent timezone',()=>{
 const spec=field('source_updated_at');
 for(const value of [
   '2026-02-30T12:01:00Z','2025-02-29T09:20:00Z','2026-13-01T00:00:00Z',
   '2026-01-01T24:00:00Z','2026-01-01T15:61:00Z',
   '2026-01-01T02:00:00+24:00','2026-01-01T02:00:00+01:80',
   '2026-01-01T10:00:00','not a timestamp'
 ]){
  const [,error]=coerce(spec,value);
  assert.ok(error,'Should reject impossible or ambiguous timestamp '+value);
 }
 for(const value of ['2024-02-29T12:00:00Z','2026-01-01T15:15:00+02:00','2026-01-01T15:15:00.123Z']){
  const [parsed,error]=coerce(spec,value);
  assert.equal(error,null,'Valid ISO source timestamp '+value);
  assert.ok(parsed instanceof Date);
 }
});
test('reject overflow, fractions and executable-looking strings as integers',()=>{
 const spec=field('eligible_count');
 for(const value of ['9007199254740992','1.5','Infinity','NaN','1e10','0;DELETE FROM employer','-0.1']){
  const [,error]=coerce(spec,value);
  assert.ok(error,'Invalid integer must not be coerced: '+value);
 }
 assert.deepEqual(coerce(spec,'123'),[123,null]);
});
test('reject negative headcount despite parseable integer',()=>{
 const row={employer_ref:'fixture-employer',name:'Example',eligible_count:'-2',
  eligible_count_as_at:'2026-02-01',source_updated_at:'2026-02-01T00:00:00Z'};
 const result=validate(employers,[row]);
 assert.equal(result.ok,false);
 assert.deepEqual(result.rows,[]);
 assert.ok(result.errors.some(e=>e.column==='eligible_count'));
});
test('invalid calendar date rejected for cache observation',()=>{
 const spec=field('eligible_count_as_at');
 assert.ok(coerce(spec,'2026-02-30')[1]);
 assert.equal(coerce(spec,'2024-02-29')[1],null);
});
test('BOM and quoted CSV fields normalize without losing identity',async()=>{
 const csv=Buffer.from('\uFEFFemployer_ref,name,source_updated_at\n"fixture-1","Example, Inc.",2026-01-01T00:00:00Z\n');
 const result=await parseAndValidateCsvStreaming(csv,employers);
 assert.equal(result.ok,true);
 assert.equal(result.rowCount,1);
 assert.equal(result.rows[0].name,'Example, Inc.');
});
test('JSON records require object rows (no scalars or arrays)',()=>{
 for(const payload of ['false','{}','{"records":null}','{"records":[true]}','{"records":[42]}','{"records":[[]]}']){
  assert.throws(()=>parseFile(Buffer.from(payload),'json'));
 }
});
test('unknown input columns are surfaced and do not mutate canonical schema',()=>{
 const row={employer_ref:'fixture-1',name:'Example',source_updated_at:'2026-01-01T00:00:00Z',
  'untrusted_column':'=HYPERLINK("https://attacker.invalid","CLICK")'};
 const result=validate(employers,[row]);
 assert.ok(result.unknownColumns.includes('untrusted_column'));
 assert.equal(Object.hasOwn(result.rows[0],'untrusted_column'),false);
});
test('large duplicate natural-key set is rejected without committing rows',()=>{
 const rows=Array.from({length:1024},(_,i)=>({
  employer_ref:'fixture-'+(i%1023),name:'Example',source_updated_at:'2026-01-01T00:00:00Z'
 }));
 const result=validate(employers,rows);
 assert.equal(result.ok,false);
 assert.deepEqual(result.rows,[]);
 assert.ok(result.errors.some(e=>e.reason.includes('duplicate natural key')));
});
