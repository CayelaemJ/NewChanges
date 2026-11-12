import test from "node:test";
import assert from "node:assert/strict";
import { parseAlertEmailRecipients } from "../../src/services/alertEmailRecipients.js";

test("valid and empty admin recipients are normalized without changing addresses", () => {
  assert.deepEqual(parseAlertEmailRecipients(null), []);
  assert.deepEqual(parseAlertEmailRecipients(""), []);
  assert.deepEqual(parseAlertEmailRecipients("one@example.org, two@example.org"), ["one@example.org", "two@example.org"]);
});
test("invalid, excessive and duplicate addresses are rejected", () => {
  for (const raw of [
    "one@example.org,", ",one@example.org", "one@example.org,,two@example.org",
    "one@example.org\r\nBcc:third@example.org",
    "one@example.org,ONE@example.org",
    Array.from({length:11},(_,i)=>`person${i}@example.org`).join(","),
    "x".repeat(2550), 1, {}, ["one@example.org"]
  ]) assert.throws(() => parseAlertEmailRecipients(raw), /invalid alert recipients|duplicate alert recipients/);
});
