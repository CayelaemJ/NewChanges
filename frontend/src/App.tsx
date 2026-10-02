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
  comparison?: {current?:{label:string;savings:number[];savingsLabels:string[];monthlySavingRand?:number;totalAdvancedRaw?:number;ewa?:number[];ewaLabels?:string[]};previous?:{label:string;savings:number[];savingsLabels:string[];monthlySavingRand:number;totalAdvancedRaw:number;ewa?:number[];ewaLabels?:string[]}};
  filterOptions?: { sites?:Array<{value:string;label:string}>; incomes?:Array<{value:string;label:string}> };
  outcomes?: Array<{key:string;name:string;count:number;stat:string;statL:string;avgPerEmployee:string;trend?:number[];delta?:number|null}>;
  creditors?: Array<{name:string;accounts:number;balance:string;avg:string;stateBreakdown?:Array<{label:string;count:number;pct:number}>}>;
  creditorsTotal?: {accounts:number;balance:string};
  debtStates?: {active?:{rand:number;employees:number};challenged?:{rand:number;employees:number};guided?:{rand:number;employees:number}};
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

function LineChart({values,labels,prefix="R "}:{values:number[];labels:string[];prefix?:string}) {
  if(!values.length) return <div className="flex h-44 items-center justify-center text-xs text-slate-500">No trend data available for this period.</div>;
  const max=Math.max(...values,1),min=Math.min(...values,0),span=Math.max(max-min,1);
  const points=values.map((v,i)=>`${values.length===1?50:i/(values.length-1)*100},${92-(v-min)/span*76}`).join(" ");
  return <div className="mt-3 min-w-0">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Trend chart" role="img" className="h-44 w-full rounded-xl bg-gradient-to-b from-violet-50/60 to-white">
      <line x1="0" y1="92" x2="100" y2="92" className="stroke-slate-200" strokeWidth=".7"/>
      <polyline points={points} fill="none" className="stroke-violet-700" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
    </svg>
    <div className="mt-2 flex justify-between gap-2 overflow-hidden text-[9px] text-slate-400">{labels.map((l,i)=><span className="whitespace-nowrap" key={i}>{l}</span>)}</div>
    <div className="mt-1 flex justify-between gap-2 overflow-hidden text-[9px] font-bold text-violet-800">{values.map((v,i)=><span className="whitespace-nowrap" key={i}>{prefix}{number(v)}</span>)}</div>
  </div>;
}

function SectionHeading({icon:Icon,title,description}:{icon:typeof Activity;title:string;description?:string}) {
  return <div className="mb-4 flex items-start gap-3"><div className="rounded-lg bg-violet-50 p-2 text-violet-700"><Icon className="h-4 w-4"/></div><div><CardTitle>{title}</CardTitle>{description&&<CardDescription className="mt-1">{description}</CardDescription>}</div></div>;
}

