// Zero-paid-service alternative to Cloudflare Containers.
// Cloudflare is the public entry point; the unmodified Fastify app runs on Render.
// This is NOT an always-running backend: Render Free sleeps after inactivity.
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function evaluateFreeEdgeConfig(env, incomingHost) {
  const host = String(incomingHost || "").toLowerCase();
  const canonical = String(env.NEWCHANGES_CANONICAL_HOST || "").toLowerCase();
  if (env.NEWCHANGES_FREE_EDGE_ENABLED !== "true")
    return { ready: false, reason: "disabled" };
  if (typeof env.NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET !== "string" ||
      env.NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET.length < 32)
    return { ready: false, reason: "private_origin_token_missing" };
  if (!canonical || !/^[a-z0-9.-]+$/.test(canonical) || canonical.includes("..") ||
      host !== canonical)
    return { ready: false, reason: "hostname_not_approved" };
  let origin;
  try {
    origin = new URL(String(env.NEWCHANGES_RENDER_ORIGIN || ""));
  } catch {
    return { ready: false, reason: "origin_missing" };
  }
  if (origin.protocol !== "https:" || !/^[a-z0-9-]+\.onrender\.com$/.test(origin.hostname) ||
      origin.port || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash)
    return { ready: false, reason: "origin_not_approved" };
  return { ready: true, origin: origin.origin, canonical };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const gate = evaluateFreeEdgeConfig(env, url.hostname);
    if (url.pathname === "/__migration/status") {
      return new Response(JSON.stringify({
        application: "NewChanges",
        mode: "cloudflare-free-edge-render-backend",
        configured: gate.ready
      }), { status: 200, headers });
    }
    if (!gate.ready)
      return new Response(JSON.stringify({ error: "NewChanges free edge is not active" }), {
        status: 503, headers
      });

    const target = new URL(url.pathname + url.search, gate.origin);
    const h = new Headers(request.headers);
    // Never send the browser's Host or spoofed forwarding headers upstream.
    for (const key of ["host", "x-forwarded-for", "x-forwarded-host",
      "x-forwarded-proto", "x-real-ip", "forwarded", "cf-connecting-ip",
      "x-newchanges-edge-token"])
      h.delete(key);
    h.set("X-Forwarded-Host", gate.canonical);
    h.set("X-Forwarded-Proto", "https");
    h.set("X-NewChanges-Edge-Token", env.NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET);
    // The backend must still authenticate, authorize and rate-limit requests.
    const upstreamRequest = new Request(target, {
      method: request.method,
      headers: h,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
      // Streaming upload is supported by Workers and Node-compatible Request.
      ...(request.body ? { duplex: "half" } : {})
    });
    try {
      const response = await fetch(upstreamRequest, { redirect: "manual" });
      const outHeaders = new Headers(response.headers);
      outHeaders.set("Cache-Control", "no-store");
      outHeaders.set("X-Content-Type-Options", "nosniff");
      const location = outHeaders.get("Location");
      if (location) {
        try {
          const destination = new URL(location, gate.origin);
          if (destination.origin === gate.origin) {
            destination.protocol = "https:";
            destination.host = gate.canonical;
            outHeaders.set("Location", destination.toString());
          }
        } catch { /* Preserve invalid-location handling in the browser. */ }
      }
      // Forward Set-Cookie and streaming bodies without converting to JSON.
      return new Response(response.body, {
        status: response.status, statusText: response.statusText, headers: outHeaders
      });
    } catch {
      return new Response(JSON.stringify({
        error: "Backend temporarily unavailable",
        detail: "Free hosting can require a cold start. Retry shortly."
      }), { status: 503, headers: { ...headers, "Retry-After": "60" } });
    }
  }
};
