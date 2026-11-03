#!/usr/bin/env python3
"""Offline unit checks for local Ollama scanner, no actual model or secrets."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "ai-security-review.py"
spec = importlib.util.spec_from_file_location("local_ollama_scanner", SCRIPT)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)

class LocalOllamaContractTests(unittest.TestCase):
    def test_docker_uses_the_reduced_scanner_chunk_limit(self):
        compose = Path(__file__).resolve().parents[2] / "docker-compose.ai-security.yml"
        self.assertRegex(compose.read_text(), r'AI_SCAN_CHUNK_CHARS:\s*"3000"')

    def test_chunking_preserves_every_char_and_line(self):
        lines = ["one", "two", "z" * 16000, "end"]
        pieces = scanner.chunks_for("\n".join(lines))
        self.assertGreaterEqual(len(pieces), 3)
        combined = {}
        for first, last, text in pieces:
            for record in text.splitlines():
                number, segment = record.split(": ", 1)
                self.assertLessEqual(first, int(number))
                self.assertLessEqual(int(number), last)
                combined.setdefault(int(number), []).append(segment)
        self.assertEqual(["".join(combined[i]) for i in range(1, 5)], lines)

    def test_plain_and_fenced_json(self):
        self.assertEqual(scanner.parse_answer('{"findings":[]}'), [])
        fence = chr(96) * 3
        self.assertEqual(scanner.parse_answer(fence + 'json\n{"findings":[]}\n' + fence), [])
        self.assertEqual(scanner.parse_answer('reply: {"findings":[]} done'), [])

    def test_non_json_is_not_reported_clean(self):
        with self.assertRaises(ValueError):
            scanner.parse_answer("Model got confused: zero issues!")
        with self.assertRaises(ValueError):
            scanner.parse_answer('{"unrelated": []}')

    def test_gpu_residency_detection(self):
        models = [{"name": "qwen2.5-coder:7b", "size_vram": 4870000000}]
        self.assertEqual(scanner.gpu_residency(models), 4870000000)
        self.assertEqual(scanner.gpu_residency([{"name": "qwen2.5-coder:7b", "size_vram": 0}]), 0)
        self.assertEqual(scanner.gpu_residency([{"name": "other:7b", "size_vram": 9000}]), 0)

    def test_gpu_required_refuses_cpu_only(self):
        class FakeResponse:
            def __init__(self, content): self.content = content
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return self.content
        replies = iter([
            FakeResponse(json.dumps({"response": "OK"}).encode()),
            FakeResponse(json.dumps({"models": [{"name": scanner.MODEL, "size_vram": 0}]}).encode())
        ])
        with patch.object(scanner, "REQUIRE_GPU", True), \
             patch.object(scanner, "urlopen", side_effect=lambda *args, **kwargs: next(replies)):
            with self.assertRaisesRegex(RuntimeError, "GPU acceleration REQUIRED"):
                scanner.require_local_gpu()

    def test_checkpoint_atomic(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "audit" / "check.json"
            scanner.atom_json(p, {"findings": [], "complete": True})
            self.assertEqual(json.loads(p.read_text())["findings"], [])
            self.assertFalse(p.with_name("check.json.tmp").exists())

    def test_retry_invalid_json_then_success(self):
        class FakeResponse:
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return self.payload
        results = iter([
            FakeResponse(json.dumps({"response": "bad json"}).encode()),
            FakeResponse(json.dumps({"response": '{"findings":[]}'}).encode())
        ])
        def json_load_stub(response): return json.loads(response.read())
        with patch.object(scanner, "urlopen", side_effect=lambda *args, **kwargs: next(results)), \
             patch.object(scanner.json, "load", side_effect=json_load_stub), \
             patch.object(scanner.time, "sleep"):
            findings, attempts = scanner.ask_model("safe.ts", 1, 1, "1: const x = 1")
        self.assertEqual(findings, [])
        self.assertEqual(attempts, 2)

if __name__ == "__main__":
    unittest.main()
