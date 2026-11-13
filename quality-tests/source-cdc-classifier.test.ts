import { describe, expect, it } from "vitest";
import { classifySourceRowChange } from "../src/services/sourceCdcClassifier.js";

describe("canonical MySQL ROW-binlog change classification", () => {
  it("invalidates all employer periods after a rating that affects cumulative KPIs", () => {
    expect(classifySourceRowChange({
      feed: "ratings", operation: "INSERT",
      after: { employer_ref: "VIG", created_at: "2026-11-13" },
    })).toEqual([{ feed: "ratings", employerRef: "VIG", period: null }]);
  });

  it("invalidates later periods as well as the start and completion months", () => {
    expect(classifySourceRowChange({
      feed: "journeys", operation: "INSERT",
      after: { employer_ref: "VIG", started_at: "2026-09-22", completed_at: "2026-11-03" },
    })).toEqual([{ feed: "journeys", employerRef: "VIG", period: null }]);
  });

  it("conservatively invalidates all employer periods after an historical correction", () => {
    expect(classifySourceRowChange({
      feed: "debt_accounts", operation: "UPDATE",
      before: { employer_ref: "VIG" }, after: { employer_ref: "VIG" },
    })).toEqual([{ feed: "debt_accounts", employerRef: "VIG", period: null }]);
  });

  it("invalidates both employers after reassignment, including the old tenant", () => {
    expect(classifySourceRowChange({
      feed: "policies", operation: "UPDATE",
      before: { employer_ref: "OLD" }, after: { employer_ref: "NEW" },
    })).toEqual([
      { feed: "policies", employerRef: "OLD", period: null },
      { feed: "policies", employerRef: "NEW", period: null },
    ]);
  });

  it("treats delete and ambiguous dates conservatively", () => {
    expect(classifySourceRowChange({
      feed: "salary_advances", operation: "DELETE",
      before: { employer_ref: "VIG" },
    })).toEqual([{ feed: "salary_advances", employerRef: "VIG", period: null }]);
    expect(classifySourceRowChange({
      feed: "ratings", operation: "INSERT",
      after: { employer_ref: "VIG", created_at: "2026-02-30" },
    })).toEqual([{ feed: "ratings", employerRef: "VIG", period: null }]);
  });

  it("refuses missing before-images rather than silently leaving old employers stale", () => {
    expect(() => classifySourceRowChange({
      feed: "journeys", operation: "UPDATE", after: { employer_ref: "NEW" },
    })).toThrow(/before-image/);
    expect(() => classifySourceRowChange({
      feed: "policies", operation: "DELETE",
    })).toThrow(/before-image/);
    expect(() => classifySourceRowChange({
      feed: "unknown" as any, operation: "INSERT", after: { employer_ref: "VIG" },
    })).toThrow(/canonical feed/);
  });

  it("sends no employee row payload in invalidation hints", () => {
    const result = classifySourceRowChange({
      feed: "employees", operation: "INSERT", after: { employer_ref: "VIG" },
    });
    expect(result).toEqual([{ feed: "employees", employerRef: "VIG", period: null }]);
    expect(JSON.stringify(result)).not.toContain("payroll_ref");
  });
});
