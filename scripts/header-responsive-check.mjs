import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({args:['--no-sandbox']});
mkdirSync('test-results/header-responsive',{recursive:true});
try{
for(const width of [320,360,640,768,900,940,1024,1180,1280,1366]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname!=='header.test')return route.abort();
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:readFileSync('public/dashboard.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
  const path='public/'+u.pathname.replace(/^\/static\//,'');
  if(!existsSync(path))return route.fulfill({status:404,body:''});
  return route.fulfill({contentType:path.endsWith('.css')?'text/css':path.endsWith('.js')?'application/javascript':'image/svg+xml',body:readFileSync(path)});
 });
 await page.goto('http://header.test/');
 await page.addScriptTag({content:readFileSync('public/portal-nav-v080.js','utf8')});
 await page.evaluate(()=>{
  document.querySelector('#welcome-splash')?.remove();
  const meta=document.querySelector('.topbar-meta');const nav=document.createElement('div');nav.id='portal-nav';meta.prepend(nav);
  document.querySelector('#data-fresh-label').textContent='Last synced 16 Oct 2026';
  document.querySelector('#role-indicator').textContent='SUPER ADMIN';
  EmpowerPortalNav.render({me:{name:'Fixture Admin',role:'SUPERADMIN',modules:{dashboard:true,admin:true,users:true}},active:'dashboard',includeDashboard:false});
 });
 const problems=await page.locator('.topbar').evaluate(top=>{
  const selectors=['.logo','.audience-switch','.portal-primary-nav','.data-fresh','.role-indicator','.portal-account'];
  const visible=selectors.map(s=>top.querySelector(s)).filter(e=>e&&e.getBoundingClientRect().width&&getComputedStyle(e).display!=='none');
  const issues=[];
  for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){
   const a=visible[i].getBoundingClientRect(),b=visible[j].getBoundingClientRect();
   if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)issues.push(visible[i].className+' overlaps '+visible[j].className);
  }
  for(const e of visible){const r=e.getBoundingClientRect();if(r.left<0||r.right>innerWidth+1)issues.push(e.className+' outside viewport');}
  return issues;
 });
 assert.deepEqual(problems,[],width+' header overlap');
 await page.getByRole('button',{name:'Account menu',exact:true}).click();
 if(width<=1180){for(const href of ['/admin','/users'])assert.equal(await page.locator('.portal-mobile-links a[href="'+href+'"]').isVisible(),true,width+' '+href+' menu link');}
 const menu=await page.locator('.portal-account-menu').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=width+1,width+' menu fits viewport');
 await page.screenshot({path:'test-results/header-responsive/'+width+'.png'});
 await page.close();
}
console.log('Header checks passed at 10 phone, tablet, half-screen and desktop widths; admin/users navigation remains accessible.');
}finally{await browser.close();}
