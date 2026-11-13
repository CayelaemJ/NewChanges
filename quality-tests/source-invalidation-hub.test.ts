import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createSourceInvalidationHub } from "../src/services/sourceInvalidationHub.js";

describe("bounded and tenant-isolated MySQL CDC invalidation transport", () => {
  it("coalesces changed canonical feeds by employer and period", () => {
    const hub = createSourceInvalidationHub(1_200);
    const received: any[] = [];
    const unsub = hub.subscribe("E-1", hint => received.push(hint));
    expect(unsub).toBeTypeOf("function");
    expect(hub.publish({ feed: "journeys", employerRef: "E-1", period: "2026-11" })).toBe(true);
    expect(hub.publish({ feed: "ratings", employerRef: "E-1", period: "2026-11" })).toBe(true);
    hub.flush();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      employerRef: "E-1", period: "2026-11", feeds: ["journeys", "ratings"],
    });
    expect(received[0]).not.toHaveProperty("row");
    unsub?.();
    hub.stop();
  });

  it("isolates employers and does not publish notifications across tenants", () => {
    const hub = createSourceInvalidationHub();
    const first: any[] = [];
    const second: any[] = [];
    hub.subscribe("EMP-1", n => first.push(n));
    hub.subscribe("EMP-2", n => second.push(n));
    hub.publish({ feed: "policies", employerRef: "EMP-1", period: "2026-10" });
    hub.flush();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    hub.stop();
  });

  it("a tenant-wide correction supersedes queued period hints without losing feed labels", () => {
    const hub = createSourceInvalidationHub();
    const notices: any[] = [];
    hub.subscribe("EMP-1", n => notices.push(n));
    hub.publish({ feed: "debt_accounts", employerRef: "EMP-1", period: "2026-08" });
    hub.publish({ feed: "journeys", employerRef: "EMP-1", period: "2026-09" });
    hub.publish({ feed: "workforce_snapshots", employerRef: "EMP-1", period: null });
    hub.flush();
    expect(notices).toHaveLength(1);
    expect(notices[0].period).toBeNull();
    expect(notices[0].feeds).toEqual(expect.arrayContaining([
      "debt_accounts", "journeys", "workforce_snapshots",
    ]));
    hub.stop();
  });

  it("refuses invalid canonical feeds and invalid partitions", () => {
    const hub = createSourceInvalidationHub();
    expect(() => hub.publish({ feed: "customers" as any, employerRef: "EMP-1", period: null }))
      .toThrow(/Unknown canonical/);
    expect(() => hub.publish({ feed: "employees", employerRef: "EMP-1", period: "2026-13" }))
      .toThrow(/Invalid CDC report period/);
    expect(() => hub.subscribe("", () => undefined)).toThrow(/employer scope/);
    hub.stop();
  });

  it("guards browser access before starting the SSE stream and stays opt-in", () => {
    const server = readFileSync("src/server.ts", "utf8");
    const at = server.indexOf('"/api/employers/:employerId/source-changes/events"');
    expect(at).toBeGreaterThan(-1);
    const route = server.slice(at, at + 2250);
    expect(route.indexOf("requireUser(req, reply)"))
      .toBeLessThan(route.indexOf("directSourceNotifications.subscribe("));
    expect(route.indexOf("canViewEmployer(user, req.params.employerId)"))
      .toBeLessThan(route.indexOf("directSourceNotifications.subscribe("));
    expect(route.indexOf("sourceDeletedAt: null"))
      .toBeLessThan(route.indexOf("directSourceNotifications.subscribe("));
    expect(route).toContain('DIRECT_MYSQL_CDC_SSE_ENABLED !== "true"');
    expect(route).toContain("hasVerifiedMfaSession(req, user.id)");
    expect(route).toContain("event: source-change\\ndata:");
  });

  it("cleans pending events and listeners on disconnect", () => {
    const hub = createSourceInvalidationHub();
    const unsubscribe = hub.subscribe("E-1", () => undefined)!;
    hub.publish({ feed: "referrals", employerRef: "E-1", period: null });
    expect(hub.stats().pending).toBe(1);
    unsubscribe();
    expect(hub.stats()).toMatchObject({ pending: 0, subscribers: 0 });
    hub.stop();
    expect(hub.publish({ feed: "ratings", employerRef: "E-1", period: null })).toBe(false);
  });
});
