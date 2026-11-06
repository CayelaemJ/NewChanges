// A failed replica initialization must not leave an authenticated primary
// connection open. Close every acquired connection, even if another close fails.
export interface SourceConnectionHandle {
  close(): Promise<void>;
}

export async function closeSourceConnections(
  primary: SourceConnectionHandle | null | undefined,
  replica: SourceConnectionHandle | null | undefined,
  suppressErrors = false,
): Promise<void> {
  const handles = [primary, replica].filter((handle): handle is SourceConnectionHandle => handle != null);
  const results = await Promise.allSettled(handles.map(handle => Promise.resolve().then(() => handle.close())));
  if (!suppressErrors && results.some(result => result.status === "rejected"))
    throw new Error("Source connection cleanup failed.");
}
