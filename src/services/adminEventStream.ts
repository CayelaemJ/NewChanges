import { randomUUID } from "node:crypto";

export interface AdminStreamEvent {
  id: string;
  type: string;
  jobId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

type Listener = (event: AdminStreamEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function publishAdminEvent(type: string, payload: Record<string, unknown> = {}, jobId?: string) {
  const event: AdminStreamEvent = {
    id: randomUUID(),
    type,
    ...(jobId ? { jobId } : {}),
    payload,
    createdAt: new Date().toISOString(),
  };
  const targets = new Set<Listener>([
    ...(listeners.get("*") ?? []),
    ...(jobId ? (listeners.get(jobId) ?? []) : []),
  ]);
  for (const listener of targets) {
    try { listener(event); } catch {}
  }
  return event;
}

export function subscribeAdminEvents(key: string, listener: Listener) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(key);
  };
}
