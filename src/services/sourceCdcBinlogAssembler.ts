/**
 * Strict parser-neutral MySQL binlog transaction assembler.
 *
 * This module NEVER opens a replication connection. A verified decoder must
 * supply accurate ordered physical-table events, explicit BEGIN/COMMIT, and
 * complete row before/after images. Binlog files contain TABLE changes,
 * NOT updates to derived reporting views (v_employers, etc).
 *
 * It refuses unsupported DDL/anonymous gaps and half-transactions rather
 * than acknowledging a cursor it cannot prove is safely committed.
 */
import { LOAD_ORDER } from "./reportFormats.js";
import type { CanonicalFeed } from "./sourceInvalidationHub.js";
import type { SourceRowChange, SourceRowMetadata } from "./sourceCdcClassifier.js";
import type { CommittedSourceTransaction } from "./sourceCdcTransactionAdapter.js";

type ChangeOp = "INSERT" | "UPDATE" | "DELETE";
type Position = { filename: string; position: number };
export type CdcDecodedEvent =
  | { kind: "BEGIN"; at: Position }
  | { kind: "ROWS"; at: Position; schema: string; table: string; operation: ChangeOp;
      rows: readonly { before?: SourceRowMetadata; after?: SourceRowMetadata }[] }
  | { kind: "COMMIT"; at: Position }
  | { kind: "ROLLBACK"; at: Position }
  | { kind: "ROTATE"; at: Position; nextFilename: string }
  | { kind: "UNSUPPORTED"; at: Position; reason: string };

export interface CdcPhysicalTableBinding {
  /** Actual MySQL table name; never a reporting view. */
  schema: string;
  table: string;
  feed: CanonicalFeed;
}
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BINLOG = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_ROWS = 256;
const MAX_TABLES = 128;

function positionString(pos: Position): string {
  if (!BINLOG.test(pos.filename) ||
      !Number.isSafeInteger(pos.position) || pos.position < 4)
    throw new Error("Invalid MySQL binlog event position");
  return pos.filename + ":" + String(pos.position);
}
function parseCursor(cursor: string): Position {
  const sep = cursor.lastIndexOf(":");
  if (sep <= 0) throw new Error("CDC requires an explicit persisted binlog cursor");
  const value = Number(cursor.slice(sep + 1));
  const pos = { filename: cursor.slice(0, sep), position: value };
  if (positionString(pos) !== cursor)
    throw new Error("Invalid MySQL binlog resume cursor");
  return pos;
}
function mapKey(schema: string, table: string): string {
  if (!IDENT.test(schema) || !IDENT.test(table)) throw new Error("Invalid physical source table");
  return schema + "." + table;
}

/** Schema mappings must be independently reviewed against SHOW TABLES and binlog events. */
export class CdcTransactionAssembler {
  private readonly bindings = new Map<string, Set<CanonicalFeed>>();
  private committedCursor: string;
  private lastSeen: Position;
  private inTransaction = false;
  private changes: SourceRowChange[] = [];
  private changedRows = 0;
  private awaitingDurability: CommittedSourceTransaction | null = null;

  constructor(
    private readonly sourceId: string,
    initialCursor: string,
    physicalTables: readonly CdcPhysicalTableBinding[],
  ) {
    if (!sourceId || sourceId.length > 128) throw new Error("Invalid CDC source ID");
    this.lastSeen = parseCursor(initialCursor);
    this.committedCursor = initialCursor;
    if (!physicalTables.length || physicalTables.length > MAX_TABLES)
      throw new Error("Explicit canonical physical table mappings are required");
    const covered = new Set<CanonicalFeed>();
    for (const binding of physicalTables) {
      if (!LOAD_ORDER.includes(binding.feed)) throw new Error("Unknown canonical feed mapping");
      const key = mapKey(binding.schema, binding.table);
      if (!this.bindings.has(key)) this.bindings.set(key, new Set());
      if (this.bindings.get(key)!.has(binding.feed))
        throw new Error("Duplicate physical table/feed mapping");
      this.bindings.get(key)!.add(binding.feed);
      covered.add(binding.feed);
    }
    if (covered.size !== LOAD_ORDER.length)
      throw new Error("All ten canonical feeds need verified physical table mappings");
  }

