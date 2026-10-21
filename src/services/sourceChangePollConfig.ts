// Pure, side-effect-free runtime interval parsing for SQL source change watch.
// A shorter interval checks MAX(source_updated_at), never forces full refresh.
export function sourceChangePollSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SOURCE_CHANGE_POLL_SECONDS;
  const parsed = raw == null || raw.trim() === "" ? 60 : Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return 60;
  // Fifteen-second mode is explicitly opt-in for isolated latency tests;
  // normal deployments retain the cheaper 30-second minimum/60s default.
  const minSeconds=env.ENABLE_SEMANTIC_FAST_SOURCE_WATCH==="true" && env.STANDBY_MODE!=="true" ? 15 : 30;
  return Math.max(minSeconds, Math.min(3600, parsed));
}

