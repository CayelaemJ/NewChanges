// A read started before invalidation may finish afterwards. Fence its cache
// write with the generation captured before any asynchronous database work.
export function createPublicationCache<T>(maxEntries = 250) {
  const entries = new Map<string, { expiresAt: number; value: T }>();
  let generation = 0;
  return {
    generation: () => generation,
    get(key: string, now = Date.now()): T | undefined {
      const hit = entries.get(key);
      if (!hit || hit.expiresAt <= now) { entries.delete(key); return undefined; }
      return structuredClone(hit.value);
    },
    set(key: string, value: T, expiresAt: number, expectedGeneration: number) {
      if (expectedGeneration !== generation) return false;
      while (entries.size >= maxEntries && !entries.has(key)) entries.delete(entries.keys().next().value!);
      entries.set(key, { expiresAt, value: structuredClone(value) });
      return true;
    },
    clear() { generation++; entries.clear(); },
    invalidateEmployer(employerId: string) {
      generation++;
      for (const key of entries.keys()) if (key.includes(`,${JSON.stringify(employerId)},`)) entries.delete(key);
    },
  };
}
