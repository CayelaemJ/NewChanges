import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Progress } from "./components/ui/progress";
import { Select } from "./components/ui/select";
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
const api = async <T,>(url:string, init?:RequestInit):Promise<T> => {
  const r=await fetch(url,{credentials:"same-origin",cache:"no-store",...init});
  if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error || "Request failed");
  return r.json();
};

function LineChart({values,labels,prefix="R "}:{values:number[];labels:string[];prefix?:string}) {
  if(!values.length) return <div className="flex h-44 items-center justify-center text-xs text-slate-500">No trend data available for this period.</div>;
  const max=Math.max(...values,1),min=Math.min(...values,0),span=Math.max(max-min,1);
  const points=values.map((v,i)=>`${values.length===1?50:i/(values.length-1)*100},${92-(v-min)/span*76}`).join(" ");
  return <div className="mt-3 min-w-0">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Trend chart" role="img" className="h-44 w-full rounded-md bg-slate-50">
      <line x1="0" y1="92" x2="100" y2="92" className="stroke-slate-200" strokeWidth=".7"/>
      <polyline points={points} fill="none" className="stroke-[var(--brand-accent)]" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
    </svg>
    <div className="mt-2 flex justify-between gap-2 overflow-hidden text-[9px] text-slate-400">{labels.map((l,i)=><span className="whitespace-nowrap" key={i}>{l}</span>)}</div>
    <div className="mt-1 flex justify-between gap-2 overflow-hidden text-[9px] font-bold text-[var(--brand-ink-strong)]">{values.map((v,i)=><span className="whitespace-nowrap" key={i}>{prefix}{number(v)}</span>)}</div>
  </div>;
}

