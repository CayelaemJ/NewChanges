#!/usr/bin/env python3
"""Inventory *all tracked* repository files and report reviewable bloat candidates.

No files are deleted; reports contain paths/counts only, not source or secrets.
"""
import collections
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
out = root / "test-reports" / "codebase-audit"
out.mkdir(parents=True, exist_ok=True)
tracked = subprocess.check_output(["git", "-C", str(root), "ls-files", "-z"]).split(b"\0")
source_ext = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".prisma", ".sh", ".sql", ".css", ".html", ".json", ".yml", ".yaml"}
excluded = {"node_modules", "dist", ".git", "coverage", "test-reports", "build"}
files = []
skipped = []
hashes = collections.defaultdict(list)
for entry in tracked:
    if not entry:
        continue
    relative = entry.decode("utf-8", "surrogateescape")
    path = root / relative
    if path.suffix.lower() not in source_ext:
        continue
    if any(part in excluded for part in path.parts) or path.is_symlink():
        skipped.append({"file": relative, "reason": "excluded/generated/symlink"})
        continue
    try:
        payload = path.read_bytes()
        if b"\0" in payload[:4096]:
            skipped.append({"file": relative, "reason": "binary"})
            continue
        lines = payload.count(b"\n") + (1 if payload and not payload.endswith(b"\n") else 0)
    except OSError:
        skipped.append({"file": relative, "reason": "unreadable"})
        continue
    files.append({"file": relative, "bytes": len(payload), "lines": lines})
    if len(payload) > 0:
        hashes[hashlib.sha256(payload).hexdigest()].append(relative)
duplicates = [group for group in hashes.values() if len(group) > 1]
duplicates.sort(key=lambda group: (-len(group), group))
large = sorted((f for f in files if f["lines"] >= 400 or f["bytes"] >= 50000),
               key=lambda f: (-f["lines"], -f["bytes"]))[:100]
report = {
    "tracked_entries": sum(bool(x) for x in tracked),
    "tracked_eligible_source_files": len(files),
    "skipped_eligible_files": skipped,
    "total_source_lines": sum(f["lines"] for f in files),
    "largest_files": large,
    "identical_file_groups": duplicates,
    "warning": "Candidates only: generated-looking, old or duplicate files may be required. Nothing deleted."
}
(out / "inventory.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
summary = [
    "# The Fixer codebase inventory / bloat candidates",
    f"Tracked entries: {report['tracked_entries']}",
    f"Eligible source/config files inspected: {len(files)}",
    f"Source lines: {report['total_source_lines']}",
    f"Skipped eligible paths: {len(skipped)}",
    f"Identical-content groups: {len(duplicates)}",
    "No files were changed or removed.", "",
    "## Large-file refactoring candidates"
]
summary.extend(f"- \`{f['file']}\`: {f['lines']} lines, {f['bytes']} bytes" for f in large)
summary += ["", "## Identical-content file groups (verify references before deletion)"]
summary.extend("- " + ", ".join(f"\`{f}\`" for f in group) for group in duplicates[:50])
(out / "inventory.md").write_text("\n".join(summary) + "\n", encoding="utf-8")
print(f"Codebase inventory: {len(files)} tracked eligible files, {len(duplicates)} duplicate groups, {len(large)} large-file candidates, {len(skipped)} skipped.")
