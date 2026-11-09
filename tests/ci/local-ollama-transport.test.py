import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.local_ollama_transport import local_ollama_url


class LocalOllamaTransportTests(unittest.TestCase):
    def test_canonicalizes_allowed_local_endpoints(self):
        for origin, expected in (
            ("http://host.docker.internal:11434", "http://host.docker.internal:11434/api/generate"),
            ("http://localhost:11434/", "http://localhost:11434/api/generate"),
            ("http://127.0.0.1", "http://127.0.0.1:11434/api/generate"),
        ):
            with self.subTest(origin=origin):
                self.assertEqual(local_ollama_url(origin, "/api/generate"), expected)

    def test_rejects_nonlocal_or_ambiguous_destinations(self):
        for value in (
            "file:///etc/passwd",
            "https://host.docker.internal:11434",
            "http://ollama.example:11434",
            "http://host.docker.internal.evil:11434",
            "http://user@localhost:11434",
            "http://localhost:8080",
            "http://localhost:11434/api/generate?token=x",
            "http://localhost:11434/#fragment",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                local_ollama_url(value, "/api/generate")


if __name__ == "__main__":
    unittest.main()