  accept(event: CdcDecodedEvent): CommittedSourceTransaction | null {
    if (this.awaitingDurability) throw new Error("Persist prior binlog commit before accepting next event");
    const cursor = positionString(event.at);
    if (event.kind === "UNSUPPORTED")
      throw new Error("Unsupported MySQL binlog event: " + event.reason.slice(0, 100));
    if (event.kind === "ROTATE") {
      if (this.inTransaction) throw new Error("Binlog rotation during uncommitted transaction");
      if (!BINLOG.test(event.nextFilename)) throw new Error("Invalid next binlog file");
      // A decoder must verify rotation continuity, file identity and purge
      // status. This assembler only prevents blind position reuse.
      if (event.at.filename !== this.lastSeen.filename ||
          event.at.position <= this.lastSeen.position)
        throw new Error("Invalid binlog rotation position");
      this.lastSeen = { filename: event.nextFilename, position: 4 };
      return null;
    }
    if (event.at.filename !== this.lastSeen.filename ||
        event.at.position <= this.lastSeen.position)
      throw new Error("MySQL binlog events are not strictly ordered");
    this.lastSeen = event.at;
    if (event.kind === "BEGIN") {
      if (this.inTransaction) throw new Error("Nested MySQL transaction");
      this.inTransaction = true;
      this.changes = [];
      this.changedRows = 0;
      return null;
    }
    if (!this.inTransaction) throw new Error("MySQL event without active BEGIN");
    if (event.kind === "ROLLBACK") {
      this.inTransaction = false;
      this.changes = [];
      this.changedRows = 0;
      // An explicit rollback also advances the source cursor, but a
      // consumer must durably checkpoint it through an empty committed
      // envelope rather than skip untracked transactions.
      const rollbackMarker: CommittedSourceTransaction = {
        committed: true, sourceId: this.sourceId,
        fromCursor: this.committedCursor, toCursor: cursor, changes: [],
      };
      this.awaitingDurability = rollbackMarker;
      return rollbackMarker;
    }
    if (event.kind === "ROWS") {
      const feeds = this.bindings.get(mapKey(event.schema, event.table));
      if (!feeds?.size) throw new Error("Unmapped source table changed; CDC coverage uncertain");
      if (!Array.isArray(event.rows) || event.rows.length === 0)
        throw new Error("Empty MySQL row event");
      this.changedRows += event.rows.length;
      if (this.changedRows > MAX_ROWS) throw new Error("Unbounded MySQL transaction row count");
      for (const row of event.rows) {
        if (event.operation === "INSERT" && !row.after ||
            event.operation === "DELETE" && !row.before ||
            event.operation === "UPDATE" && (!row.before || !row.after))
          throw new Error("Missing full MySQL row before/after image");
        for (const feed of feeds) {
          this.changes.push({ feed, operation: event.operation,
            before: row.before ?? null, after: row.after ?? null });
        }
      }
      return null;
    }
    this.inTransaction = false;
    const transaction: CommittedSourceTransaction = {
      committed: true, sourceId: this.sourceId,
      fromCursor: this.committedCursor, toCursor: cursor,
      changes: [...this.changes],
    };
    this.changes = [];
    this.changedRows = 0;
    this.awaitingDurability = transaction;
    // This parser remains a single-use source of candidate envelopes.
    // The caller must not hand it new events until commitCdcBatch has
    // succeeded. Its next cursor is updated only via acknowledge().
    return transaction;
  }

  acknowledge(transaction: CommittedSourceTransaction): void {
    if (this.awaitingDurability !== transaction ||
        transaction.sourceId !== this.sourceId ||
        transaction.fromCursor !== this.committedCursor ||
        transaction.toCursor !== positionString(this.lastSeen))
      throw new Error("Refusing unsafe binlog acknowledgement");
    this.committedCursor = transaction.toCursor;
    this.awaitingDurability = null;
  }

  assertComplete(): void {
    if (this.inTransaction || this.awaitingDurability)
      throw new Error("MySQL stream ended with unresolved transaction");
  }
}
