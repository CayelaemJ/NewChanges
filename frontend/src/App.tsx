import { useEffect, useMemo, useState } from "react";

type Me = {
  name?: string; email?: string; role?: string;
  employers?: Array<{ id: string; name: string }>;
  sections?: Record<string, boolean>;
};

type Dashboard = {
  employer?: string; headcount?: number;
  dataAsOf?: string;
  filterContext?: {
    label?: string; period?: string; range?: string; incomeLabel?: string;
    comparison?: { mode?: string; label?: string; current?: string; previous?: string | null };
  };
  portfolio?: Record<string, number | null>;
  wellness?: { score?: number | null; prior?: number | null; band?: string; complete?: boolean; drivers?: Array<{name:string;score:number|null;weight:number}> };
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
  comparison?: {current?:{label:string;savings:number[];savingsLabels:string[];monthlySavingRand:number;totalAdvancedRaw:number};previous?:{label:string;savings:number[];savingsLabels:string[];monthlySavingRand:number;totalAdvancedRaw:number}};
  ewa?: {totalRaw?:number; total?:string; trend?:number[]; trendLabels?:string[]};
  savings?: number[];
  savingsLabels?: string[];
  dataQuality?: {scoreReady:boolean;warnings?:string[]};
};

const roleLabels: Record<string,string> = {
  SUPERADMIN:"Super Admin", ADMIN:"Admin", EMPLOYER_MANAGER:"Employer Manager",
  PORTFOLIO_MANAGER:"Portfolio Manager", VIEWER:"Viewer"
};
const money = (n:number|null|undefined) => n == null ? "—" : new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR",maximumFractionDigits:0}).format(n);
const number = (n:number|null|undefined) => n == null ? "—" : new Intl.NumberFormat("en-ZA").format(n);
const pct = (n:number|null|undefined) => n == null ? "—" : `${n.toFixed(1)}%`;
const api = async <T,>(url:string):Promise<T> => {
  const r=await fetch(url,{credentials:"same-origin",cache:"no-store"});
  if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error || "Request failed");
  return r.json();
};

function LineChart({values, labels, prefix="R "}:
  {values:number[];labels:string[];prefix?:string}) {
  if(!values.length) return <div className="empty">No trend data available for this period.</div>;
  const max=Math.max(...values,1), min=Math.min(...values,0), span=Math.max(max-min,1);
  const points=values.map((v,i)=>`${values.length===1?50:i/(values.length-1)*100},${92-(v-min)/span*76}`).join(" ");
  return <div className="chart">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Trend chart" role="img">
      <line x1="0" y1="92" x2="100" y2="92" className="axis"/>
      <polyline points={points} className="line"/>
    </svg>
    <div className="chart-labels">{labels.map((l,i)=><span key={i}>{l}</span>)}</div>
    <div className="chart-values">{values.map((v,i)=><span key={i}>{prefix}{number(v)}</span>)}</div>
  </div>;
}

