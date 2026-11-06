// Deterministic isolated visual regression: rendering twice with the same state
// must produce identical pixels. This checks instability, not designer-approved baselines.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
if(process.env.CI!=='true')throw Error('CI environment required');
const baseline=JSON.parse(readFileSync('tests/visual-baselines/mfa-design-contract.json','utf8'));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
mkdirSync('test-results/visual-regression',{recursive:true});
try {
 for(const width of baseline.breakpoints){
  const ctx=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',deviceScaleFactor:1});
  const page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='visual.test')return route.abort();
   if(url.pathname==='/mfa')return route.fulfill({status:200,contentType:'text/html',body:readFileSync('public/admin-mfa.html','utf8')});
   if(url.pathname==='/static/admin-mfa.js')return route.fulfill({status:200,contentType:'application/javascript',body:readFileSync('public/admin-mfa.js','utf8')});
   if(url.pathname==='/api/auth/mfa/status')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({configured:true,enrolled:false,verified:false,totpAvailable:true,totpEnrolled:false,passkeyEnrolled:false,canManageRecovery:false})});
   if(url.pathname.startsWith('/api/'))return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Synthetic fixture denied"}'});
   return route.fulfill({status:404,body:'Fixture missing'});
  });
  try {
   await page.goto('http://visual.test/mfa',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>!document.querySelector('#status')?.textContent?.includes('Checking your account security'),null,{timeout:15000});
   await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
   await page.evaluate(()=>document.fonts.ready);
   assert.equal((await page.locator('h1').innerText()).trim(),baseline.title,
     'MFA heading deviates from reviewed design contract');
   assert.equal((await page.locator('header strong').innerText()).trim(),
     baseline.headerBrandText,'MFA brand heading changed');
   const background=await page.locator('header').evaluate(el=>getComputedStyle(el).backgroundColor);
   assert.equal(background,baseline.headerBackground,'MFA brand colour changed');
   for(const selector of baseline.requiredElements){
     assert.equal(await page.locator(selector).count(),1,'Missing required MFA component '+selector);
   }
   const tooSmall=await page.locator('button:visible').evaluateAll(buttons=>buttons
     .filter(el=>el.getBoundingClientRect().height<44)
     .map(el=>({text:el.textContent?.trim(),height:el.getBoundingClientRect().height})));
   assert.deepEqual(tooSmall,[],'Visible buttons must meet minimum touch target height');
   const first=await page.screenshot({animations:'disabled'});
   const second=await page.screenshot({animations:'disabled'});
   assert.deepEqual(first,second,'Unstable pixels on identical MFA view at '+width);
   const metrics=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
   assert.ok(metrics.scroll<=metrics.width+baseline.maxPageOverflowPx,'MFA horizontal page overflow at '+width);
   assert.deepEqual(errors,[],'Unexpected script errors');
   results.push({width,status:'pass',pixelSha256:createHash('sha256').update(first).digest('hex')});
  }catch(e){
   await page.screenshot({path:'test-results/visual-regression/mfa-'+width+'-failure.png',fullPage:true}).catch(()=>{});
   results.push({width,status:'fail',message:String(e)});
  }finally{await ctx.close();}
 }
}finally{await browser.close();}
writeFileSync('test-results/visual-regression/results.json',JSON.stringify(results,null,2));
assert.ok(results.every(r=>r.status==='pass'),'Visual regression suite failed: '+JSON.stringify(results));
console.log('PASS stable MFA visuals and no horizontal overflow at 320, 390, 768 and 1366px');
