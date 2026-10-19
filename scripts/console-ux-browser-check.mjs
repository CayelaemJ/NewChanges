import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

// Disposable browser fixtures only: no production cookies, accounts or writes.
const employers=[{id:'fixture-employer',name:'A long employer name for regional financial wellbeing services'}];
const users=[{id:'fixture-user',name:'A long user name for wrapping checks',email:'fixture.user.with.a.long.address@example.invalid',role:'VIEWER',active:true,pendingSetup:false,employers,partner:null}];
const results=[];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
mkdirSync('test-results/console-ux',{recursive:true});
try {
  for(const viewport of [...[320,360,390,768,940,1024,1366].map(width=>({width,height:900})),{width:844,height:390}]) for(const dark of [false,true]) for(const consoleName of ['admin','users']) {
    const {width,height}=viewport;
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(({dark})=>{
      localStorage.setItem('cookieNoticeDismissed','1');
      sessionStorage.setItem('efsWelcomeShown','1');
    },{dark});
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='console.test')return route.abort();
      if(url.pathname==='/admin'||url.pathname==='/users')return route.fulfill({contentType:'text/html',body:readFileSync(`public${url.pathname}.html`)});
      if(url.pathname.startsWith('/static/')){
        const path='public/'+url.pathname.slice(8);
        if(!existsSync(path))return route.fulfill({status:404,body:'Not found'});
        const type=path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'image/png';
        return route.fulfill({contentType:type,body:readFileSync(path)});
      }
      if(url.pathname.startsWith('/api/')){
        if(!['GET','HEAD'].includes(route.request().method()))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture request failed. No data was written.'})});
        let body={};
        if(url.pathname==='/api/auth/me')body={id:'fixture-admin',name:'Fixture administrator',role:'SUPERADMIN',modules:{admin:true,dashboard:true,users:true},employers,theme:{branded:false}};
        else if(url.pathname==='/api/users')body=users;
        else if(url.pathname==='/api/admin/reports')body={loadOrder:['fixture'],reports:[{key:'fixture',title:'Workforce eligibility and employee observations',description:'A fixture report for checking format and upload controls.',naturalKey:['employerId'],fields:[{name:'employerId',type:'string',required:true,description:'A long field description to check that governed import documentation wraps without squeezing other columns.'}]}]};
        else if(url.pathname==='/api/admin/integration')body={configured:true,sourceMode:'SQL',effectiveSourceMode:'SQL',sqlDialect:'MYSQL',enabled:true,scheduleHours:24,lastSyncStatus:'OK'};
        else if(url.pathname==='/api/admin/partners')body=[{id:'fixture-partner',name:'Fixture partner with a long regional business name',displayName:'Fixture branded portal',slug:'fixture-partner',primaryColor:'003053',accentColor:'1078BE',navyColor:'003053',_count:{users:12,employers:3}}];
        else if(/partners|batches|sections|sessions|alerts|logins|devices|data-access|revoked|mlops\/events/.test(url.pathname))body=[];
        else if(url.pathname.endsWith('/security/overview'))body={activeSessions:0,failedLogins24h:0,openAlerts:0,successfulLogins24h:0,riskState:'Good'};
        return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
      }
      return route.fulfill({status:204,body:''});
    });
    try {
      await page.goto(`http://console.test/${consoleName}`,{waitUntil:'networkidle'});
      // The app supports persisted dark mode; fixture class makes both token sets deterministic.
      if(dark)await page.locator('html').evaluate(el=>el.classList.add('portal-dark'));
      if(consoleName==='users'){
        await page.locator('#security-center .compact-toggle').click();
        await page.locator('#user-list-card .compact-toggle').click();
        await page.locator('#revoked-users-card .compact-toggle').click();
        assert.equal(await page.locator('#n-pass').getAttribute('type'),'password');
        for(const id of ['n-name','n-email','n-pass','n-partner','user-admin-search','user-admin-status']){
          assert.ok(await page.locator('#'+id).evaluate(el=>!!(el.labels?.length||el.getAttribute('aria-label'))),id+' needs an accessible label');
        }
        await page.locator('#user-admin-search').fill('zz-no-matching-user');
        assert.match(await page.locator('#user-filter-summary').innerText(),/no matches/i);
        await page.locator('#user-admin-search').fill('');
        await page.locator('#user-rows button').filter({hasText:/^Edit$/}).click();
        assert.equal(await page.locator('[id^="editor-"]').count(),1);
        await page.getByRole('button',{name:'Cancel',exact:true}).click();
        assert.equal(await page.locator('[id^="editor-"]').count(),0);
        await page.locator('#user-rows button').filter({hasText:/^Security$/}).click();
        await page.getByRole('dialog',{name:'User security profile'}).waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('dialog').count(),0,'Escape closes the security drawer');
        await page.getByLabel('Send a set-password link',{exact:true}).check();
        assert.equal(await page.locator('#n-pass').isVisible(),false);
        await page.getByLabel('Set a temp password',{exact:true}).check();
        await page.locator('#create-user-btn').click();
        assert.match(await page.locator('#add-msg').innerText(),/full name/i);
        await page.locator('#n-name').fill('Fixture user');
        await page.locator('#n-email').fill('invalid');
        await page.locator('#create-user-btn').click();
        assert.match(await page.locator('#add-msg').innerText(),/valid email/i);
        await page.locator('#n-email').fill('fixture@example.invalid');
        await page.locator('#n-pass').fill('FixtureOnly2026!');
        await page.locator('#create-user-btn').click();
        await page.waitForFunction(()=>!document.querySelector('#create-user-btn').disabled);
        assert.match(await page.locator('#add-msg').innerText(),/Fixture request failed/i);
        assert.equal(await page.locator('#n-name').inputValue(),'Fixture user','failed request preserves form input');
      }else{
        await page.locator('.rep').focus();
        await page.keyboard.press('Enter');
        assert.match(await page.locator('#rep-title').innerText(),/Workforce eligibility/);
        assert.equal(await page.locator('#file').getAttribute('accept'),'.csv,.xlsx,.xls,.json');
        await page.locator('#work summary').click();
        assert.equal(await page.locator('#work details').getAttribute('open'),'');
        await page.locator('#source-tab-api').click();
        assert.equal(await page.locator('#source-tab-api').getAttribute('aria-selected'),'true');
        await page.locator('#source-tab-sql').click();
        assert.equal(await page.locator('#source-tab-sql').getAttribute('aria-selected'),'true');
        await page.locator('#live-integration .compact-toggle').click();
        assert.equal(await page.locator('#live-integration .compact-toggle').getAttribute('aria-expanded'),'false');
        await page.locator('#live-integration .compact-toggle').click();
        assert.equal(await page.locator('#live-integration .compact-toggle').getAttribute('aria-expanded'),'true');
      }
      if(consoleName==='admin'){
        assert.equal(await page.locator('.partner-card').count(),1,'populated branding editor is rendered');
        if(width<=1100){
          for(const grid of await page.locator('.partner-editor-grid').all())assert.equal(await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1,'branding editor stacks its controls');
          assert.equal(await page.locator('#efs-admin-source-status').evaluate(el=>getComputedStyle(el).position),'static','source status does not cover phone/tablet forms');
        }
      }
      const layout=await page.evaluate(()=>({
        width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        outside:[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length&&el.getBoundingClientRect().right>innerWidth+2&&!el.closest('.console-table-scroll,.security-table-wrap')).map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:Math.round(el.getBoundingClientRect().right),text:el.textContent.trim().slice(0,45)})).slice(0,16),
        clipped:[...document.querySelectorAll('button,h1,h2,h3,label,.note')].filter(el=>{
          if(!el.getClientRects().length)return false;
          const style=getComputedStyle(el);
          return (el.scrollWidth>el.clientWidth+2&&style.overflowX!=='visible')||(el.scrollHeight>el.clientHeight+2&&style.overflowY==='hidden');
        }).map(el=>el.textContent.trim().slice(0,80)),
      }));
      assert.ok(layout.scrollWidth<=layout.width+1,`page overflow at ${width}: ${layout.scrollWidth}; ${JSON.stringify(layout.outside)}`);
      assert.deepEqual(layout.clipped,[],'text controls must not clip');
      assert.deepEqual(errors,[],'no uncaught browser errors');
      await page.locator('.head').scrollIntoViewIfNeeded();
      await page.screenshot({path:`test-results/console-ux/${consoleName}-${width}-${dark?'dark':'light'}.png`});
      results.push({console:consoleName,width,height,mode:dark?'dark':'light',status:'pass'});
    }catch(error){
      await page.screenshot({path:`test-results/console-ux/failure-${consoleName}-${width}-${dark?'dark':'light'}.png`,fullPage:true});
      results.push({console:consoleName,width,height,mode:dark?'dark':'light',status:'fail',error:String(error)});
    }finally{await context.close();}
  }
}finally{await browser.close();}
writeFileSync('test-results/console-ux/results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
assert.ok(results.every(result=>result.status==='pass'),'Console UI/UX checks failed');
