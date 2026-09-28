// ════════════════════════════════════════════════════════════════════
//  ASYNC SYNC JOBS — run integration syncs off the HTTP request thread.
//  POST /api/admin/integration/sync returns 202 + jobId immediately;
//  the browser polls GET /api/admin/sync-jobs/:jobId. A full pull from
//  an external API/SQL source can take minutes and must never hold the
//  admin UI's HTTP connection open.
// ════════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import { runSync } from "./syncService.js";

export type SyncJobStatus = "PENDING" | "DONE" | "FAILED";

export interface SyncJob {
  status: SyncJobStatus;
  result?: any;
  error?: string;
  timer: NodeJS.Timeout;
}

const syncJobs = new Map<string, SyncJob>();
const JOB_TTL_MS = 30 * 60 * 1000; // jobs expire so the map can't grow forever

export function startSyncJob(trigger: "manual" | "scheduled" = "manual"): string {
  const jobId = randomUUID();
  const timer = setTimeout(() => syncJobs.delete(jobId), JOB_TTL_MS);
  syncJobs.set(jobId, { status: "PENDING", timer });
  const job = syncJobs.get(jobId)!;

  (async () => {
    try {
      job.result = await runSync(trigger);
      job.status = "DONE";
    } catch (e: any) {
      job.status = "FAILED";
      job.error = e?.message || String(e);
      console.error("[sync-job] sync failed:", e);
    }
  })();

  return jobId;
}

export function getSyncJob(jobId: string): SyncJob | undefined {
  return syncJobs.get(jobId);
}
