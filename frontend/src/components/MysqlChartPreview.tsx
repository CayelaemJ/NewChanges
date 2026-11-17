import {useCallback, useEffect, useRef, useState} from "react";

type Bucket={bucket:string|number|boolean|null;value:number};
type NativeChart={
  source:"MYSQL_AGGREGATED_READ_ONLY";feed:string;dimension:string;
  buckets:Bucket[];
};
type Capabilities={chartPreviewEnabled:boolean;cdcAutoRefreshConnected:boolean};
type Invalidation={type:"MYSQL_CHART_INVALIDATION";feed:string;generation:number};

/**
 * Independent MySQL-native reporting preview.
 * Does not replace the existing Postgres-backed dashboard or advertise CDC
 * freshness before a durable producer is connected. Feature discovery is
 * authenticated and default-off; no requests to RDS when disabled.
 */
export function MysqlChartPreview({employerId}:{employerId:string}){
  const [capabilities,setCapabilities]=useState<Capabilities|null>(null);
  const [chart,setChart]=useState<NativeChart|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const generation=useRef(0);
  const pending=useRef(false);
  const queued=useRef(false);
  const refreshRef=useRef<((signal?:AbortSignal)=>Promise<void>)|null>(null);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    if(!employerId)return;
    if(pending.current){queued.current=true;return;}
    pending.current=true;
    setBusy(true);
    try{
      const url="/api/reporting/mysql/charts/"+encodeURIComponent(employerId)+
        "?feed=journeys&dimension=status";
      const response=await fetch(url,{credentials:"same-origin",cache:"no-store",signal});
      if(!response.ok)throw Error("MySQL chart temporarily unavailable");
      const payload=await response.json() as NativeChart;
      if(payload.source!=="MYSQL_AGGREGATED_READ_ONLY" ||
         payload.feed!=="journeys" || payload.dimension!=="status" ||
         !Array.isArray(payload.buckets) ||
         payload.buckets.length>20 ||
         payload.buckets.some(b=>!Number.isSafeInteger(b.value)||b.value<0))
        throw Error("Unexpected MySQL chart result");
      if(!signal?.aborted){setChart(payload);setError("");}
    }catch{
      if(!signal?.aborted)setError("Reporting preview unavailable. Last good result retained.");
    }finally{
      pending.current=false;
      if(!signal?.aborted)setBusy(false);
    }
  },[employerId]);

  refreshRef.current=refresh;

  useEffect(()=>{
    let cancelled=false;
    const controller=new AbortController();
    setCapabilities(null);
    setChart(null);
    generation.current=0;
    fetch("/api/reporting/mysql/capabilities",{
      credentials:"same-origin",cache:"no-store",signal:controller.signal,
    }).then(async r=>{
      if(!r.ok)throw Error("capabilities unavailable");
      return await r.json() as Capabilities;
    }).then(v=>{
      if(!cancelled){
        setCapabilities(v);
        if(v.chartPreviewEnabled)void refresh(controller.signal);
      }
    }).catch(()=>{if(!cancelled)setCapabilities({chartPreviewEnabled:false,cdcAutoRefreshConnected:false});});
    return ()=>{cancelled=true;controller.abort();};
  },[employerId,refresh]);

  useEffect(()=>{
    if(!capabilities?.chartPreviewEnabled||!employerId)return;
    const controller=new AbortController();
    const source=new EventSource(
      "/api/reporting/mysql/events/"+encodeURIComponent(employerId),
      {withCredentials:true},
    );
    let timer:ReturnType<typeof setTimeout>|undefined;
    const onInvalidation=(event:Event)=>{
      if(!(event instanceof MessageEvent))return;
      try {
        const message=JSON.parse(event.data) as Invalidation;
        if(message.type!=="MYSQL_CHART_INVALIDATION" ||
           message.feed!=="journeys" || !Number.isSafeInteger(message.generation) ||
           message.generation<=generation.current)return;
        generation.current=message.generation;
        if(timer)clearTimeout(timer);
        timer=setTimeout(()=>{
          if(document.visibilityState==="visible")void refresh(controller.signal);
        },250);
      }catch{/* Invalid SSE notifications are never trusted. */}
    };
    // EventSource reconnects automatically. The API reauthorizes each reconnect.
    // Re-read on tab focus to recover from missed process-local notifications.
    const onVisible=()=>{if(document.visibilityState==="visible")void refresh(controller.signal);};
    source.addEventListener("chart-invalidated",onInvalidation);
    document.addEventListener("visibilitychange",onVisible);
    return ()=>{
      controller.abort();
      if(timer)clearTimeout(timer);
      document.removeEventListener("visibilitychange",onVisible);
      source.removeEventListener("chart-invalidated",onInvalidation);
      source.close();
    };
  },[capabilities?.chartPreviewEnabled,employerId,refresh]);

  if(!capabilities?.chartPreviewEnabled)return null;
  const max=Math.max(1,...(chart?.buckets??[]).map(row=>row.value));
  return <section className="card reveal section-gap" aria-label="MySQL reporting preview">
    <div className="card-hd">
      <div>
        <div className="card-title">Journeys · MySQL reporting preview</div>
        <div className="card-note">Direct read-only MySQL aggregation; separate from existing dashboard metrics</div>
      </div>
      <button type="button" onClick={()=>void refresh()} disabled={busy}
        className="rounded border px-3 py-1 text-xs font-semibold">
        {busy?"Refreshing…":"Refresh chart"}
      </button>
    </div>
    <p className="mb-3 text-xs text-slate-500">
      {capabilities.cdcAutoRefreshConnected
        ?"CDC-driven updates enabled"
        :"CDC producer not connected; on-demand preview only"}
    </p>
    {error&&<p role="status" className="text-xs text-amber-700">{error}</p>}
    {!chart&&!busy&&<p className="text-sm text-slate-500">No reporting result available.</p>}
    {chart&&chart.buckets.length===0&&
      <p className="text-sm text-slate-500">No journey status groups for this employer.</p>}
    {chart&&chart.buckets.map((row,index)=><div key={String(row.bucket)+index} className="mb-2 flex items-center gap-3 text-sm">
      <span className="w-32 shrink-0 truncate" title={String(row.bucket??"Unknown")}>
        {String(row.bucket??"Unknown")}
      </span>
      <div className="h-3 min-w-0 flex-1 overflow-hidden rounded bg-slate-100">
        <div className="h-full rounded bg-[var(--brand-accent)]"
          style={{width:`${Math.min(100,100*row.value/max)}%`}} />
      </div>
      <strong className="w-16 text-right">{row.value.toLocaleString("en-ZA")}</strong>
    </div>)}
  </section>;
}
