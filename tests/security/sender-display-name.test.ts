import test from "node:test";
import assert from "node:assert/strict";
import { safeSenderDisplayName } from "../../src/services/notificationTextSafety.js";

test("sender display names remove controls and mailbox delimiters", () => {
  assert.equal(safeSenderDisplayName("Finance\r\nBcc: thief@example.invalid"), "Finance Bcc: thief@example.invalid");
  assert.equal(safeSenderDisplayName("<System>\u200b\u202e Team"), "System Team");
  assert.equal(safeSenderDisplayName(" Finance   Team "), "Finance Team");
  assert.equal(safeSenderDisplayName('Finance", hidden@example.org; Team'), "Finance hidden@example.org Team");
  assert.equal(safeSenderDisplayName('Finance\\\\Ops, South'), "Finance Ops South");
});
test("empty and excessive display names are bounded", () => {
  assert.equal(safeSenderDisplayName("\r\n"), "The Fixer (Pty) Ltd Dashboard Portal");
  assert.equal(safeSenderDisplayName("a".repeat(250)).length, 120);
});
