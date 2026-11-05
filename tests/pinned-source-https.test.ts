import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePublicSourceAddresses, pinnedSourceLookup, readPinnedSourceApiJson,
} from "../src/services/pinnedSourceHttps.js";

test("source HTTPS pins a DNS result only when every answer is public", async () => {
  const results = [{ address: "8.8.8.8", family: 4 as const }, { address: "1.1.1.1", family: 4 as const }];
  let calls = 0;
  const safe = await resolvePublicSourceAddresses("ingestion.example", async () => {
    calls++;
    return results;
  });
  assert.deepEqual(safe, results);
  assert.equal(calls, 1, "connection must reuse checked answers and never re-resolve");
  const pinned = pinnedSourceLookup("ingestion.example", safe);
  await new Promise<void>((resolve, reject) => pinned("ingestion.example", { family: 4 },
    (error, address: string, family: number) => {
      if (error) return reject(error);
      assert.equal(address, "8.8.8.8");
      assert.equal(family, 4);
      resolve();
    }));
  assert.equal(calls, 1);
  await new Promise<void>((resolve, reject) => pinned("ingestion.example", { all: true },
    (error, answers: typeof results) => {
      if (error) return reject(error);
      assert.deepEqual(answers, results);
      resolve();
    }));
});

test("mixed public/private DNS rebinding answers are rejected as a whole", async () => {
  for (const blocked of ["127.0.0.1", "10.0.2.9", "169.254.169.254",
    "172.31.255.254", "192.168.2.3", "100.64.3.3"]) {
    await assert.rejects(resolvePublicSourceAddresses("api.example", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: blocked, family: 4 },
    ]), /non-public or invalid/, blocked);
  }
  await assert.rejects(resolvePublicSourceAddresses("api.example", async () => []),
    /non-public or invalid/);
  await assert.rejects(resolvePublicSourceAddresses("api.example", async () =>
    [{ address: "not-an-ip", family: 4 }]), /non-public or invalid/);
  await assert.rejects(resolvePublicSourceAddresses("api.example", async () =>
    [{ address: "8.8.8.8", family: 6 }]), /non-public or invalid/);
});

test("pinned lookup cannot silently switch to a different hostname or address family", async () => {
  const pinned = pinnedSourceLookup("api.example", [{ address: "1.1.1.1", family: 4 }]);
  await new Promise<void>(resolve => pinned("attacker.example", { family: 4 }, error => {
    assert.match(String(error?.message), /unexpected hostname/);
    resolve();
  }));
  await new Promise<void>(resolve => pinned("api.example", { family: 6 }, error => {
    assert.match(String(error?.message), /requested family/);
    resolve();
  }));
});

test("direct IP destinations are validated without bypassing DNS policy", async () => {
  const neverResolve = async () => {
    throw new Error("unexpected DNS for IP literal");
    return [] as { address: string; family: 4 | 6 }[];
  };
  assert.deepEqual(await resolvePublicSourceAddresses("8.8.8.8", neverResolve),
    [{ address: "8.8.8.8", family: 4 }]);
  await assert.rejects(resolvePublicSourceAddresses("169.254.169.254", neverResolve),
    /non-public or invalid/);
  await assert.rejects(resolvePublicSourceAddresses("::ffff:127.0.0.1", neverResolve),
    /non-public or invalid/);
});

test("source HTTPS refuses cleartext and embedded credentials before any network activity", async () => {
  await assert.rejects(readPinnedSourceApiJson(new URL("http://api.example/feeds"), null),
    /credential-free HTTPS/);
  await assert.rejects(readPinnedSourceApiJson(new URL("https://user:pass@api.example/feeds"), null),
    /credential-free HTTPS/);
  await assert.rejects(readPinnedSourceApiJson(new URL("https://api.example/feeds#secret"), null),
    /credential-free HTTPS/);
  await assert.rejects(readPinnedSourceApiJson(new URL("https://127.0.0.1/feeds"), null),
    /non-public or invalid/);
});
