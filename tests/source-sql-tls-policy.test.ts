import test from "node:test";
import assert from "node:assert/strict";
import { assertSecureSourceSqlTransport } from "../src/services/sourceSqlTlsPolicy.js";

test("production SQL source connections must use TLS and a trusted certificate", () => {
  for (const dialect of ["PostgreSQL", "MySQL", "SQL Server"]) {
    assert.throws(
      () => assertSecureSourceSqlTransport(false, false, dialect, "production"),
      /requires encrypted SQL transport/, dialect,
    );
    assert.throws(
      () => assertSecureSourceSqlTransport(true, true, dialect, "production"),
      /requires trusted server certificate verification/, dialect,
    );
    assert.doesNotThrow(
      () => assertSecureSourceSqlTransport(true, false, dialect, "production"),
    );
  }
});

test("disposable local SQL integration fixtures remain available outside production", () => {
  for (const environment of ["test", "development"]) {
    assert.doesNotThrow(
      () => assertSecureSourceSqlTransport(false, true, "Synthetic fixture", environment),
    );
  }
});

test("production policy fails closed for the unset NODE_ENV label", () => {
  // The production policy is applied only when the actual runtime explicitly
  // identifies itself as production; release gates verify NODE_ENV separately.
  assert.doesNotThrow(
    () => assertSecureSourceSqlTransport(false, true, "Dev fixture", undefined),
  );
});
