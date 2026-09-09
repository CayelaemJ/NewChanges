// ════════════════════════════════════════════════════════════════════
//  ASYNC JOB RUNNER
//  Upload validation and batch commit run in the background so the
//  HTTP response can return immediately (202 Accepted). The browser
//  polls /api/admin/upload-jobs/:id or /api/admin/commit-jobs/:id.
// ════════════════════════════════════════════════════════════════════
import { randomUUID } from "node:crypto";
import { uploadAndValidate, commitBatch } from "./importService.js";
import { prisma } from "./snapshotBuilder.js";
const uploadJobs = new Map();
const commitJobs = new Map();
// Jobs expire after 30 minutes so the maps don't grow forever.
function startJob(map) {
    const id = randomUUID();
    const timer = setTimeout(() => map.delete(id), 30 * 60 * 1000);
    map.set(id, { status: "PENDING", timer });
    return id;
}
export function startUploadJob(opts) {
    const jobId = startJob(uploadJobs);
    const job = uploadJobs.get(jobId);
    (async () => {
        try {
            const { batch, result } = await uploadAndValidate(opts);
            job.status = "DONE";
            job.result = {
                batchId: batch.id,
                status: batch.status,
                rowCount: result.rowCount,
                errors: result.errors.slice(0, 200),
                errorCount: result.errors.length,
                missingColumns: result.missingColumns,
                unknownColumns: result.unknownColumns,
                preview: result.rows.slice(0, 10),
            };
        }
        catch (e) {
            job.status = "FAILED";
            job.error = e?.message || String(e);
            console.error("[upload-job] validation failed:", e);
        }
    })();
    return jobId;
}
export function getUploadJob(jobId) {
    return uploadJobs.get(jobId);
}
export function startCommitJob(batchId) {
    const jobId = startJob(commitJobs);
    const job = commitJobs.get(jobId);
    (async () => {
        try {
            const result = await commitBatch(batchId);
            // Harmless if commitBatch already set this itself.
            await prisma.importBatch.update({
                where: { id: batchId },
                data: { status: "COMMITTED" },
            }).catch(() => { });
            job.status = "DONE";
            job.result = result;
        }
        catch (e) {
            job.status = "FAILED";
            job.error = String(e?.message || "Import commit failed.").replace(/\s+/g, " ").trim();
            console.error("[commit-job] commit failed:", e);
            await prisma.importBatch.update({
                where: { id: batchId },
                data: { status: "FAILED", errors: { commitError: job.error } },
            }).catch(() => { });
        }
    })();
    return jobId;
}
export function getCommitJob(jobId) {
    return commitJobs.get(jobId);
}
