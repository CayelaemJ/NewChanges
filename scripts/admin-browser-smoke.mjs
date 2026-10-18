import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage();
const errors=[];
const diagnostics=[];
const failures=[];
page.on("pageerror",e=>errors.push(e.stack||e.message));
page.on("console",message=>{if(message.type()==="error"){diagnostics.push("[console] "+message.text());console.error("[browser console]",message.text())}});
page.on("requestfailed",request=>{const detail=request.url()+" "+(request.failure()?.errorText||"");failures.push(detail);console.error("[request failed]",detail)});
page.on("response",response=>{if(response.status()>=400 && new URL(response.url()).hostname==="admin.test")diagnostics.push("[HTTP "+response.status()+"] "+response.url())});
await page.route("http://admin.test/**",async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==="/admin")return route.fulfill({status:200,contentType:"text/html",body:readFileSync("public/admin.html","utf8")});
  if(url.pathname.startsWith("/static/")){
    const path="public/"+url.pathname.slice(8);
    if(!existsSync(path))return route.fulfill({status:404,body:"Not found"});
    return route.fulfill({status:200,contentType:path.endsWith(".js")?"application/javascript":"text/css",body:readFileSync(path)});
  }
  if(url.pathname.startsWith("/api/")){
    const body=url.pathname==="/api/auth/me" ? {id:"browser-smoke-admin",role:"SUPERADMIN",modules:{admin:true,dashboard:true},employers:[],theme:null}
      : url.pathname==="/api/admin/integration"
      ? {configured:true,sourceMode:"SQL",effectiveSourceMode:"SQL",enabled:true,scheduleHours:24,lastSyncStatus:"OK"}
      : url.pathname==="/api/admin/database-status" ? {status:"green",provider:"Neon",database:"newchanges",message:"Test connection"}
      : url.pathname==="/api/admin/integration/logs" ? {logs:[]}
      : {};
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
  }
  return route.fulfill({status:200,body:""});
});
try {
await page.goto("http://admin.test/admin",{waitUntil:"domcontentloaded"});
await page.waitForTimeout(1200);
const labels=await page.locator("body").innerText();
assert(labels.trim().length>100,"Admin Console rendered empty page");
assert(await page.locator("#integ-enabled").count()===1,"Source sync checkbox missing");
assert(await page.locator("#integ-hours").count()===1,"Heartbeat schedule missing");
assert.equal(await page.evaluate(()=>typeof window.loadInteg),"function","Integration loader unavailable");
if(errors.length) console.error("[uncaught browser exceptions]",errors.join("\\n"));
assert.deepEqual(errors,[],"Browser runtime errors: "+errors.join(" | "));
console.log("Admin Console headless Chromium smoke passed");
} catch(error) {
  mkdirSync("test-results/admin-browser",{recursive:true});
  await page.screenshot({path:"test-results/admin-browser/failure.png",fullPage:true}).catch(()=>{});
  writeFileSync("test-results/admin-browser/diagnostics.json",JSON.stringify({error:String(error),pageErrors:errors,console:diagnostics,requestFailures:failures,url:page.url()},null,2));
  console.error("[Admin browser diagnostics]",JSON.stringify({pageErrors:errors,console:diagnostics,requestFailures:failures},null,2));
  throw error;
} finally {await browser.close()};
