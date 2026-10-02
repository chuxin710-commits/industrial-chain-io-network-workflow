"""Check curated snapshot provenance and run each extracted source bundle."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from build_bundles import build, CASES, ROOT


class DistributionTests(unittest.TestCase):
    def test_snapshot_hashes(self):
        for case in CASES:
            with self.subTest(case=case):
                folder = ROOT / case / "published"
                metadata = json.loads((folder / "snapshot.json").read_text())
                for name, expected in metadata["files_sha256"].items():
                    self.assertEqual(hashlib.sha256((folder / name).read_bytes()).hexdigest(), expected, name)
                for name, expected in metadata["code_sha256"].items():
                    self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), expected, name)

    def test_extracted_bundles_run(self):
        for case in CASES:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                package = build(case, root)
                extracted = root / "extracted"
                with zipfile.ZipFile(package) as archive:
                    self.assertIsNone(archive.testzip())
                    self.assertTrue(all("aggregated" not in name and "outputs/" not in name
                                        for name in archive.namelist()))
                    archive.extractall(extracted)
                output = root / "demo"
                result = subprocess.run([sys.executable, "-X", "utf8", "research/run_case.py", case,
                                         "--synthetic", "--output", str(output)], cwd=extracted,
                                        capture_output=True, text=True, encoding="utf-8")
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                manifest = json.loads((output / "run_manifest.json").read_text())
                self.assertEqual(manifest["status"], "complete")


if __name__ == "__main__":
    unittest.main()
