"""Run one isolated research case; private inputs never become bundled data."""
import argparse
import hashlib
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
CASES = ("structure_resilience", "critical_sectors")


def required_sources(case, data):
    kinds = ["Z", "X", "VA", "F", "M_inter", "E", "Err"] if case == CASES[0] else ["Z", "X"]
    return [data / str(year) / f"{kind}_{year}.csv"
            for year in range(2009, 2024) for kind in kinds]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", choices=CASES)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--synthetic", action="store_true")
    inputs.add_argument("--data-root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if sys.flags.optimize:
        parser.error("Do not use -O: these research scripts use assertions for scientific checks.")
    output = args.output.resolve()
    if output.exists():
        parser.error("Output already exists; choose a new run directory.")
    data = args.data_root.resolve() if args.data_root else None
    if data:
        missing = [p for p in required_sources(args.case, data) if not p.is_file()]
        if missing:
            parser.error(f"Missing {len(missing)} required source files; first: {missing[0]}")
    case_root = ROOT / args.case
    output.mkdir(parents=True)
    versions = {}
    for package in ("numpy", "scipy", "networkx", "pandas", "statsmodels"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    files = [Path(__file__), *sorted(case_root.glob("*.py"))]
    manifest = {
        "case": args.case, "mode": "synthetic" if args.synthetic else "private_mrio",
        "status": "started", "started_utc": datetime.now(timezone.utc).isoformat(),
        "python": platform.python_version(), "dependencies": versions,
        "code_sha256": {str(p.relative_to(ROOT)).replace("\\", "/"):
                        hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
        "raw_data_bundled": False,
    }
    manifest_path = output / "run_manifest.json"

    def save_manifest():
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    save_manifest()
    try:
        env = os.environ.copy()
        env["PYTHONUTF8"] = "1"
        tests = subprocess.run([sys.executable, "-X", "utf8", str(case_root / "test_model.py")],
                               capture_output=True, text=True, encoding="utf-8", env=env)
        (output / "model_tests.txt").write_text(tests.stdout + tests.stderr, encoding="utf-8")
        manifest["model_tests_exit_code"] = tests.returncode
        tests.check_returncode()
        # Case scripts retain their original module names, isolated per CLI process.
        sys.path.insert(0, str(case_root))
        if args.synthetic:
            importlib.import_module("demo").main(output)
        else:
            experiment = importlib.import_module("run_experiments")
            experiment.OUT = output
            if args.case == CASES[0]:
                experiment.DATA = data
                experiment.main()
                importlib.import_module("extend_sensitivity").main()
                importlib.import_module("validate_results").main()
            else:
                experiment.main(data)
                extension = importlib.import_module("extend_analysis")
                extension.OUT, extension.DATA = output, data
                extension.main()
        manifest["status"] = "complete"
    except BaseException as exc:
        manifest.update(status="failed", error_type=type(exc).__name__)
        raise
    finally:
        manifest["finished_utc"] = datetime.now(timezone.utc).isoformat()
        save_manifest()
    print(f"Completed {args.case} ({manifest['mode']}): {output}")


if __name__ == "__main__":
    main()
