import test from "node:test";
import assert from "node:assert/strict";
import { closeSourceConnections } from "../../src/services/sourceConnectionCleanup.js";

test("closes both SQL connections after successful initialization", async () => {
  const closed: string[] = [];
  await closeSourceConnections(
    { async close() { closed.push("primary"); } },
    { async close() { closed.push("replica"); } },
  );
  assert.deepEqual(closed, ["primary", "replica"]);
});

test("a failing primary close cannot skip closing the replica", async () => {
  const closed: string[] = [];
  await assert.rejects(
    closeSourceConnections(
      { async close() { closed.push("primary"); throw new Error("password=do-not-leak"); } },
      { async close() { closed.push("replica"); } },
    ),
    { message: "Source connection cleanup failed." },
  );
  assert.deepEqual(closed, ["primary", "replica"]);
});

test("partial initialization cleanup suppresses driver details after closing acquired sockets", async () => {
  const closed: string[] = [];
  await assert.doesNotReject(closeSourceConnections(
    { async close() { closed.push("primary"); throw new Error("Bearer private-secret"); } },
    null,
    true,
  ));
  assert.deepEqual(closed, ["primary"]);
});

test("synchronous close errors cannot prevent other handles from closing", async () => {
  const closed: string[] = [];
  await assert.rejects(closeSourceConnections(
    { close() { closed.push("primary"); throw new Error("connection credentials"); } },
    { async close() { closed.push("replica"); } },
  ), { message: "Source connection cleanup failed." });
  assert.deepEqual(closed, ["primary", "replica"]);
});

test("no opened connections is a safe no-op", async () => {
  await assert.doesNotReject(closeSourceConnections(undefined, null));
});
