import { createHash, timingSafeEqual } from "node:crypto";

const HEADER = "x-newchanges-edge-token";

export function evaluateOriginAccess(
  enabled: boolean,
  secret: string | undefined,
  supplied: string | undefined
): boolean {
  if (!enabled) return true;
  if (typeof secret !== "string" || secret.length < 32 ||
      typeof supplied !== "string" || supplied.length !== secret.length)
    return false;
  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(a, b);
}

export function cloudflareOriginAccessAllowed(
  headers: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): boolean {
  return evaluateOriginAccess(
    env.NEWCHANGES_EDGE_ORIGIN_GUARD_ENABLED === "true",
    env.NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET,
    typeof headers[HEADER] === "string" ? headers[HEADER] : undefined
  );
}
