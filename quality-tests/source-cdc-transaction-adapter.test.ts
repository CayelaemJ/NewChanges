import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ commit: vi.fn() }));
vi.mock("../src/services/sourceCdcCheckpoint.js", () => ({
  commitCdcBatch: mock.commit,
}));
import { ingestCommittedSourceTransaction } from "../src/services/sourceCdcTransactionAdapter.js";

const lease = {
  sourceId: "rds-fixer", owner: "consumer-A", generation: 1,
  cursor: "mysql-bin.000010:120", expiresAt: new Date("2030-01-01"),
};
const tx = {
  committed: true as const,
  sourceId: "rds-fixer",
  fromCursor: "mysql-bin.000010:120",
  toCursor: "mysql-bin.000010:240",
  changes: [
    { feed: "ratings" as const, operation: "INSERT" as const,
      after: { employer_ref: "VIG", created_at: "2026-11-13" } },
    { feed: "ratings" as const, operation: "INSERT" as const,
      after: { employer_ref: "VIG", created_at: "2026-11-13" } },
  ],
};

describe("committed ROW-binlog transaction handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DIRECT_MYSQL_CDC_CONSUMER_ENABLED", "true");
    vi.stubEnv("DIRECT_MYSQL_REPORTING_ENABLED", "true");
    mock.commit.mockResolvedValue(1);
  });
  it("deduplicates same-tenant period hints before durable atomic checkpoint", async () => {
    expect(await ingestCommittedSourceTransaction(lease, tx)).toEqual({
      nextCursor: tx.toCursor, sourceRows: 2, invalidations: 1,
    });
    expect(mock.commit).toHaveBeenCalledWith({
      lease, expectedCursor: tx.fromCursor, nextCursor: tx.toCursor,
      hints: [{ employerRef: "VIG", period: "2026-11", feed: "ratings" }],
    });
  });
  it("does not advance a cursor when durable handoff fails", async () => {
    mock.commit.mockRejectedValue(new Error("PG transaction unavailable"));
    await expect(ingestCommittedSourceTransaction(lease, tx))
      .rejects.toThrow(/PG transaction unavailable/);
  });
  it("rejects uncommitted events and mismatched source positions", async () => {
    await expect(ingestCommittedSourceTransaction(lease, {
      ...tx, committed: false as any,
    })).rejects.toThrow(/uncommitted/);
    await expect(ingestCommittedSourceTransaction(lease, {
      ...tx, fromCursor: "mysql-bin.000010:999",
    })).rejects.toThrow(/cursor mismatch/);
    expect(mock.commit).not.toHaveBeenCalled();
  });
  it("refuses incomplete before-images, and oversized source transactions", async () => {
    await expect(ingestCommittedSourceTransaction(lease, {
      ...tx, changes: [{ feed: "policies", operation: "DELETE" }],
    })).rejects.toThrow(/before-image/);
    await expect(ingestCommittedSourceTransaction(lease, {
      ...tx, changes: Array.from({ length: 257 }, () => tx.changes[0]),
    })).rejects.toThrow(/bounded row batch/);
    expect(mock.commit).not.toHaveBeenCalled();
  });
  it("stays disabled unless both explicit feature flags are enabled", async () => {
    vi.stubEnv("DIRECT_MYSQL_CDC_CONSUMER_ENABLED", "false");
    await expect(ingestCommittedSourceTransaction(lease, tx))
      .rejects.toThrow(/disabled/);
    expect(mock.commit).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
