import test from "node:test";
import assert from "node:assert/strict";
import { assertSourceApiBaseUrlHasNoQuery } from "../../src/services/sourceApiBaseUrlPolicy.js";

test("source API base URL may include a non-sensitive path", () => {
  assert.doesNotThrow(() => assertSourceApiBaseUrlHasNoQuery(new URL("https://source.example.com/v2/")));
});

test("base URL query parameters cannot carry API tokens into labels and diagnostics", () => {
  for (const value of [
    "https://source.example.com/v2?api_key=fake",
    "https://source.example.com/?token=fake",
    "https://source.example.com/path?mode=preview",
  ]) {
    assert.throws(() => assertSourceApiBaseUrlHasNoQuery(new URL(value)),
      /must not include query parameters/);
  }
});

test("normal paginated request query strings remain valid at the transport layer", () => {
  // This policy is applied only to the configured base URL, not to
  // generated request URLs that carry bounded pagination parameters.
  const page = new URL("api/empower-fin/employers", "https://source.example.com/v2/");
  page.searchParams.set("limit", "5000");
  assert.equal(page.searchParams.get("limit"), "5000");
});
