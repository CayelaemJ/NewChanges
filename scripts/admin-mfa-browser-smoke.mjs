import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage();
const browserErrors=[];
let verified=true;
let requests=0;
let approvals=0;
page.on('pageerror',error=>browserErrors.push(error.message));
await page.route('http://mfa.test/**',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/mfa')return route.fulfill({
  status:200,contentType:'text/html',body:readFileSync('public/admin-mfa.html','utf8'),
 });
 if(url.pathname==='/static/admin-mfa.js')return route.fulfill({
  status:200,contentType:'application/javascript',body:readFileSync('public/admin-mfa.js','utf8'),
 });
 if(url.pathname==='/api/auth/mfa/status')return route.fulfill({
  status:200,contentType:'application/json',
  body:JSON.stringify({configured:true,enrolled:true,verified,canManageRecovery:verified}),
 });
 if(url.pathname==='/api/admin/mfa/recovery/request'){
  const body=route.request().postDataJSON();
  assert.equal(body.targetUserId,'test-admin-user');
  requests++;
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   ok:true,requestId:'test-request-id',expiresAt:'2026-10-30T16:00:00Z',
  })});
 }
 if(url.pathname==='/api/admin/mfa/recovery/test-request-id/approve'){
  approvals++;
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   ok:true,grantCode:'SYNTHETIC-NO-REAL-ACCESS',
   expiresAt:'2026-10-30T15:55:00Z',
  })});
 }
 return route.fulfill({status:404,body:'Synthetic path not available'});
});
try {
 await page.goto('http://mfa.test/mfa',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('recovery')?.hidden===false);
 assert.equal(await page.locator('#enroll').count(),1);
 assert.equal(await page.locator('#verify').count(),1);
 await page.locator('#recovery-target').fill('test-admin-user');
 await page.locator('#recovery-request').click();
 await page.waitForFunction(()=>document.getElementById('recovery-request-id')?.value==='test-request-id');
 await page.locator('#recovery-approve').click();
 await page.getByText('SYNTHETIC-NO-REAL-ACCESS',{exact:false}).waitFor();
 assert.equal(requests,1);
 assert.equal(approvals,1);
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 verified=false;
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('recovery')?.hidden===true);
 assert.deepEqual(browserErrors,[]);
 console.log('MFA browser smoke: branded page, recovery request/approval and hidden nonverified controls passed.');
}finally {
 await browser.close();
}
