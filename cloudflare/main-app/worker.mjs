import { Container } from "@cloudflare/containers";
import { env as secrets } from "cloudflare:workers";
import { evaluateNewChangesPrimary, allowWriteLeadership } from "./gate.mjs";

// Run the *existing* Fastify/Prisma app from NewChanges main, not a React
// rewrite or a proxy to Render/Railway. All routes remain with the actual app.
export class NewChangesMainContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "20m";
  envVars = {
    PORT: "3000",
    NODE_ENV: "production",
    DATABASE_URL: secrets.NEWCHANGES_NEON_DATABASE_URL,
    STANDBY_MODE: allowWriteLeadership(secrets) ? "false" : "true",
    TRAFFIC_SAVER_MODE: "true",
    ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER: "false",
    ENABLE_SEMANTIC_SHADOW_WORKER: "false",
    ENABLE_SEMANTIC_SHADOW_ENQUEUE: "false",
    ENABLE_SEMANTIC_OBJECT_PUBLISH: "false",
    NEWCHANGES_CLOUDFLARE_RUNTIME: "true",
    NEWCHANGES_ALLOW_WRITES: allowWriteLeadership(secrets) ? "true" : "false"
  };
}

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow"
};
export default {
  async fetch(request, env) {
    const host = new URL(request.url).hostname;
    const gate = evaluateNewChangesPrimary(env, host);
    if (new URL(request.url).pathname === "/__migration/status") {
      // No credentials, connection strings, or account identifier are returned.
      return new Response(JSON.stringify({
        application: "NewChanges",
        sourceRepository: "CayelaemJ/NewChanges",
        backendAvailable: gate.ready,
        writeLeader: gate.ready && allowWriteLeadership(env),
        stage: gate.ready ? "candidate" : "disabled"
      }), { status: 200, headers });
    }
    if (!gate.ready)
      return new Response(JSON.stringify({error:"NewChanges primary backend is not yet enabled"}), {
        status:503, headers
      });
    try {
      const container = env.NEWCHANGES_MAIN.getByName("authoritative-app");
      return await container.fetch(request);
    } catch {
      return new Response(JSON.stringify({error:"NewChanges primary backend unavailable"}), {
        status:503, headers
      });
    }
  }
};
