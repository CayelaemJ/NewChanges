// Background source synchronisation jobs with live SSE progress and polling fallback.
import { randomUUID } from "node:crypto";
import { runSync } from "./syncService.js";
import { publishAdminEvent } from "./adminEventStream.js";

export type SyncJobStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

export interface SyncJob {
  status: SyncJobStatus;
  phase: string;
  progress: number;
  message: string;
  updatedAt: string;
  result?: any;
  error?: string;
  timer: NodeJS.Timeout;
}

const syncJobs = new Map<string, SyncJob>();
const JOB_TTL_MS = 30 * 60 * 1000;

function update(job: SyncJob, jobId: string, patch: Partial<SyncJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  publishAdminEvent("job.progress", {
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    jobType: "sync",
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  }, jobId);
}

export function startSyncJob(trigger: "manual" | "scheduled" = "manual"): string {
  const jobId = randomUUID();
  const timer = setTimeout(() => syncJobs.delete(jobId), JOB_TTL_MS);
  const job: SyncJob = {
    status: "PENDING",
    phase: "QUEUED",
    progress: 0,
    message: "Queued",
    updatedAt: new Date().toISOString(),
    timer,
  };
  syncJobs.set(jobId, job);
  publishAdminEvent("job.progress", {
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    jobType: "sync",
  }, jobId);

  (async () => {
    try {
      update(job, jobId, {
        status: "PROCESSING",
        phase: "SYNCING",
        progress: 10,
        message: "Synchronising source data",
      });
      job.result = await runSync(trigger);
      update(job, jobId, {
        status: "DONE",
        phase: "COMPLETE",
        progress: 100,
        message: "Synchronisation complete",
      });
    } catch (e: any) {
      update(job, jobId, {
        status: "FAILED",
        phase: "FAILED",
        progress: 100,
        message: "Synchronisation failed",
        error: e?.message || String(e),
      });
      console.error("[sync-job] sync failed:", e);
    }
  })();

  return jobId;
}

export function getSyncJob(jobId: string): SyncJob | undefined {
  return syncJobs.get(jobId);
}
