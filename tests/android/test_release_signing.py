"""Run after sourcing /opt/data/tools/android-env.sh; serial Gradle probes."""
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2] / "apps/android"
NAMES = ("DAYMARK_KEYSTORE_PATH", "DAYMARK_KEYSTORE_PASSWORD", "DAYMARK_KEY_ALIAS", "DAYMARK_KEY_PASSWORD")

class ReleaseSigningTest(unittest.TestCase):
    def gradle(self, task, extra=None):
        env = {k: v for k, v in os.environ.items() if k not in NAMES}
        env.update(extra or {})
        return subprocess.run(["bash", "gradlew", task, "--dry-run", "--console=plain", "--max-workers=2", "-Dorg.gradle.jvmargs=-Xmx768m -XX:MaxMetaspaceSize=512m"], cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)

    def test_unsigned_release_assembly_refused(self):
        result = self.gradle(":app:assembleRelease")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("Release packaging refused", result.stdout)

    def test_unsigned_release_packaging_refused(self):
        result = self.gradle(":app:packageRelease")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("Release packaging refused", result.stdout)

    def test_partial_configuration_refused_without_echoing_values(self):
        marker = "/fixture/not-a-secret-or-a-real-key"
        result = self.gradle("help", {"DAYMARK_KEYSTORE_PATH": marker})
        self.assertNotEqual(0, result.returncode)
        self.assertIn("requires all four", result.stdout)
        self.assertNotIn(marker, result.stdout)

if __name__ == "__main__":
    unittest.main()