function DashboardView({me}:{me:Me}) {
  const [data,setData]=useState<Dashboard|null>(null);
  const [period,setPeriod]=useState(""); const [range,setRange]=useState<"latest"|"quarter"|"all">("latest");
  const [income,setIncome]=useState("all"); const [site,setSite]=useState("all"); const [periodOptions,setPeriodOptions]=useState<string[]>([]);
  const [selectedEmployerId,setSelectedEmployerId]=useState(me.employers?.[0]?.id??""); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  const employer=me.employers?.find(e=>e.id===selectedEmployerId)??me.employers?.[0];

  const query=useMemo(()=>{const p=new URLSearchParams();if(period)p.set("period",period);else p.set("range",range);if(income!=="all")p.set("income",income);if(site!=="all")p.set("site",site);return p.toString()},[period,range,income,site]);

  useEffect(()=>{if(!employer)return;setLoading(true);setError("");const url=`/api/employers/${encodeURIComponent(employer.id)}/dashboard?${query}`;api<Dashboard>(url).then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[query,employer?.id]);
  useEffect(()=>{if(!employer?.id)return;api<string[]>(`/api/employers/${encodeURIComponent(employer.id)}/periods`).then(rows=>setPeriodOptions(Array.isArray(rows)?rows:[])).catch(()=>setPeriodOptions([]));},[employer?.id]);

  if(!employer)return <Card className="mx-auto mt-20 max-w-2xl"><CardHeader><CardTitle>No employer data available</CardTitle><CardDescription>Your authenticated role has no employer assignment.</CardDescription></CardHeader></Card>;
  if(loading)return <Card className="mx-auto mt-20 max-w-2xl"><CardContent className="py-12 text-center text-sm text-slate-500">Loading governed dashboard data…</CardContent></Card>;
  if(error)return <Card className="mx-auto mt-20 max-w-2xl border-red-200"><CardContent className="py-10"><div className="flex gap-3"><CircleAlert className="h-5 w-5 text-red-600"/><div><p className="font-semibold text-red-700">Dashboard unavailable</p><p className="mt-1 text-sm text-slate-600">{error}</p></div></div></CardContent></Card>;
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

  return <main className="min-h-screen bg-slate-50/70">
    <div className="mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-5 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="text-[10px] font-extrabold uppercase tracking-[.16em] text-violet-700">EFS Optimise</div><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Financial wellbeing dashboard</h1></div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"><div className="hidden h-8 w-8 items-center justify-center rounded-full bg-violet-50 text-violet-700 sm:flex"><Users className="h-4 w-4"/></div><div><p className="text-sm font-semibold text-slate-900">{me.name||me.email}</p><p className="text-[11px] text-slate-500">{role}</p></div></div>
      </header>

      <section className="mt-5 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-950 via-violet-800 to-cyan-700 p-5 text-white shadow-xl shadow-violet-950/10 sm:p-7 lg:flex lg:items-end lg:justify-between lg:gap-8">
        <div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-[.15em] text-white/70">Employer workspace</div><h2 className="mt-1 break-words text-3xl font-bold tracking-tight sm:text-5xl">{data.employer}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/80">Financial wellbeing measured from governed source data, with period-aware comparisons.</p></div>
        <div className="mt-5 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end lg:mt-0 lg:justify-end">
          {me.employers&&me.employers.length>1&&<Select label="Employer" className="min-w-0 sm:min-w-[210px]" value={employer.id} onChange={e=>setSelectedEmployerId(e.target.value)}>{me.employers.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select>}
          <div className="rounded-full border border-white/20 bg-white/10 px-3 py-2 text-[10px] font-bold whitespace-nowrap">Data as at {data.filterContext?.label||data.dataAsOf?.slice(0,10)||"latest"}</div>
        </div>
      </section>

      <section className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-end">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {([["latest","Latest"],["quarter","Quarter"],["all","Programme"]] as const).map(([key,label])=><Button key={key} size="sm" variant={!period&&range===key?"default":"ghost"} onClick={()=>{setPeriod("");setRange(key)}}>{label}</Button>)}
        </div>
        <Select label="Month" value={period} onChange={e=>{setPeriod(e.target.value);if(e.target.value)setRange("latest")}}><option value="">Select month</option>{periodOptions.map(m=><option key={m} value={m}>{new Date(m+"-01T00:00:00Z").toLocaleDateString("en-ZA",{month:"long",year:"numeric",timeZone:"UTC"})}</option>)}</Select>
        {data.filterOptions?.sites?.length?<Select label="Site" value={site} onChange={e=>setSite(e.target.value)}><option value="all">All sites</option>{data.filterOptions.sites.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</Select>:null}
        <Select label="Income band" value={income} onChange={e=>setIncome(e.target.value)}><option value="all">All income bands</option>{incomeOptions.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</Select>
        {comparison?.current&&<div className="text-xs text-slate-500 lg:ml-auto">Comparing <span className="font-bold text-violet-700">{comparison.current}</span>{comparison.previous&&<> with <span className="font-bold text-violet-700">{comparison.previous}</span></>}</div>}
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Employees enrolled",number(data.kpis?.takeUp?.enrolled),`${pct(data.kpis?.takeUp?.pct)} take-up`,Users],
          ["Employees activated",number(data.kpis?.activated?.count),`${pct(data.kpis?.activated?.pct)} of workforce`,CheckCircle2],
          ["Monthly cash freed up",money(data.kpis?.monthlySaving?.rand),savingDelta===0?"No prior comparison":`${savingDelta>=0?"+":""}${money(savingDelta)} vs prior`,WalletCards],
          ["Employee rating",data.kpis?.avgRating?.val==null?"—":`${data.kpis.avgRating.val.toFixed(1)}/5`,`${number(data.kpis?.avgRating?.responses)} responses`,Star]
        ].map(([label,value,sub,Icon])=><Card key={label as string}><CardContent className="p-5"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{label as string}</span><Icon className="h-4 w-4 text-violet-600"/></div><p className="mt-3 break-words text-2xl font-bold tracking-tight text-violet-800 sm:text-3xl">{value as string}</p><p className="mt-1 text-[11px] text-slate-500">{sub as string}</p></CardContent></Card>)}
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><SectionHeading icon={Activity} title="Optimise Score" description="Current governed wellbeing score and weighted drivers."/></CardHeader><CardContent><div className="flex items-baseline gap-3"><strong className="text-5xl font-bold tracking-tight text-violet-800">{data.wellness?.score==null?"—":data.wellness.score.toFixed(1)}</strong><Badge>{data.wellness?.band||"Unavailable"}</Badge></div><div className="mt-5 grid gap-4">{(data.wellness?.drivers||[]).map(d=><div key={d.name}><div className="mb-1 flex justify-between text-xs font-semibold"><span>{d.name}</span><b className="text-violet-700">{d.score==null?"—":d.score.toFixed(1)}</b></div><Progress value={d.score??0}/></div>)}</div></CardContent></Card>
        <Card><CardHeader><SectionHeading icon={WalletCards} title="Monthly cash freed up" description="Line trend respects the selected reporting period and comparison window."/></CardHeader><CardContent><LineChart values={trend} labels={trendLabels}/></CardContent></Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><SectionHeading icon={CreditCard} title="Total advanced" description="Early wage access advanced in the selected period."/></CardHeader><CardContent><div className="mb-2 flex flex-wrap items-baseline gap-2"><strong className="break-words text-3xl font-bold tracking-tight text-violet-800">{money(data.comparison?.current?.totalAdvancedRaw??data.ewa?.totalRaw)}</strong><span className="text-[10px] text-slate-500">Current period total</span></div><LineChart values={advancedTrend} labels={advancedLabels}/></CardContent></Card>
        <Card><CardHeader><SectionHeading icon={CheckCircle2} title="Financial problems resolved" description="Completed fixes from governed journey data."/></CardHeader><CardContent><div className="divide-y divide-slate-100">{(data.outcomes||[]).map(row=><div className="grid grid-cols-[1fr_auto] gap-2 py-3" key={row.key}><div><b className="text-xs">{row.name}</b><small className="mt-1 block text-[10px] text-slate-500">{row.avgPerEmployee}</small></div><strong className="text-sm text-violet-800">{number(row.count)}</strong><span className="col-span-2 text-[9px] text-slate-400">{row.statL}</span></div>)}</div></CardContent></Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><SectionHeading icon={Users} title="Workforce funnel"/></CardHeader><CardContent><div className="grid gap-4">{(data.funnel||[]).map(row=><div className="grid grid-cols-[minmax(105px,1fr)_minmax(70px,2fr)_55px] items-center gap-3" key={row.label}><div><b className="text-xs">{row.label}</b><small className="mt-1 block text-[9px] text-slate-500">{row.sub}</small></div><Progress value={row.pct??0}/><strong className="text-right text-xs text-violet-800">{number(row.n)}</strong></div>)}</div></CardContent></Card>
        <Card><CardHeader><SectionHeading icon={Users} title="Activated employees by income band"/></CardHeader><CardContent><div className="grid gap-4">{(data.income||[]).map(row=><div className="grid grid-cols-[minmax(100px,1fr)_minmax(70px,2fr)_45px] items-center gap-3" key={row.name}><span className="text-xs">{row.name}</span><Progress value={row.count/maxIncome*100}/><strong className="text-right text-xs text-violet-800">{number(row.count)}</strong></div>)}</div></CardContent></Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><SectionHeading icon={Landmark} title="Financial problems resolved by creditor"/></CardHeader><CardContent><div className="divide-y divide-slate-100">{(data.creditors||[]).slice(0,8).map(row=><div className="grid grid-cols-[1fr_auto] gap-2 py-3" key={row.name}><div><b className="text-xs">{row.name}</b><small className="mt-1 block text-[10px] text-slate-500">{number(row.accounts)} accounts · {row.avg} average</small></div><strong className="break-words text-right text-sm text-violet-800">{row.balance}</strong><span className="col-span-2 text-[9px] text-slate-400">{(row.stateBreakdown||[]).map(s=>`${s.label}: ${number(s.count)}`).join(" · ")||"No state detail"}</span></div>)}</div>{data.creditorsTotal&&<div className="mt-3 flex justify-between gap-3 border-t border-slate-200 pt-3 text-xs"><span>Total in arrears journey</span><strong className="text-violet-800">{data.creditorsTotal.balance}</strong></div>}</CardContent></Card>
        <Card><CardHeader><SectionHeading icon={ShieldCheck} title="Intervention states"/></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-3">{[["Active intervention",data.debtStates?.active],["Prescription challenged",data.debtStates?.challenged],["Self-guided",data.debtStates?.guided]].map(([label,row])=><div className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={label as string}><strong className="block break-words text-lg text-violet-800">{money((row as any)?.rand)}</strong><span className="mt-1 block text-[10px] font-bold">{label as string}</span><small className="mt-1 block text-[9px] text-slate-500">{number((row as any)?.employees)} employees</small></div>)}</div></CardContent></Card>
      </section>

      <section className="mt-4 grid gap-4 pb-8 lg:grid-cols-2">
        <Card><CardHeader><SectionHeading icon={ArrowUpRight} title="Value delivered"/></CardHeader><CardContent><div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 sm:grid-cols-2">{(data.valueStrip||[]).map(row=><div className="min-w-0 bg-slate-50 p-4" key={row.l}><span className="block text-[10px] text-slate-500">{row.l}</span><strong className="mt-1 block break-words text-xl text-violet-800">{row.v}</strong><small className="mt-1 block text-[10px] text-slate-500">{row.d}</small></div>)}</div></CardContent></Card>
        <Card><CardHeader><SectionHeading icon={ShieldCheck} title="Reporting integrity"/></CardHeader><CardContent><div className="grid gap-2"><strong className="text-2xl text-emerald-700">{data.dataQuality?.scoreReady?"Score ready":"Review required"}</strong><span className="text-xs text-slate-600">{data.dataQuality?.warnings?.length||0} data-quality warnings</span><small className="leading-5 text-slate-500">Source calculations remain governed by the existing Node/Prisma data layer.</small></div></CardContent></Card>
      </section>
    </div>
  </main>;
}

function App() {
  const [me,setMe]=useState<Me|null>(null); const [loading,setLoading]=useState(true);
  useEffect(()=>{api<Me>("/api/auth/me").then(setMe).catch(()=>setMe(null)).finally(()=>setLoading(false));},[]);
  if(loading)return <div className="min-h-screen bg-slate-50 px-4 py-20"><Card className="mx-auto max-w-2xl"><CardContent className="py-12 text-center text-sm text-slate-500">Loading your workspace…</CardContent></Card></div>;
  if(!me)return <div className="min-h-screen bg-slate-50 px-4 py-20"><Card className="mx-auto max-w-lg"><CardHeader><div className="text-[10px] font-extrabold uppercase tracking-[.16em] text-violet-700">EFS Optimise</div><CardTitle className="mt-2 text-2xl">Sign in to continue</CardTitle><CardDescription>Your existing secure Fastify session remains the authentication authority.</CardDescription></CardHeader><CardContent><Button onClick={()=>window.location.assign("/login")}>Sign in</Button></CardContent></Card></div>;
  return <DashboardView me={me}/>;
}
export default App;
