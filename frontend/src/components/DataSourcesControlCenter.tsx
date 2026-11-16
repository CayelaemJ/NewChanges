import { useCallback, useEffect, useState } from "react";

type SourceStatus =
  | "ENABLED_LEGACY_IMPORT" | "NOT_CONFIGURED" | "PAUSED"
  | "STAGED" | "VALIDATED" | "ACTIVE_GENERATION"
  | "RETIRED" | "UNKNOWN";
type TrackedSource = {
  id: string;
  label: string;
  sourceType: string;
  driver?: string;
  status: SourceStatus;
  strategy?: string;
  lastSuccessfulSyncAt?: string | null;
  lastSyncStatus?: string | null;
  validatedAt?: string | null;
};
type DataSourcesOverview = {
  schemaVersion: number;
  observedAt: string;
  architecture: string;
  dataResidency: string;
  activeSource: TrackedSource;
  candidates: TrackedSource[];
  summary: { enabledIntegrations: number; staged: number; trackedEntries: number; cdcProductionReady: false };
  polling: {
    status: string; scope: string; lastCheckedAt: string | null;
    lastFailureAt: string | null; changedFeedsLastPoll: number | null;
  };
  cdcPilot: {
    label: string; mode: string; state: string; localDockerBaseline: string;
    sourceViewIdentity: string; currentDashboardWiring: string;
    prerequisites: string[];
  };
  onboarding: {
    currentCapability: string; simultaneousActiveSources: false;
    schemaMappingCapability: string; link: string;
  };
  availableConnectors: Array<{ driver: string; label: string; support: string; futureCdc: string }>;
};

const gates: Record<string, string> = {
  APPROVED_RDS_BINLOG_RETENTION: "Confirm RDS replay retention and available storage",
  REPLICATION_SCOPE_PRIVACY_REVIEW: "Review global replication privileges and sensitive data scope",
  CONSISTENT_INITIAL_SNAPSHOT: "Verify a consistent initial source snapshot",
  VERIFIED_READONLY_ACCOUNT: "Provision a dedicated, verified read-only MySQL account",
  MULTI_WORKER_PUBLICATION: "Publish generations safely across application instances",
  AGGREGATION_AND_DASHBOARD_PARITY: "Validate source-side aggregates against existing dashboard calculations",
};

function formattedDate(raw?: string | null): string {
  if (!raw) return "Not yet observed";
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-ZA") : "Not yet observed";
}

function State({ value }: { value: string }) {
  const text: Record<string, string> = {
    ENABLED_LEGACY_IMPORT: "Enabled · legacy importer",
    PAUSED: "Configured · disabled",
    NOT_CONFIGURED: "Not configured",
    VALIDATED: "Staged · validated",
    STAGED: "Staged · not validated",
    ACTIVE_GENERATION: "Active generation",
    RETIRED: "Retired",
    BLOCKED_NOT_DEPLOYED: "CDC not activated",
    RUNNING: "Source watcher running",
    STALE: "Watcher stale",
    DEGRADED: "Watcher degraded",
    PAUSED_WATCHER: "Watcher paused",
  };
  return <span className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">{text[value] ?? value.replace(/_/g, " ").toLowerCase()}</span>;
}

