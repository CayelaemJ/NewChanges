// Synthetic ingestion fault-injection tests. No database, sockets or cloud APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFile, parseAndValidateCsvStreaming, parseAndValidateXlsxJsonStreaming, validate } from '../../src/services/importParser.js';
import { getFormat } from '../../src/services/reportFormats.js';

const format = getFormat('employers');
assert.ok(format, 'Canonical employers report fixture must exist');

test('malformed and unsafe JSON import shapes reject before staging', () => {
  for (const payload of ['{bad json', '{"records":{}}', '{"records":[null]}', '{"records":[[]]}', '{"records":[1]}']) {
    assert.throws(() => parseFile(Buffer.from(payload), 'json'));
  }
});

test('invalid CSV validation reports rejected rows rather than approving them', async () => {
  const buffer = Buffer.from('employer_ref,name,source_updated_at\nfixture-one,Example,not-a-date\n');
  const result = await parseAndValidateCsvStreaming(buffer, format, undefined, 1);
  assert.equal(result.rowCount, 1);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rows, []);
});

test('consumer failure interrupts CSV streaming and is never swallowed as success', async () => {
  const buffer = Buffer.from('employer_ref,name,source_updated_at\nfixture-one,Example,2026-01-01T00:00:00Z\n');
  let calls = 0;
  await assert.rejects(
    parseAndValidateCsvStreaming(buffer, format, async () => { calls++; throw new Error('synthetic staging database outage'); }, 1),
    /synthetic staging database outage/
  );
  assert.equal(calls, 1, 'Writer failure must reach the caller exactly once');
});

test('consumer failure interrupts JSON streaming and is never swallowed', async () => {
  let calls = 0;
  const buffer = Buffer.from(JSON.stringify([{employer_ref:'fixture-one',name:'Example',source_updated_at:'2026-01-01T00:00:00Z'}]));
  await assert.rejects(
    parseAndValidateXlsxJsonStreaming(buffer, 'json', format, async () => {calls++; throw new Error('synthetic write interruption');}, 1),
    /synthetic write interruption/
  );
  assert.equal(calls, 1);
});

test('duplicate source identifiers cannot pass full import validation', () => {
  const row={employer_ref:'fixture-one',name:'Example',source_updated_at:'2026-01-01T00:00:00Z'};
  const outcome=validate(format,[row,row]);
  assert.equal(outcome.ok,false);
  assert.deepEqual(outcome.rows,[]);
  assert.ok(outcome.errors.length>0);
});
