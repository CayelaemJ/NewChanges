import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage();
const errors=[];
page.on("pageerror",e=>errors.push(e.stack||e.message));
page.on("console",message=>{if(message.type()==="error")console.error("[browser console]",message.text())});
page.on("requestfailed",request=>console.error("[request failed]",request.url(),request.failure()?.errorText));
await page.route("http://admin.test/**",async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==="/admin")return route.fulfill({status:200,contentType:"text/html",body:readFileSync("public/admin.html","utf8")});
  if(url.pathname.startsWith("/static/")){
    const path="public/"+url.pathname.slice(8);
    if(!existsSync(path))return route.fulfill({status:404,body:"Not found"});
    return route.fulfill({status:200,contentType:path.endsWith(".js")?"application/javascript":"text/css",body:readFileSync(path)});
  }
  if(url.pathname.startsWith("/api/")){
    const body=url.pathname==="/api/admin/integration"
      ? {configured:true,sourceMode:"SQL",effectiveSourceMode:"SQL",enabled:true,scheduleHours:24,lastSyncStatus:"OK"}
      : url.pathname==="/api/admin/database-status" ? {status:"green",provider:"Neon",database:"newchanges",message:"Test connection"}
      : url.pathname==="/api/admin/integration/logs" ? {logs:[]}
      : {};
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
  }
  return route.fulfill({status:200,body:""});
});
await page.goto("http://admin.test/admin",{waitUntil:"domcontentloaded"});
await page.waitForTimeout(1200);
const labels=await page.locator("body").innerText();
assert(labels.trim().length>100,"Admin Console rendered empty page");
assert(await page.locator("#integ-enabled").count()===1,"Source sync checkbox missing");
assert(await page.locator("#integ-hours").count()===1,"Heartbeat schedule missing");
assert.equal(typeof await page.evaluate(()=>window.loadInteg),"function","Integration loader unavailable");
if(errors.length) console.error("[uncaught browser exceptions]",errors.join("\\n"));
assert.deepEqual(errors,[],"Browser runtime errors: "+errors.join(" | "));
console.log("Admin Console headless Chromium smoke passed");
await browser.close();
