import test from "node:test";
import assert from "node:assert/strict";
import { resolvedSecurityIp, isPublicSecurityIp } from "../../src/services/securityNetworkPolicy.js";

test("untrusted forwarding headers cannot forge the audit-log source IP", () => {
  const request = {
    ip: "203.0.113.2",
    headers: { "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" },
    raw: { socket: { remoteAddress: "192.168.0.3" } },
  };
  assert.equal(resolvedSecurityIp(request), "203.0.113.2");
  assert.equal(resolvedSecurityIp({ raw: { socket: { remoteAddress: "127.0.0.1" } } }), "127.0.0.1");
  assert.equal(resolvedSecurityIp({ ip: "not-an-ip" }), undefined);
});

test("geo lookup cannot process non-public, malformed or metadata addresses", () => {
  for (const ip of ["127.0.0.1", "169.254.169.254", "10.0.0.1",
    "172.31.0.12", "100.64.0.1", "::ffff:127.0.0.1", "fc00::1",
    "not-an-ip", undefined]) assert.equal(isPublicSecurityIp(ip), false, String(ip));
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(isPublicSecurityIp(ip), true, ip);
});
