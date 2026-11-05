#!/usr/bin/env python3
"""Export a local Ollama audit as a private, dependency-free PDF.

The PDF summarizes *unverified* observations. It does not include raw source,
credentials, or model-evidence excerpts. Nothing is uploaded to GitHub.
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

    def wrapped(self, text, width=102, indent=0, font="F1", size=9):
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
    pdf = Pdf()
    date = datetime.now().strftime("%Y-%m-%d %H:%M")
    findings = data.get("findings", [])
    errors = data.get("errors", [])
    skipped = data.get("skipped_files", [])
    severity = collections.Counter(str(item.get("severity", "unknown")).lower()
                                   for item in findings)
    categories = collections.Counter(group_for(str(item.get("file", "")))
                                     for item in findings)
    unique = []
    duplicates = 0
    seen = set()
    for item in findings:
        key = (str(item.get("file", "")), item.get("line"),
               str(item.get("title", "")).casefold().strip())
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        unique.append(item)
    pdf.line("Security audit overview", font="F2", size=16, gap=24)
    pdf.wrapped("Generated: " + date)
    pdf.wrapped("Source: local Ollama qwen2.5-coder:7b; source report held on this PC.")
    pdf.wrapped("STATUS: " + ("ALL REVIEWABLE CHUNKS PROCESSED" if data.get("complete")
                             else "INCOMPLETE - REVIEW REQUIRED"),
                font="F2")
    pdf.section("Coverage")
    for caption, value in [
        ("Files reviewed", f"{data.get('reviewed_files', 0)}/{data.get('eligible_files', 0)}"),
        ("Chunks processed", f"{data.get('completed_chunks', 0)}/{data.get('total_chunks', 0)}"),
        ("Unresolved chunk failures", str(len(errors))),
        ("Excluded tracked paths", str(len(skipped))),
        ("Model observations (unverified)", str(len(findings))),
        ("Repeated file/line/title observations", str(duplicates)),
    ]:
        pdf.line(f"{caption}: {value}")
    pdf.section("Important limitations")
    for paragraph in [
        "Model-assigned severity is NOT confirmation of exploitability. Findings can be repetitive, inaccurate, or based on tests and documentation.",
        "A previous version of this scanner used a HIGH-severity example, which may have inflated its findings. Historical severity totals need independent validation.",
        "This PDF intentionally omits raw source snippets and model evidence. The full JSON report remains in the local test-reports/ai-security directory.",
        "Do not auto-deploy or auto-merge findings. Validate suspected auth/MFA, access control, injection and tenant isolation defects against source code and deterministic regression tests.",
    ]:
        pdf.wrapped("- " + paragraph, width=106)
        pdf.y -= 4
    pdf.section("Model-assigned severity (unverified)")
    for level in ("critical", "high", "medium", "low", "unknown"):
        pdf.line(f"{level.upper()}: {severity.get(level, 0)}")
    pdf.section("Observations by code category")
    for category, count in categories.most_common():
        pdf.line(f"{category}: {count}")
    pdf.section("Unresolved chunks")
    if not errors:
        pdf.line("No unresolved chunk errors were recorded.")
    else:
        for item in errors[:40]:
            pdf.wrapped(f"- {item.get('file', '?')} lines {item.get('first', '?')}-"
                        f"{item.get('last', '?')}: {item.get('error', 'unknown')}", width=106)
    pdf.section("Most flagged files (counts, not confirmed vulnerabilities)")
    files = collections.Counter(str(x.get("file", "")) for x in findings)
    for path, count in files.most_common(35):
        pdf.wrapped(f"{count:>4}  {path}", width=106)
    pdf.section("Selected implementation observations - manual validation required")
    app_findings = [
        item for item in unique
        if group_for(str(item.get("file", ""))) in ("Application", "Database")
    ]
    app_findings.sort(key=lambda x: (
        ("critical", "high", "medium", "low").index(str(x.get("severity", "low")).lower())
        if str(x.get("severity", "low")).lower() in ("critical", "high", "medium", "low")
        else 4, str(x.get("file", "")), x.get("line", 0)
    ))
    for item in app_findings[:75]:
        pdf.wrapped(
            f"- [{str(item.get('severity','?')).upper()} - UNVERIFIED] "
            f"{item.get('file','?')}:{item.get('line','?')} "
            f"{item.get('title','(untitled)')}", width=100
        )
    if len(app_findings) > 75:
        pdf.wrapped(
            f"... {len(app_findings) - 75} additional unique application/database "
            "observations remain in the local JSON report.", width=100
        )
    pdf.section("Review before deployment")
    for item in [
        "1. Resolve or explicitly account for missing chunks and unscanned material.",
        "2. Reassess model-generated severity independently.",
        "3. Verify any real security defect with source-level evidence and tests.",
        "4. Re-run deterministic CI, MFA and tenant isolation checks in Docker.",
        "5. Review PR #219 before merge; do not modify production from this PDF.",
    ]:
        pdf.wrapped(item, width=106)
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
        filename = "The_Fixer_Security_Audit_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".pdf"
        output = destination_dir / filename
        pages = create_report(data, output)
        print(f"PDF created ({pages} pages): {output}")
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"PDF export failed: {exc}", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
