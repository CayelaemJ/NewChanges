import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  lease: vi.fn(), renew: vi.fn(), ingest: vi.fn(),
}));
vi.mock("../src/services/sourceCdcCheckpoint.js", () => ({
  acquireCdcLease: fake.lease, renewCdcLease: fake.renew,
}));
vi.mock("../src/services/sourceCdcTransactionAdapter.js", () => ({
  ingestCommittedSourceTransaction: fake.ingest,
}));
import { runCdcCaptureSession } from "../src/services/sourceCdcSession.js";

const initial = {
  sourceId: "rds-fixer", owner: "worker-a", generation: 3,
  cursor: "binlog.000002:200", expiresAt: new Date("2030-01-01"),
};
const frame = (fromCursor: string, toCursor: string) => ({
  committed: true as const, sourceId: "rds-fixer", fromCursor, toCursor, changes: [],
});
function reader(...frames: ReturnType<typeof frame>[]) {
  const open = vi.fn(async function* (_start: string, _signal: AbortSignal) {
    for (const f of frames) yield f;
  });
  return { open };
}
describe("sequential fenced MySQL CDC capture orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DIRECT_MYSQL_CDC_CONSUMER_ENABLED", "true");
    vi.stubEnv("DIRECT_MYSQL_REPORTING_ENABLED", "true");
    fake.lease.mockResolvedValue({ ...initial });
    fake.renew.mockResolvedValue(true);
    fake.ingest.mockImplementation(async (_lease: any, tx: any) =>
      ({ nextCursor: tx.toCursor, invalidations: 1 }));
  });
  afterEach(() => vi.unstubAllEnvs());
  it("passes the durable committed cursor into the reader and advances sequentially", async () => {
    const stream = reader(frame("binlog.000002:200","binlog.000002:250"),
      frame("binlog.000002:250","binlog.000002:300"));
    const response = await runCdcCaptureSession({
      sourceId: "rds-fixer", owner: "worker-a", reader: stream,
    });
    expect(response).toMatchObject({
      status: "END_OF_STREAM", committedTransactions: 2,
      lastCursor: "binlog.000002:300", invalidationHints: 2,
    });
    expect(stream.open).toHaveBeenCalledWith("binlog.000002:200", expect.any(AbortSignal));
    expect(fake.ingest.mock.calls[0][0].cursor).toBe("binlog.000002:200");
    expect(fake.ingest.mock.calls[1][0].cursor).toBe("binlog.000002:250");
  });
  it("does not read the binlog if another owner has the active lease", async () => {
    fake.lease.mockResolvedValue(null);
    const stream = reader(frame("binlog.000002:200","binlog.000002:250"));
    const response = await runCdcCaptureSession({
      sourceId:"rds-fixer",owner:"worker-b",reader:stream,
    });
    expect(response.status).toBe("LEASE_HELD");
    expect(stream.open).not.toHaveBeenCalled();
  });
  it("rejects source gaps without writing a checkpoint", async () => {
    const stream = reader(frame("binlog.000002:201","binlog.000002:250"));
    await expect(runCdcCaptureSession({
      sourceId:"rds-fixer",owner:"worker-a",reader:stream,
    })).rejects.toThrow(/continuity gap/);
    expect(fake.ingest).not.toHaveBeenCalled();
  });
  it("stops immediately on durable persistence failure without acknowledging more changes", async () => {
    fake.ingest.mockRejectedValueOnce(new Error("postgres down"));
    const stream = reader(frame("binlog.000002:200","binlog.000002:250"),
      frame("binlog.000002:250","binlog.000002:300"));
    await expect(runCdcCaptureSession({
      sourceId:"rds-fixer",owner:"worker-a",reader:stream,
    })).rejects.toThrow(/postgres down/);
    expect(fake.ingest).toHaveBeenCalledTimes(1);
  });
  it("refuses disabled capture before obtaining a lease", async () => {
    vi.stubEnv("DIRECT_MYSQL_CDC_CONSUMER_ENABLED", "false");
    await expect(runCdcCaptureSession({
      sourceId:"rds-fixer",owner:"worker-a",reader:reader(),
    })).rejects.toThrow(/disabled/);
    expect(fake.lease).not.toHaveBeenCalled();
  });
  it("bounds captured transactions per session", async () => {
    const stream = reader(frame("binlog.000002:200","binlog.000002:250"),
      frame("binlog.000002:250","binlog.000002:300"));
    const response = await runCdcCaptureSession({
      sourceId:"rds-fixer",owner:"worker-a",reader:stream,maxTransactions:1,
    });
    expect(response.committedTransactions).toBe(1);
    expect(fake.ingest).toHaveBeenCalledTimes(1);
  });
});
