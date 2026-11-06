import test from "node:test";
import assert from "node:assert/strict";
import { csvEscape } from "../../src/services/csvSafety.js";

test("CSV neutralizes spreadsheet formulas in untrusted text cells", () => {
  for (const text of [
    "=HYPERLINK(\"https://attacker.example\",\"click\")",
    "+SUM(1,2)", "-cmd|'/C calc'!A0", "@SUM(A1)",
    "  =1+2", "\t=1+2", "\r=1+2", "\n=1+2", "\uFEFF=1+2",
    "\u200B=1+2", "\u0085=1+2", "\u00A0=1+2",
  ]) assert.ok(csvEscape(text).startsWith("'") || csvEscape(text).startsWith("\"'"), text);
});

test("CSV escapes carriage returns, line breaks, double-quotes and delimiters", () => {
  assert.equal(csvEscape("Alice\r=2+2"), '"Alice\r=2+2"');
  assert.equal(csvEscape('Alice,"Bob"'), '"Alice,""Bob"""');
  assert.equal(csvEscape("line1\nline2"), '"line1\nline2"');
});

test("CSV retains typed numeric values while defending text-formatted values", () => {
  assert.equal(csvEscape(-123.45), "-123.45");
  assert.equal(csvEscape(0), "0");
  assert.equal(csvEscape("-123.45"), "'-123.45");
  assert.equal(csvEscape("+273"), "'+273");
  assert.equal(csvEscape("ordinary text"), "ordinary text");
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(new Date("2026-11-05T00:00:00Z")), "2026-11-05T00:00:00.000Z");
});

test("JSON-encoded object data remains quoted and delimiter-safe", () => {
  assert.equal(csvEscape({ action: "=1+1" }), '"{""action"":""=1+1""}"');
});
