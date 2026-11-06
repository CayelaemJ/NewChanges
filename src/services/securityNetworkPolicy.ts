// Audit trail IP addresses must come from Fastify's proxy-trust policy, not
// directly from client-supplied forwarding headers.
import { isIP } from "node:net";
import { isBlockedSourceAddress } from "./sourceAddressPolicy.js";

export function resolvedSecurityIp(req: {
  ip?: unknown;
  raw?: { socket?: { remoteAddress?: unknown } };
} | null): string | undefined {
  const candidates = [req?.ip, req?.raw?.socket?.remoteAddress];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const ip = value.trim();
    if (ip.length <= 64 && isIP(ip) !== 0) return ip;
  }
  return undefined;
}

export function isPublicSecurityIp(value: string | undefined): boolean {
  return Boolean(value && isIP(value) !== 0 && !isBlockedSourceAddress(value));
}
