import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const db = vi.hoisted(() => {
  const outbox = { findMany: vi.fn(), updateMany: vi.fn() };
  const versions = { upsert: vi.fn(), findUnique: vi.fn() };
  const tx = { sourceCdcOutbox: outbox, sourceCdcVersion: versions };
  const transaction = vi.fn(async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx));
  return { outbox, versions, transaction, tx };
});
vi.mock("../src/services/database.js", () => ({
  prisma: {
    $transaction: db.transaction,
    sourceCdcVersion: db.versions,
  },
}));
import { dispatchCdcOutboxToVersions, readCdcEmployerVersion } from "../src/services/sourceCdcVersion.js";

describe("CDC durable employer version dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.outbox.findMany.mockResolvedValue([
      { id: "a", employerRef: "TENANT-A" },
      { id: "b", employerRef: "TENANT-A" },
      { id: "c", employerRef: "TENANT-B" },
    ]);
    db.outbox.updateMany.mockResolvedValue({ count: 3 });
    db.versions.upsert.mockImplementation(async (req: any) => ({
      employerRef: req.create.employerRef, version: 4n,
    }));
    db.versions.findUnique.mockResolvedValue({ version: 4n });
  });

  it("claims outbox hints before bumping a version once per affected employer", async () => {
    const result = await dispatchCdcOutboxToVersions("aws-fixer");
    expect(result).toEqual({ delivered: 3, versions: [
      { employerRef: "TENANT-A", version: "4" },
      { employerRef: "TENANT-B", version: "4" },
    ] });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.outbox.updateMany.mock.calls[0][0].where).toEqual({
      sourceId: "aws-fixer", id: { in: ["a", "b", "c"] }, deliveredAt: null,
    });
    expect(db.outbox.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(db.versions.upsert.mock.invocationCallOrder[0]);
    expect(db.versions.upsert).toHaveBeenCalledTimes(2);
  });

  it("fails closed on concurrent row claim instead of double advancing versions", async () => {
    db.outbox.updateMany.mockResolvedValue({ count: 2 });
    await expect(dispatchCdcOutboxToVersions("aws-fixer"))
      .rejects.toThrow(/outbox contention/);
    expect(db.versions.upsert).not.toHaveBeenCalled();
  });

  it("makes no writes for empty outbox, and bounds scan size", async () => {
    db.outbox.findMany.mockResolvedValue([]);
    expect(await dispatchCdcOutboxToVersions("aws-fixer", 25))
      .toEqual({ delivered: 0, versions: [] });
    expect(db.outbox.findMany.mock.calls[0][0].take).toBe(25);
    expect(db.outbox.updateMany).not.toHaveBeenCalled();
    expect(db.versions.upsert).not.toHaveBeenCalled();
  });

  it("never serializes BigInt versions as JSON numbers", async () => {
    expect(await readCdcEmployerVersion("aws-fixer", "TENANT-A")).toBe("4");
    db.versions.findUnique.mockResolvedValue(null);
    expect(await readCdcEmployerVersion("aws-fixer", "TENANT-A")).toBe("0");
  });

  it("requires identity, MFA and employer authorization before durable-version access", () => {
    const code = readFileSync("src/server.ts", "utf8") as string;
    const at = code.indexOf('"/api/employers/:employerId/source-changes/version"');
    expect(at).toBeGreaterThan(-1);
    const route = code.slice(at, at + 1900);
    expect(route.indexOf("requireUser(req, reply)")).toBeLessThan(route.indexOf("readCdcEmployerVersion("));
    expect(route.indexOf("canViewEmployer(user, req.params.employerId)"))
      .toBeLessThan(route.indexOf("readCdcEmployerVersion("));
    expect(route.indexOf("hasVerifiedMfaSession(req, user.id)"))
      .toBeLessThan(route.indexOf("readCdcEmployerVersion("));
    expect(route.indexOf("sourceDeletedAt: null"))
      .toBeLessThan(route.indexOf("readCdcEmployerVersion("));
    expect(route).toContain('DIRECT_MYSQL_CDC_SSE_ENABLED !== "true"');
    expect(route).toContain("DIRECT_MYSQL_CDC_SOURCE_ID");
    expect(route).toContain('Cache-Control", "private, no-store"');
  });

  it("refuses malformed source ids and oversized dispatch requests", async () => {
    await expect(dispatchCdcOutboxToVersions("", 100)).rejects.toThrow(/source ID/);
    await expect(dispatchCdcOutboxToVersions("aws-fixer", 101)).rejects.toThrow(/batch size/);
    await expect(readCdcEmployerVersion("aws-fixer", "")).rejects.toThrow(/employer reference/);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
