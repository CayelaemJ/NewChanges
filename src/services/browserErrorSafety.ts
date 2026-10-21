// Error responses must not disclose connection credentials or internal traces.
const internalDetail = /(?:postgres(?:ql)?|mysql|mssql|sqlserver):\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|secret|authToken|api[_-]?key)\s*[:=]|node_modules[\\/]|PrismaClient|\bInvalid[\s\S]*?invocation|\bat\s+[^\n]+\.[cm]?[jt]s:\d+/i;
export function browserSafeFailure(value: unknown): unknown {
  if (typeof value === 'string') return internalDetail.test(value)
    ? 'Operation failed. Review server diagnostics for details.' : value;
  if (Array.isArray(value)) return value.map(browserSafeFailure);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(?:stack|query|connectionString|password|sqlPassword|smtpPassword|authToken|apiKey|secret)$/i.test(key)
      ? '[redacted]' : browserSafeFailure(item),
  ]));
  return value;
}
