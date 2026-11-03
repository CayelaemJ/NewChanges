import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('cloudflare-output','pages-full-gateway');
fs.mkdirSync(root,{recursive:true});
const source=fs.readFileSync('cloudflare/full-app/pages-gateway.mjs','utf8');
if(!source.includes('NEWCHANGES_FULL_APP_SERVICE')||!source.includes('NEWCHANGES_GATEWAY_PRODUCTION_APPROVED'))
 throw Error('Missing gateway release safety controls');
fs.writeFileSync(path.join(root,'_worker.js'),source);
console.log('NewChanges production Pages gateway candidate emitted; NOT deployed');
