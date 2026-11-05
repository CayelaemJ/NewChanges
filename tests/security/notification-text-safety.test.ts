import test from "node:test";
import assert from "node:assert/strict";
import { escapeNotificationHtml, notificationPlainText } from "../../src/services/notificationTextSafety.js";

test("account names and telemetry cannot inject HTML markup into notifications",()=>{
  assert.equal(escapeNotificationHtml('<img src="x" onerror="alert(1)">'),
    "&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeNotificationHtml("A & B's"),"A &amp; B&#39;s");
});

test("Slack text does not accept control characters or HTML delimiters",()=>{
  assert.equal(notificationPlainText("Alice\n<@U123>\r"),"Alice  @U123");
});
