import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCdcFeedSummaryPublisher,
  type CdcFeedReader,
} from "../src/services/ingestStageCdcFeedPublication.js";
import {
  readCdcMysqlView,
  type CdcMysqlQueryConnection,
  type CdcMysqlReaderSettings,
  type VerifiedEmployerScope,
} from "../src/services/ingestStageCdcMysqlReader.js";
import { getFormat } from "../src/services/reportFormats.js";

const settings: CdcMysqlReaderSettings = {
  sourceId: "ingest_stage_rds",
  featureEnabled: true,
  accessReviewed: true,
  snapshotVerified: true,
  hostname: "fixture.abcdef.eu-north-1.rds.amazonaws.com",
  port: 3306,
  username: "cdc_readonly",
  password: "SYNTHETIC_TEST_ONLY",
  caCertificatePath: "/not-used-by-mocks.pem",
  queryTimeoutMs: 10000,
  maxRows: 10,
};
const employerScope: VerifiedEmployerScope = { sourceId: "ingest_stage_rds", tenantId: "tenant_a", authorizedEmployerRefs: ["VIG"] };

function reading(rows = [{ employer_ref: "VIG", payroll_ref: "MUST_NOT_CACHE" }]) {
  let calls = 0;
  const read: CdcFeedReader = async (feed, employerRef) => {
    calls++;
    return {
      sourceId: "ingest_stage_rds", tenantId: "tenant_a", feed, employerRef, source: "MYSQL_READ_ONLY", complete: true,
      records: rows,
    };
  };
  return { read, calls: () => calls };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    feed: "employees",
    employerRef: "VIG",
    scope: employerScope,
    generation: 1,
    settings,
    ...overrides,
  };
}

test("reader-to-publication integration returns only scoped metadata after read-only SQL", async () => {
  const statements: string[] = [];
  let closed = false;
  const connection: CdcMysqlQueryConnection = {
    async query(command) {
      const sql = typeof command === "string" ? command : command.sql;
      statements.push(sql);
      if (sql.includes("information_schema.COLUMNS")) {
        return [getFormat("employees")!.fields.map(field => ({
          COLUMN_NAME: field.name,
        })), []];
      }
      if (sql.startsWith("SELECT ") && sql.includes(" FROM ")) {
        return [[{
          employer_ref: "VIG", payroll_ref: "PRIVATE_EMPLOYEE_REF",
          source_updated_at: null,
        }], []];
      }
      return [[], []];
    },
    async end() { closed = true; },
  };
  const read: CdcFeedReader = (feed, employerRef, scope, cfg) =>
    readCdcMysqlView(feed, employerRef, scope, cfg, async () => connection);
  const pub = createCdcFeedSummaryPublisher({ read });
  const published = await pub.publish(input());
  assert.deepEqual({
    feed: published.feed, employerRef: published.employerRef,
    generation: published.generation, rowCount: published.rowCount,
  }, {
    feed: "employees", employerRef: "VIG", generation: 1, rowCount: 1,
  });
  assert(!JSON.stringify(published).includes("PRIVATE_EMPLOYEE_REF"));
  assert(statements.includes("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"));
  assert(statements.includes("ROLLBACK"));
  assert(!statements.some(sql => /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|GRANT)\s/i.test(sql)));
  assert(closed);
});

test("one authorized read publishes only count and monotonic generation", async () => {
  const r = reading();
  const pub = createCdcFeedSummaryPublisher({ read: r.read, now: () => 12000 });
  const summary = await pub.publish(input());
  assert.deepEqual(summary, {
    sourceId: "ingest_stage_rds", tenantId: "tenant_a",
    feed: "employees", employerRef: "VIG",
    generation: 1, rowCount: 1, publishedAtMs: 12000,
  });
  assert.equal(r.calls(), 1);
  assert(Object.isFrozen(summary));
  assert(!JSON.stringify(summary).includes("MUST_NOT_CACHE"));
  assert.deepEqual(pub.get("employees", "VIG", employerScope), summary);
});

test("same generation and fresh cache never repeat the expensive view read", async () => {
  const r = reading();
  const pub = createCdcFeedSummaryPublisher({ read: r.read });
  const first = await pub.publish(input());
  const replay = await pub.publish(input());
  assert.equal(first, replay);
  assert.equal(r.calls(), 1);
});

test("all ten feeds are independently scoped and supported", async () => {
  const feeds = [
    "employers", "workforce_snapshots", "employees", "platform_users",
    "journeys", "debt_accounts", "policies", "ratings", "referrals", "salary_advances",
  ];
  const r = reading();
  const pub = createCdcFeedSummaryPublisher({ read: r.read });
  for (const feed of feeds) {
    const result = await pub.publish(input({ feed }));
    assert.equal(result.feed, feed);
  }
  assert.equal(r.calls(), 10);
  assert.equal(pub.get("employees", "VIG", employerScope)?.feed, "employees");
});

