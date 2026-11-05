import assert from "node:assert/strict";
import test from "node:test";
import { isBlockedSourceAddress } from "../src/services/sourceAddressPolicy.js";

test("source adapters reject local, private and reserved IPv4 destinations", () => {
  for (const ip of [
    "0.0.0.0", "10.1.2.3", "100.127.4.9", "127.0.0.1",
    "169.254.169.254", "172.16.0.1", "172.31.255.254",
    "192.168.1.4", "192.0.2.1", "198.19.1.2",
    "198.51.100.3", "203.0.113.7", "224.0.0.1", "255.255.255.255",
  ]) assert.equal(isBlockedSourceAddress(ip), true, ip);
});

test("source adapters reject IPv6 private, mapped, tunneled and documentation destinations", () => {
  for (const ip of [
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1",
    "ff02::1", "2001:db8::1", "2001::1", "2002::1",
    "::ffff:127.0.0.1", "::ffff:172.31.0.1",
    "::ffff:ac1f:1", "::ffff:192.168.2.2",
    "64:ff9b::a9fe:a9fe",
  ]) assert.equal(isBlockedSourceAddress(ip), true, ip);
});

test("source adapters preserve public destination addresses and DNS checks", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "example.org"]) {
    assert.equal(isBlockedSourceAddress(address), false, address);
  }
});
