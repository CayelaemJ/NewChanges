#!/usr/bin/env python3
"""Offline smoke test of Windows-download PDF exporter using synthetic data."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[2] / "scripts/ci/export-ollama-pdf.py"
spec = importlib.util.spec_from_file_location("exporter", path)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)

class PdfExportTests(unittest.TestCase):
    def test_pdf_is_valid_complete_local_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "test.pdf"
            sample = {
                "complete": False, "eligible_files": 5, "reviewed_files": 4,
                "completed_chunks": 8, "total_chunks": 9,
                "errors": [{"file":"src/server.ts","first":1,"last":3,"error":"test failure"}],
                "skipped_files": [{"file":"fixture.bin","reason":"binary"}],
                "findings": [
                    {"file":"src/server.ts","line":9,"severity":"high",
                     "title":"Mock sensitive test only", "evidence":"Synthetic evidence for PDF export"},
                    {"file":"tests/example.ts","line":11,"severity":"medium",
                     "title":"Mock test observation"}
                ]
            }
            pages = exporter.create_report(sample, dest)
            contents = dest.read_bytes()
            self.assertGreaterEqual(pages, 1)
            self.assertTrue(contents.startswith(b"%PDF-1.4"))
            self.assertIn(b"%%EOF", contents[-80:])
            self.assertGreater(len(contents), 1000)
            self.assertIn(b"xref", contents)

    def test_all_findings_included_without_cap(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "full.pdf"
            sample = {
                "complete": True, "eligible_files": 1, "reviewed_files": 1,
                "total_chunks": 1, "completed_chunks": 1,
                "errors": [], "skipped_files": [],
                "findings": [
                    {"file": "src/example.ts", "line": i, "severity": "medium",
                     "title": f"Finding #{i}", "evidence": f"Evidence #{i}",
                     "recommendation": f"Remediation #{i}"}
                    for i in range(1, 151)
                ]
            }
            pages = exporter.create_report(sample, dest)
            self.assertGreater(pages, 5)
            self.assertGreater(dest.stat().st_size, 10000)
            import zlib
            payload = dest.read_bytes()
            import re
            text = b"".join(
                zlib.decompress(match.group(1))
                for match in re.finditer(rb"\\nstream\\n(.*?)\\nendstream", payload, re.S)
            )
            self.assertIn(b"Finding #1", text)
            self.assertIn(b"Finding #150", text)
            self.assertIn(b"Evidence #150", text)
            self.assertIn(b"Remediation #150", text)

    def test_pdf_string_escape(self):
        self.assertEqual(exporter.pdf_string("a(b)\\c"), r"a\(b\)\\c")

if __name__ == "__main__":
    unittest.main()
