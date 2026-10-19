import { test, expect } from "@playwright/test";

test("visible semantic version update refreshes rendered wellness score and months",async({page})=>{
  await page.clock.install();
  let score=26;
  let periods=["2026-09"];
  let dashboardReads=0;
  let periodReads=0;
  let versionReads=0;
  const employerId="synthetic-browser-employer";
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url());
    const path=url.pathname;
    const json=(data)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
    if(path==="/api/auth/me")return json({
      name:"Synthetic Browser Viewer",role:"VIEWER",
      employers:[{id:employerId,name:"Synthetic Employer"}],
      theme:{branded:false},
    });
    if(path==="/api/dashboard/semantic-features")return json({pollingEnabled:true,servingEnabled:false});
    if(path==="/api/dashboard/semantic-version-changes"){
      versionReads++;
      const after=url.searchParams.get("afterId");
      if(!after)return json({changes:[],nextCursor:"START"});
      if(after!=="START" && after!=="synthetic-cursor-2")throw new Error("Unexpected publication cursor");
      return json({changes:[{employerId,period:"2026-10",action:"PUBLISH"}],nextCursor:"synthetic-cursor-2"});
    }
    if(path==="/api/employers/"+employerId+"/dashboard"){
      dashboardReads++;
      return json({
        employer:"Synthetic Employer",
        filterContext:{label:"Latest reporting month",period:"2026-10"},
        wellness:{score,prior:null,complete:true,band:score>=30?"At risk":"Critical",drivers:[]},
        dataQuality:{scoreReady:true,warnings:[]},
        filterOptions:{sites:[],incomes:[]},
        exec:{items:[{l:"Financial wellbeing score",v:score+"/100"}]},
      });
    }
    if(path==="/api/employers/"+employerId+"/periods"){
      periodReads++;
      return json(periods);
    }
    return json({});
  });

  await page.goto("/");
  await expect(page.getByText(/Financial wellbeing score is 26\/100/)).toBeVisible();
  await expect.poll(()=>versionReads).toBeGreaterThan(0);
  const initialDashboardReads=dashboardReads;
  const initialPeriodReads=periodReads;

  score=38;
  periods=["2026-09","2026-10"];
  await page.clock.fastForward(30_001);
  await expect(page.getByText(/Financial wellbeing score is 38\/100/)).toBeVisible();
  expect(dashboardReads).toBeGreaterThan(initialDashboardReads);
  expect(periodReads).toBeGreaterThan(initialPeriodReads);
  expect(versionReads).toBeGreaterThan(1);
});
