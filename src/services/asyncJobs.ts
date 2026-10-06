// ════════════════════════════════════════════════════════════════════
// ASYNC JOB RUNNER
// Background work for uploads, commits and source synchronisation.
// Job progress is exposed through authenticated SSE with polling fallback.
// ════════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import { uploadAndValidate, commitBatch } from "./importService.js";
import { runSync } from "./syncService.js";
import { publishAdminEvent } from "./adminEventStream.js";

const uploadJobs = new Map<string, any>();
const commitJobs = new Map<string, any>();
const syncJobs = new Map<string, any>();

const JOB_TTL_MS = 30 * 60 * 1000;

function startJob(map: Map<string, any>, type: string) {
  const id = randomUUID();
  const timer = setTimeout(() => map.delete(id), JOB_TTL_MS);
  map.set(id, {
    status: "PENDING",
    phase: "QUEUED",
    progress: 0,
    message: "Queued",
    updatedAt: new Date().toISOString(),
    timer,
  });
  publishAdminEvent("job.progress", {
    status: "PENDING",
    phase: "QUEUED",
    progress: 0,
    message: "Queued",
    jobType: type,
  }, id);
  return id;
}

function updateJob(job: any, jobId: string, jobType: string, patch: Record<string, unknown>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  publishAdminEvent("job.progress", {
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    jobType,
    ...(job.detail !== undefined ? { detail: job.detail } : {}),
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  }, jobId);
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function startUploadJob(opts: any) {
  const jobId = startJob(uploadJobs, "upload");
  const job = uploadJobs.get(jobId)!;

  (async () => {
    try {
      updateJob(job, jobId, "upload", {
        status: "PROCESSING",
        phase: "VALIDATING",
        progress: 35,
        message: "Validating file",
      });

      const { batch, result } = await uploadAndValidate(opts);

      job.result = {
        batchId: batch?.id,
        status: batch?.status,
        rowCount: result.rowCount,
        errors: result.errors.slice(0, 200),
        errorCount: result.errors.length,
        errorSummary: "",
        missingColumns: result.missingColumns,
        unknownColumns: result.unknownColumns,
        preview: result.rows.slice(0, 3),
      };

      if (!result.ok || batch?.status !== "VALIDATED") {
        job.status = "DONE";
        updateJob(job, jobId, "upload", {
          phase: "VALIDATED",
          progress: 100,
          message: result.ok ? "Validation complete" : "Validation found problems",
        });
        return;
      }

      updateJob(job, jobId, "upload", {
        status: "PROCESSING",
        phase: "COMMITTING",
        progress: 80,
        message: "Committing and recomputing scores",
      });

      const commit = await commitBatch(batch.id, {
        onProgress: async (detail) => {
          job.detail = { ...detail, batchId: batch.id };
          updateJob(job, jobId, "upload", {
            status: "PROCESSING",
            phase: "COMMITTING",
            progress: detail.total > 0 ? 80 + Math.round((detail.processed / detail.total) * 18) : 98,
            message: `${detail.reportKey}: ${detail.processed.toLocaleString("en-ZA")} / ${detail.total.toLocaleString("en-ZA")} rows processed into live tables`,
          });
        },
      });
      job.result = {
        ...job.result,
        status: "COMMITTED",
        errors: [],
        errorCount: 0,
        errorSummary: "",
        ...commit,
        period: currentPeriod(),
      };
      job.status = "DONE";
      updateJob(job, jobId, "upload", {
        phase: "COMPLETE",
        progress: 100,
        message: "Import complete",
      });
    } catch (e: any) {
      job.status = "DONE";
      job.result = {
        batchId: opts.batchId || "unknown",
        status: "ERROR",
        rowCount: 0,
        errors: [],
        errorCount: 0,
        errorSummary: `Upload failed: ${e?.message || String(e)}`,
        missingColumns: [],
        unknownColumns: [],
        preview: [],
      };
      updateJob(job, jobId, "upload", {
        phase: "FAILED",
        progress: 100,
        message: "Import failed",
      });
      console.error("[upload-job] validation/commit failed:", e);
    }
  })();

  return jobId;
}

export function getUploadJob(jobId: string) {
  return uploadJobs.get(jobId);
}

export function startCommitJob(batchId: string) {
  const jobId = startJob(commitJobs, "commit");
  const job = commitJobs.get(jobId)!;

  (async () => {
    try {
      updateJob(job, jobId, "commit", {
        status: "PROCESSING",
        phase: "COMMITTING",
        progress: 20,
        message: "Committing and recomputing scores",
      });

      const result = await commitBatch(batchId, {
        onProgress: async (detail) => {
          job.detail = { ...detail, batchId };
          updateJob(job, jobId, "commit", {
            status: "PROCESSING",
            phase: "COMMITTING",
            progress: detail.total > 0 ? 20 + Math.round((detail.processed / detail.total) * 75) : 95,
            message: `${detail.reportKey}: ${detail.processed.toLocaleString("en-ZA")} / ${detail.total.toLocaleString("en-ZA")} rows processed into live tables`,
          });
        },
      });
      job.status = "DONE";
      job.result = { ...result, period: currentPeriod() };
      updateJob(job, jobId, "commit", {
        phase: "COMPLETE",
        progress: 100,
        message: "Commit complete",
      });
    } catch (e: any) {
      job.status = "FAILED";
      job.error = e?.message || String(e);
      updateJob(job, jobId, "commit", {
        phase: "FAILED",
        progress: 100,
        message: "Commit failed",
      });
      console.error("[commit-job] commit failed:", e);
    }
  })();

  return jobId;
}

export function getCommitJob(jobId: string) {
  return commitJobs.get(jobId);
}

export function startSyncJob(trigger: "manual" | "scheduled" = "manual") {
  const jobId = startJob(syncJobs, "sync");
  const job = syncJobs.get(jobId)!;

  (async () => {
    try {
      updateJob(job, jobId, "sync", {
        status: "PROCESSING",
        phase: "SYNCING",
        progress: 10,
        message: "Synchronising source data",
      });

      const result = await runSync(trigger, {
        onProgress: async (detail) => {
          job.detail = detail;
          updateJob(job, jobId, "sync", {
            status: "PROCESSING",
            phase: detail.phase,
            progress: detail.progress,
            message: detail.message,
          });
        },
      });
      job.status = "DONE";
      job.result = result;
      updateJob(job, jobId, "sync", {
        phase: "COMPLETE",
        progress: 100,
        message: "Synchronisation complete",
      });
    } catch (e: any) {
      job.status = "FAILED";
      job.error = e?.message || String(e);
      updateJob(job, jobId, "sync", {
        phase: "FAILED",
        progress: 100,
        message: "Synchronisation failed",
      });
      console.error("[sync-job] sync failed:", e);
    }
  })();

  return jobId;
}

export function getSyncJob(jobId: string) {
  return syncJobs.get(jobId);
}