function SectionHeading({title,description}:{title:string;description?:string}) {
  return <div className="mb-4 border-b border-slate-200 pb-3"><CardTitle>{title}</CardTitle>{description&&<CardDescription className="mt-1">{description}</CardDescription>}</div>;
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

  return <main className="min-h-screen bg-[var(--brand-paper)]">
    <div className="mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-5 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--brand-accent)]">EFS Optimise</div><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Financial wellbeing dashboard</h1></div>
        <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm"><div className="hidden h-8 w-8 items-center justify-center rounded-sm bg-[var(--brand-accent-soft)] text-[var(--brand-accent)] sm:flex"><span className="text-[10px] font-bold uppercase tracking-widest">User</span></div><div><p className="text-sm font-semibold text-slate-900">{me.name||me.email}</p><p className="text-[11px] text-slate-500">{role}</p></div></div>
      </header>

      <section className="mt-5 overflow-hidden rounded-none bg-slate-950 p-5 text-white shadow-xl shadow-black/10 sm:p-7 lg:flex lg:items-end lg:justify-between lg:gap-8">
        <div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-[.15em] text-white/70">Employer workspace</div><h2 className="mt-1 break-words text-3xl font-bold tracking-tight sm:text-5xl">{data.employer}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-white/80">Financial wellbeing measured from governed source data, with period-aware comparisons.</p></div>
        <div className="mt-5 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end lg:mt-0 lg:justify-end">
          {me.employers&&me.employers.length>1&&<Select label="Employer" className="min-w-0 sm:min-w-[210px]" value={employer.id} onChange={e=>setSelectedEmployerId(e.target.value)}>{me.employers.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</Select>}
          <div className="rounded-sm border border-white/20 bg-white/10 px-3 py-2 text-[10px] font-bold whitespace-nowrap">Data as at {data.filterContext?.label||data.dataAsOf?.slice(0,10)||"latest"}</div>
        </div>
      </section>

      <section className="mt-4 flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-end">
        <div className="flex flex-wrap gap-1 rounded-md bg-slate-100 p-1">
          {([["latest","Latest"],["quarter","Quarter"],["all","Programme"]] as const).map(([key,label])=><Button key={key} size="sm" variant={!period&&range===key?"default":"ghost"} onClick={()=>{setPeriod("");setRange(key)}}>{label}</Button>)}
        </div>
        <Select label="Month" value={period} onChange={e=>{setPeriod(e.target.value);if(e.target.value)setRange("latest")}}><option value="">Select month</option>{periodOptions.map(m=><option key={m} value={m}>{new Date(m+"-01T00:00:00Z").toLocaleDateString("en-ZA",{month:"long",year:"numeric",timeZone:"UTC"})}</option>)}</Select>
        {data.filterOptions?.sites?.length?<Select label="Site" value={site} onChange={e=>setSite(e.target.value)}><option value="all">All sites</option>{data.filterOptions.sites.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</Select>:null}
        <Select label="Income band" value={income} onChange={e=>setIncome(e.target.value)}><option value="all">All income bands</option>{incomeOptions.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</Select>
        {comparison?.current&&<div className="text-xs text-slate-500 lg:ml-auto">Comparing <span className="font-bold text-[var(--brand-accent)]">{comparison.current}</span>{comparison.previous&&<> with <span className="font-bold text-[var(--brand-accent)]">{comparison.previous}</span></>}</div>}
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Employees enrolled",number(data.kpis?.takeUp?.enrolled),`${pct(data.kpis?.takeUp?.pct)} take-up`],
          ["Employees activated",number(data.kpis?.activated?.count),`${pct(data.kpis?.activated?.pct)} of workforce`],
          ["Monthly cash freed up",money(data.kpis?.monthlySaving?.rand),savingDelta===0?"No prior comparison":`${savingDelta>=0?"+":""}${money(savingDelta)} vs prior`],
          ["Employee rating",data.kpis?.avgRating?.val==null?"Not available":`${data.kpis.avgRating.val.toFixed(1)}/5`,`${number(data.kpis?.avgRating?.responses)} responses`]
        ].map(([label,value,sub])=><Card key={label as string}><CardContent className="p-5"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">{label as string}</span></div><p className="mt-3 break-words text-2xl font-bold tracking-tight text-[var(--brand-ink-strong)] sm:text-3xl">{value as string}</p><p className="mt-1 text-[11px] text-slate-500">{sub as string}</p></CardContent></Card>)}
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><SectionHeading title="Employee voice" description="Average rating and response coverage from employee feedback."/></CardHeader><CardContent><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-3"><strong className="text-4xl font-bold tracking-tight text-[var(--brand-ink-strong)]">{data.ratings?.avg==null?"Not available":data.ratings.avg.toFixed(1)}</strong><div className="flex gap-0.5" aria-label={data.ratings?.avg==null?"Rating unavailable":data.ratings.avg.toFixed(1)+" out of 5 stars"}>{Array.from({length:5},(_,i)=><span aria-hidden="true" className="text-[var(--brand-accent)]">★</span>)}</div></div><p className="mt-1 text-xs text-slate-500">{number(data.ratings?.responses)} employee responses</p></div><div className="min-w-0 sm:w-52"><div className="mb-1 flex justify-between text-[10px] font-semibold text-slate-500"><span>Five-star responses</span><span>{pct(data.ratings?.fiveStarPct)}</span></div><Progress value={data.ratings?.fiveStarPct??0}/></div></div></CardContent></Card>
        <Card><CardHeader><SectionHeading title="Optimise Score" description="Current governed wellbeing score and weighted drivers."/></CardHeader><CardContent><div className="flex items-baseline gap-3"><strong className="text-5xl font-bold tracking-tight text-[var(--brand-ink-strong)]">{data.wellness?.score==null?"Not available":data.wellness.score.toFixed(1)}</strong><Badge>{data.wellness?.band||"Unavailable"}</Badge></div><div className="mt-5 grid gap-4">{(data.wellness?.drivers||[]).map(d=><div key={d.name}><div className="mb-1 flex justify-between text-xs font-semibold"><span>{d.name}</span><b className="text-[var(--brand-accent)]">{d.score==null?"Not available":d.score.toFixed(1)}</b></div><Progress value={d.score??0}/></div>)}</div></CardContent></Card>
        <Card><CardHeader><SectionHeading title="Monthly cash freed up" description="Line trend respects the selected reporting period and comparison window."/></CardHeader><CardContent><LineChart values={trend} labels={trendLabels}/></CardContent></Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><SectionHeading title="Total advanced" description="Early wage access advanced in the selected period."/></CardHeader><CardContent><div className="mb-2 flex flex-wrap items-baseline gap-2"><strong className="break-words text-3xl font-bold tracking-tight text-[var(--brand-ink-strong)]">{money(data.comparison?.current?.totalAdvancedRaw??data.ewa?.totalRaw)}</strong><span className="text-[10px] text-slate-500">Current period total</span></div><LineChart values={advancedTrend} labels={advancedLabels}/></CardContent></Card>
        <Card><CardHeader><SectionHeading title="Financial problems resolved" description="Completed fixes from governed journey data."/></CardHeader><CardContent><div className="divide-y divide-slate-100">{(data.outcomes||[]).map(row=><div className="grid grid-cols-[1fr_auto] gap-2 py-3" key={row.key}><div><b className="text-xs">{row.name}</b><small className="mt-1 block text-[10px] text-slate-500">{row.avgPerEmployee}</small></div><strong className="text-sm text-[var(--brand-ink-strong)]">{number(row.count)}</strong><span className="col-span-2 text-[9px] text-slate-400">{row.statL}</span></div>)}</div></CardContent></Card>
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
    }catch(e:any){setError(e.message||"Could not load administration data");}
    finally{setLoading(false);}
  };
  useEffect(()=>{load();const id=window.setInterval(load,30000);return()=>window.clearInterval(id)},[]);

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

  return <main className="min-h-screen bg-[var(--brand-paper)]">
    <div className="mx-auto w-full max-w-[1480px] px-3 py-4 sm:px-5 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div><div className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--brand-accent)]">EFS Optimise</div><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Administration</h1><p className="mt-1 text-sm text-slate-500">Governed control plane for identity, integrations, data and compliance.</p></div>
        <div className="flex items-center gap-3"><Badge>{roleLabels[me.role||""]||me.role||"User"}</Badge><Button variant="outline" onClick={()=>window.location.assign("/react/dashboard")}>Dashboard</Button></div>
      </header>
      <nav className="mt-4 -mx-1 overflow-x-auto pb-1" aria-label="Administration sections"><div className="flex min-w-max gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-sm">{nav.map(([key,label])=><Button key={key} size="sm" variant={tab===key?"default":"ghost"} onClick={()=>setTab(key)}>{label}</Button>)}</div></nav>
      {error&&<div className="mt-4 flex gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span className="text-xs font-bold uppercase tracking-widest text-red-700">Error</span><span>{error}</span></div>}
      {loading?<Card className="mt-5"><CardContent className="py-14 text-center text-sm text-slate-500">Loading governed administration data...</CardContent></Card>:<>
        {tab==="overview"&&<section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[["Active sessions",number(security?.activeSessions)],["Failed logins, 24h",number(security?.failedLogins24h)],["Open security alerts",number(security?.openAlerts)],["Open imports",number(ops?.imports?.open)]].map(([label,value])=><Card key={label as string}><CardContent className="p-5"><div className="flex justify-between"><span className="text-xs font-semibold text-slate-500">{label as string}</span></div><strong className="mt-3 block break-words text-2xl font-bold text-[var(--brand-ink-strong)]">{value as string}</strong></CardContent></Card>)}
        </section>}
        {tab==="overview"&&<section className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><SectionHeading title="Security & identity" description="Live authentication and access posture."/></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-3"><div><b className="text-xl text-[var(--brand-ink-strong)]">{number(security?.successfulLogins24h)}</b><p className="text-[10px] text-slate-500">Successful logins</p></div><div><b className="text-xl text-[var(--brand-ink-strong)]">{number(security?.failedLogins24h)}</b><p className="text-[10px] text-slate-500">Failed logins</p></div><div><b className="text-xl text-[var(--brand-ink-strong)]">{number(security?.openAlerts)}</b><p className="text-[10px] text-slate-500">Open alerts</p></div></div><Button className="mt-4" onClick={()=>setTab("users")}>Open identity controls</Button></CardContent></Card>
          <Card><CardHeader><SectionHeading title="Live enterprise integration" description="Connection and analytics routing remain visible to authorised admins."/></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2">{[["Source",integration?.sourceType||ops?.integration?.sourceMode],["Enabled",integration?.enabled==null?"Not available":integration.enabled?"Yes":"No"],["Schedule",integration?.scheduleHours==null?"Not available":number(integration.scheduleHours)+" hours"],["Freshness",ops?.integration?.freshnessState]].map(([l,v])=><div className="rounded-md bg-slate-50 p-4" key={l as string}><span className="text-[10px] text-slate-500">{l as string}</span><strong className="mt-1 block break-words text-sm">{v==null?"Not available":String(v)}</strong></div>)}</div><Button className="mt-4" onClick={()=>setTab("integrations")}>Manage integration</Button></CardContent></Card>
          <Card><CardHeader><SectionHeading title="Data-quality gate" description="Quarantine and review states are surfaced before live data use."/></CardHeader><CardContent>{unresolved.length?<div className="space-y-2">{unresolved.slice(0,5).map((e:any)=><div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 p-3" key={e.id}><span className="min-w-0 break-words text-xs font-semibold">{e.metadata?.reportKey||"Dataset"}</span><Badge>{e.status}</Badge></div>)}</div>:<div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">No unresolved data-quality gates.</div>}<Button className="mt-4" variant="outline" onClick={()=>setTab("imports")}>Review data</Button></CardContent></Card>
          <Card><CardHeader><SectionHeading title="Critical operational audit" description="Highest-priority operational changes, with full history retained separately."/></CardHeader><CardContent>{critical.length?<div className="space-y-2">{critical.map((e:any,i)=><div className="grid gap-1 rounded-md border border-slate-200 p-3" key={e.id||i}><div className="flex justify-between gap-3"><b className="text-xs">{e.action||"Event"}</b><span className="text-[10px] text-slate-500">{e.createdAt?new Date(e.createdAt).toLocaleString("en-ZA"):""}</span></div><p className="break-words text-[11px] text-slate-600">{e.message||e.detail||"Operational event recorded."}</p></div>)}</div>:<p className="text-sm text-slate-500">No critical operational events in the returned history.</p>}<Button className="mt-4" variant="outline" onClick={()=>setTab("audit")}>Open full audit</Button></CardContent></Card>
        </section>}

        {tab==="users"&&<section className="mt-5 grid gap-4">
          <Card><CardHeader><SectionHeading title="Users & roles" description="Role is authority. Employer and portfolio assignments define access scope."/></CardHeader><CardContent>
            <div className="overflow-x-auto rounded-md border border-slate-200"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Scope</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{users.map((u:any)=><tr key={u.id}><td className="p-3"><b>{u.name||"Unnamed"}</b><span className="mt-1 block text-slate-500">{u.email}</span></td><td className="p-3"><Badge>{roleLabels[u.role]||u.role||"Unknown"}</Badge></td><td className="p-3">{u.active===false?<span className="text-red-700">Inactive</span>:<span className="text-emerald-700">Active</span>}</td><td className="p-3 break-words">{number(Array.isArray(u.employers)?u.employers.length:u.employerIds?.length)} employer assignments</td><td className="p-3"><Select aria-label={"Change role for "+(u.name||u.email)} value={u.role||""} onChange={e=>{const next=e.target.value;if(!roleOptions.includes(next))return;action("role",()=>api("/api/users/"+u.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:next,reason:"Role updated from React administration"})}))}}><option value={u.role}>{roleLabels[u.role]||u.role}</option>{roleOptions.filter(r=>r!==u.role).map(r=><option key={r} value={r}>{roleLabels[r]}</option>)}</Select></td></tr>)}</tbody></table></div>
            <p className="mt-3 text-[10px] text-slate-500">{isSuper?"Super Admin control-plane roles are visible here.":"Privileged Super Admin accounts are intentionally not discoverable to ordinary Admins."}</p>
          </CardContent></Card>
        </section>}

        {tab==="integrations"&&<section className="mt-5 grid gap-4 lg:grid-cols-2">
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
  if(loading)return <div className="min-h-screen bg-slate-50 px-4 py-20"><Card className="mx-auto max-w-2xl"><CardContent className="py-12 text-center text-sm text-slate-500">Loading your workspace...</CardContent></Card></div>;
  if(!me)return <div className="min-h-screen bg-slate-50 px-4 py-20"><Card className="mx-auto max-w-lg"><CardHeader><div className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--brand-accent)]">EFS Optimise</div><CardTitle className="mt-2 text-2xl">Sign in to continue</CardTitle><CardDescription>Your existing secure Fastify session remains the authentication authority.</CardDescription></CardHeader><CardContent><Button onClick={()=>window.location.assign("/login")}>Sign in</Button></CardContent></Card></div>;
  const isAdminRoute=window.location.pathname==="/react/admin" || window.location.pathname==="/react/admin/";
  return isAdminRoute && (me.role==="ADMIN" || me.role==="SUPERADMIN") ? <AdminView me={me}/> : <DashboardView me={me}/>;
}
export default App;
