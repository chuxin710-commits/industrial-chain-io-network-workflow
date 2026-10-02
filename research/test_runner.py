"""Integration checks use subprocesses to isolate the two legacy model modules."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent


class RunnerTests(unittest.TestCase):
    def invoke(self, *args):
        return subprocess.run([sys.executable, "-X", "utf8", str(ROOT / "run_case.py"), *args],
                              capture_output=True, text=True, encoding="utf-8")

    def test_synthetic_cases_and_no_overwrite(self):
        for case in ("structure_resilience", "critical_sectors"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "demo"
                args = (case, "--synthetic", "--output", str(output))
                first = self.invoke(*args)
                self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
                manifest = json.loads((output / "run_manifest.json").read_text())
                self.assertEqual(manifest["status"], "complete")
                self.assertEqual(manifest["mode"], "synthetic")
                self.assertEqual(manifest["model_tests_exit_code"], 0)
                self.assertIn("run_case.py", manifest["code_sha256"])
                before = (output / "run_manifest.json").read_bytes()
                second = self.invoke(*args)
                self.assertNotEqual(second.returncode, 0)
                self.assertIn("already exists", second.stderr)
                self.assertEqual(before, (output / "run_manifest.json").read_bytes())

    def test_missing_data_leaves_no_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "out"
            result = self.invoke("critical_sectors", "--data-root", directory, "--output", str(output))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Missing 30", result.stderr)
            self.assertFalse(output.exists())

    def test_input_mode_required(self):
        result = self.invoke("structure_resilience", "--output", "unused")
        self.assertNotEqual(result.returncode, 0)

    def test_failed_run_records_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for year in range(2009, 2024):
                folder = root / str(year)
                folder.mkdir()
                for kind in ("Z", "X"):
                    (folder / f"{kind}_{year}.csv").write_text("node,DEMO\nDEMO,1\n", encoding="ascii")
            output = root / "out"
            result = self.invoke("critical_sectors", "--data-root", directory, "--output", str(output))
            self.assertNotEqual(result.returncode, 0)
            manifest = json.loads((output / "run_manifest.json").read_text())
            self.assertEqual(manifest["status"], "failed")
            self.assertEqual(manifest["error_type"], "AssertionError")

    def test_optimized_python_rejected(self):
        result = subprocess.run([sys.executable, "-O", str(ROOT / "run_case.py"),
                                 "critical_sectors", "--synthetic", "--output", "unused"],
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Do not use -O", result.stderr)


if __name__ == "__main__":
    unittest.main()
