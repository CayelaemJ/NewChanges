import test from "node:test";
import assert from "node:assert/strict";
import { effectiveSourceConfig } from "../src/services/sourceAdapter.js";

function withSourceEnv(values: Record<string, string | undefined>, check: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    check();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("saved SQL source and replica settings take precedence when not environment-locked", () => {
  withSourceEnv({
    SOURCE_CONFIG_LOCKED: "false",
    SOURCE_SQL_PASSWORD: "env-primary",
    SOURCE_SQL_SSL: "true",
    SOURCE_SQL_TRUST_SERVER_CERTIFICATE: "true",
    SOURCE_SQL_REPLICA_PASSWORD: "env-replica",
    SOURCE_SQL_REPLICA_SSL: "false",
    SOURCE_SQL_REPLICA_TRUST_SERVER_CERTIFICATE: "true",
    SOURCE_SQL_REPLICA_ENABLED: "true",
  }, () => {
    const resolved = effectiveSourceConfig({
      sqlPassword: "saved-primary",
      sqlSsl: false,
      sqlTrustServerCertificate: false,
      sqlReplicaPassword: "saved-replica",
      sqlReplicaSsl: true,
      sqlReplicaTrustServerCertificate: false,
      sqlReplicaEnabled: false,
    });
    assert.equal(resolved.sqlPassword, "saved-primary");
    assert.equal(resolved.sqlSsl, false);
    assert.equal(resolved.sqlTrustServerCertificate, false);
    assert.equal(resolved.sqlReplicaPassword, "saved-replica");
    assert.equal(resolved.sqlReplicaSsl, true);
    assert.equal(resolved.sqlReplicaTrustServerCertificate, false);
    assert.equal(resolved.sqlReplicaEnabled, false);
  });
});

test("environment-locked SQL source and replica settings take precedence", () => {
  withSourceEnv({
    SOURCE_CONFIG_LOCKED: "true",
    SOURCE_SQL_PASSWORD: "env-primary",
    SOURCE_SQL_SSL: "true",
    SOURCE_SQL_TRUST_SERVER_CERTIFICATE: "false",
    SOURCE_SQL_REPLICA_PASSWORD: "env-replica",
    SOURCE_SQL_REPLICA_SSL: "true",
    SOURCE_SQL_REPLICA_TRUST_SERVER_CERTIFICATE: "false",
    SOURCE_SQL_REPLICA_ENABLED: "true",
  }, () => {
    const resolved = effectiveSourceConfig({
      sqlPassword: "saved-primary",
      sqlSsl: false,
      sqlTrustServerCertificate: true,
      sqlReplicaPassword: "saved-replica",
      sqlReplicaSsl: false,
      sqlReplicaTrustServerCertificate: true,
      sqlReplicaEnabled: false,
    });
    assert.equal(resolved.sqlPassword, "env-primary");
    assert.equal(resolved.sqlSsl, true);
    assert.equal(resolved.sqlTrustServerCertificate, false);
    assert.equal(resolved.sqlReplicaPassword, "env-replica");
    assert.equal(resolved.sqlReplicaSsl, true);
    assert.equal(resolved.sqlReplicaTrustServerCertificate, false);
    assert.equal(resolved.sqlReplicaEnabled, true);
  });
});

test("API token uses the same environment-lock precedence", () => {
  withSourceEnv({ SOURCE_CONFIG_LOCKED: "false", SOURCE_API_TOKEN: "env-token" }, () => {
    assert.equal(effectiveSourceConfig({ authToken: "saved-token" }).authToken, "saved-token");
  });
  withSourceEnv({ SOURCE_CONFIG_LOCKED: "true", SOURCE_API_TOKEN: "env-token" }, () => {
    assert.equal(effectiveSourceConfig({ authToken: "saved-token" }).authToken, "env-token");
  });
});

test("persisted IntegrationConfig analytics-replica columns map to the active adapter", () => {
  withSourceEnv({
    SOURCE_CONFIG_LOCKED: "false",
    SOURCE_SQL_REPLICA_HOST: "env-replica.invalid",
    SOURCE_SQL_REPLICA_PASSWORD: "env-replica-secret",
    SOURCE_SQL_REPLICA_ENABLED: "false",
  }, () => {
    const resolved = effectiveSourceConfig({
      sourceAnalyticsReplicaEnabled: true,
      sourceAnalyticsReplicaHost: "saved-replica.invalid",
      sourceAnalyticsReplicaPort: 3307,
      sourceAnalyticsReplicaDatabase: "reporting",
      sourceAnalyticsReplicaSchema: "analytics",
      sourceAnalyticsReplicaUsername: "replica_reader",
      sourceAnalyticsReplicaPassword: "saved-replica-secret",
      sourceAnalyticsReplicaSsl: true,
      sourceAnalyticsReplicaTrustServerCertificate: false,
      sourceAnalyticsReplicaMaxLagSeconds: 45,
    });
    assert.equal(resolved.sqlReplicaEnabled, true);
    assert.equal(resolved.sqlReplicaHost, "saved-replica.invalid");
    assert.equal(resolved.sqlReplicaPort, 3307);
    assert.equal(resolved.sqlReplicaDatabase, "reporting");
    assert.equal(resolved.sqlReplicaSchema, "analytics");
    assert.equal(resolved.sqlReplicaUsername, "replica_reader");
    assert.equal(resolved.sqlReplicaPassword, "saved-replica-secret");
    assert.equal(resolved.sqlReplicaSsl, true);
    assert.equal(resolved.sqlReplicaTrustServerCertificate, false);
    assert.equal(resolved.sqlReplicaMaxLagSeconds, 45);
  });
});
