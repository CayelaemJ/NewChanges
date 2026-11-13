/**
 * Decoder-neutral implementation of CommittedTransactionReader.
 *
 * Vendor-specific MySQL binlog clients are NOT installed or started here.
 * A decoded event stream must enforce source continuity, verified event
 * integrity, and correct physical table names BEFORE calling this adapter.
 */
import type { CommittedTransactionReader } from "./sourceCdcSession.js";
import type { CommittedSourceTransaction } from "./sourceCdcTransactionAdapter.js";
import {
  CdcTransactionAssembler, type CdcDecodedEvent, type CdcPhysicalTableBinding,
} from "./sourceCdcBinlogAssembler.js";

export interface DecodedSourceEventProvider {
  open(cursor: string, signal: AbortSignal): AsyncIterable<CdcDecodedEvent>;
}

export function createDecodedCdcTransactionReader(
  sourceId: string,
  bindings: readonly CdcPhysicalTableBinding[],
  provider: DecodedSourceEventProvider,
): CommittedTransactionReader {
  return {
    async *open(cursor: string, signal: AbortSignal): AsyncIterable<CommittedSourceTransaction> {
      if (signal.aborted) throw new Error("CDC reader aborted");
      const assembler = new CdcTransactionAssembler(sourceId, cursor, bindings);
      // The async generator resumes only after its consumer finishes handling
      // the yielded envelope. A reader reopening after failure must use the
      // persisted checkpoint; acknowledging here changes only local parsing.
      for await (const event of provider.open(cursor, signal)) {
        if (signal.aborted) throw new Error("CDC reader aborted");
        const transaction = assembler.accept(event);
        if (transaction) {
          yield transaction;
          // This local acknowledgement does not persist anything. The caller
          // must have successfully stored the transaction before requesting
          // another item from this iterator.
          assembler.acknowledge(transaction);
        }
      }
      assembler.assertComplete();
    },
  };
}
