import test from "node:test";
import assert from "node:assert/strict";
import { summarizeScannerReport } from "./summarize-scanner-report.mjs";

test("Gitleaks summary never prints secret/match data", () => {
  const result = summarizeScannerReport("gitleaks", [
    { RuleID: "generic-api-key", Secret: "dummy-secret-should-not-appear", Match: "dummy-match" },
  ]);
  assert.equal(result.findingCount, 1);
  assert.ok(!JSON.stringify(result).includes("dummy-secret"));
  assert.ok(!JSON.stringify(result).includes("dummy-match"));
});

test("Trivy summary excludes descriptions, targets and raw file contents", () => {
  const result = summarizeScannerReport("trivy", { Results: [{
    Target: "private/file", Vulnerabilities: [{ VulnerabilityID: "CVE-TEST-001", PkgName: "test-package", Severity: "HIGH", FixedVersion: "1.1.1", Description: "private-details" }],
    Misconfigurations: [{ ID: "DS-TEST", Severity: "CRITICAL", Message: "private-details" }]
  }]});
  assert.equal(result.vulnerabilityCount, 1);
  assert.equal(result.misconfigurationCount, 1);
  assert.ok(!JSON.stringify(result).includes("private"));
});
