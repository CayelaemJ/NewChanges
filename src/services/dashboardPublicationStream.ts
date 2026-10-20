// One durable-version read per serving process, shared by connected browsers.
// Notifications contain no employer data. Every payload request rechecks access.
export function createDashboardPublicationStream(read: () => Promise<string | null>, pollMs = 5000) {
  const listeners = new Set<(version: string) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let busy = false;
  let previous: string | null | undefined;
  async function poll() {
    if (busy || !listeners.size) return;
    busy = true;
    try {
      const version = await read();
      if (version && version !== previous) {
        previous = version;
        for (const listener of listeners) { try { listener(version); } catch { /* Disconnect is isolated. */ } }
      }
    } catch { /* Retain prior version and retry; HTTP polling remains available. */ }
    finally { busy = false; }
  }
  return {
    subscribe(listener: (version: string) => void) {
      if (listeners.size >= 200) return null;
      listeners.add(listener);
      if (!timer) { timer = setInterval(() => void poll(), pollMs); timer.unref?.(); }
      if (previous) listener(previous);
      void poll();
      return () => {
        listeners.delete(listener);
        if (!listeners.size && timer) { clearInterval(timer); timer = undefined; previous = undefined; }
      };
    },
  };
}
