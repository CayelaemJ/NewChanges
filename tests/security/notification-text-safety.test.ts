import test from "node:test";
import assert from "node:assert/strict";
import { escapeNotificationHtml, notificationPlainText, safeEmailColor, safePortalBaseUrl } from "../../src/services/notificationTextSafety.js";

test("account names and telemetry cannot inject HTML markup into notifications",()=>{
  assert.equal(escapeNotificationHtml('<img src="x" onerror="alert(1)">'),
    "&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeNotificationHtml("A & B's"),"A &amp; B&#39;s");
});

test("unsafe origins cannot become password-reset or report links", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,evil",
    "https://safe.example/\" onclick=\"alert(1)", "https://user:pass@safe.example/",
    "https://safe.example/?token=bad", "https://safe.example/#fragment",
    "https://safe.example/other/path"]) {
    assert.equal(safePortalBaseUrl(value),null,String(value));
  }
  assert.equal(safePortalBaseUrl("https://fixer.example.com"),"https://fixer.example.com");
});

test("unsafe theme colors cannot inject email CSS or markup", () => {
  assert.equal(safeEmailColor('fff\" onmouseover=\"oops','32217C'),"#32217C");
  assert.equal(safeEmailColor("aabbcc","32217C"),"#aabbcc");
});

test("Slack text does not accept control characters or HTML delimiters",()=>{
  assert.equal(notificationPlainText("Alice\n<@U123>\r"),"Alice  @U123");
  assert.equal(notificationPlainText("X\u0085Y\u001bZ"),"X Y Z");
});