function DashboardView({me}:{me:Me}) {
  const [data,setData]=useState<Dashboard|null>(null);
  const [period,setPeriod]=useState("");
  const [range,setRange]=useState<"latest"|"quarter"|"all">("latest");
  const [income,setIncome]=useState("all");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const employer=me.employers?.[0];

  const query=useMemo(()=>{
    const p=new URLSearchParams();
    if(period) p.set("period",period); else p.set("range",range);
    if(income!=="all") p.set("income",income);
    return p.toString();
  },[period,range,income]);

  useEffect(()=>{
    if(!employer) return;
    setLoading(true); setError("");
    api<Dashboard>(`/api/dashboard/first?${query}`).then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[query,employer?.id]);

  const months=useMemo(()=>{
    const now=new Date();
    const out:string[]=[];
    for(let i=0;i<18;i++){ const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1)); out.push(d.toISOString().slice(0,7)); }
    return out;
  },[]);

  if(!employer) return <section className="panel"><h2>No employer data available</h2><p>Your role is authenticated, but there is currently no employer assigned to this account.</p></section>;
  if(loading) return <section className="panel loading">Loading governed dashboard data…</section>;
  if(error) return <section className="panel error"><strong>Dashboard unavailable</strong><p>{error}</p></section>;
  if(!data) return null;

  const comparison=data.filterContext?.comparison;
  const currentSaving=data.comparison?.current?.monthlySavingRand ?? data.kpis?.monthlySaving?.rand ?? 0;
  const previousSaving=data.comparison?.previous?.monthlySavingRand ?? 0;
  const savingDelta=currentSaving-previousSaving;
  const trend=data.comparison?.current?.savings ?? data.kpis?.monthlySaving?.trend ?? data.savings ?? [];
  const trendLabels=data.comparison?.current?.savingsLabels ?? data.savingsLabels ?? [];
  const role=roleLabels[me.role??""]??me.role??"User";

  return <main>
    <header className="topbar">
      <div><div className="eyebrow">EFS Optimise</div><h1>Financial wellbeing dashboard</h1></div>
      <div className="identity"><strong>{me.name||me.email}</strong><span>{role}</span></div>
    </header>

    <section className="dashboard-head">
      <div><div className="eyebrow">Employer workspace</div><h2>{data.employer}</h2><p>Financial wellbeing measured from governed source data, with period-aware comparisons.</p></div>
      <div className="asat">Data as at {data.filterContext?.label || data.dataAsOf?.slice(0,10) || "latest"}</div>
    </section>

    <section className="filters">
      <div className="seg"><button className={!period&&range==="latest"?"on":""} onClick={()=>{setPeriod("");setRange("latest")}}>Latest</button><button className={!period&&range==="quarter"?"on":""} onClick={()=>{setPeriod("");setRange("quarter")}}>Quarter</button><button className={!period&&range==="all"?"on":""} onClick={()=>{setPeriod("");setRange("all")}}>Programme</button></div>
      <label className="select"><span>Month</span><select value={period} onChange={e=>{setPeriod(e.target.value);if(e.target.value)setRange("latest")}}><option value="">Select month</option>{months.map(m=><option key={m} value={m}>{new Date(m+"-01T00:00:00Z").toLocaleDateString("en-ZA",{month:"long",year:"numeric",timeZone:"UTC"})}</option>)}</select></label>
      <label className="select"><span>Income band</span><select value={income} onChange={e=>setIncome(e.target.value)}><option value="all">All income bands</option>{data.filterContext?.incomeLabel&&<option value={income}>{data.filterContext.incomeLabel}</option>}{data.filterContext?.incomeLabel==null&&["UNDER_5K","BAND_5_10K","BAND_10_20K","BAND_20_40K","OVER_40K"].map(v=><option key={v} value={v}>{v.replaceAll("_"," ").replace("BAND ","R ")}</option>)}</select></label>
      {comparison?.current&&<span className="comparison">Comparing <strong>{comparison.current}</strong>{comparison.previous&&<> with <strong>{comparison.previous}</strong></>}</span>}
    </section>

    <section className="grid four">
      <article className="kpi"><span>Employees enrolled</span><strong>{number(data.kpis?.takeUp?.enrolled)}</strong><small>{pct(data.kpis?.takeUp?.pct)} take-up</small></article>
      <article className="kpi"><span>Employees activated</span><strong>{number(data.kpis?.activated?.count)}</strong><small>{pct(data.kpis?.activated?.pct)} of workforce</small></article>
      <article className="kpi"><span>Monthly cash freed up</span><strong>{money(data.kpis?.monthlySaving?.rand)}</strong><small>{savingDelta===0?"No prior comparison":`${savingDelta>=0?"+":""}${money(savingDelta)} vs prior`}</small></article>
      <article className="kpi"><span>Employee rating</span><strong>{data.kpis?.avgRating?.val==null?"—":`${data.kpis.avgRating.val.toFixed(1)}/5`}</strong><small>{number(data.kpis?.avgRating?.responses)} responses</small></article>
    </section>

    <section className="grid two">
      <article className="card score">
        <div className="card-title">Optimise Score</div>
        <div className="score-row"><strong>{data.wellness?.score==null?"—":data.wellness.score.toFixed(1)}</strong><span>{data.wellness?.band||"Unavailable"}</span></div>
        <div className="drivers">{(data.wellness?.drivers||[]).map(d=><div className="driver" key={d.name}><div><span>{d.name}</span><b>{d.score==null?"—":d.score.toFixed(1)}</b></div><progress max="100" value={d.score??0}/></div>)}</div>
      </article>
      <article className="card">
        <div className="card-title">Monthly cash freed up</div>
        <p className="note">Line trend respects the selected reporting period and its comparison window.</p>
        <LineChart values={trend} labels={trendLabels}/>
      </article>
    </section>

    <section className="grid two">
      <article className="card">
        <div className="card-title">Workforce funnel</div>
        <div className="funnel">{(data.funnel||[]).map(row=><div className="funnel-row" key={row.label}><div><b>{row.label}</b><small>{row.sub}</small></div><div className="track"><i style={{width:`${Math.max(0,Math.min(100,row.pct??0))}%`}}/></div><strong>{number(row.n)}</strong></div>)}</div>
      </article>
      <article className="card">
        <div className="card-title">Activated employees by income band</div>
        <div className="income">{(data.income||[]).map(row=><div className="income-row" key={row.name}><span>{row.name}</span><div className="track"><i style={{width:`${Math.min(100,(row.count/Math.max(1,...(data.income||[]).map(x=>x.count)))*100)}%`}}/></div><strong>{number(row.count)}</strong></div>)}</div>
      </article>
    </section>

    <section className="grid two">
      <article className="card">
        <div className="card-title">Value delivered</div>
        <div className="value-grid">{(data.valueStrip||[]).map(row=><div key={row.l}><span>{row.l}</span><strong>{row.v}</strong><small>{row.d}</small></div>)}</div>
      </article>
      <article className="card">
        <div className="card-title">Reporting integrity</div>
        <div className="quality"><strong>{data.dataQuality?.scoreReady?"Score ready":"Review required"}</strong><span>{data.dataQuality?.warnings?.length||0} data-quality warnings</span><small>Source calculations remain governed by the existing Node/Prisma data layer.</small></div>
      </article>
    </section>
  </main>;
}

function App() {
  const [me,setMe]=useState<Me|null>(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{ api<Me>("/api/auth/me").then(setMe).catch(()=>setMe(null)).finally(()=>setLoading(false)); },[]);
  if(loading) return <main className="shell"><section className="panel loading">Loading your workspace…</section></main>;
  if(!me) return <main className="shell"><section className="panel"><div className="eyebrow">EFS Optimise</div><h2>Sign in to continue</h2><p>Your existing secure Fastify session is still the authentication authority.</p><a className="button" href="/login">Sign in</a></section></main>;
  return <main className="shell"><DashboardView me={me}/></main>;
}
export default App;
