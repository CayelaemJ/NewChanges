// Reject non-public source API IP destinations before establishing a connection.
// Keep this policy separate from the adapters so it has executable regression tests.
import { BlockList, isIP } from "node:net";

const prohibited = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) prohibited.addSubnet(ip, prefix, "ipv4");

for (const [ip, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10],
  ["2001::", 32], ["2001:db8::", 32], ["2002::", 16],
  ["ff00::", 8],
] as const) prohibited.addSubnet(ip, prefix, "ipv6");

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function isBlockedSourceAddress(address: string): boolean {
  const version = isIP(address);
  // DNS names are checked separately by the caller, including all resolved IPs.
  if (version === 0) return false;
  // Deny IPv6 special-use, transition/tunnel and IPv4-mapped destinations.
  if (version === 6 && !globalV6.check(address, "ipv6")) return true;
  return prohibited.check(address, version === 4 ? "ipv4" : "ipv6");
}
