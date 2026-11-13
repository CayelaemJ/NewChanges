import { describe, expect, it, vi } from "vitest";
import { LOAD_ORDER } from "../src/services/reportFormats.js";
import { createDecodedCdcTransactionReader } from "../src/services/sourceCdcDecodedReader.js";
import type { CdcDecodedEvent } from "../src/services/sourceCdcBinlogAssembler.js";

const bindings = LOAD_ORDER.map(feed => ({
  schema: "ingest_stage", table: "physical_" + feed, feed,
}));
const at = (position: number) => ({ filename: "mysql-bin.000011", position });
const changes: CdcDecodedEvent[] = [
  { kind: "BEGIN", at: at(110) },
  { kind: "ROWS", at: at(135), schema: "ingest_stage",
    table: "physical_ratings", operation: "INSERT",
    rows: [{ after: { employer_ref: "EMP-1" } }] },
  { kind: "COMMIT", at: at(150) },
  { kind: "BEGIN", at: at(180) },
  { kind: "COMMIT", at: at(200) },
];

describe("committed event reader from verified decoder events", () => {
  it("resumes from supplied durable cursor and yields complete transactions only", async () => {
    const open = vi.fn(async function* () {
      for (const event of changes) yield event;
    });
    const reader = createDecodedCdcTransactionReader("aws-fixer", bindings, { open });
    const controller = new AbortController();
    const frames = [];
    for await (const frame of reader.open("mysql-bin.000011:100", controller.signal))
      frames.push(frame);
    expect(open).toHaveBeenCalledWith("mysql-bin.000011:100", controller.signal);
    expect(frames).toMatchObject([
      { fromCursor: "mysql-bin.000011:100", toCursor: "mysql-bin.000011:150",
        changes: [{ feed: "ratings", operation: "INSERT" }] },
      { fromCursor: "mysql-bin.000011:150", toCursor: "mysql-bin.000011:200", changes: [] },
    ]);
  });
  it("stops without acknowledging a transaction after downstream consumer fails", async () => {
    const provider = { open: async function* () {
      for (const event of changes) yield event;
    } };
    const reader = createDecodedCdcTransactionReader("aws-fixer", bindings, provider);
    const iterator = reader.open("mysql-bin.000011:100", new AbortController().signal)[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value?.toCursor).toBe("mysql-bin.000011:150");
    await iterator.return?.();
    // A fresh invocation must still start at the externally stored cursor.
    const second = reader.open("mysql-bin.000011:100", new AbortController().signal);
    expect((await second[Symbol.asyncIterator]().next()).value?.fromCursor)
      .toBe("mysql-bin.000011:100");
  });
  it("rejects incomplete transactions when source stream ends unexpectedly", async () => {
    const provider = { open: async function* () {
      yield changes[0];
      yield changes[1];
    } };
    const reader = createDecodedCdcTransactionReader("aws-fixer", bindings, provider);
    await expect((async () => {
      for await (const _ of reader.open("mysql-bin.000011:100", new AbortController().signal)) { /* none */ }
    })()).rejects.toThrow(/unresolved transaction/);
  });
});