export function DataSourcesControlCenter() {
  const [data, setData] = useState<DataSourcesOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/data-sources/overview", {
        credentials: "same-origin", cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("Data source overview unavailable");
      const result = await response.json() as DataSourcesOverview;
      if (result.schemaVersion !== 1 || !result.activeSource || !Array.isArray(result.candidates))
        throw new Error("Unexpected data source overview format");
      setData(result);
      setError("");
    } catch {
      setError("Unable to load the connection overview. Existing data integrations are unchanged.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(id);
  }, [reload]);

  return <section aria-label="Data source control centre" className="mt-5 space-y-5 pb-8">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Data Sources &amp; CDC</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Monitor existing connections, prepare another database, and review changes without copying reporting datasets into PostgreSQL.
        </p>
      </div>
      <button type="button" onClick={() => void reload()} disabled={busy}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {busy ? "Refreshing…" : "Refresh status"}
      </button>
    </header>

    {error && <p role="alert" className="border-l-4 border-rose-500 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {!data ? <p role="status" className="py-6 text-sm text-slate-500">Loading connection inventory…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Enabled integrations", data.summary.enabledIntegrations, "Configured; connection uptime not implied"],
          ["Staged candidates", data.summary.staged, "Safe previews, not automatic cutovers"],
          ["Source watcher", data.polling.status.replace(/_/g, " "), "This app process only; not binlog CDC"],
          ["Live CDC", "Not enabled", "PR #237 remains a production gate"],
        ].map(([label, value, explanation]) => <div key={String(label)}
          className="border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <strong className="mt-1 block break-words text-xl font-semibold text-slate-900">{value}</strong>
          <p className="mt-2 text-xs leading-5 text-slate-500">{explanation}</p>
        </div>)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
        <div className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-5">
            <h3 className="text-base font-semibold text-slate-900">Connection inventory</h3>
            <p className="mt-1 text-xs text-slate-500">Connection status is based on saved configuration and historical sync evidence—not a live DB ping.</p>
          </div>
          <div className="divide-y divide-slate-100">
            <div className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-slate-900">{data.activeSource.label}</strong>
                <State value={data.activeSource.status} />
              </div>
              <div className="mt-3 grid gap-3 text-xs text-slate-600 sm:grid-cols-2">
                <span>Connector: <b>{data.activeSource.driver && data.activeSource.driver !== "UNKNOWN" ? data.activeSource.driver : data.activeSource.sourceType}</b></span>
                <span>Refresh mode: <b>Existing sync/import</b></span>
                <span>Last successful sync: <b>{formattedDate(data.activeSource.lastSuccessfulSyncAt)}</b></span>
                <span>Last sync state: <b>{data.activeSource.lastSyncStatus ?? "Unknown"}</b></span>
              </div>
            </div>
            {data.candidates.map(item => <div key={item.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm text-slate-900">{item.label}</strong>
                <State value={item.status} />
              </div>
              <p className="mt-2 text-xs text-slate-600">Type: {item.sourceType} · Validated: {formattedDate(item.validatedAt)}</p>
            </div>)}
            {!data.candidates.length && <p className="p-5 text-sm text-slate-500">No additional database candidates staged yet.</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 p-5">
            <div><b className="text-sm text-slate-800">Another database coming?</b>
              <p className="mt-1 text-xs text-slate-600">Use the existing preview and staging workflow; it does not automatically replace the current source.</p></div>
            <a href={data.onboarding.link} className="rounded-md bg-[var(--brand-ink-strong)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
              Stage a database
            </a>
          </div>
        </div>

        <div className="border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold text-slate-900">CDC readiness</h3>
          <div className="mt-3"><State value={data.cdcPilot.state}/></div>
          <p className="mt-3 text-xs leading-5 text-slate-600">
            MySQL row-binlog feed invalidation has a tested local foundation. It is not yet a deployed live pipeline.
          </p>
          <p className="mt-3 text-xs text-slate-600">Latest local test evidence: <b>{data.cdcPilot.localDockerBaseline}</b></p>
          <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Unresolved launch gates</h4>
          <ul className="mt-2 space-y-2">
            {data.cdcPilot.prerequisites.map(gate => <li key={gate} className="flex gap-2 text-xs leading-5 text-slate-700">
              <span aria-hidden="true" className="text-amber-600">○</span>{gates[gate] ?? gate}
            </li>)}
          </ul>
          <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
            The normal dashboard still uses the existing PostgreSQL read model. A CDC notification is not a published dashboard version.
          </p>
        </div>
      </div>

      <section className="border border-slate-200 bg-white p-5">
        <h3 className="text-base font-semibold text-slate-900">Plug-and-play connector pathway</h3>
        <p className="mt-1 text-sm text-slate-600">
          Supported today: test and stage one candidate. Multiple simultaneously active sources and automatic schema mapping require another implementation phase.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {data.availableConnectors.map(connector => <div key={connector.driver} className="border border-slate-200 p-3">
            <b className="text-sm text-slate-900">{connector.label}</b>
            <p className="mt-1 text-xs text-slate-500">Existing import adapter</p>
            <p className="mt-2 text-xs text-slate-600">CDC: {connector.futureCdc.replace(/_/g, " ").toLowerCase()}</p>
          </div>)}
        </div>
        <ol className="mt-4 grid gap-2 text-xs text-slate-700 sm:grid-cols-2 xl:grid-cols-5">
          {["Choose connector", "Test and preview", "Map schema (planned)", "Approve change mode", "Activate deliberately"].map((step, i) =>
            <li key={step} className="border-t-2 border-slate-200 pt-2"><span className="mr-2 text-slate-400">{i + 1}.</span>{step}</li>)}
        </ol>
        <p className="mt-4 text-xs text-slate-500">
          Source discovery, transformation rules and multi-source runtime registration are not yet automated. The control centre will show them as pending rather than guessing.
        </p>
      </section>
      <p className="text-right text-[11px] text-slate-400">Inventory checked {formattedDate(data.observedAt)} · Admin-only</p>
    </>}
  </section>;
}
