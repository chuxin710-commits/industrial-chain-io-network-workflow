"""Export only explicitly selected, non-monetary research summaries."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import pandas as pd

ROOT = Path(__file__).resolve().parent
SUMMARY_FILES = {
    "structure_resilience": ["annual_metrics.csv", "entropy_weights.csv", "ode_sensitivity.csv",
                             "paired_comparison.csv", "robustness_summary.csv",
                             "threshold_sensitivity.csv", "cascades.csv"],
    "critical_sectors": ["ranking_comparison.csv", "predictor_comparison.csv",
                         "ranking_sensitivity.csv", "policy_summary.csv", "tie_audit.csv",
                         "dynamic_sensitivity.csv"],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", choices=SUMMARY_FILES)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source, output = args.run.resolve(), args.output.resolve()
    run = json.loads((source / "run_manifest.json").read_text(encoding="utf-8"))
    if run["status"] != "complete" or run["mode"] != "private_mrio" or run["case"] != args.case:
        parser.error("Only a completed matching private MRIO run can be exported.")
    output.mkdir(parents=True, exist_ok=False)
    names = SUMMARY_FILES[args.case] + ["config.json"]
    for name in names:
        shutil.copyfile(source / name, output / name)
    if args.case == "structure_resilience":
        frame = pd.read_csv(source / "regressions.csv")
        frame = frame[frame["term"] == frame["metric"]]
        frame.to_csv(output / "regression_core.csv", index=False)
    else:
        annual = pd.read_csv(source / "annual.csv").drop(columns=["equal_shock_amount"])
        annual.to_csv(output / "annual.csv", index=False)
        random = pd.read_csv(source / "policy_random.csv")
        draws = random.groupby(["year", "draw"])["efficiency_gain_pp"].mean()
        draws.groupby("year").agg(mean="mean", q025=lambda x: x.quantile(.025),
                                   q975=lambda x: x.quantile(.975)).to_csv(output / "random_policy_summary.csv")
    names = sorted(p.name for p in output.iterdir() if p.is_file())
    metadata = {
        "case": args.case, "scope": "selected non-monetary summaries; not full input data",
        "run_started_utc": run["started_utc"], "dependencies": run["dependencies"],
        "code_sha256": run["code_sha256"],
        "files_sha256": {name: hashlib.sha256((output / name).read_bytes()).hexdigest() for name in names},
        "excluded": ["raw inputs", "aggregated Z/X", "node panels", "monetary shock amounts",
                     "full validation logs", "absolute local paths", "unpublished Word manuscripts"],
    }
    (output / "snapshot.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Exported {len(names)} summary files: {output}")


if __name__ == "__main__":
    main()
