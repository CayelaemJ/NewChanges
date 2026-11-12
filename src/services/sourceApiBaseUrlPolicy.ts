// Source base URLs are configuration, not request URLs. Query strings in a
// base URL can carry tokens and may be copied into labels, logs and audit text.
export function assertSourceApiBaseUrlHasNoQuery(url: URL): void {
  if (url.search)
    throw new Error("Source API base URL must not include query parameters. Configure the API token separately.");
}
