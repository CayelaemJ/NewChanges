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
  detail?: any;
  result?: any;
  error?: string;
  timer: NodeJS.Timeout | null;
}

const syncJobs = new Map<string, SyncJob>();
const JOB_TTL_MS = 30 * 60 * 1000;

function update(job: SyncJob, jobId: string, patch: Partial<SyncJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  if ((job.status === "DONE" || job.status === "FAILED") && !job.timer) {
    job.timer = setTimeout(() => syncJobs.delete(jobId), JOB_TTL_MS);
    job.timer.unref();
  }
  publishAdminEvent("job.progress", {
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    jobType: "sync",
    ...(job.detail !== undefined ? { detail: job.detail } : {}),
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  }, jobId);
}

export function startSyncJob(trigger: "manual" | "scheduled" = "manual"): string {
  const jobId = randomUUID();
  // Keep in-flight jobs observable even when a sync takes longer than 30 minutes.
  const timer = null;
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
      job.result = await runSync(trigger, {
        onProgress: async (detail) => {
          job.detail = detail;
          update(job, jobId, {
            status: "PROCESSING",
            phase: detail.phase,
            progress: detail.progress,
            message: detail.message,
          });
        },
      });
      // runSync reports ordered-feed failures as a result rather than throwing.
      // PARTIAL is not a successful sync: later dependent feeds were blocked.
      const complete = job.result?.status === "OK" && job.result?.ok === true;
      update(job, jobId, {
        status: complete ? "DONE" : "FAILED",
        phase: complete ? "COMPLETE" : "FAILED",
        progress: 100,
        message: job.result?.note || (complete ? "Synchronisation complete" : "Synchronisation failed"),
        ...(!complete ? { error: job.result?.error || job.result?.note || "Source synchronisation did not complete" } : {}),
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
