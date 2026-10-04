import { Component, type CSSProperties, type PropsWithChildren, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Progress } from "./components/ui/progress";
import { Select } from "./components/ui/select";
import { CartesianGrid, Line, LineChart as RechartsLineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import MuiTooltip from "@mui/material/Tooltip";
import "./enterprise.css";
type Me = {
  name?: string; email?: string; role?: string;
  employers?: Array<{ id: string; name: string }>;
  sections?: Record<string, boolean>;
  theme?: { name?: string; primaryColor?: string; accentColor?: string; navyColor?: string; logoDataUrl?: string | null; tagline?: string | null };
};

type BrandEngine = {
  themeController: () => { set: (options: { brand?: { accentColor?: string; primaryColor?: string; navyColor?: string }; light?: "engine" | null; charts?: Record<string,string> }) => void };
  deriveChartPalette: (theme: { accentColor?: string; primaryColor?: string; navyColor?: string }) => Record<string,string>;
};
declare global { interface Window { BrandEngine?: BrandEngine } }

type Dashboard = {
  employer?: string; headcount?: number;
  dataAsOf?: string;
  filterContext?: {
    label?: string; period?: string; range?: string; incomeLabel?: string;
    comparison?: { mode?: string; label?: string; current?: string; previous?: string | null };
  };
  portfolio?: Record<string, number | null>;
  wellness?: { score?: number | null; prior?: number | null; band?: string; complete?: boolean; drivers?: Array<{name:string;score:number|null;weight:number}> };
  exec?: { items?: Array<{l:string;v:string}> };
  kpis?: {
    takeUp?: {pct:number|null; enrolled:number|null; delta:number|null};
    activated?: {pct:number|null; count:number|null; delta:number|null};
    monthlySaving?: {rand:number|null; perHead:number|null; delta:number|null; trend:number[]};
    avgRating?: {val:number|null; responses:number|null; delta:number|null};
  };
  funnel?: Array<{label:string; sub:string; n:number|null; pct:number|null; available:boolean}>;
  valueStrip?: Array<{l:string;v:string;d:string;available:boolean}>;
  income?: Array<{name:string;count:number;color:string}>;
  ratings?: {avg:number|null;fiveStarPct:number|null;responses:number|null};
  comparison?: {current?:{label:string;savings:number[];savingsLabels:string[];monthlySavingRand?:number;totalAdvancedRaw?:number;ewa?:number[];ewaLabels?:string[]};previous?:{label:string;savings:number[];savingsLabels:string[];monthlySavingRand:number;totalAdvancedRaw:number;ewa?:number[];ewaLabels?:string[]}};
  filterOptions?: { sites?:Array<{value:string;label:string}>; incomes?:Array<{value:string;label:string}> };
  outcomes?: Array<{key:string;name:string;count:number;stat:string;statL:string;avgPerEmployee:string;trend?:number[];delta?:number|null}>;
  creditors?: Array<{name:string;accounts:number;balance:string;avg:string;stateBreakdown?:Array<{label:string;count:number;pct:number}>}>;
  creditorsTotal?: {accounts:number;balance:string};
  debtStates?: {active?:{rand:number;employees:number};challenged?:{rand:number;employees:number};guided?:{rand:number;employees:number}};
  ewa?: {totalRaw?:number; total?:string; trend?:number[]; trendLabels?:string[]; advances?:number; clients?:number; avg?:string; perClient?:number};
  referral?: {shares?:number; shareRate?:number; channel?:string; impliedReach?:string};
  riskSignals?: Array<{sig:string;n:number;sev:string;note:string}>;
  opportunities?: {cards?:Array<{name:string;eligible:number;saving:string;extra?:string;icon?:string}>;estMonthly?:string;estAnnual?:string;valueLabel?:string;valueNote?:string};
  savings?: number[];
  savingsLabels?: string[];
  dataQuality?: {scoreReady:boolean;warnings?:string[]};
};

const roleLabels: Record<string,string> = {
  SUPERADMIN:"Super Admin", ADMIN:"Admin", EMPLOYER_MANAGER:"Employer Manager",
  PORTFOLIO_MANAGER:"Portfolio Manager", VIEWER:"Viewer"
};
const money = (n:number|null|undefined) => n == null ? "Not available" : new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR",maximumFractionDigits:0}).format(n);
const number = (n:number|null|undefined) => n == null ? "Not available" : new Intl.NumberFormat("en-ZA").format(n);
const pct = (n:number|null|undefined) => n == null ? "Not available" : `${n.toFixed(1)}%`;
const api = async <T,>(url:string, init:RequestInit = {}):Promise<T> => {
  const r=await fetch(url,{credentials:"same-origin",cache:"no-store",signal:init.signal ?? AbortSignal.timeout(15_000),...init});
  if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error || "Request failed");
  return r.json();
};

function normaliseHex(value?: string | null, fallback = "#5f756d") {
  if (!value) return fallback;
  const hex = value.startsWith("#") ? value : "#" + value;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : fallback;
}

