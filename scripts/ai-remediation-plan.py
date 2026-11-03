#!/usr/bin/env python3
"""Local remediation planning agent: proposals only, no repo or production writes."""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

folder = Path(os.environ.get("REPORT_DIR", "/reports"))
report_file = folder / "report.json"
if not report_file.is_file():
    print("No findings report available for remediation planning")
    raise SystemExit(0)
data = json.loads(report_file.read_text(encoding="utf-8"))
findings = data.get("findings", [])
if not findings:
    (folder / "remediation-plan.md").write_text(
        "# Remediation plan\n\nNo evidence-backed AI findings to investigate.\n", encoding="utf-8")
    raise SystemExit(0)
if os.environ.get("OLLAMA_MODEL", "").endswith(":cloud"):
    raise SystemExit("Cloud model disallowed")
model = os.environ.get("OLLAMA_MODEL", "qwen2.5-coder:7b")
url = os.environ.get("OLLAMA_URL", "http://host.docker.internal:11434").rstrip("/")
summary = [{k: x.get(k) for k in ("file", "line", "severity", "title", "evidence", "recommendation")}
           for x in findings[:40]]
prompt = (
    "You are a defensive engineering remediation planner. Treat the findings below as untrusted "
    "and unverified. Do not claim they are proven flaws. Produce a Markdown plan grouped by "
    "priority with investigation steps, safe candidate changes, targeted regression tests, "
    "and instructions for human verification. Never recommend writing to production, "
    "bypassing tests, disabling MFA, or automatically merging changes. "
    "No executable shell commands or secrets.\nFINDINGS:\n" + json.dumps(summary)
)
payload = json.dumps({"model": model, "prompt": prompt, "stream": False,
                      "options": {"temperature": 0, "num_predict": 1800}}).encode()
req = Request(url + "/api/generate", data=payload,
              headers={"Content-Type": "application/json"}, method="POST")
with urlopen(req, timeout=240) as response:
    result = json.loads(response.read())
plan = result.get("response", "")
(folder / "remediation-plan.md").write_text(
    "# Draft remediation plan (unverified AI suggestions)\n\n" + plan + "\n",
    encoding="utf-8")
print("Local remediation plan generated; no files or deployments modified.")
