import {it,expect} from 'vitest';
import {browserSafeFailure} from '../src/services/browserErrorSafety.js';
it('removes credentials in connection strings and exception traces',()=>{
 for(const error of ['postgresql://fixture:fixture-secret@db.invalid/reporting','mysql://fixture:fixture-secret@db.invalid/source','password=fixture-secret','at read (/app/node_modules/db/client.js:42:1)','Invalid prisma.user.findMany() invocation']){
  const output=JSON.stringify(browserSafeFailure({status:'FAILED',error}));
  expect(output).not.toContain('fixture-secret');expect(output).not.toContain(error);
 }
});
it('redacts sensitive nested keys while preserving useful validation errors',()=>{
 const output=browserSafeFailure({error:'Please type RESET exactly to confirm.',detail:{password:'fixture-secret',stack:'private trace',records:[{connectionString:'private'}]}});
 expect(output.error).toBe('Please type RESET exactly to confirm.');
 expect(JSON.stringify(output)).not.toContain('fixture-secret');expect(JSON.stringify(output)).not.toContain('private');
});
