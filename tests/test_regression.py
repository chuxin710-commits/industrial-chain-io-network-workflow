"""Frozen synthetic reference, verified from explicit three-sector equations."""

import csv
from pathlib import Path

import pytest

from ionet.experiment import run_experiment


def test_synthetic_reference(tmp_path):
    sample = Path(__file__).resolve().parents[1] / "examples" / "synthetic_config.yaml"
    output = run_experiment(sample, tmp_path / "reference")
    with (output / "metrics.csv").open(encoding="utf-8", newline="") as stream:
        row = next(csv.DictReader(stream))
    assert (int(row["nodes"]), int(row["edges"])) == (3, 4)
    assert float(row["density"]) == pytest.approx(4 / 6)
    # Ordered pair distances are 4, 8, 20, 4, 36, 16; original denominator is six.
    reference_efficiency = sum(1 / d for d in (4, 8, 20, 4, 36, 16)) / 6
    assert float(row["global_efficiency"]) == pytest.approx(reference_efficiency, rel=1e-12)
    with (output / "io_importance.csv").open(encoding="utf-8", newline="") as stream:
        multipliers = list(csv.DictReader(stream))
    assert [row["sector"] for row in multipliers] == ["S01", "S02", "S03"]
    # m^T(I-A)=1^T gives m=(1604, 2132, 2040)/1337, without using the core solver.
    assert [float(row["output_multiplier"]) for row in multipliers] == pytest.approx(
        [1604 / 1337, 2132 / 1337, 2040 / 1337], rel=1e-12,
    )
