// Pure migration gate shared by edge routing and Node-only negative tests.
// Disabling this gate must not expose the original Fastify backend.
export function evaluateNewChangesPrimary(env, requestedHost) {
  const failures = [];
  const host = String(requestedHost || "").toLowerCase();
  const expectedHost = String(env.NEWCHANGES_CANONICAL_HOST || "").toLowerCase();
  if (!expectedHost || host !== expectedHost || host.includes("/") ||
      host.includes(":") || !/^[a-z0-9.-]+$/.test(host))
    failures.push("NewChanges hostname not configured or mismatched");
  if (env.NEWCHANGES_BACKEND_ENABLED !== "true")
    failures.push("Backend is explicitly disabled");
  if (typeof env.NEWCHANGES_AIVEN_DATABASE_URL !== "string" ||
      !env.NEWCHANGES_AIVEN_DATABASE_URL)
    failures.push("Aiven primary database secret unavailable");
  if (!allowWriteLeadership(env)) failures.push("Cloudflare live primary is not authorized");
  if (!env.NEWCHANGES_MAIN?.getByName)
    failures.push("Cloudflare Container binding unavailable");
  return { ready: failures.length === 0, failures };
}
export function allowWriteLeadership(env) {
  // This flag is intentionally independent of the frontend/backend switch.
  return env.NEWCHANGES_WRITE_LEADER_ENABLED === "true" &&
    env.NEWCHANGES_CUTOVER_APPROVED === "true" &&
    env.NEWCHANGES_DATABASE_PERMISSIONS_VERIFIED === "true" &&
    env.NEWCHANGES_TENANT_E2E_VERIFIED === "true" &&
    env.NEWCHANGES_SOURCE_WRITERS_FENCED === "YES" &&
    env.NEWCHANGES_FINAL_SYNC_VERIFIED === "YES" &&
    env.NEWCHANGES_AIVEN_PRODUCTION_APPROVED === "YES";
}
