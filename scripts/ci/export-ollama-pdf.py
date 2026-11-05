#!/usr/bin/env python3
"""Export a complete, private, dependency-free PDF from local Ollama audit.

Contains every recorded observation, evidence, recommendation, failure and
exclusion. Findings are UNVERIFIED. No upload or code modification occurs.
"""
import argparse
import collections
import json
import re
import subprocess
import sys
import textwrap
import zlib
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPORT = ROOT / "test-reports/ai-security/report.json"
PAGE_W, PAGE_H = 595, 842
MARGIN = 46

def printable(value):
    """Remove control characters and unsupported glyphs from untrusted model titles."""
    s = str(value).replace("\r", " ").replace("\n", " ")
    s = re.sub(r"[\x00-\x1f\x7f]", " ", s)
    return s.encode("latin-1", "replace").decode("latin-1").strip()

def pdf_string(value):
    s = printable(value)
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

def get_windows_downloads():
    """Use the signed-in Windows user's own profile, not a hard-coded username."""
    try:
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
             "[Environment]::GetFolderPath('UserProfile')"],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20
        )
        profile = proc.stdout.decode("utf-8", "replace").strip().splitlines()[-1].strip()
        converted = subprocess.run(["wslpath", "-u", profile], check=True,
                                   capture_output=True, text=True, timeout=10)
        candidate = Path(converted.stdout.strip()) / "Downloads"
        if candidate.is_dir():
            return candidate
    except (OSError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired,
            IndexError):
        pass
    raise RuntimeError(
        "Windows Downloads not detected from WSL. Supply --output-dir "
        "'/mnt/c/Users/<Windows-user>/Downloads' explicitly."
    )

class Pdf:
    def __init__(self):
        self.pages = []
        self.current = []
        self.y = PAGE_H - 105
        self.number = 0
        self.new_page()

    def cmd(self, command):
        self.current.append(command)

    def line(self, text, font="F1", size=9, indent=0, gap=13):
        if self.y < 64:
            self.new_page()
        safe = pdf_string(text)
        self.cmd(f"BT /{font} {size} Tf 0.18 0.23 0.31 rg "
                 f"1 0 0 1 {MARGIN+indent} {self.y:.1f} Tm ({safe}) Tj ET")
        self.y -= gap

    def wrapped(self, text, width=88, indent=0, font="F1", size=9):
        for segment in textwrap.wrap(printable(text), width=width,
                                     break_long_words=True, break_on_hyphens=False) or [""]:
            self.line(segment, font=font, size=size, indent=indent)

    def section(self, title):
        self.y -= 9
        if self.y < 86:
            self.new_page()
        self.line(title, font="F2", size=12, gap=21)

    def new_page(self):
        if self.current:
            self.pages.append("\n".join(self.current).encode("latin-1", "replace"))
        self.number += 1
        self.current = [
            "0.06 0.25 0.35 rg 0 787 595 55 re f",
            "BT /F2 18 Tf 1 1 1 rg 1 0 0 1 46 805 Tm (THE FIXER) Tj ET",
            "BT /F1 9 Tf 0.78 0.89 0.94 rg 1 0 0 1 46 792 Tm (LOCAL SECURITY AUDIT) Tj ET",
            "0.80 0.84 0.88 RG 46 53 m 549 53 l S",
            f"BT /F1 8 Tf 0.40 0.45 0.50 rg 1 0 0 1 46 39 Tm "
            f"(Confidential - unverified model observations  |  Page {self.number}) Tj ET",
        ]
        self.y = PAGE_H - 87

    def save(self, path):
        if self.current:
            self.pages.append("\n".join(self.current).encode("latin-1", "replace"))
        objects = []
        def add(payload):
            objects.append(payload)
            return len(objects)
        catalog = add(b"")
        pages_obj = add(b"")
        font_normal = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        font_bold = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
        kids = []
        for page in self.pages:
            compressed = zlib.compress(page, 9)
            content_id = add(
                (f"<< /Length {len(compressed)} /Filter /FlateDecode >>\nstream\n").encode()
                + compressed + b"\nendstream"
            )
            page_id = add((f"<< /Type /Page /Parent {pages_obj} 0 R "
                           f"/MediaBox [0 0 {PAGE_W} {PAGE_H}] "
                           f"/Resources << /Font << /F1 {font_normal} 0 R "
                           f"/F2 {font_bold} 0 R >> >> "
                           f"/Contents {content_id} 0 R >>").encode())
            kids.append(f"{page_id} 0 R")
        objects[pages_obj-1] = (
            f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
        ).encode()
        objects[catalog-1] = f"<< /Type /Catalog /Pages {pages_obj} 0 R >>".encode()
        data = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for index, obj in enumerate(objects, 1):
            offsets.append(len(data))
            data.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
        xref = len(data)
        data.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
        for offset in offsets[1:]:
            data.extend(f"{offset:010d} 00000 n \n".encode())
        data.extend((f"trailer\n<< /Size {len(objects)+1} /Root {catalog} 0 R >>\n"
                     f"startxref\n{xref}\n%%EOF\n").encode())
        path.write_bytes(data)

