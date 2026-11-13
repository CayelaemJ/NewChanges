import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const checkpoint = {
    createMany: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(),
  };
  const outbox = { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() };
  const tx = { sourceCdcCheckpoint: checkpoint, sourceCdcOutbox: outbox };
  const transaction = vi.fn(async (cb: (arg: typeof tx) => Promise<unknown>) => cb(tx));
  return { checkpoint, outbox, transaction, tx };
});
vi.mock("../src/services/database.js", () => ({
  prisma: {
    $transaction: fake.transaction,
    sourceCdcCheckpoint: fake.checkpoint,
    sourceCdcOutbox: fake.outbox,
  },
}));

import {
  acquireCdcLease, renewCdcLease, commitCdcBatch,
  pendingCdcInvalidations, acknowledgeDurableCdcInvalidations,
} from "../src/services/sourceCdcCheckpoint.js";

const base = {
  lease: { sourceId: "aws-fixer", owner: "consumer-A", generation: 4 },
  expectedCursor: "mysql-bin.000004:120",
  nextCursor: "mysql-bin.000004:230",
  hints: [{ feed: "journeys" as const, employerRef: "VIG", period: "2026-11" }],
};

describe("durable MySQL CDC cursor and small Postgres outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.checkpoint.createMany.mockResolvedValue({ count: 1 });
    fake.checkpoint.updateMany.mockResolvedValue({ count: 1 });
    fake.checkpoint.findUniqueOrThrow.mockResolvedValue({
      id: "aws-fixer", cursor: base.expectedCursor,
      leaseGeneration: 4, leaseExpiresAt: new Date("2030-01-01"),
    });
    fake.outbox.createMany.mockResolvedValue({ count: 1 });
    fake.outbox.findMany.mockResolvedValue([]);
    fake.outbox.updateMany.mockResolvedValue({ count: 1 });
  });

  it("persists invalidation hints inside the same transaction as the checkpoint CAS", async () => {
    expect(await commitCdcBatch(base)).toBe(1);
    expect(fake.transaction).toHaveBeenCalledOnce();
    const where = fake.checkpoint.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      id: "aws-fixer", cursor: base.expectedCursor,
      leaseOwner: "consumer-A", leaseGeneration: 4,
    });
    const rows = fake.outbox.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceId: "aws-fixer", sourceCursor: base.nextCursor,
      employerRef: "VIG", period: "2026-11", feed: "journeys",
    });
    expect(rows[0].id).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]).not.toHaveProperty("payrollRef");
    expect(fake.checkpoint.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(fake.outbox.createMany.mock.invocationCallOrder[0]);
  });

  it("uses deterministic outbox ids for replay of the same source position", async () => {
    await commitCdcBatch(base);
    await commitCdcBatch(base);
    const [first, second] = fake.outbox.createMany.mock.calls.map(args => args[0].data[0].id);
    expect(first).toBe(second);
    expect(fake.outbox.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it("refuses expired, stolen or stale source checkpoints before inserting invalidations", async () => {
    fake.checkpoint.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(commitCdcBatch(base)).rejects.toThrow(/stale lease or cursor/);
    expect(fake.outbox.createMany).not.toHaveBeenCalled();
  });

  it("fails safely on invalid feed, source position, or overlarge batch", async () => {
    await expect(commitCdcBatch({ ...base, nextCursor: base.expectedCursor }))
      .rejects.toThrow(/must advance/);
    await expect(commitCdcBatch({
      ...base, hints: [{ feed: "unknown" as any, employerRef: "VIG", period: null }],
    })).rejects.toThrow(/Invalid CDC invalidation/);
    await expect(commitCdcBatch({
      ...base, hints: Array.from({ length: 513 }, () => base.hints[0]),
    })).rejects.toThrow(/bounded outbox/);
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it("lets only one fenced leader acquire a generation and renew its own lease", async () => {
    const lease = await acquireCdcLease("aws-fixer", "consumer-A");
    expect(lease).toMatchObject({ generation: 4, cursor: base.expectedCursor });
    expect(fake.checkpoint.createMany).toHaveBeenCalledOnce();
    const options = fake.checkpoint.updateMany.mock.calls[0][0];
    expect(options.data.leaseGeneration).toEqual({ increment: 1 });
    expect(await renewCdcLease(lease!)).toBe(true);
    fake.checkpoint.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await renewCdcLease(lease!)).toBe(false);
  });

  it("does not claim ownership if another consumer holds the lease", async () => {
    fake.checkpoint.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await acquireCdcLease("aws-fixer", "consumer-B")).toBeNull();
  });

  it("pages only undelivered bounded outbox hints and requires explicit durable ack", async () => {
    await pendingCdcInvalidations("aws-fixer", 50);
    expect(fake.outbox.findMany.mock.calls[0][0]).toMatchObject({
      where: { sourceId: "aws-fixer", deliveredAt: null },
      take: 50,
    });
    await expect(acknowledgeDurableCdcInvalidations("aws-fixer", ["invalid"]))
      .rejects.toThrow(/acknowledgement/);
    expect(await acknowledgeDurableCdcInvalidations("aws-fixer", ["a".repeat(64)])).toBe(1);
    expect(fake.outbox.updateMany.mock.calls[0][0]).toMatchObject({
      where: { sourceId: "aws-fixer", id: { in: ["a".repeat(64)] }, deliveredAt: null },
    });
  });
});
