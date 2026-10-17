// Pure, side-effect-free runtime interval parsing for SQL source change watch.
// A shorter interval checks MAX(source_updated_at), never forces full refresh.
export function sourceChangePollSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SOURCE_CHANGE_POLL_SECONDS;
  const parsed = raw == null || raw.trim() === "" ? 60 : Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return 60;
  return Math.max(30, Math.min(3600, parsed));
}
