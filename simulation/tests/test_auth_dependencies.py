"""Ensure Docker tests cannot silently lose MySQL 8.4 SHA-2 auth support."""
from pathlib import Path
import unittest


SIM_ROOT = Path(__file__).resolve().parents[1]


class MySQL84AuthDependencies(unittest.TestCase):
    def test_requirements_pin_pymysql_rsa_extra(self):
        deps = (SIM_ROOT / "requirements.txt").read_text(encoding="utf-8")
        lines = {line.strip() for line in deps.splitlines() if line.strip() and not line.startswith("#")}
        self.assertIn("PyMySQL[rsa]==1.1.1", lines)
        self.assertIn("cryptography==50.0.2", lines)

    def test_docker_image_checks_crypto_backend_during_build(self):
        dockerfile = (SIM_ROOT / "Dockerfile.test").read_text(encoding="utf-8")
        self.assertIn("import cryptography", dockerfile)
        self.assertIn("cryptography.hazmat.primitives.asymmetric", dockerfile)


if __name__ == "__main__":
    unittest.main()
