#!/usr/bin/env python3
"""Post-deployment health observations; HTTP GET only, no credentials or body logging.

Configured URLs must be explicit repository variables, never untrusted deployment payloads.
"""
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = build_opener(NoRedirect)
root = Path(os.getenv("REPORT_DIR", "test-reports/deployment"))
root.mkdir(parents=True, exist_ok=True)
targets = {
    "Render": os.getenv("FIXER_RENDER_BASE_URL", ""),
    "Cloudflare": os.getenv("FIXER_CLOUDFLARE_BASE_URL", "")
}
def validate(value):
    if not value:
        return None
    u = urlsplit(value)
    if (u.scheme != "https" or not u.hostname or u.username or u.password
        or u.query or u.fragment or u.path not in ("", "/") or u.port not in (None, 443)
        or u.hostname in ("localhost", "127.0.0.1")):
        raise ValueError("Monitoring URL must be a plain HTTPS public base URL without credentials")
    return urlunsplit((u.scheme, u.netloc, "", "", ""))

results = {}
for label, base in targets.items():
    if not base:
        results[label] = {"status": "unconfigured", "checks": []}
        continue
    try:
        base = validate(base)
    except (ValueError, TypeError):
        results[label] = {"status": "invalid_url", "checks": []}
        continue
    checks = []
    # Grace period: sample immediately, again at +30s and +90s.
    for delay in (0, 30, 60):
        if delay:
            time.sleep(delay)
        sample = {"observed_at": datetime.now(timezone.utc).isoformat(), "endpoints": {}}
        for endpoint in ("/health", "/ready", "/version"):
            try:
                req = Request(base + endpoint, headers={"User-Agent": "Fixer-PostDeploy-Monitor/1.0"})
                started = time.monotonic()
                with opener.open(req, timeout=12) as response:
                    status = response.status
                sample["endpoints"][endpoint] = {"http_status": status,
                    "duration_ms": round((time.monotonic() - started) * 1000)}
            except HTTPError as error:
                sample["endpoints"][endpoint] = {"http_status": error.code}
            except (URLError, TimeoutError, OSError):
                sample["endpoints"][endpoint] = {"http_status": None, "error": "unreachable"}
        checks.append(sample)
    last = checks[-1]["endpoints"]
    results[label] = {"status": "healthy" if all(last[p]["http_status"] == 200 for p in ("/health", "/ready", "/version")) else "degraded",
                      "checks": checks}
report = {"run_id": os.getenv("GITHUB_RUN_ID", "local"),
          "event": os.getenv("GITHUB_EVENT_NAME", "manual"),
          "expected_commit": os.getenv("DEPLOYMENT_SHA", ""),
          "observed_at": datetime.now(timezone.utc).isoformat(),
          "targets": results}
(root / "health.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
with (root / "health.md").open("w") as f:
    f.write("# Post-deployment runtime health\n\n")
    for label, entry in results.items():
        f.write(f"- {label}: **{entry['status']}** (last observation)\n")
        for sample in entry["checks"]:
            f.write("  - " + sample["observed_at"] + " " + ", ".join(
                f"{p}={data['http_status']}" for p, data in sample["endpoints"].items()) + "\n")
    f.write("\nHealth only measures public read-only endpoints. It does not certify authentication, data correctness, or deployment SHA.\n")
print("Runtime health:", ", ".join(f"{k}={v['status']}" for k,v in results.items()))
if any(v["status"] != "healthy" for v in results.values()):
    raise SystemExit(2)
