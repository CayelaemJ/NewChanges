import { strict as assert } from "node:assert";
import { validateConfig } from "../src/config.js";

const errors = (env: Record<string, string | undefined>) =>
  validateConfig(env).filter((i) => i.level === "error");

// Production without a database is a hard failure.
assert.ok(
  errors({ NODE_ENV: "production" }).some((i) => /DATABASE_URL/.test(i.message)),
  "production without DATABASE_URL must be an error",
);

// A fully configured production environment has no errors.
assert.equal(
  errors({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://u:p@h:5432/db",
    PUBLIC_BASE_URL: "https://portal.example.com",
    CONTACT_EMAIL: "support@example.com",
  }).length,
  0,
  "valid production config must have no errors",
);

// Development without a database only warns (local tooling stays usable).
assert.equal(errors({}).length, 0, "development must not hard-fail on missing DATABASE_URL");

// Malformed values are rejected.
assert.ok(errors({ PUBLIC_BASE_URL: "not a url" }).length > 0, "invalid PUBLIC_BASE_URL must fail");
assert.ok(errors({ PORT: "abc" }).length > 0, "non-numeric PORT must fail");
assert.ok(errors({ COOKIE_SECURE: "maybe" }).length > 0, "invalid boolean must fail");
assert.ok(errors({ CONTACT_EMAIL: "nope" }).length > 0, "invalid CONTACT_EMAIL must fail");

// Valid booleans/ports pass.
assert.equal(errors({ COOKIE_SECURE: "false", TRUST_PROXY: "true", PORT: "3000" }).length, 0);

console.log("config validation tests passed");
