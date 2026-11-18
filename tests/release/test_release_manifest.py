import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / 'scripts' / 'create_android_release.py'


def load_tool(test):
    test.assertTrue(TOOL.is_file(), 'Android release manifest builder is missing')
    spec = importlib.util.spec_from_file_location('daymark_release', TOOL)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReleaseManifestTests(unittest.TestCase):
    def test_accepts_real_aapt2_minimum_sdk_spelling(self):
        tool = load_tool(self)
        badging = "package: name='com.everyonesoftware.daymark' versionCode='2' versionName='0.2.0' platformBuildVersionName='16'\nminSdkVersion:'26'\ntargetSdkVersion:'36'\n"
        self.assertEqual(tool.parse_badging(badging)['minSdk'], 26)

    def test_reads_package_version_and_minimum_sdk_from_apk_badging(self):
        tool = load_tool(self)
        text = "package: name='com.everyonesoftware.daymark' versionCode='2' versionName='0.2.0'\nsdkVersion:'26'\n"
        self.assertEqual(tool.parse_badging(text), {
            'packageName': 'com.everyonesoftware.daymark',
            'versionName': '0.2.0', 'versionCode': 2, 'minSdk': 26,
        })

    def test_packages_exact_apk_bytes_and_manifest_checksum(self):
        import hashlib
        import json
        import tempfile
        tool = load_tool(self)
        self.assertTrue(hasattr(tool, 'build_release'), 'Release packaging is not implemented')
        with tempfile.TemporaryDirectory() as root:
            apk = Path(root) / 'input.apk'
            apk.write_bytes(b'unit-test APK bytes, not a distributable package')
            badging = "package: name='com.everyonesoftware.daymark' versionCode='2' versionName='0.2.0'\nsdkVersion:'26'\n"
            out = Path(root) / 'out'
            result = tool.build_release(apk, badging, out)
            self.assertEqual(result['apkAssetName'], 'Tasks-0.2.0-2.apk')
            self.assertEqual(result['sha256'], hashlib.sha256(apk.read_bytes()).hexdigest())
            self.assertEqual((out / result['apkAssetName']).read_bytes(), apk.read_bytes())
            self.assertEqual(json.loads((out / 'tasks-release.json').read_text()), result)
            self.assertEqual((out / 'daymark-release.json').read_bytes(),
                             (out / 'tasks-release.json').read_bytes())
            self.assertEqual(result['schemaVersion'], 1)

    def test_rejects_wrong_package_and_unsafe_release_identifiers(self):
        tool = load_tool(self)
        for package, code, version, sdk in [
            ('com.other.app', '2', '0.2.0', '26'),
            ('com.everyonesoftware.daymark', '0', '0.2.0', '26'),
            ('com.everyonesoftware.daymark', '2147483648', '0.2.0', '26'),
            ('com.everyonesoftware.daymark', '2', '../../outside', '26'),
            ('com.everyonesoftware.daymark', '2', '0.2.0', '0'),
        ]:
            with self.subTest(package=package, code=code, version=version, sdk=sdk):
                text = f"package: name='{package}' versionCode='{code}' versionName='{version}'\nsdkVersion:'{sdk}'\n"
                with self.assertRaises(ValueError):
                    tool.parse_badging(text)

    def test_cli_blocks_debug_apks_unless_explicitly_allowed(self):
        import json
        import subprocess
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            apk = root / 'fixture.apk'
            apk.write_bytes(b'unit-test-only bytes')
            aapt = root / 'fixture-aapt'
            aapt.write_text(f'#!{sys.executable}\nprint(\"package: name=\\\'com.everyonesoftware.daymark\\\' versionCode=\\\'2\\\' versionName=\\\'0.2.0\\\'\")\nprint(\"sdkVersion:\\\'26\\\'\")\nprint(\"application-debuggable\")\n')
            aapt.chmod(0o700)
            out = root / 'out'
            command = [sys.executable, str(TOOL), '--apk', str(apk), '--out', str(out), '--aapt', str(aapt)]
            refused = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(refused.returncode, 0, 'CLI must refuse a debug APK by default')
            self.assertFalse((out / 'tasks-release.json').exists())
            self.assertFalse((out / 'daymark-release.json').exists())
            allowed = subprocess.run(command + ['--allow-debug'], capture_output=True, text=True)
            self.assertEqual(allowed.returncode, 0, allowed.stderr)
            self.assertEqual(json.loads((out / 'tasks-release.json').read_text())['versionCode'], 2)
            self.assertEqual((out / 'daymark-release.json').read_bytes(),
                             (out / 'tasks-release.json').read_bytes())


if __name__ == '__main__':
    unittest.main()