test("scope and feature gates run before a database read or cached response", async () => {
  const r = reading();
  const pub = createCdcFeedSummaryPublisher({ read: r.read });
  await assert.rejects(pub.publish(input({
    scope: { ...employerScope, authorizedEmployerRefs: ["OTHER"] },
  })), /CDC_PUBLICATION_SCOPE_DENIED/);
  await assert.rejects(pub.publish(input({
    settings: { ...settings, featureEnabled: false },
  })), /CDC_PUBLICATION_SOURCE_NOT_APPROVED/);
  await assert.rejects(pub.publish(input({
    settings: { ...settings, snapshotVerified: false },
  })), /CDC_PUBLICATION_SOURCE_NOT_APPROVED/);
  await assert.rejects(pub.publish(input({
    settings: { ...settings, accessReviewed: false },
  })), /CDC_PUBLICATION_SOURCE_NOT_APPROVED/);
  assert.throws(() => pub.get("employees", "VIG", { ...employerScope, authorizedEmployerRefs: ["OTHER"] }),
    /CDC_PUBLICATION_SCOPE_DENIED/);
  assert.equal(r.calls(), 0);
});

test("a failed source read must retain the last successfully published generation", async () => {
  let shouldFail = false;
  const read: CdcFeedReader = async (feed, employerRef) => {
    if (shouldFail) throw new Error("SECRET MYSQL FAILURE MUST_NOT_RETURN");
    return { sourceId: "ingest_stage_rds", tenantId: "tenant_a", feed, employerRef, source: "MYSQL_READ_ONLY", complete: true, records: [] };
  };
  const pub = createCdcFeedSummaryPublisher({ read, now: () => 10000 });
  await pub.publish(input());
  shouldFail = true;
  await assert.rejects(pub.publish(input({ generation: 2 })),
    error => error instanceof Error &&
      error.message === "CDC_PUBLICATION_SOURCE_READ_FAILED" &&
      !error.message.includes("SECRET MYSQL FAILURE"));
  assert.equal(pub.get("employees", "VIG", employerScope)?.generation, 1);
});

test("incomplete or cross-employer source response never overwrites a valid generation", async () => {
  let malformed = false;
  const read: CdcFeedReader = async (feed, employerRef) => {
    if (malformed) return {
      sourceId: "ingest_stage_rds", tenantId: "tenant_a", feed, employerRef, source: "MYSQL_READ_ONLY", complete: true,
      records: [{ employer_ref: "OTHER" }],
    };
    return { sourceId: "ingest_stage_rds", tenantId: "tenant_a", feed, employerRef, source: "MYSQL_READ_ONLY", complete: true, records: [] };
  };
  const pub = createCdcFeedSummaryPublisher({ read, now: () => 10000 });
  await pub.publish(input());
  malformed = true;
  await assert.rejects(pub.publish(input({ generation: 2 })),
    /CDC_PUBLICATION_INCOMPLETE_MYSQL_READ/);
  assert.equal(pub.get("employees", "VIG", employerScope)?.generation, 1);
});

test("batch above configured limit is rejected; no partial feed published", async () => {
  const r = reading(Array.from({ length: 11 }, () => ({ employer_ref: "VIG" })));
  const pub = createCdcFeedSummaryPublisher({ read: r.read });
  await assert.rejects(pub.publish(input()), /CDC_PUBLICATION_INCOMPLETE_MYSQL_READ/);
  assert.equal(pub.get("employees", "VIG", employerScope), null);
});

test("concurrent same employer/feed generation coalesces to one source query", async () => {
  let settle!: () => void;
  let starts = 0;
  const gate = new Promise<void>(resolve => { settle = resolve; });
  const read: CdcFeedReader = async (feed, employerRef) => {
    starts++;
    await gate;
    return { sourceId: "ingest_stage_rds", tenantId: "tenant_a", feed, employerRef, source: "MYSQL_READ_ONLY", complete: true, records: [] };
  };
  const pub = createCdcFeedSummaryPublisher({ read });
  const first = pub.publish(input());
  const second = pub.publish(input());
  settle();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(starts, 1);
  assert.deepEqual(a, b);
});

test("a newer generation during an in-flight read gets an additional read", async () => {
  let settle!: () => void;
  let starts = 0;
  const gate = new Promise<void>(resolve => { settle = resolve; });
  const read: CdcFeedReader = async (feed, employerRef) => {
    starts++;
    if (starts === 1) await gate;
    return { sourceId: "ingest_stage_rds", tenantId: "tenant_a", feed, employerRef, source: "MYSQL_READ_ONLY", complete: true, records: [] };
  };
  const pub = createCdcFeedSummaryPublisher({ read });
  const older = pub.publish(input({ generation: 1 }));
  const newer = pub.publish(input({ generation: 2 }));
  settle();
  await Promise.all([older, newer]);
  assert.equal(starts, 2);
  assert.equal(pub.get("employees", "VIG", employerScope)?.generation, 2);
});

