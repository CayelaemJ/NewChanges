import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export function summarizeScannerReport(scanner, report) {
  if (scanner === "gitleaks") {
    if (!Array.isArray(report)) throw new Error("Expected redacted Gitleaks JSON array");
    const rules = {};
    for (const hit of report) {
      const rule = String(hit.RuleID || "unknown").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 70);
      rules[rule] = (rules[rule] || 0) + 1;
    }
    return { scanner, findingCount: report.length, ruleCounts: rules };
  }
  if (scanner === "trivy") {
    if (!report || !Array.isArray(report.Results)) throw new Error("Expected Trivy result collection");
    const vulnerabilities = [];
    const misconfigurations = [];
    for (const section of report.Results) {
      for (const row of section.Vulnerabilities || []) {
        vulnerabilities.push({
          id: String(row.VulnerabilityID || "").slice(0, 60),
          package: String(row.PkgName || "").slice(0, 90),
          severity: String(row.Severity || "").slice(0, 16),
          fixAvailable: Boolean(row.FixedVersion),
        });
      }
      for (const row of section.Misconfigurations || []) {
        misconfigurations.push({
          id: String(row.ID || "").slice(0, 60),
          severity: String(row.Severity || "").slice(0, 16),
        });
      }
    }
    return {
      scanner, vulnerabilityCount: vulnerabilities.length,
      misconfigurationCount: misconfigurations.length,
      vulnerabilities: vulnerabilities.slice(0, 30),
      misconfigurations: misconfigurations.slice(0, 30),
      truncated: vulnerabilities.length > 30 || misconfigurations.length > 30,
    };
  }
  throw new Error("Unsupported scanner");
}

export function printScannerSummary(scanner, filename) {
  let report;
  try {
    report = JSON.parse(readFileSync(filename, "utf8"));
  } catch {
    console.error("[security-summary] Scanner produced no readable report; check the preceding command for download, timeout or execution failure.");
    return 2;
  }
  try {
    const result = summarizeScannerReport(scanner, report);
    mkdirSync("security-reports", { recursive: true });
    writeFileSync(`security-reports/${scanner}-summary.json`, JSON.stringify(result, null, 2) + "\n");
    console.log("[security-summary] Safe finding categories only (NO secret values, file contents or raw matches):");
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch {
    console.error("[security-summary] Invalid report schema; do not claim a passing scan.");
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = printScannerSummary(process.argv[2], process.argv[3]);
}
