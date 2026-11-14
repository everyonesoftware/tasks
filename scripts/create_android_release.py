#!/usr/bin/env python3
"""Create Android release metadata from the APK, never from guessed versions."""
import re


def parse_badging(text):
    package = re.search(r"^package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'", text, re.MULTILINE)
    sdk = re.search(r"^(?:sdkVersion|minSdkVersion):'([0-9]+)'", text, re.MULTILINE)
    if not package or not sdk:
        raise ValueError('APK package/version/minimum SDK could not be read')
    if package[1] != 'com.everyonesoftware.daymark':
        raise ValueError('Only the Daymark Android package can be published')
    if not 1 <= int(package[2]) <= 2_100_000_000:
        raise ValueError('Invalid Android version code')
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?', package[3]):
        raise ValueError('Version name is not a safe release identifier')
    if not 1 <= int(sdk[1]) <= 1000:
        raise ValueError('Invalid minimum Android SDK')
    return {'packageName': package[1], 'versionName': package[3],
            'versionCode': int(package[2]), 'minSdk': int(sdk[1])}


def build_release(apk, badging, out):
    import hashlib
    import json
    from pathlib import Path
    import shutil
    info = parse_badging(badging)
    apk, out = Path(apk), Path(out)
    name = f"Daymark-{info['versionName']}-{info['versionCode']}.apk"
    with apk.open('rb') as handle:
        checksum = hashlib.file_digest(handle, 'sha256').hexdigest()
    manifest = {'schemaVersion': 1, **info, 'apkAssetName': name, 'sha256': checksum}
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(apk, out / name)
    (out / 'daymark-release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def main(argv=None):
    import argparse
    import os
    from pathlib import Path
    import shutil
    import subprocess
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--aapt', type=Path, help='Override Android aapt2 executable')
    parser.add_argument('--allow-debug', action='store_true', help='Explicitly package a development APK, not a production release')
    args = parser.parse_args(argv)
    try:
        apk = args.apk.resolve(strict=True)
        if not apk.is_file() or apk.suffix.lower() != '.apk':
            raise ValueError('Input must be an APK file')
        aapt = args.aapt
        if aapt is None:
            found = shutil.which('aapt2')
            if found:
                aapt = Path(found)
            else:
                sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
                candidates = list((Path(sdk) / 'build-tools').glob('*/aapt2')) if sdk else []
                def version(path):
                    return tuple(int(n) for n in re.findall(r'\d+', path.parent.name))
                if candidates:
                    aapt = max(candidates, key=version)
        if aapt is None or not aapt.is_file():
            raise ValueError('Android aapt2 is required; set ANDROID_HOME or pass --aapt')
        result = subprocess.run([str(aapt.resolve()), 'dump', 'badging', str(apk)],
                                check=True, capture_output=True, text=True, timeout=60)
        if re.search(r'^application-debuggable\s*$', result.stdout, re.MULTILINE) and not args.allow_debug:
            raise ValueError('Refusing a debuggable APK; use a signed release build or explicitly pass --allow-debug for development')
        manifest = build_release(apk, result.stdout, args.out)
        print(f"Packaged {manifest['apkAssetName']} and daymark-release.json")
        print(f"Version {manifest['versionName']} / build {manifest['versionCode']}; SHA256 {manifest['sha256']}")
        if args.allow_debug:
            print('Development package only. Do not use a debug signing key for production releases.')
        print('No files were uploaded or published. Signing continuity must be maintained by the release build.')
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    raise SystemExit(main())
