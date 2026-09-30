import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root,p),"utf8");
const pages = {
  dashboard: read("public/dashboard.html"),
  admin: read("public/admin.html"),
  users: read("public/users.html"),
};
const nav = read("public/portal-nav-v080.js");
const navCss = read("public/portal-nav-v080.css");
const server = read("src/server.ts");
const snap = read("src/services/snapshotBuilder.ts");
const score = read("src/services/scoreEngine.ts");
const imports = read("src/services/importService.ts");
const failures=[];
const must=(ok,msg)=>{ if(!ok) failures.push(msg); };
const everyPage=(predicate)=>Object.entries(pages).every(([name,src])=>predicate(src,name));

must(existsSync(join(root,"public/portal-nav-v080.js")) && existsSync(join(root,"public/portal-nav-v080.css")), "versioned navigation assets must exist");
must(everyPage(src=>src.includes('/static/portal-nav-v080.css?v=0.10.0') && src.includes('/static/portal-nav-v080.js?v=0.10.0')), "all protected pages must load v0.10.0 versioned navigation assets");
must(everyPage(src=>src.includes('data-portal-build="0.10.0"')), "all protected pages must carry the v0.10.0 build marker");
must(everyPage(src=>!src.includes('class="nav-name"') && !src.includes('class="nav-signout"') && !src.includes('onclick="signOut();return false;"')), "legacy inline username/sign-out navigation must be absent from every protected page");
must(pages.dashboard.includes('id="portal-account"') && pages.admin.includes('id="portal-account"') && pages.users.includes('id="portal-account"'), "all protected pages need the shared account mount");
must(nav.includes("PORTAL_BUILD='0.10.0'") && nav.includes('portal-account-menu') && nav.includes('Portal v${PORTAL_BUILD}') && nav.includes('Sign out'), "account dropdown must contain profile metadata, version and sign out");
must(navCss.includes('.portal-account-menu') && navCss.includes('.portal-account-build'), "account dropdown styling must be present");
must(pages.admin.includes('id="source-tab-sql"') && pages.admin.includes('Database integration'), 'Administration must expose Database integration as a first-class option');
must(pages.admin.includes('Database connection (Direct SQL)') && pages.admin.includes('id="integ-sql-host"'), 'Administration must retain SQL connection fields');
must(pages.admin.includes('body:JSON.stringify(body)') && pages.admin.includes('function integrationDraft()'), 'connection test/save must use the currently entered integration fields');
must(pages.dashboard.includes("countTag.textContent='Data unavailable'") && !pages.dashboard.includes('<span class="card-tag">3,247 chats</span>'), 'live chat UI must not leak the hard-coded 3,247 badge');
must(!pages.dashboard.includes('2,114 employee money problems fixed') && pages.dashboard.includes('id="outcomes-note"') && pages.dashboard.includes("financial ${total===1?'problem':'problems'} resolved"), 'outcomes summary must be calculated from live outcome counts, never hard-coded');
must(!pages.dashboard.includes('58% earn under R15k/mo') && !pages.dashboard.includes('2,114 employee money problems fixed'), 'live dashboard must not contain demo-specific interpretation text outside the explicit demo fixture');
must(!pages.dashboard.includes('>1,182 enrolled<') && pages.dashboard.includes('id="emp-tag"') && pages.dashboard.includes('— enrolled')===false, 'live filter row must not contain a hard-coded enrolled count');
must(pages.dashboard.includes('w.complete===false || !hasValue(w.score)') && pages.dashboard.includes('Data not loaded') && pages.dashboard.includes('function fmtCount'), 'live KPI/wellness renderers must preserve unavailable state instead of synthetic zero/null values');
must(score.includes('optimiseScore: number | null') && snap.includes('missingFeeds'), 'missing feeds must continue to produce unavailable scores, not synthetic scores');
must(snap.includes('const CORE_FEEDS = [') && !snap.match(/CORE_FEEDS\s*=\s*\[[\s\S]*?chat_sessions/), 'chat must not be part of the 10 core source feeds');
must(pages.dashboard.includes("const value=(v,fallback='Not available')") && pages.dashboard.includes("v===null || v===undefined"), 'month activity strip must not render null/undefined values');
must(pages.users.includes('function renderEmpPick()') && pages.users.includes('renderEmpPick();'), 'Users page must define and invoke the employer picker renderer');
must(pages.users.includes("await Promise.allSettled([loadPartnersDropdown(),loadUsers(),loadRevokedUsers(),loadSecurityCenter()])"), 'Users page startup must load user, partner, revoked-user and security telemetry data');
must(pages.users.includes('showUsersLoadError') && pages.users.includes('Could not load users.'), 'Users page must replace indefinite loading states with a visible retryable error');
must(pages.users.includes("const users=await getJson('/api/users')"), 'Users page must fetch the admin user list through the checked JSON helper');

must(pages.admin.includes('function openReset()') && pages.admin.includes('async function doReset()') && pages.admin.includes('/api/admin/reset-all'), 'Administration reset control must have working open/reset handlers');
must(pages.admin.includes('b.revertable') && pages.admin.includes('Could not revert this import'), 'Import history must expose safe revert controls and visible revert failures');
must(server.includes('revertable') && server.includes('reply.code(409)') && imports.includes('batch.reportKey === "employers"'), 'Backend must publish revertability and safely support insert-only employer rollback');
must(server.includes('X-Empower-Portal-Build') && server.includes('no-store, no-cache') && server.includes('version: "0.10.0"'), 'server must expose build identity and disable stale UI caching');
must(pages.admin.includes('System Email &amp; Scheduled Reports') && pages.admin.includes('id="mail-host"') && pages.admin.includes('Send test email'), 'Administration must expose SMTP system email setup');
must(pages.dashboard.includes('function openScheduleReport()') && pages.dashboard.includes('/api/report-schedules') && pages.dashboard.includes('Save schedule'), 'Dashboard Schedule report must open a real scheduling workflow');
must(pages.dashboard.includes('id="pf-employer-filter"') && pages.dashboard.includes('id="pf-select-all"') && pages.dashboard.includes('id="pf-clear-all"') && pages.dashboard.includes('function pfVisibleEmployers()'), 'Portfolio view must provide employer multi-select filtering with Select all/Clear all');
must(pages.dashboard.includes('PORTFOLIO_METRIC_INFO') && pages.dashboard.includes('class="metric-info"') && pages.dashboard.includes('function pfShowMetricTip'), 'Portfolio measures must expose hover/focus information tooltips');
must(pages.dashboard.includes('function pfMoney(v)') && !pages.dashboard.includes("raw:'R '+(totSaving/1e6).toFixed(2)+'m'"), 'Portfolio money KPIs must use scale-aware formatting rather than showing small values as R0.00m');
must(pages.dashboard.includes('Missing measures are shown as unavailable and are not ranked as zero') && pages.dashboard.includes('pf-no-data'), 'Portfolio view must preserve missing-data state instead of converting unavailable metrics to zero');
must(pages.dashboard.includes('id="btn-pf-export"') && pages.dashboard.includes("pfExp.addEventListener('click'"), 'Portfolio Export book action must be wired');
must(server.includes('/api/admin/email-settings') && server.includes('/api/report-schedules/:id/send-now') && server.includes('startReportScheduler(app)'), 'Server must expose SMTP and scheduled report routes and start the scheduler');

must(pages.dashboard.includes('const EMPLOYER_METRIC_INFO = {'), 'Employer metric glossary must be embedded in the dashboard');
must(pages.dashboard.includes('data-metric=\"wellness\"') && pages.dashboard.includes("wireMetricTips(document.getElementById('employer-view'))"), 'Employer view must expose and wire metric information icons');
must(pages.dashboard.includes("infoKey:'takeUp'") && pages.dashboard.includes("infoKey:'engaged'") && pages.dashboard.includes("infoKey:'saving'") && pages.dashboard.includes("infoKey:'rating'"), 'Employer KPI cards must expose metric help');
must(pages.dashboard.includes('funnelEligible') && pages.dashboard.includes('valueMonthly') && pages.dashboard.includes('debtProfile') && pages.dashboard.includes('prescription') && pages.dashboard.includes('riskSignals') && pages.dashboard.includes('opportunities'), 'Employer metric glossary must cover the major dashboard sections');


must(pages.dashboard.includes('id="employer-select"') && pages.dashboard.includes('id="month-select"') && pages.dashboard.includes('id="region-filter"') && pages.dashboard.includes('id="income-filter"'), 'filter order must expose Company, Period/Month, Region and Income Band controls');
must(pages.dashboard.indexOf('id="employer-select"') < pages.dashboard.indexOf('id="month-select"') && pages.dashboard.indexOf('id="month-select"') < pages.dashboard.indexOf('id="region-filter"') && pages.dashboard.indexOf('id="region-filter"') < pages.dashboard.indexOf('id="income-filter"'), 'filter DOM order must be Company -> Period/Month -> Region -> Income Band');
must(pages.dashboard.includes("switchFilter('site',v)") && pages.dashboard.includes("switchFilter('income',v)"), 'Region and Income selections must update the live URL/API filters');
must(snap.includes('historicalSiteRows') && snap.includes('employeeVersion.findMany'), 'Region choices must include historical site dimension members');
must(snap.includes('const cohort = { site: filter.site ?? undefined, income: filter.income ?? undefined }') && snap.includes('previousPeriod(filter.period)'), 'Prior-period score must use the same Region/Income cohort and previous month for monthly selections');
must(snap.includes('{ range: "30d", asAt: priorEnd.toISOString(), ...cohort }'), 'Last 30 days must compare against the preceding 30-day window');
must(snap.includes('platformUsers.length > 0 && liveJourneys.length > 0') && snap.includes('policies.length > 0 && platformUsers.length > 0'), 'Historical score availability must be based on selected-period records, not only global sync cursors');
must(pages.dashboard.includes('Score ${Math.round(Number(score))}') && pages.dashboard.includes('replace(" · Score ", ": Score ")'), 'Month selector labels must show the actual score for each month');


// Responsive release gates: the same protected pages must remain bounded on
// desktop and collapse/wrap cleanly at phone/tablet widths. These are static
// invariants; browser/device smoke testing remains a deployment-stage check.
const dashboardHtml = pages.dashboard;
const dashboardCss = read("public/dashboard.css");
must(everyPage(src => /<meta[^>]+name=["']viewport["'][^>]+content=["']width=device-width,\s*initial-scale=1(?:\.0)?["']/i.test(src)), "all protected pages need a real responsive viewport");
must(/\.wrap\s*\{[^}]*max-width:\s*1280px/i.test(dashboardHtml), "dashboard desktop layout must have a bounded content width");
must(/@media\s*\(max-width:\s*1080px\)/.test(dashboardCss), "dashboard must have a tablet breakpoint");
must(/@media\s*\(max-width:\s*640px\)/.test(dashboardCss), "dashboard must have a phone breakpoint");
must(/@media\s*\(max-width:\s*900px\)\s*and\s*\(orientation:\s*landscape\)/.test(dashboardCss), "dashboard must have an explicit mobile-landscape breakpoint");
must(/orientation:\s*landscape[\s\S]*?\.g-12\s*\{grid-template-columns:\s*1fr/.test(dashboardCss), "mobile landscape must collapse the 12-column dashboard grid");
must(pages.dashboard.includes("function formatRandThousands") && pages.dashboard.includes("function niceTicks"), "financial charts must use explicit full-rand formatting and nice axis ticks");
must(pages.dashboard.includes('function alignSeries(current, previous)') && pages.dashboard.includes('DATA.comparison'), "time-series charts must share an aligned selected-period versus comparison-period data model");
must(pages.dashboard.includes("DATA.filterContext?.comparison?.label"), "dashboard comparison labels must reflect the exact selected comparison window");
must(!pages.dashboard.includes("pts vs. last period") && !pages.dashboard.includes("vs. last period"), "dashboard visible comparison copy must use the selected comparison label");
must(pages.dashboard.includes("const legend=rows.map((b,i)") && pages.dashboard.includes("brandSeries(i)"), "income chart legend must receive its palette index explicitly");
must(dashboardCss.includes('@media (max-width:900px) and (orientation:landscape)') && dashboardCss.includes('table.ct tr.ct-row td::before'), "creditor detail must reflow in landscape as well as portrait");

must(pages.dashboard.includes('data-label="Creditor"') && pages.dashboard.includes('data-label="Average per account"'), "creditor detail must expose mobile-readable row labels");
must(dashboardCss.includes('table.ct tr.ct-row') && dashboardCss.includes('table.ct tr.ct-row td::before'), "creditor table must reflow into readable mobile cards");
must(dashboardCss.includes('.drawer-outcome') && dashboardCss.includes('.drawer-creditor'), "drilldown drawers must have dedicated responsive layouts");
must(pages.dashboard.includes('function renderPeriodLineChart') && !pages.dashboard.includes('period-bar-chart'), "monthly and quarter comparisons must use line charts, not bar fallback cards");
must((pages.dashboard.includes('pc.current.label') && pages.dashboard.includes('pc.previous.label')) || (pages.dashboard.includes('DATA.filterContext?.comparison?.current') && pages.dashboard.includes('DATA.filterContext?.comparison?.previous')), "comparison charts must use exact current and previous period labels");
must(!pages.dashboard.includes('cumulative value drawn'), "monthly EWA chart copy must not describe a monthly series as cumulative");

must(pages.dashboard.includes('const rows=Array.isArray(DATA.income)?DATA.income:[]') && pages.dashboard.includes('brandSeries(i)'), "income reach must be robust and use the dashboard brand palette");
must(snap.includes('INCOME_VALUES.map((band, index)') && snap.includes('incomeCounts.get(band) ?? 0'), "income reach data must preserve zero-count configured bands");
must(dashboardCss.includes('.drawer-outcome .drawer-stat-grid') && dashboardCss.includes('white-space:nowrap'), "drilldown financial values must not wrap within stat cards");

must(snap.includes('comparisonPayload') && snap.includes('previous month') && snap.includes('previous quarter') && snap.includes('previous 30 days') && snap.includes('same period last year'), "server comparisons must use exact like-for-like reporting windows");

must(pages.dashboard.includes("formatRandThousands(") && pages.dashboard.includes("valueFormatter(v)") && pages.dashboard.includes("function renderPeriodLineChart"), "savings/EWA charts must label values in full rand amounts");
must(!/toFixed\([^)]*\)[^\n]*['"]m['"]|toFixed\([^)]*\)[^\n]*['"]k['"]/.test(pages.dashboard), "dashboard source must not create compact m/k financial labels");
must(!/Math\.round\([^\n]+\/\s*(?:1e6|1000000|1e3|1000)\)[^\n]*['"]m?['"]/.test(pages.dashboard), "dashboard must not abbreviate financial amounts into m/k labels");

must(/@media\s*\(max-width:\s*420px\)/.test(dashboardCss), "dashboard must have a small-phone breakpoint");
must(/\.g-4\s*\{[^}]*grid-template-columns:\s*repeat\(4,1fr\)/.test(dashboardHtml) && /@media\s*\(max-width:\s*1080px\)[\s\S]*?\.g-4\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(dashboardCss), "dashboard KPI grid must collapse from four columns on smaller screens");
must(/\.g-2\s*\{[^}]*grid-template-columns:\s*repeat\(2,1fr\)/.test(dashboardHtml) && /@media\s*\(max-width:\s*640px\)[\s\S]*?\.grid,\s*\.g-4,\s*\.g-3,\s*\.g-2\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(dashboardCss), "dashboard two-column sections must stack on phones");
must(/overflow-x:\s*auto/.test(dashboardCss), "data tables must have a horizontal overflow escape hatch on small screens");
must(/overflow-wrap:\s*anywhere/.test(dashboardCss), "long labels and values must wrap instead of forcing horizontal page overflow");
must(/max-width:\s*100%/.test(dashboardCss), "media/form content must be bounded to the viewport");
must(/\.stat-strip\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)/.test(dashboardCss), "enterprise value strip must use bounded desktop columns");
must(/\.stat-cell \.v\s*\{[\s\S]*?white-space:\s*nowrap/.test(dashboardCss), "financial values must remain atomic and never wrap character-by-character");
must(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.stat-strip\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(dashboardCss), "enterprise value strip must become a single readable column on phones");
must(pages.dashboard.includes('fitResponsiveDataValues') && pages.dashboard.includes('scrollWidth>maxWidth'), "dashboard must auto-fit numeric values to their available card width");

must(!pages.dashboard.includes("ui-enhance-v1.css") && !pages.dashboard.includes("ui-enhance-v2.css") && !pages.dashboard.includes("responsive-v1.css") && !pages.dashboard.includes("responsive-v2.css"), "dashboard must use one canonical responsive stylesheet, not stacked legacy layers");

must(read("public/enterprise.css").includes("img[data-custom-logo]") && read("public/dashboard.html").includes("setAttribute('data-custom-logo','1')"), "uploaded company logos must be exempt from the white-out filter");
must(!/invert\(1\)\s+hue-rotate/.test(read("public/dark-mode-v1.css")) && !/invert\(1\)\s+hue-rotate/.test(read("public/portal-nav-v080.css")), "dark mode must not use the whole-page invert filter");
must(!/portal-dark[^{]*\{[^}]*#e5d8ff/.test(read("public/portal-nav-v080.css")), "dark mode must not hard-code a fixed brand colour");
for (const page of ["dashboard", "admin", "users"]) {
  const h = read(`public/${page}.html`);
  must(h.includes("/static/dark-theme-v2.css") && h.includes("/static/brand-engine.js"), `${page}: token-driven dark theme + brand engine must be loaded`);
  must(!h.includes("dark-mode-v1.css"), `${page}: legacy dark-mode stylesheet must not be loaded`);
}
must(read("public/dashboard.html").includes("BrandEngine.themeController()"), "dashboard theme must be applied through the brand engine controller");
must(read("public/admin.html").includes("BrandEngine.extractFromImage"), "admin logo detection must use the brand engine");
must(/background:var\(--white,#fff\)!important/.test(read("public/enterprise.css")), "enterprise surfaces must be token-driven so dark mode can restyle them");
if(failures.length){ console.error('UI regression check failed:\n- '+failures.join('\n- ')); process.exit(1); }
console.log('UI regression check passed: v0.10.0 navigation, SQL integration, users/import controls, live-data availability and demo-leak safeguards are present.');