def group_for(path):
    if path.startswith(("src/", "frontend/src/", "public/")):
        return "Application"
    if path.startswith(("prisma/", "src/Migrations/")):
        return "Database"
    if path.startswith(("tests/", "quality-tests/", "browser-tests/")):
        return "Tests"
    if path.startswith(("docs/", "security/")) or path.endswith(".md"):
        return "Documentation"
    return "CI and configuration"

def create_report(data, destination):
    """Render every observation from report.json, in source order, with no cap."""
    pdf = Pdf()
    date = datetime.now().strftime("%Y-%m-%d %H:%M")
    findings = data.get("findings", [])
    errors = data.get("errors", [])
    skipped = data.get("skipped_files", [])
    severity = collections.Counter(str(x.get("severity", "unknown")).lower()
                                   for x in findings)
    categories = collections.Counter(group_for(str(x.get("file", "")))
                                     for x in findings)
    dup_keys = set()
    duplicate_count = 0
    for x in findings:
        key = (str(x.get("file", "")), x.get("line"),
               str(x.get("title", "")).casefold().strip())
        if key in dup_keys:
            duplicate_count += 1
        dup_keys.add(key)

    pdf.line("Comprehensive audit report", font="F2", size=16, gap=24)
    pdf.wrapped("Generated locally: " + date)
    pdf.wrapped("Model: " + str(data.get("model", "unspecified local Ollama model")))
    pdf.wrapped("Scanner schema: " + str(data.get("schema_version", "unknown")))
    pdf.wrapped("Report timestamp: " + str(data.get("created_at", "not recorded")))
    pdf.wrapped("STATUS: " + ("ALL REVIEWABLE CHUNKS PROCESSED" if data.get("complete")
                             else "INCOMPLETE - REVIEW REQUIRED"), font="F2")
    pdf.section("Scope and coverage")
    for label, value in (
        ("Total tracked files recorded", data.get("total_tracked_files", "unknown")),
        ("Reviewable files", data.get("eligible_files", 0)),
        ("Files completely reviewed", data.get("reviewed_files", 0)),
        ("Total source chunks", data.get("total_chunks", 0)),
        ("Chunks completed", data.get("completed_chunks", 0)),
        ("Failed chunks", len(errors)),
        ("Excluded tracked paths", len(skipped)),
        ("Source segments truncated", len(data.get("truncated_files", []))),
        ("Total AI observations", len(findings)),
        ("Identical path/line/title observations", duplicate_count),
        ("All tracked paths included", data.get("all_tracked_included", "unknown")),
    ):
        pdf.wrapped(f"{label}: {value}", width=90)

    pdf.section("Interpretation and limitations")
    for note in (
        "Every finding in this report is an unverified AI claim, not a demonstrated exploit. The assigned severity is not a verified risk rating.",
        "Earlier scanner prompts contained a HIGH-severity example that may have distorted the severity distribution. Retained older findings should be interpreted cautiously.",
        "The PDF includes all recorded model evidence and recommendations. The evidence is model-authored, not independently verified source text.",
        "The scanner may redact apparent credentials before sending text to Ollama, but filenames, evidence and model output can still be sensitive. Keep this PDF in private storage.",
        "Do not automatically patch, deploy or merge based on these findings. Confirm vulnerable paths against real implementation and isolated regression tests.",
    ):
        pdf.wrapped("- " + note)
        pdf.y -= 3

    pdf.section("Model-labelled severity - NOT confirmed")
    for level in ("critical", "high", "medium", "low", "unknown"):
        pdf.line(f"{level.upper()}: {severity.get(level, 0)}")

    pdf.section("Observations by file category")
    for key, count in categories.most_common():
        pdf.wrapped(f"{key}: {count}")

    pdf.section("Observations by file - full index")
    for name, count in sorted(collections.Counter(
        str(x.get("file", "")) for x in findings).items()):
        pdf.wrapped(f"{name}  |  {count} observations")

    pdf.section(f"All {len(findings)} recorded observations - FULL DETAIL")
    pdf.wrapped("Presented in original JSON report order. Exact repeats are retained; "
                "no item count limit or severity-based omission.")
    for number, item in enumerate(findings, 1):
        pdf.section(f"Finding {number} of {len(findings)}  |  "
                    f"{str(item.get('severity', 'unknown')).upper()} (UNVERIFIED)")
        pdf.wrapped("File: " + str(item.get("file", "(not supplied)")))
        pdf.wrapped("Line: " + str(item.get("line", "(not supplied)")))
        pdf.wrapped("Category: " + group_for(str(item.get("file", ""))))
        pdf.wrapped("Title: " + str(item.get("title", "(not supplied)")))
        pdf.wrapped("Evidence (AI supplied): " + str(item.get("evidence", "(not supplied)")))
        pdf.wrapped("Recommendation (AI supplied): " +
                    str(item.get("recommendation", "(not supplied)")))
        pdf.y -= 4

    pdf.section(f"All {len(errors)} failed review chunks")
    if not errors:
        pdf.wrapped("No unresolved chunk errors were recorded.")
    for n, item in enumerate(errors, 1):
        pdf.section(f"Failed chunk {n} of {len(errors)}")
        for key in ("file", "first", "last", "error"):
            pdf.wrapped(f"{key}: {item.get(key, 'not supplied')}")

    pdf.section(f"All {len(skipped)} excluded tracked paths")
    if not skipped:
        pdf.wrapped("No excluded tracked paths were recorded.")
    for number, item in enumerate(skipped, 1):
        pdf.wrapped(f"{number}. {item.get('file', '(not supplied)')}  |  "
                    f"{item.get('reason', '(no reason)')}")

    truncated = data.get("truncated_files", [])
    pdf.section(f"All {len(truncated)} reported truncations")
    if not truncated:
        pdf.wrapped("The report recorded no truncated source segments.")
    for number, item in enumerate(truncated, 1):
        pdf.wrapped(f"{number}. {item}")

    pdf.section("Required validation before release")
    for note in (
        "1. Resolve, exclude with justification, or separately validate every failed/unreviewable input.",
        "2. Deduplicate and verify individual findings, especially authentication, MFA, authorization, tenant isolation and SQL injection.",
        "3. Validate suspected defects with reproducible tests in isolated Docker environments.",
        "4. Review remediation changes and rerun deterministic security suites before merging.",
        "5. Keep the report private: it can expose internal paths and security observations.",
    ):
        pdf.wrapped(note)
    destination.parent.mkdir(parents=True, exist_ok=True)
    pdf.save(destination)
    return len(pdf.pages)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--output-dir", type=Path, help="Destination directory, otherwise Windows Downloads")
    args = parser.parse_args()
    if not args.report.is_file():
        parser.error("No scanner report.json found. Finish or run a scan first.")
    try:
        destination_dir = args.output_dir if args.output_dir else get_windows_downloads()
        if not destination_dir.is_dir():
            raise RuntimeError(f"Output directory does not exist: {destination_dir}")
        data = json.loads(args.report.read_text(encoding="utf-8"))
        filename = "The_Fixer_Full_Detailed_Security_Audit_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".pdf"
        output = destination_dir / filename
        pages = create_report(data, output)
        print(f"PDF created ({pages} pages): {output}")
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"PDF export failed: {exc}", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
