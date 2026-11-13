import { describe, expect, it } from "vitest";
import { LOAD_ORDER } from "../src/services/reportFormats.js";
import {
  CdcTransactionAssembler, type CdcPhysicalTableBinding,
} from "../src/services/sourceCdcBinlogAssembler.js";

const bindings: CdcPhysicalTableBinding[] = LOAD_ORDER.map(feed => ({
  schema: "ingest_stage", table: "physical_" + feed, feed,
}));
const at = (position: number) => ({ filename: "mysql-bin.000010", position });
function assembler() {
  return new CdcTransactionAssembler("aws-fixer", "mysql-bin.000010:100", bindings);
}
const change = {
  kind: "ROWS" as const, at: at(140),
  schema: "ingest_stage", table: "physical_journeys",
  operation: "INSERT" as const,
  rows: [{ after: { employer_ref: "VIG" } }],
};

describe("strict physical-table MySQL ROW binlog assembler", () => {
  it("emits only after COMMIT, then awaits a durable checkpoint acknowledgement", () => {
    const parser = assembler();
    expect(parser.accept({ kind: "BEGIN", at: at(120) })).toBeNull();
    expect(parser.accept(change)).toBeNull();
    const result = parser.accept({ kind: "COMMIT", at: at(180) });
    expect(result).toMatchObject({
      committed: true, sourceId: "aws-fixer",
      fromCursor: "mysql-bin.000010:100",
      toCursor: "mysql-bin.000010:180",
      changes: [{ feed: "journeys", operation: "INSERT", after: { employer_ref: "VIG" } }],
    });
    expect(() => parser.accept({ kind: "BEGIN", at: at(190) }))
      .toThrow(/Persist prior binlog commit/);
    parser.acknowledge(result!);
    expect(parser.accept({ kind: "BEGIN", at: at(190) })).toBeNull();
  });
  it("refuses partial and unknown physical table mappings", () => {
    expect(() => new CdcTransactionAssembler(
      "aws-fixer", "mysql-bin.000010:100", bindings.slice(0, 9),
    )).toThrow(/All ten/);
    const parser = assembler();
    parser.accept({ kind: "BEGIN", at: at(120) });
    expect(() => parser.accept({ ...change, table: "unknown" }))
      .toThrow(/Unmapped source table/);
  });
  it("refuses missing update/deletion images", () => {
    const parser = assembler();
    parser.accept({ kind: "BEGIN", at: at(120) });
    expect(() => parser.accept({
      ...change, operation: "UPDATE", rows: [{ after: { employer_ref: "VIG" } }],
    })).toThrow(/before\/after/);
  });
  it("rejects incomplete source transaction on disconnect", () => {
    const parser = assembler();
    parser.accept({ kind: "BEGIN", at: at(120) });
    parser.accept(change);
    expect(() => parser.assertComplete()).toThrow(/unresolved transaction/);
  });
  it("rejects duplicate or backward positions instead of skipping source changes", () => {
    const parser = assembler();
    parser.accept({ kind: "BEGIN", at: at(120) });
    expect(() => parser.accept({ ...change, at: at(120) }))
      .toThrow(/strictly ordered/);
  });
  it("durably checkpoints rollback as an empty committed envelope", () => {
    const parser = assembler();
    parser.accept({ kind: "BEGIN", at: at(120) });
    const rollback = parser.accept({ kind: "ROLLBACK", at: at(140) });
    expect(rollback).toMatchObject({
      toCursor: "mysql-bin.000010:140", changes: [],
    });
    expect(() => parser.assertComplete()).toThrow(/unresolved transaction/);
    parser.acknowledge(rollback!);
    expect(() => parser.assertComplete()).not.toThrow();
  });
  it("rejects unknown decoded features, including compressed transaction payloads", () => {
    const parser = assembler();
    expect(() => parser.accept({
      kind: "UNSUPPORTED", at: at(120), reason: "transactionpayload compression",
    })).toThrow(/Unsupported MySQL binlog event/);
  });
});
