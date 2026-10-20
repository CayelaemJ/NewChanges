// A fallback must represent the requested cohort. Never relabel an unfiltered
// latest snapshot as a historical/site/income selection when rebuilding fails.
export function publishedCohortMatches(payload: any, query: {
  period?: string; quarter?: string; range?: string; site?: string; income?: string;
}) {
  const context = payload?.filterContext;
  if (!context) return false;
  const dimension = (value?: string | null) => !value || value === "all" ? null : value;
  if (dimension(query.site) !== dimension(context.site) || dimension(query.income) !== dimension(context.income)) return false;
  if (query.period && context.period !== query.period) return false;
  if (query.quarter) return false; // No immutable quarter fallback is captured yet.
  const range = query.range === "30" ? "30d" : query.range === "q" ? "quarter" : query.range;
  if (range && range !== "latest" && context.range !== range) return false;
  return true;
}
