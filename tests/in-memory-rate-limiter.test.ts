import { strict as assert } from "node:assert";
import test from "node:test";
import { InMemoryRateLimiter } from "../src/services/inMemoryRateLimiter.js";

test("enforces each key limit and emits bounded Retry-After", () => {
  const guard = new InMemoryRateLimiter(3);
  assert.deepEqual(guard.hit("auth:a", 2, 10_000, 1000), { allowed: true });
  assert.deepEqual(guard.hit("auth:a", 2, 10_000, 1001), { allowed: true });
  assert.deepEqual(guard.hit("auth:a", 2, 10_000, 1002),
    { allowed: false, retryAfterSeconds: 10, reason: "limit" });
  assert.deepEqual(guard.hit("auth:a", 2, 10_000, 10_999),
    { allowed: false, retryAfterSeconds: 1, reason: "limit" });
  assert.deepEqual(guard.hit("auth:a", 2, 10_000, 11_000), { allowed: true });
});
test("never exceeds configured memory capacity under high-cardinality traffic", () => {
  const guard = new InMemoryRateLimiter(2);
  assert.deepEqual(guard.hit("ip:1", 10, 60_000, 1000), { allowed: true });
  assert.deepEqual(guard.hit("ip:2", 10, 60_000, 1000), { allowed: true });
  assert.deepEqual(guard.hit("ip:3", 10, 60_000, 1000),
    { allowed: false, retryAfterSeconds: 60, reason: "capacity" });
  assert.equal(guard.size, 2);
  assert.deepEqual(guard.hit("ip:1", 10, 60_000, 1000), { allowed: true },
    "existing clients remain usable at capacity");
  assert.equal(guard.size, 2);
  guard.pruneExpired(61_000);
  assert.equal(guard.size, 0);
  assert.deepEqual(guard.hit("ip:3", 10, 60_000, 61_000), { allowed: true });
});
test("expired existing key can be reused at capacity", () => {
  const guard = new InMemoryRateLimiter(1);
  guard.hit("ip:1", 1, 5_000, 1000);
  assert.deepEqual(guard.hit("ip:1", 1, 5_000, 6000), { allowed: true });
});
test("invalid config and input fail safely", () => {
  assert.throws(() => new InMemoryRateLimiter(0));
  const guard = new InMemoryRateLimiter(5);
  assert.throws(() => guard.hit("", 1, 1000));
  assert.throws(() => guard.hit("test", 0, 1000));
  assert.throws(() => guard.hit("test", 1, 0));
});
