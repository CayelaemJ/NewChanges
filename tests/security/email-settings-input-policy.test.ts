import test from "node:test";
import assert from "node:assert/strict";
import { strictEmailSettingBoolean, strictSmtpPort, strictStaleDeactivateDays } from "../../src/services/emailSettingsInputPolicy.js";

test("boolean settings accept only JSON booleans, never truthy strings", () => {
  assert.equal(strictEmailSettingBoolean(true, "syntheticDataMode"), true);
  assert.equal(strictEmailSettingBoolean(false, "syntheticDataMode"), false);
  for (const input of ["false", "true", "0", "1", 0, 1, null, {}, []])
    assert.throws(() => strictEmailSettingBoolean(input, "syntheticDataMode"),
      { message: "syntheticDataMode must be true or false" });
});

test("SMTP port must be a whole numeric TCP port", () => {
  for (const port of [1, 465, 587, 65535]) assert.equal(strictSmtpPort(port), port);
  for (const port of [0, -1, 65536, 25.5, "587", null, NaN, Infinity, {}, []])
    assert.throws(() => strictSmtpPort(port),
      { message: "SMTP port must be an integer between 1 and 65535" });
});

test("inactivity thresholds cannot be coerced, rounded or silently clamped", () => {
  assert.equal(strictStaleDeactivateDays(null), null);
  assert.equal(strictStaleDeactivateDays(0), null);
  for (const days of [7, 30, 3650]) assert.equal(strictStaleDeactivateDays(days), days);
  for (const days of [1, 6, 3651, -1, 7.1, "30", "false", NaN, Infinity, {}, []])
    assert.throws(() => strictStaleDeactivateDays(days),
      { message: "Inactivity threshold must be 0 (off) or 7 to 3650 whole days" });
});
