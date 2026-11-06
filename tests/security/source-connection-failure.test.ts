import test from "node:test";
import assert from "node:assert/strict";
import { safeSourceConnectionFailure } from "../../src/services/sourceConnectionFailure.js";

test("driver and DNS failures are classified without reflecting raw diagnostics", () => {
  for (const [code, label] of [
    ["ECONNREFUSED", "connection refused"],
    ["ETIMEDOUT", "timed out"],
    ["ENOTFOUND", "hostname could not"],
    ["ER_ACCESS_DENIED_ERROR", "rejected the credentials"],
    ["28P01", "rejected the credentials"],
  ]) {
    const error = Object.assign(new Error("postgresql://test:secret@internal.invalid/fixture"), { code });
    const safe = safeSourceConnectionFailure(error);
    assert.match(safe.toLowerCase(), new RegExp(label));
    assert.doesNotMatch(safe, /secret|internal\.invalid/);
  }
});

test("TLS enforcement errors retain a safe, actionable classification", () => {
  assert.equal(safeSourceConnectionFailure(new Error("MySQL read-replica health requires encrypted SQL transport in production")),
    "Source SQL connection requires TLS in production.");
  assert.equal(safeSourceConnectionFailure(new Error("PostgreSQL source requires trusted server certificate verification in production")),
    "Source SQL connection requires trusted certificate verification in production.");
});

test("unknown errors, credentials and arbitrary provider codes are never reflected", () => {
  for (const error of [
    new Error("password=fixture-secret; at src/server.ts:100"),
    new Error("Bearer abcdefghijklmnop"),
    Object.assign(new Error("host:db.private"), { code: "TOKEN=secret" }),
    "postgresql://user:password@db.invalid",
    null,
  ]) {
    assert.equal(safeSourceConnectionFailure(error),
      "Source connection or validation failed. Check configuration and server diagnostics.");
  }
});
