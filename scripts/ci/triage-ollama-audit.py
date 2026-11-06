#!/usr/bin/env python3
"""Read-only triage of local Ollama results. Never treats AI severity as confirmed."""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "test-reports/ai-security/report.json"
OUT = ROOT / "test-reports/ai-security/triage.md"

def group_for(path):
    if path.startswith(("src/", "frontend/src/", "public/")):
        return "Application implementation"
    if path.startswith(("prisma/", "src/Migrations/")):
        return "Schema and migrations"
    if path.startswith(("tests/", "quality-tests/", "browser-tests/", "scripts/fixtures/")):
        return "Tests and fixtures"
    if path.startswith(("docs/", "security/")) or path.endswith(".md"):
        return "Documentation"
    return "CI, scripts and configuration"

def main():
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    findings = report.get("findings", [])
    severity = collections.Counter(str(x.get("severity", "unknown")).lower() for x in findings)
    category = collections.Counter(group_for(str(x.get("file", ""))) for x in findings)
    byfile = collections.Counter(str(x.get("file", "")) for x in findings)
    seen = set()
    duplicate_count = 0
    for item in findings:
        key = (str(item.get("file", "")), item.get("line"),
               " ".join(str(item.get("title", "")).lower().split()))
        if key in seen:
            duplicate_count += 1
        seen.add(key)
    high_count = severity.get("high", 0)
    high_ratio = high_count / max(1, len(findings))
    lines = [
        "# The Fixer Ollama audit triage (AI claims unverified)",
        "",
        f"- Reviewable scan complete: {report.get('complete', False)}",
        f"- Chunks: {report.get('completed_chunks', 0)}/{report.get('total_chunks', 0)}",
        f"- Unresolved chunks: {len(report.get('errors', []))}",
        f"- Excluded paths: {len(report.get('skipped_files', []))}",
        f"- Model-generated observations: {len(findings)}",
        f"- Exact file+line+title duplicates: {duplicate_count}",
        f"- HIGH share: {high_ratio:.1%}",
        "",
        "**Do not treat model severity as validated.** In particular, the scanner prompt",
        "has previously demonstrated HIGH as its example severity. Validate evidence",
        "against source and deterministic tests before assigning a remediation priority.",
        "",
        "## Model-assigned severity (not confirmed)",
    ]
    for key, number in severity.most_common():
        lines.append(f"- {key}: {number}")
    lines += ["", "## Observations by file category"]
    for key, number in category.most_common():
        lines.append(f"- {key}: {number}")
    lines += ["", "## Most flagged files (investigate, do not auto-fix)"]
    for name, number in byfile.most_common(30):
        lines.append(f"- {name}: {number}")
    lines += ["", "## Unresolved review chunks"]
    for item in report.get("errors", []):
        lines.append(f"- {item.get('file')}:{item.get('first')}-{item.get('last')}: {item.get('error')}")
    lines += ["", "## Verification gates",
              "- No security finding is confirmed solely by this model.",
              "- Prioritize reproducible auth/MFA, authorization, tenant isolation, secrets and injection issues.",
              "- Review actual code paths; write a regression test before changing production logic.",
              "- Keep raw report and model findings private on the local machine.",
              "- Do not merge or deploy automatic AI changes based on this severity distribution."]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("Triage written:", OUT)
    print(f"AI findings: {len(findings)}; model-assigned HIGH share: {high_ratio:.1%}; unresolved chunks: {len(report.get('errors', []))}")

if __name__ == "__main__":
    main()
