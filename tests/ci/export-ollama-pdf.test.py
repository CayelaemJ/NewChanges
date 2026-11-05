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
    def test_pdf_is_valid_pdf_container_with_sources_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "test.pdf"
            sample = {
                "complete": False, "eligible_files": 5, "reviewed_files": 4,
                "completed_chunks": 8, "total_chunks": 9,
                "errors": [{"file":"src/server.ts","first":1,"last":3,"error":"test failure"}],
                "skipped_files": [{"file":"fixture.bin","reason":"binary"}],
                "findings": [
                    {"file":"src/server.ts","line":9,"severity":"high",
                     "title":"Mock sensitive test only", "evidence":"SECRET_TEST_PAYLOAD_SHOULD_NOT_APPEAR"},
                    {"file":"tests/example.ts","line":11,"severity":"medium",
                     "title":"Mock test observation"}
                ]
            }
            pages = exporter.create_report(sample, dest)
            contents = dest.read_bytes()
            self.assertGreaterEqual(pages, 1)
            self.assertTrue(contents.startswith(b"%PDF-1.4"))
            self.assertIn(b"%%EOF", contents[-80:])
            self.assertNotIn(b"SECRET_TEST_PAYLOAD_SHOULD_NOT_APPEAR", contents)
            self.assertIn(b"xref", contents)

    def test_pdf_string_escape(self):
        self.assertEqual(exporter.pdf_string("a(b)\\c"), r"a\(b\)\\c")

if __name__ == "__main__":
    unittest.main()
