// Error responses must not disclose connection credentials or internal traces.
const internalDetail = /[a-z][a-z0-9+.-]*:\/\/[^\s/]+:[^\s@]+@|(?:postgres(?:ql)?|mysql|mssql|sqlserver):\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|secret|authToken|authorization|access[_-]?token|token|api[_-]?key)\s*[:=]|node_modules[\\/]|PrismaClient|\bInvalid[\s\S]*?invocation|\bat\s+[^\n]+\.[cm]?[jt]s:\d+/i;
export function browserSafeFailure(value: unknown, depth = 0): unknown {
  if (depth > 24) return "[redacted]";
  if (typeof value === 'string') return internalDetail.test(value)
    ? 'Operation failed. Review server diagnostics for details.' : value;
  if (Array.isArray(value)) return value.map(item => browserSafeFailure(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(?:stack|query|connectionString|password|sqlPassword|smtpPassword|authToken|apiKey|secret)$/i.test(key)
      ? '[redacted]' : browserSafeFailure(item, depth + 1),
  ]));
  return value;
}