function LineChart({values,labels,previous=[],previousLabels=[],currentLabel="Selected period",previousLabel="Previous period",prefix="R "}:{values:number[];labels:string[];previous?:number[];previousLabels?:string[];currentLabel?:string;previousLabel?:string;prefix?:string}) {
  const current=values.map(Number).filter(Number.isFinite);
  const prior=previous.map(Number).filter(Number.isFinite);
  if(!current.length&&!prior.length) return <div className="muted comparison-empty">No data is available for this period.</div>;
  const n=Math.max(current.length,prior.length,1);
  const align=(arr:number[])=>Array.from({length:n},(_,i)=>arr[i-(n-arr.length)]??null);
  const a=align(current), b=align(prior);
  const all=[...a,...b].filter((v):v is number=>v!==null);
  const min=Math.min(...all,0), max=Math.max(...all,1), span=Math.max(max-min,1);
  const w=720,h=230,left=42,right=16,top=18,bottom=38;
  const point=(v:number|null,i:number)=>v===null?null:[left+(n===1?(w-left-right)/2:i/(n-1)*(w-left-right)),top+(1-(v-min)/span)*(h-top-bottom)];
  const path=(arr:Array<number|null>)=>arr.map((v,i)=>{const p=point(v,i);return p ? `${i ? "L" : "M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}` : null}).filter(Boolean).join(" ");
  const currentPath=path(a), priorPath=path(b);
  const labelsForChart=labels.length?labels:previousLabels;
  return <div className="comparison-chart">
    <div className="comparison-value-row">
      <div className="comparison-value-card previous"><span className="comparison-value-period">{previousLabel}</span><strong>{prior.length?prefix+number(prior[prior.length-1]):"Not available"}</strong></div>
      <div className="comparison-value-card current"><span className="comparison-value-period">{currentLabel}</span><strong>{current.length?prefix+number(current[current.length-1]):"Not available"}</strong></div>
    </div>
    <div className="comparison-legend"><span><i className="comparison-dot current"></i>{currentLabel}</span><span><i className="comparison-dot previous"></i>{previousLabel}</span></div>
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${currentLabel} compared with ${previousLabel}`} className="w-full" preserveAspectRatio="none">
      <line x1={left} x2={w-right} y1={h-bottom} y2={h-bottom} stroke="var(--line)" />
      <line x1={left} x2={w-right} y1={top+(h-top-bottom)/2} y2={top+(h-top-bottom)/2} stroke="var(--line-soft)" />
      {priorPath&&<path d={priorPath} fill="none" stroke="var(--grey-l)" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" strokeLinejoin="round" />}
      {currentPath&&<path d={currentPath} fill="none" stroke="var(--chart-cashflow,var(--brand-accent))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      {a.map((v,i)=>{const p=point(v,i);return p?<circle key={`c${i}`} cx={p[0]} cy={p[1]} r="4" fill="var(--chart-cashflow,var(--brand-accent))" />:null})}
      {b.map((v,i)=>{const p=point(v,i);return p?<circle key={`p${i}`} cx={p[0]} cy={p[1]} r="3" fill="var(--grey-l)" />:null})}
      {labelsForChart.map((label,i)=>{const x=n===1?(w-left-right)/2+left:left+i/(Math.max(labelsForChart.length-1,1))*(w-left-right);return <text key={i} x={x} y={h-12} textAnchor={i===0?"start":i===labelsForChart.length-1?"end":"middle"} fontSize="10" fontWeight="800" fill={i===labelsForChart.length-1?"var(--brand-primary)":"var(--grey-l)"}>{label}</text>})}
    </svg>
  </div>;
}
function SectionHeading({title,description}:{title:string;description?:string}) {
  return <div className="mb-4 border-b border-slate-200 pb-3"><CardTitle>{title}</CardTitle>{description&&<CardDescription className="mt-1">{description}</CardDescription>}</div>;
}

function WellnessGauge({score}:{score:number|null|undefined}) {
  if(score==null || !Number.isFinite(Number(score))) return <div className="wellness-gauge-empty">Not available</div>;
  const value=Math.max(0,Math.min(100,Number(score)));
  return <svg viewBox="0 0 160 96" width="180" className="wellness-gauge" role="img" aria-label={`Workforce Financial Wellness Score ${value} out of 100`}>
    <defs><linearGradient id="wellnessGaugeGradient" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--brand-grad-1)"/><stop offset=".5" stopColor="var(--brand-grad-3)"/><stop offset="1" stopColor="var(--brand-grad-5)"/></linearGradient></defs>
    <path d="M16 88 A64 64 0 0 1 144 88" fill="none" stroke="var(--ice-2)" strokeWidth="13" strokeLinecap="round"/>
    <path d="M16 88 A64 64 0 0 1 144 88" fill="none" stroke="url(#wellnessGaugeGradient)" strokeWidth="13" strokeLinecap="round" pathLength="100" strokeDasharray={`${value} ${100-value}`} strokeDashoffset="0"/>
    <text x="80" y="74" textAnchor="middle" fontFamily="Fraunces,serif" fontSize="34" fontWeight="600" fill="var(--brand-primary)">{value.toFixed(0)}</text>
    <text x="80" y="90" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--grey-l)">/ 100</text>
  </svg>;
}

function DashboardView({me}:{me:Me}) {
  const [data,setData]=useState<Dashboard|null>(null);
  const [period,setPeriod]=useState("");
  const [darkMode,setDarkMode]=useState(()=>document.documentElement.classList.contains("portal-dark")); const [range,setRange]=useState<"latest"|"quarter"|"all">("latest");
  const [income,setIncome]=useState("all"); const [site,setSite]=useState("all"); const [periodOptions,setPeriodOptions]=useState<string[]>([]);
  const [selectedEmployerId,setSelectedEmployerId]=useState(me.employers?.[0]?.id??""); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const employer=me.employers?.find(e=>e.id===selectedEmployerId)??me.employers?.[0];
  const brandPrimary = normaliseHex(me.theme?.primaryColor, "#2b1b68");
  const brandNavy = normaliseHex(me.theme?.navyColor, "#0d2a47");
  const brandAccent = normaliseHex(me.theme?.accentColor, "#7d2fa3");
  const chartPalette = useMemo(() => window.BrandEngine?.deriveChartPalette({accentColor: brandAccent, primaryColor: brandPrimary, navyColor: brandNavy}) ?? {}, [brandAccent, brandPrimary, brandNavy]);
  const themeStyle: CSSProperties = {
    "--brand-primary": brandPrimary,
    "--brand-primary-deep": brandNavy,
    "--brand-navy": brandNavy,
    "--brand-accent": brandAccent,
    "--blue": brandAccent,
    "--blue-d": brandAccent,
    ...Object.fromEntries(Object.entries(chartPalette).map(([key,value]) => [`--chart-${key.replace(/^--chart-/,"")}`, value]))
  } as CSSProperties;
  useEffect(()=>{
    document.documentElement.classList.toggle("portal-dark",darkMode);
  },[darkMode]);
  useEffect(()=>{
    const engine=window.BrandEngine?.themeController();
    if(engine) engine.set({brand:{accentColor:brandAccent,primaryColor:brandPrimary,navyColor:brandNavy},light:"engine",charts:chartPalette});
  },[brandAccent,brandPrimary,brandNavy,chartPalette]);


  const query=useMemo(()=>{const p=new URLSearchParams();if(period)p.set("period",period);else p.set("range",range);if(income!=="all")p.set("income",income);if(site!=="all")p.set("site",site);return p.toString()},[period,range,income,site]);

  useEffect(()=>{
    if(!employer) return;
    const controller=new AbortController();
    setLoading(true); setError("");
    const url="/api/employers/"+encodeURIComponent(employer.id)+"/dashboard?"+query;
    api<Dashboard>(url,{signal:controller.signal}).then(setData).catch(e=>{
      if(e?.name !== "AbortError") setError(e.message);
    }).finally(()=>{ if(!controller.signal.aborted) setLoading(false); });
    return ()=>controller.abort();
  },[query,employer?.id]);
  useEffect(()=>{if(!employer?.id)return;api<string[]>(`/api/employers/${encodeURIComponent(employer.id)}/periods`).then(rows=>setPeriodOptions(Array.isArray(rows)?rows:[])).catch(()=>setPeriodOptions([]));},[employer?.id]);

  if(!employer)return <Card className="mx-auto mt-20 max-w-2xl"><CardHeader><CardTitle>No employer data available</CardTitle><CardDescription>Your authenticated role has no employer assignment.</CardDescription></CardHeader></Card>;
  if(loading)return <Card className="mx-auto mt-20 max-w-2xl"><CardContent className="py-12 text-center text-sm text-slate-500">Loading governed dashboard data...</CardContent></Card>;
  if(error)return <Card className="mx-auto mt-20 max-w-2xl border-red-200"><CardContent className="py-10"><div className="flex gap-3"><span className="text-xs font-bold uppercase tracking-widest text-red-700">Error</span><div><p className="font-semibold text-red-700">Dashboard unavailable</p><p className="mt-1 text-sm text-slate-600">{error}</p></div></div></CardContent></Card>;
  if(!data)return null;

  const comparison=data.filterContext?.comparison;
  const currentSaving=data.comparison?.current?.monthlySavingRand??data.kpis?.monthlySaving?.rand??0;
  const previousSaving=data.comparison?.previous?.monthlySavingRand??0;
  const savingDelta=currentSaving-previousSaving;
  const trend=data.comparison?.current?.savings??data.kpis?.monthlySaving?.trend??data.savings??[];
  const trendLabels=data.comparison?.current?.savingsLabels??data.savingsLabels??[];
  const advancedTrend=data.comparison?.current?.ewa??data.ewa?.trend??[];
  const advancedLabels=data.comparison?.current?.ewaLabels??data.ewa?.trendLabels??[];
  const incomeOptions=data.filterOptions?.incomes??[];
  const role=roleLabels[me.role??""]??me.role??"User";
  const maxIncome=Math.max(1,...(data.income??[]).map(x=>x.count));

  return <main className="dashboard-shell" style={themeStyle}>
    <div className="topbar">
      <div className="topbar-inner">
        <div className="logo"><img src="/static/logo.png" alt="empower-fin Dashboard Portal" /><span className="logo-text">{me.theme?.name||""}</span></div>
        <div className="topbar-divider" />
        <div className="audience-switch"><button className="on" type="button">Employer view</button><button type="button" disabled>Portfolio view</button></div>
        <div className="topbar-spacer" />
        <div className="topbar-meta">
          <div className="data-fresh"><span className="dot" /><span>Live dashboard</span></div>
          <MuiTooltip title={darkMode ? "Switch to light mode" : "Switch to dark mode"} arrow><button type="button" className="portal-theme-quick" aria-label={darkMode?"Switch to light mode":"Switch to dark mode"} onClick={()=>setDarkMode(v=>!v)}>{darkMode?"☀":"☾"}</button></MuiTooltip>
          <div className="nav-who"><span className="nav-emp">{me.name||me.email||"User"}</span><span className="avatar">{(me.name||me.email||"U").slice(0,1).toUpperCase()}</span></div>
        </div>
      </div>
    </div>
    <div className="wrap">
      <header className="portal-header flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="head-eyebrow">Employer Insights · Financial Wellbeing Programme</div><h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-[var(--brand-primary)] sm:text-4xl">Your workforce <span className="emp">{data.employer}</span></h1></div>
        <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm"><div className="hidden h-8 w-8 items-center justify-center rounded-sm bg-[var(--brand-accent-soft)] text-[var(--brand-accent)] sm:flex"><span className="text-[10px] font-bold uppercase tracking-widest">User</span></div><div><p className="text-sm font-semibold text-slate-900">{me.name||me.email}</p><p className="text-[11px] text-slate-500">{role}</p></div></div>
      </header>

      <section className="filters">
        <div className="flex flex-wrap gap-1 rounded-md bg-slate-100 p-1">
          {([["latest","Latest"],["quarter","Quarter"],["all","Programme"]] as const).map(([key,label])=><Button key={key} size="sm" variant={!period&&range===key?"default":"ghost"} onClick={()=>{setPeriod("");setRange(key)}}>{label}</Button>)}
        </div>
        <Select label="Month" value={period} onChange={e=>{setPeriod(e.target.value);if(e.target.value)setRange("latest")}}><option value="">Select month</option>{periodOptions.map(m=><option key={m} value={m}>{new Date(m+"-01T00:00:00Z").toLocaleDateString("en-ZA",{month:"long",year:"numeric",timeZone:"UTC"})}</option>)}</Select>
        {data.filterOptions?.sites?.length?<Select label="Site" value={site} onChange={e=>setSite(e.target.value)}><option value="all">All sites</option>{data.filterOptions.sites.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</Select>:null}
        <Select label="Income band" value={income} onChange={e=>setIncome(e.target.value)}><option value="all">All income bands</option>{incomeOptions.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</Select>
        {comparison?.current&&<div className="text-xs text-slate-500 lg:ml-auto">Comparing <span className="font-bold text-[var(--brand-accent)]">{comparison.current}</span>{comparison.previous&&<> with <span className="font-bold text-[var(--brand-accent)]">{comparison.previous}</span></>}</div>}
      </section>

      <div className="enterprise-toolbar" aria-label="Dashboard tools">
        <div id="executive-insight" className="min-w-0">
          <div className="enterprise-insight">
            <div className="enterprise-insight-eyebrow">Executive insight</div>
            <div className="enterprise-insight-copy">
              {(() => {
                const score=Number(data.wellness?.score), prior=Number(data.wellness?.prior);
                const delta=Number.isFinite(score)&&Number.isFinite(prior)?score-prior:null;
                const pc=data.comparison;
                const statements:string[]=[];
                if(Number.isFinite(score)) statements.push(`Financial wellbeing score is ${score}/100${delta===null?"":", "+(delta>0?"up ":delta<0?"down ":"unchanged ")+Math.abs(delta)+" points versus "+(comparison?.previous||"the comparison period")}.`);
                if(Number.isFinite(Number(pc?.current?.monthlySavingRand))) statements.push(`Monthly cash freed up is ${money(pc?.current?.monthlySavingRand)}.`);
                if(Number.isFinite(Number(pc?.current?.totalAdvancedRaw))) statements.push(`Total advanced through early wage access is ${money(pc?.current?.totalAdvancedRaw)} in this period.`);
                return statements.join(" ") || "More data is required to produce an executive insight for this view.";
              })()}
            </div>
          </div>
        </div>
      </div>
      <div className="exec-band reveal">
        <div className="exec-head">
          <div className="exec-pulse"></div>
          <div><div className="exec-title">Financial wellbeing impact summary</div><div className="exec-sub">{data.filterContext?.label||"Programme to date"} · at a glance</div></div>
          <div className={`exec-verdict ${data.wellness?.complete===false||data.wellness?.score==null?"is-incomplete":""}`}>
            {data.wellness?.complete===false||data.wellness?.score==null?"Data incomplete":Number(data.wellness.score)>=75?"Strong":Number(data.wellness.score)>=60?"On track":"Needs attention"}
          </div>
        </div>
        <div className="exec-grid">
          {(data.exec?.items?.length ? data.exec.items : [
            {l:"Employees enrolled",v:number(data.kpis?.takeUp?.enrolled)},
            {l:"Monthly cashflow restored",v:money(data.kpis?.monthlySaving?.rand)},
            {l:"Employees better off",v:number(data.outcomes?.reduce((n,o)=>n+(Number(o.count)||0),0))},
            {l:"Employee satisfaction",v:data.ratings?.avg==null?"Not available":`${data.ratings.avg.toFixed(1)}/5`},
            {l:"Financial wellbeing score",v:data.wellness?.score==null?"Not available":`${data.wellness.score}/100`},
            {l:"Data quality",v:data.dataQuality?.scoreReady?"Score ready":"Review required"}
          ]).slice(0,6).map((item,i)=><div className="exec-item" key={item.l+i}><span aria-hidden="true" className="exec-check">✓</span><div><div className="exec-v">{item.v}</div><div className="exec-l">{item.l}</div></div></div>)}
        </div>
      </div>

      <section className="card reveal wellness-card section-gap" style={{animationDelay:".04s"}}>
        <div className="card-hd"><div><div className="card-title">Workforce Financial Wellness Score</div><div className="card-note">The single number that tracks your people's financial health and its trajectory</div></div><span className="card-tag">Index · modelled</span></div>
        <div className="wellness-inner">
          <div className="wellness-left">
            <WellnessGauge score={data.wellness?.score}/>
            <div className="wellness-band">{data.wellness?.band||"Unavailable"}</div>
            <div className="wellness-delta">{data.wellness?.prior==null||data.wellness?.score==null?"No prior period":`${data.wellness.score-data.wellness.prior>0?"+":""}${(data.wellness.score-data.wellness.prior).toFixed(0)} pts vs ${comparison?.previous||"previous period"}`}</div>
            <div className="wellness-note">A composite of four weighted drivers. Use it to track workforce financial health over time.</div>
          </div>
          <div className="wellness-right">{(data.wellness?.drivers||[]).map(d=><div className="wd-row" key={d.name}><div className="wd-name">{d.name}<small>{Math.round(d.weight*100)}% weight</small></div><div className="wd-track"><div className="wd-fill" style={{width:`${Math.max(0,Math.min(100,d.score??0))}%`,background:d.score==null?"var(--brand-soft)":"var(--chart-low)"}}/></div><div className="wd-val">{d.score==null?"Not available":d.score.toFixed(0)}</div></div>)}</div>
        </div>
      </section>
      <section className="grid g-4 section-gap">
        {[
          ["Employees enrolled",number(data.kpis?.takeUp?.enrolled),`${pct(data.kpis?.takeUp?.pct)} take-up`],
          ["Employees activated",number(data.kpis?.activated?.count),`${pct(data.kpis?.activated?.pct)} of workforce`],
          ["Monthly cash freed up",money(data.kpis?.monthlySaving?.rand),savingDelta===0?"No prior comparison":`${savingDelta>=0?"+":""}${money(savingDelta)} vs prior`],
          ["Employee rating",data.kpis?.avgRating?.val==null?"Not available":`${data.kpis.avgRating.val.toFixed(1)}/5`,`${number(data.kpis?.avgRating?.responses)} responses`]
        ] .map(([label,value,sub], index)=><Card key={label as string} className="portal-kpi"><CardContent className="p-5"><div className="flex items-center justify-between"><span className="portal-kpi-label text-xs font-semibold text-slate-500">{label as string}</span><span className="portal-kpi-index">0{index + 1}</span></div><p className="portal-number portal-kpi-value mt-3 break-words text-2xl font-bold tracking-tight text-[var(--brand-ink-strong)] sm:text-3xl">{value as string}</p><p className="mt-1 text-[11px] text-slate-500">{sub as string}</p></CardContent></Card>)}
      </section>

      <section className="grid g-12 section-gap">
        <Card style={{gridColumn:"span 7"}}><CardHeader><SectionHeading title="From enrolled to better off" description="The journey every employee can take and where they are on it."/></CardHeader><CardContent><div className="funnel">{(data.funnel||[]).map(row=><div className="funnel-row" key={row.label}><div className="funnel-lbl">{row.label}<small>{row.sub}</small></div><div className="funnel-bar-bg"><div className="funnel-bar" style={{width:`${row.pct??0}%`,background:"var(--brand-accent)"}}>{row.pct!=null?`${row.pct}%`:""}</div></div><div className="funnel-val">{number(row.n)}</div></div>)}</div></CardContent></Card>
        <Card style={{gridColumn:"span 5"}}><CardHeader><SectionHeading title="Financial problems resolved" description="Completed fixes and the value created."/></CardHeader><CardContent><div>{(data.outcomes||[]).slice(0,6).map(row=><div className="outcome" key={row.key}><div className="outcome-ico">{row.name.slice(0,1)}</div><div><div className="outcome-name">{row.name}</div><div className="outcome-meta">{row.avgPerEmployee||row.statL}</div></div><div className="outcome-stat"><div className="v">{number(row.count)}</div><div className="l">{row.statL}</div></div></div>)}</div></CardContent></Card>
      </section>

      <section className="dash-section" data-section="valueDelivered">
        <div className="head" style={{padding:"36px 0 14px"}}>
          <div><div className="head-eyebrow">The bottom line</div><h1 style={{fontSize:27}}>Value delivered to your people</h1></div>
        </div>
        <div className="stat-strip">
          {(data.valueStrip||[]).map(row=><div className="stat-cell" key={row.l}><div className="l">{row.l}</div><div className="v">{row.v}</div><div className="d">{row.d}</div></div>)}
        </div>
        <div className="grid g-12 section-gap">
          <Card style={{gridColumn:"span 5"}}><CardHeader><SectionHeading title="Monthly cash freed up" description="Recurring savings unlocked, cumulative run-rate."/></CardHeader><CardContent><div className="portal-number mb-2 text-3xl font-bold text-[var(--brand-ink-strong)]">{money(currentSaving)}</div><LineChart values={trend} labels={trendLabels} previous={data.comparison?.previous?.savings??[]} previousLabels={data.comparison?.previous?.savingsLabels??[]} currentLabel={data.comparison?.current?.label||comparison?.current||"Selected period"} previousLabel={data.comparison?.previous?.label||comparison?.previous||"Previous period"}/></CardContent></Card>
          <Card style={{gridColumn:"span 7"}}><CardHeader><SectionHeading title="Debt Pressure Profile" description="Where your people's arrears sit by intervention state, then by creditor."/></CardHeader><CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              {[["Active intervention",data.debtStates?.active],["Prescription challenged",data.debtStates?.challenged],["Self-guided",data.debtStates?.guided]].map(([label,row])=><div className="stat-cell" key={label as string}><div className="l">{label as string}</div><div className="v">{money((row as any)?.rand)}</div><div className="d">{number((row as any)?.employees)} employees</div></div>)}
            </div>
            <div className="mt-4">{(data.creditors||[]).slice(0,6).map(row=><div className="outcome" key={row.name}><div className="outcome-ico">{row.name.slice(0,1)}</div><div><div className="outcome-name">{row.name}</div><div className="outcome-meta">{number(row.accounts)} accounts · {row.avg} average</div></div><div className="outcome-stat"><div className="v">{row.balance}</div><div className="l">Balance</div></div></div>)}</div>
          </CardContent></Card>
        </div>
      </section>

      <section className="dash-section" data-section="earlyWageAccess">
        <div className="head" style={{padding:"36px 0 14px"}}>
          <div><div className="head-eyebrow">On-demand pay</div><h1 style={{fontSize:27}}>Early Wage Access</h1><div className="head-sub">How many employees are drawing earned wages early, and how much.</div></div>
        </div>
        <div className="grid g-12 section-gap">
          <Card style={{gridColumn:"span 12"}}><CardHeader><SectionHeading title="Total advanced per month" description="Finalised advances only · monthly run-rate."/></CardHeader><CardContent><div className="portal-number mb-2 text-3xl font-bold text-[var(--brand-ink-strong)]">{money(data.comparison?.current?.totalAdvancedRaw??data.ewa?.totalRaw)}</div><LineChart values={advancedTrend} labels={advancedLabels} previous={data.comparison?.previous?.ewa??[]} previousLabels={data.comparison?.previous?.ewaLabels??[]} currentLabel={data.comparison?.current?.label||comparison?.current||"Selected period"} previousLabel={data.comparison?.previous?.label||comparison?.previous||"Previous period"}/></CardContent></Card>
        </div>
      </section>
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><SectionHeading title="Workforce funnel"/></CardHeader><CardContent><div className="grid gap-4">{(data.funnel||[]).map(row=><div className="grid grid-cols-[minmax(105px,1fr)_minmax(70px,2fr)_55px] items-center gap-3" key={row.label}><div><b className="text-xs">{row.label}</b><small className="mt-1 block text-[9px] text-slate-500">{row.sub}</small></div><Progress value={row.pct??0}/><strong className="text-right text-xs text-[var(--brand-ink-strong)]">{number(row.n)}</strong></div>)}</div></CardContent></Card>
        <Card><CardHeader><SectionHeading title="Activated employees by income band"/></CardHeader><CardContent><div className="grid gap-4">{(data.income||[]).map(row=><div className="grid grid-cols-[minmax(100px,1fr)_minmax(70px,2fr)_45px] items-center gap-3" key={row.name}><span className="text-xs">{row.name}</span><Progress value={row.count/maxIncome*100}/><strong className="text-right text-xs text-[var(--brand-ink-strong)]">{number(row.count)}</strong></div>)}</div></CardContent></Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><SectionHeading title="Financial problems resolved by creditor"/></CardHeader><CardContent><div className="divide-y divide-slate-100">{(data.creditors||[]).slice(0,8).map(row=><div className="grid grid-cols-[1fr_auto] gap-2 py-3" key={row.name}><div><b className="text-xs">{row.name}</b><small className="mt-1 block text-[10px] text-slate-500">{number(row.accounts)} accounts · {row.avg} average</small></div><strong className="break-words text-right text-sm text-[var(--brand-ink-strong)]">{row.balance}</strong><span className="col-span-2 text-[9px] text-slate-400">{(row.stateBreakdown||[]).map(s=>`${s.label}: ${number(s.count)}`).join(" · ")||"No state detail"}</span></div>)}</div>{data.creditorsTotal&&<div className="mt-3 flex justify-between gap-3 border-t border-slate-200 pt-3 text-xs"><span>Total in arrears journey</span><strong className="text-[var(--brand-ink-strong)]">{data.creditorsTotal.balance}</strong></div>}</CardContent></Card>
        <Card><CardHeader><SectionHeading title="Intervention states"/></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-3">{[["Active intervention",data.debtStates?.active],["Prescription challenged",data.debtStates?.challenged],["Self-guided",data.debtStates?.guided]].map(([label,row])=><div className="rounded-md border border-slate-200 bg-slate-50 p-4" key={label as string}><strong className="block break-words text-lg text-[var(--brand-ink-strong)]">{money((row as any)?.rand)}</strong><span className="mt-1 block text-[10px] font-bold">{label as string}</span><small className="mt-1 block text-[9px] text-slate-500">{number((row as any)?.employees)} employees</small></div>)}</div></CardContent></Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card><CardHeader><SectionHeading title="Employee referrals" description="Organic sharing generated by completed journeys."/></CardHeader><CardContent><div className="grid grid-cols-2 gap-3"><div className="rounded-md bg-slate-50 p-4"><span className="text-[10px] text-slate-500">Shares</span><strong className="mt-1 block text-2xl text-[var(--brand-ink-strong)]">{number(data.referral?.shares)}</strong></div><div className="rounded-md bg-slate-50 p-4"><span className="text-[10px] text-slate-500">Share rate</span><strong className="mt-1 block text-2xl text-[var(--brand-ink-strong)]">{pct(data.referral?.shareRate)}</strong></div></div><div className="mt-3 flex flex-wrap gap-2 text-xs"><Badge>Top channel: {data.referral?.channel && data.referral.channel !== "—" ? data.referral.channel : "Not available"}</Badge><Badge>Reach: {data.referral?.impliedReach ?? "Not available"}</Badge></div></CardContent></Card>
        <Card><CardHeader><SectionHeading title="Early Wage Access" description="Usage and advance activity in the selected reporting view."/></CardHeader><CardContent><div className="grid grid-cols-2 gap-3"><div className="rounded-md bg-slate-50 p-4"><span className="text-[10px] text-slate-500">Advances</span><strong className="mt-1 block text-2xl text-[var(--brand-ink-strong)]">{number(data.ewa?.advances)}</strong></div><div className="rounded-md bg-slate-50 p-4"><span className="text-[10px] text-slate-500">Employees</span><strong className="mt-1 block text-2xl text-[var(--brand-ink-strong)]">{number(data.ewa?.clients)}</strong></div></div><div className="mt-3 text-xs text-slate-600">Average advance <strong className="text-[var(--brand-ink-strong)]">{data.ewa?.avg ?? "Not available"}</strong> · {data.ewa?.perClient == null ? "Not available" : data.ewa.perClient.toFixed(1) + " advances per employee"}</div></CardContent></Card>
        <Card><CardHeader><SectionHeading title="Financial risk signals" description="Observed exposures requiring review."/></CardHeader><CardContent><div className="space-y-2">{(data.riskSignals||[]).slice(0,5).map(signal=><div key={signal.sig} className="flex items-start justify-between gap-3 rounded-md border border-slate-200 p-3"><div className="min-w-0"><b className="block break-words text-xs">{signal.sig}</b><span className="mt-1 block text-[10px] leading-4 text-slate-500">{signal.note}</span></div><div className="shrink-0 text-right"><strong className="text-sm text-[var(--brand-ink-strong)]">{number(signal.n)}</strong><Badge className="mt-1">{signal.sev}</Badge></div></div>)}{!data.riskSignals?.length && <p className="text-xs text-slate-500">No active signals in this view.</p>}</div></CardContent></Card>
      </section>
      <section className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <Card><CardHeader><SectionHeading title="Opportunities identified" description="Employees and value associated with the next wave of action."/></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2">{(data.opportunities?.cards||[]).map(card=><div key={card.name} className="rounded-md border border-slate-200 bg-slate-50 p-4"><div className="flex items-start justify-between gap-3"><b className="text-xs leading-5">{card.name}</b><Badge>{number(card.eligible)} eligible</Badge></div><p className="mt-2 text-[10px] leading-4 text-slate-500">{card.extra || card.saving}</p></div>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-[var(--brand-accent-soft)] p-4"><span className="text-[10px] font-semibold text-[var(--brand-accent)]">{data.opportunities?.valueLabel || "Estimated additional value"}</span><strong className="mt-1 block break-words text-xl text-slate-900">{data.opportunities?.estMonthly || "Not available"}</strong><span className="text-[10px] text-[var(--brand-accent)]">monthly observed value under review</span></div><div className="rounded-md bg-slate-50 p-4"><span className="text-[10px] font-semibold text-slate-600">Annualised</span><strong className="mt-1 block break-words text-xl text-[var(--brand-ink-strong)]">{data.opportunities?.estAnnual || "Not available"}</strong></div></div><p className="mt-3 text-[10px] leading-4 text-slate-500">{data.opportunities?.valueNote || "No opportunity estimate available."}</p></CardContent></Card>
        <Card><CardHeader><SectionHeading title="Governance status" description="Data availability and calculation readiness."/></CardHeader><CardContent><div className="rounded-md border border-slate-200 p-4"><strong className="text-lg text-emerald-700">{data.dataQuality?.scoreReady ? "Score ready" : "Review required"}</strong><p className="mt-2 text-xs text-slate-600">{number(data.dataQuality?.warnings?.length || 0)} data-quality warnings are currently surfaced for this view.</p><div className="mt-4 h-px bg-slate-200"></div><p className="mt-3 text-[10px] leading-4 text-slate-500">Calculations remain tied to the governed Node and Prisma data layer. Unavailable source data is not presented as a confirmed zero.</p></div></CardContent></Card>
      </section>
      <section className="mt-4 grid gap-4 pb-8 lg:grid-cols-2">
        <Card><CardHeader><SectionHeading title="Value delivered"/></CardHeader><CardContent><div className="grid gap-px overflow-hidden rounded-md border border-slate-200 sm:grid-cols-2">{(data.valueStrip||[]).map(row=><div className="min-w-0 bg-slate-50 p-4" key={row.l}><span className="block text-[10px] text-slate-500">{row.l}</span><strong className="mt-1 block break-words text-xl text-[var(--brand-ink-strong)]">{row.v}</strong><small className="mt-1 block text-[10px] text-slate-500">{row.d}</small></div>)}</div></CardContent></Card>
        <Card><CardHeader><SectionHeading title="Reporting integrity"/></CardHeader><CardContent><div className="grid gap-2"><strong className="text-2xl text-emerald-700">{data.dataQuality?.scoreReady?"Score ready":"Review required"}</strong><span className="text-xs text-slate-600">{data.dataQuality?.warnings?.length||0} data-quality warnings</span><small className="leading-5 text-slate-500">Source calculations remain governed by the existing Node/Prisma data layer.</small></div></CardContent></Card>
      </section>
    </div>
  </main>;
}

function AdminView({me}:{me:Me}) {
  const [tab,setTab]=useState<"overview"|"users"|"integrations"|"imports"|"audit"|"compliance"|"mlops">("overview");
  const [users,setUsers]=useState<any[]>([]);
  const [security,setSecurity]=useState<any>(null);
  const [ops,setOps]=useState<any>(null);
  const [compliance,setCompliance]=useState<any>(null);
  const [integration,setIntegration]=useState<any>(null);
  const [batches,setBatches]=useState<any[]>([]);
  const [audit,setAudit]=useState<any[]>([]);
  const [mlops,setMlops]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState("");
  const isSuper=me.role==="SUPERADMIN";

  const load=async()=>{
    try{
      setLoading(true);
      const [s,o,c,i,b,a,m,u]=await Promise.all([
        api<any>("/api/admin/security/overview"),
        api<any>("/api/admin/enterprise/overview"),
        api<any>("/api/admin/compliance/overview"),
        api<any>("/api/admin/integration"),
        api<any[]>("/api/admin/batches"),
        api<any[]>("/api/admin/audit-log?limit=50"),
        api<any[]>("/api/admin/mlops/events?limit=50"),
        api<any[]>("/api/users")
      ]);
      setSecurity(s);setOps(o);setCompliance(c);setIntegration(i);
      setBatches(Array.isArray(b)?b:[]);setAudit(Array.isArray(a)?a:[]);
      setMlops(Array.isArray(m)?m:[]);setUsers(Array.isArray(u)?u:[]);
      setError("");
    }catch(e:any){ if(e?.name!=="AbortError") setError(e.message||"Could not load administration data"); }
    finally{setLoading(false);}
  };
  const refreshBusy=useRef(false);
  useEffect(()=>{
    let active=true;
    const refresh=async()=>{
      if(!active || refreshBusy.current) return;
      refreshBusy.current=true;
      try{ await load(); } finally { refreshBusy.current=false; }
    };
    refresh();
    const id=window.setInterval(refresh,30000);
    return()=>{active=false;window.clearInterval(id);};
  },[]);

  const action=async(label:string,fn:()=>Promise<any>)=>{
    try{setBusy(label);await fn();await load();}catch(e:any){setError(e.message||"Action failed");}finally{setBusy("")}
  };
  const sync=()=>action("sync",async()=>{
    const r=await api<any>("/api/admin/integration/sync",{});
    if(r?.jobId){
      for(let i=0;i<30;i++){await new Promise(res=>setTimeout(res,1000));const j=await api<any>("/api/admin/sync-jobs/"+r.jobId);if(j.status==="DONE"||j.status==="FAILED"){if(j.status==="FAILED")throw new Error(j.error||"Sync failed");break;}}
    }
  });
  const critical=audit.filter((x:any)=>["user.delete","user.revoke","partner.delete","security.alert.resolve","user.update"].includes(x.action)).slice(0,5);
  const unresolved=mlops.filter((e:any)=>e.eventType==="DATA_QUALITY_GATE"&&e.status&&e.status!=="PASS").slice(0,8);
  const roleOptions=isSuper?["ADMIN","SUPERADMIN","EMPLOYER_MANAGER","PORTFOLIO_MANAGER","VIEWER"]:["EMPLOYER_MANAGER","PORTFOLIO_MANAGER","VIEWER"];

  const nav=[
    ["overview","Overview"],["users","Users & roles"],["integrations","Live integrations"],
    ["imports","Data governance"],["audit","Audit history"],["compliance","POPIA"],["mlops","MLOps"]
  ] as const;

  const adminThemeStyle: CSSProperties = { "--brand-ink": normaliseHex(me.theme?.primaryColor, "#17212b"), "--brand-ink-strong": normaliseHex(me.theme?.navyColor, "#0d141b"), "--brand-accent": normaliseHex(me.theme?.accentColor, "#5f756d") } as CSSProperties;
  return <main className="min-h-screen bg-[var(--brand-paper)]" style={adminThemeStyle}>
    <div className="mx-auto w-full max-w-[1480px] px-3 py-4 sm:px-5 lg:px-8">
      <header className="portal-header flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div><div className="portal-kicker">EFS Optimise</div><h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-[var(--brand-ink-strong)] sm:text-4xl">Administration</h1><p className="mt-1 text-sm text-slate-500">Governed control plane for identity, integrations, data and compliance.</p></div>
        <div className="flex items-center gap-3"><Badge>{roleLabels[me.role||""]||me.role||"User"}</Badge><Button variant="outline" onClick={()=>window.location.assign("/react/dashboard")}>Dashboard</Button></div>
      </header>
      <nav className="admin-nav mt-5 -mx-1 overflow-x-auto border-b border-[var(--brand-line)] pb-0" aria-label="Administration sections"><div className="flex min-w-max gap-0 bg-transparent">{nav.map(([key,label],index)=><Button key={key} size="sm" variant="ghost" className={tab===key?"admin-tab admin-tab-active":"admin-tab"} onClick={()=>setTab(key)}><span className="admin-tab-index">0{index+1}</span>{label}</Button>)}</div></nav>
      {error&&<div className="admin-alert mt-4 flex gap-3 border-l-4 border-red-500 bg-red-50 p-4 text-sm text-red-800"><span className="text-xs font-bold uppercase tracking-widest text-red-700">Error</span><span>{error}</span></div>}
      {loading?<div className="admin-loading mt-5 border-y border-[var(--brand-line)] bg-white py-14 text-center text-sm text-slate-500">Loading governed administration data...</div>:<>
        {tab==="overview"&&<section className="portal-section mt-5 grid gap-px border-y border-[var(--brand-line)] bg-[var(--brand-line)] sm:grid-cols-2 xl:grid-cols-4">
          {[["Active sessions",number(security?.activeSessions)],["Failed logins, 24h",number(security?.failedLogins24h)],["Open security alerts",number(security?.openAlerts)],["Open imports",number(ops?.imports?.open)]].map(([label,value])=><Card key={label as string} className="rounded-none border-0 bg-[var(--brand-surface)] shadow-none"><CardContent className="p-5"><div className="flex justify-between"><span className="text-xs font-semibold text-slate-500">{label as string}</span></div><strong className="mt-3 block break-words text-2xl font-bold text-[var(--brand-ink-strong)]">{value as string}</strong></CardContent></Card>)}
        </section>}
        {tab==="overview"&&<section className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><SectionHeading title="Security & identity" description="Live authentication and access posture."/></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-3"><div><b className="text-xl text-[var(--brand-ink-strong)]">{number(security?.successfulLogins24h)}</b><p className="text-[10px] text-slate-500">Successful logins</p></div><div><b className="text-xl text-[var(--brand-ink-strong)]">{number(security?.failedLogins24h)}</b><p className="text-[10px] text-slate-500">Failed logins</p></div><div><b className="text-xl text-[var(--brand-ink-strong)]">{number(security?.openAlerts)}</b><p className="text-[10px] text-slate-500">Open alerts</p></div></div><Button className="mt-4" onClick={()=>setTab("users")}>Open identity controls</Button></CardContent></Card>
          <Card><CardHeader><SectionHeading title="Live enterprise integration" description="Connection and analytics routing remain visible to authorised admins."/></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2">{[["Source",integration?.sourceType||ops?.integration?.sourceMode],["Enabled",integration?.enabled==null?"Not available":integration.enabled?"Yes":"No"],["Schedule",integration?.scheduleHours==null?"Not available":number(integration.scheduleHours)+" hours"],["Freshness",ops?.integration?.freshnessState]].map(([l,v])=><div className="border-l-2 border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] p-4" key={l as string}><span className="text-[10px] text-slate-500">{l as string}</span><strong className="mt-1 block break-words text-sm">{v==null?"Not available":String(v)}</strong></div>)}</div><Button className="mt-4" onClick={()=>setTab("integrations")}>Manage integration</Button></CardContent></Card>
          <Card><CardHeader><SectionHeading title="Data-quality gate" description="Quarantine and review states are surfaced before live data use."/></CardHeader><CardContent>{unresolved.length?<div className="space-y-2">{unresolved.slice(0,5).map((e:any)=><div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3" key={e.id}><span className="min-w-0 break-words text-xs font-semibold">{e.metadata?.reportKey||"Dataset"}</span><Badge>{e.status}</Badge></div>)}</div>:<div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">No unresolved data-quality gates.</div>}<Button className="mt-4" variant="outline" onClick={()=>setTab("imports")}>Review data</Button></CardContent></Card>
          <Card><CardHeader><SectionHeading title="Critical operational audit" description="Highest-priority operational changes, with full history retained separately."/></CardHeader><CardContent>{critical.length?<div className="space-y-2">{critical.map((e:any,i)=><div className="grid gap-1 rounded-md border border-slate-200 p-3" key={e.id||i}><div className="flex justify-between gap-3"><b className="text-xs">{e.action||"Event"}</b><span className="text-[10px] text-slate-500">{e.createdAt?new Date(e.createdAt).toLocaleString("en-ZA"):""}</span></div><p className="break-words text-[11px] text-slate-600">{e.message||e.detail||"Operational event recorded."}</p></div>)}</div>:<p className="text-sm text-slate-500">No critical operational events in the returned history.</p>}<Button className="mt-4" variant="outline" onClick={()=>setTab("audit")}>Open full audit</Button></CardContent></Card>
        </section>}

        {tab==="users"&&<section className="mt-5 grid gap-4">
          <Card><CardHeader><SectionHeading title="Users & roles" description="Role is authority. Employer and portfolio assignments define access scope."/></CardHeader><CardContent>
            <div className="overflow-x-auto rounded-md border border-slate-200"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Scope</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{users.map((u:any)=><tr key={u.id}><td className="p-3"><b>{u.name||"Unnamed"}</b><span className="mt-1 block text-slate-500">{u.email}</span></td><td className="p-3"><Badge>{roleLabels[u.role]||u.role||"Unknown"}</Badge></td><td className="p-3">{u.active===false?<span className="text-red-700">Inactive</span>:<span className="text-emerald-700">Active</span>}</td><td className="p-3 break-words">{number(Array.isArray(u.employers)?u.employers.length:u.employerIds?.length)} employer assignments</td><td className="p-3"><Select aria-label={"Change role for "+(u.name||u.email)} value={u.role||""} onChange={e=>{const next=e.target.value;if(!roleOptions.includes(next))return;action("role",()=>api("/api/users/"+u.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:next,reason:"Role updated from React administration"})}))}}><option value={u.role}>{roleLabels[u.role]||u.role}</option>{roleOptions.filter(r=>r!==u.role).map(r=><option key={r} value={r}>{roleLabels[r]}</option>)}</Select></td></tr>)}</tbody></table></div>
            <p className="mt-3 text-[10px] text-slate-500">{isSuper?"Super Admin control-plane roles are visible here.":"Privileged Super Admin accounts are intentionally not discoverable to ordinary Admins."}</p>
          </CardContent></Card>
        </section>}

        {tab==="integrations"&&<section className="admin-section mt-5 grid gap-px border-y border-[var(--brand-line)] bg-[var(--brand-line)] lg:grid-cols-2">
          <Card><CardHeader><SectionHeading title="Live data integration" description="Connection state, schedule and governed sync controls."/></CardHeader><CardContent><div className="grid gap-3">{[["Source type",integration?.sourceType],["Enabled",integration?.enabled==null?"Not available":integration.enabled?"Enabled":"Disabled"],["Schedule",integration?.scheduleHours==null?"Not available":number(integration.scheduleHours)+" hours"],["Last successful sync",integration?.lastSuccessAt?new Date(integration.lastSuccessAt).toLocaleString("en-ZA"):"Not available"],["Analytics mode",ops?.integration?.analyticsMode]].map(([l,v])=><div className="flex flex-col gap-1 rounded-md border border-slate-200 p-4 sm:flex-row sm:justify-between"><span className="text-xs text-slate-500">{l as string}</span><b className="break-words text-sm text-slate-900">{v==null?"Not available":String(v)}</b></div>)}</div><div className="mt-4 flex flex-wrap gap-2"><Button disabled={busy==="sync"} onClick={sync}>{busy==="sync"?"Syncing...":"Sync now"}</Button><Button variant="outline" onClick={()=>action("test",()=>api("/api/admin/integration/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})}))}>Test connection</Button><Button variant="outline" onClick={()=>action("refresh",()=>api("/api/admin/integration/refresh",{method:"POST"}))}>Refresh health</Button></div></CardContent></Card>
          <Card><CardHeader><SectionHeading title="Integration logs" description="Recent sync activity and outcomes."/></CardHeader><CardContent><IntegrationLogs/></CardContent></Card>
        </section>}

        {tab==="imports"&&<section className="mt-5 grid gap-4">
          <Card><CardHeader><SectionHeading title="Imports & data governance" description="Validated files remain staged until an authorised commit. Data-quality gates fail closed."/></CardHeader><CardContent><div className="overflow-x-auto rounded-md border border-slate-200"><table className="w-full min-w-[920px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="p-3">Report</th><th className="p-3">File</th><th className="p-3">Status</th><th className="p-3">Rows</th><th className="p-3">Errors</th><th className="p-3">Uploaded</th><th className="p-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{batches.slice(0,50).map((b:any)=><tr key={b.id}><td className="p-3 font-semibold">{b.reportKey}</td><td className="p-3 max-w-[240px] break-words">{b.filename}</td><td className="p-3"><Badge>{b.status}</Badge></td><td className="p-3">{number(b.rowCount)}</td><td className="p-3">{number(b.errorCount)}</td><td className="p-3 whitespace-nowrap">{b.uploadedAt?new Date(b.uploadedAt).toLocaleString("en-ZA"):"Not available"}</td><td className="p-3"><div className="flex flex-wrap gap-1">{b.status==="STAGED"&&<Button size="sm" onClick={()=>action("commit",()=>api("/api/admin/batches/"+b.id+"/commit",{method:"POST"}))}>Commit</Button>}{b.revertable&&<Button size="sm" variant="outline" onClick={()=>action("revert",()=>api("/api/admin/batches/"+b.id+"/revert",{method:"POST"}))}>Revert</Button>}<Button size="sm" variant="ghost" onClick={()=>window.location.assign("/api/admin/batches/"+b.id+"/csv")}>CSV</Button></div></td></tr>)}</tbody></table></div></CardContent></Card>
        </section>}

        {tab==="audit"&&<section className="mt-5 grid gap-4">
          <Card><CardHeader><SectionHeading title="Audit history" description="The top operational events are prioritised in Overview. Full history remains available here."/></CardHeader><CardContent><div className="overflow-x-auto rounded-md border border-slate-200"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="p-3">Time</th><th className="p-3">Action</th><th className="p-3">Actor</th><th className="p-3">Target</th><th className="p-3">Detail</th></tr></thead><tbody className="divide-y divide-slate-100">{audit.map((e:any,i)=><tr key={e.id||i}><td className="p-3 whitespace-nowrap">{e.createdAt?new Date(e.createdAt).toLocaleString("en-ZA"):"Not available"}</td><td className="p-3 font-semibold">{e.action||"Event"}</td><td className="p-3">{e.actorEmail||e.user?.email||"System"}</td><td className="p-3 break-words">{e.targetType||""} {e.targetId||""}</td><td className="max-w-[360px] break-words p-3 text-slate-600">{e.message||e.detail?typeof(e.message||e.detail)==="string"?(e.message||e.detail):JSON.stringify(e.message||e.detail):"Recorded event"}</td></tr>)}</tbody></table></div><Button className="mt-4" variant="outline" onClick={()=>window.location.assign("/api/admin/audit-log.csv")}>Export full CSV</Button></CardContent></Card>
        </section>}

        {tab==="compliance"&&<section className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><SectionHeading title="POPIA governance" description="Live compliance-control overview."/></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2">{[["Processing activities",compliance?.processingActivities],["Cross-border activities",compliance?.crossBorderActivities],["Open data-subject requests",compliance?.openDataSubjectRequests],["Open incidents",compliance?.openSecurityIncidents]].map(([l,v])=><div className="rounded-md bg-slate-50 p-4" key={l as string}><span className="text-[10px] text-slate-500">{l as string}</span><strong className="mt-1 block text-xl text-[var(--brand-ink-strong)]">{number(v as number|undefined)}</strong></div>)}</div><p className="mt-4 text-xs text-slate-600">{compliance?.status==="ACTION_REQUIRED"?"Governance action is required. Review the underlying registers.":"Governance controls are currently being monitored."}</p></CardContent></Card>
          <Card><CardHeader><SectionHeading title="Compliance registers" description="The existing governed workflows remain authoritative."/></CardHeader><CardContent><div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" onClick={()=>window.location.assign("/admin#compliance")}>Processing activities</Button><Button variant="outline" onClick={()=>window.location.assign("/admin#compliance")}>Data-subject requests</Button><Button variant="outline" onClick={()=>window.location.assign("/admin#compliance")}>Vendors</Button><Button variant="outline" onClick={()=>window.location.assign("/admin#compliance")}>Retention</Button><Button variant="outline" onClick={()=>window.location.assign("/admin#compliance")}>Incidents</Button><Button variant="outline" onClick={()=>window.location.assign("/admin#security")}>Security controls</Button></div></CardContent></Card>
        </section>}

        {tab==="mlops"&&<section className="mt-5 grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><SectionHeading title="Governed MLOps events" description="Data-quality, anomaly, feedback and model-governance events."/></CardHeader><CardContent><div className="space-y-2">{mlops.slice(0,20).map((e:any,i)=><div className="rounded-md border border-slate-200 p-3" key={e.id||i}><div className="flex flex-wrap items-center justify-between gap-2"><b className="text-xs">{e.eventType||"Event"}</b><Badge>{e.status||"Recorded"}</Badge></div><p className="mt-1 break-words text-[10px] text-slate-500">{e.metadata?.reportKey||e.modelKey||"Governed event"}{e.createdAt?" · "+new Date(e.createdAt).toLocaleString("en-ZA"):""}</p></div>)}</div></CardContent></Card>
          <Card><CardHeader><SectionHeading title="Model governance" description="Promotion and rollback stay behind admin controls."/></CardHeader><CardContent><p className="text-sm leading-6 text-slate-600">Approved data can update governed baselines and models. Quarantined or unresolved data-quality events remain outside the learning path until reviewed.</p><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={()=>window.location.assign("/admin#mlops")}>Open MLOps control centre</Button><Button variant="outline" onClick={()=>window.location.assign("/admin#brand-learning")}>Brand learning</Button></div></CardContent></Card>
        </section>}
      </>}
    </div>
  </main>;
}

function IntegrationLogs(){
  const [logs,setLogs]=useState<any[]>([]);
  useEffect(()=>{api<any[]>("/api/admin/integration/logs").then(v=>setLogs(Array.isArray(v)?v:[])).catch(()=>setLogs([]));},[]);
  return <div className="space-y-2">{logs.length?logs.map((l:any,i)=><div className="rounded-md border border-slate-200 p-3" key={l.id||i}><div className="flex justify-between gap-2"><b className="text-xs">{l.status||"Sync"}</b><span className="text-[10px] text-slate-500">{l.createdAt?new Date(l.createdAt).toLocaleString("en-ZA"):""}</span></div><p className="mt-1 break-words text-[10px] text-slate-500">{l.message||l.mode||"Integration event"}</p></div>):<p className="text-xs text-slate-500">No recent integration logs returned.</p>}</div>;
}

function App() {
  const [me,setMe]=useState<Me|null>(null); const [loading,setLoading]=useState(true);
  useEffect(()=>{api<Me>("/api/auth/me").then(setMe).catch(()=>setMe(null)).finally(()=>setLoading(false));},[]);
  if(loading)return <div className="min-h-screen bg-[var(--brand-paper)] px-4 py-20"><Card className="mx-auto max-w-2xl"><CardContent className="py-12 text-center text-sm text-slate-500">Loading your workspace...</CardContent></Card></div>;
  if(!me)return <div className="min-h-screen bg-[var(--brand-paper)] px-4 py-20"><Card className="mx-auto max-w-lg"><CardHeader><div className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--brand-accent)]">EFS Optimise</div><CardTitle className="mt-2 text-2xl">Sign in to continue</CardTitle><CardDescription>Your existing secure Fastify session remains the authentication authority.</CardDescription></CardHeader><CardContent><Button onClick={()=>window.location.assign("/login")}>Sign in</Button></CardContent></Card></div>;
  const isAdminRoute=window.location.pathname==="/react/admin" || window.location.pathname==="/react/admin/";
  return isAdminRoute && (me.role==="ADMIN" || me.role==="SUPERADMIN") ? <AdminView me={me}/> : <DashboardView me={me}/>;
}
class AppErrorBoundary extends Component<PropsWithChildren, {hasError:boolean}> {
  state={hasError:false};
  static getDerivedStateFromError(){ return {hasError:true}; }
  render(){
    if(this.state.hasError) return <main className="min-h-screen bg-[var(--brand-paper)] px-4 py-20"><Card className="mx-auto max-w-lg"><CardHeader><div className="portal-kicker">EFS Optimise</div><CardTitle className="mt-2 text-2xl">Something went wrong</CardTitle><CardDescription>The dashboard could not render this view. Reload the page to restore the session.</CardDescription></CardHeader><CardContent><Button onClick={()=>window.location.reload()}>Reload dashboard</Button></CardContent></Card></main>;
    return this.props.children;
  }
}

export default function AppRoot(){ return <AppErrorBoundary><App /></AppErrorBoundary>; }