test("cached generations cannot regress, including on another tenant", async () => {
  const r = reading([]);
  const pub = createCdcFeedSummaryPublisher({ read: r.read });
  await pub.publish(input({ generation: 9 }));
  await assert.rejects(pub.publish(input({ generation: 8 })),
    /CDC_PUBLICATION_GENERATION_REGRESSION/);
  await assert.rejects(pub.publish(input({ generation: -1 })),
    /CDC_PUBLICATION_GENERATION_INVALID/);
  await assert.rejects(pub.publish(input({ feed: "mysql.user" })),
    /CDC_PUBLICATION_SCOPE_DENIED/);
  assert.equal(r.calls(), 1);
});

test("time-to-live expiry forces a fresh read without falsely incrementing generation", async () => {
  let now = 10000;
  const r = reading();
  const pub = createCdcFeedSummaryPublisher({ read: r.read, now: () => now, ttlMs: 1000 });
  await pub.publish(input());
  now = 10999;
  assert.equal(pub.get("employees", "VIG", employerScope)?.generation, 1);
  now = 11000;
  assert.equal(pub.get("employees", "VIG", employerScope), null);
  const republished = await pub.publish(input());
  assert.equal(republished.generation, 1);
  assert.equal(r.calls(), 2);
});

test("bounded metadata cache refuses silent eviction and cross-employer mixing", async () => {
  const read: CdcFeedReader = async (feed, employerRef) => ({
    sourceId: "ingest_stage_rds", tenantId: "tenant_a", feed, employerRef, source: "MYSQL_READ_ONLY", complete: true,
    records: [{ employer_ref: employerRef }],
  });
  const pub = createCdcFeedSummaryPublisher({ read, maxCacheEntries: 1 });
  await pub.publish(input());
  await assert.rejects(pub.publish(input({
    feed: "ratings",
  })), /CDC_PUBLICATION_CAPACITY_EXCEEDED/);
  assert.equal(pub.get("ratings", "VIG", employerScope), null);
  assert.equal(pub.get("employees", "VIG", employerScope)?.rowCount, 1);
});

test("concurrent distinct cache misses reserve slots before either completes", async () => {
  let settle!: () => void;
  let started = 0;
  const gate = new Promise<void>(resolve => { settle = resolve; });
  const read: CdcFeedReader = async (feed, employerRef) => {
    started++;
    await gate;
    return { sourceId: "ingest_stage_rds", tenantId: "tenant_a", feed, employerRef, source: "MYSQL_READ_ONLY", complete: true, records: [] };
  };
  const pub = createCdcFeedSummaryPublisher({ read, maxCacheEntries: 1 });
  const first = pub.publish(input());
  await assert.rejects(pub.publish(input({ feed: "ratings" })),
    /CDC_PUBLICATION_CAPACITY_EXCEEDED/);
  settle();
  await first;
  assert.equal(started, 1);
  assert.equal(pub.get("employees", "VIG", employerScope)?.generation, 1);
  assert.equal(pub.get("ratings", "VIG", employerScope), null);
});

test("invalid source budget is refused before the mocked reader is called", async () => {
  const r = reading();
  const pub = createCdcFeedSummaryPublisher({ read: r.read });
  await assert.rejects(pub.publish(input({
    settings: { ...settings, maxRows: Number.NaN },
  })), /CDC_PUBLICATION_SOURCE_BUDGET_INVALID/);
  await assert.rejects(pub.publish(input({
    settings: { ...settings, maxRows: 2001 },
  })), /CDC_PUBLICATION_SOURCE_BUDGET_INVALID/);
  assert.equal(r.calls(), 0);
});

test("metadata cache never exposes another employer just because a feed matches", async () => {
  const read: CdcFeedReader = async (feed, employerRef) => ({
    sourceId: "ingest_stage_rds", tenantId: "tenant_a", feed, employerRef, source: "MYSQL_READ_ONLY", complete: true,
    records: [{ employer_ref: employerRef }],
  });
  const pub = createCdcFeedSummaryPublisher({ read });
  await pub.publish(input());
  const scopeB = { ...employerScope, authorizedEmployerRefs: ["B"] };
  assert.equal(pub.get("employees", "B", scopeB), null);
  const b = await pub.publish(input({ employerRef: "B", scope: scopeB }));
  assert.equal(b.employerRef, "B");
  assert.equal(pub.get("employees", "VIG", employerScope)?.employerRef, "VIG");
});

test("invalid publisher limits fail closed at construction", () => {
  const read = reading().read;
  for (const opts of [{ ttlMs: 0 }, { ttlMs: -1 }, { maxCacheEntries: 0 },
                      { maxCacheEntries: 1025 }])
    assert.throws(() => createCdcFeedSummaryPublisher({ read, ...opts }),
      /CDC_PUBLICATION_CONFIG_INVALID/);
});
