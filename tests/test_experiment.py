import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest
import yaml

from ionet.experiment import load_config, run_experiment


SAMPLE = Path(__file__).resolve().parents[1] / "examples" / "synthetic_config.yaml"


def test_reproducible_run_and_manifest(tmp_path):
    a = run_experiment(SAMPLE, tmp_path / "a")
    b = run_experiment(SAMPLE, tmp_path / "b")
    for filename in ("metrics.csv", "io_importance.csv", "node_metrics.csv", "data_version.txt"):
        assert (a / filename).read_bytes() == (b / filename).read_bytes()
    manifest = json.loads((a / "run_manifest.json").read_text())
    assert manifest["status"] == "complete"
    assert len(manifest["sha256"]) == 8
    for name, expected in manifest["sha256"].items():
        assert hashlib.sha256((a / name).read_bytes()).hexdigest() == expected
    provenance = json.loads((a / "provenance.json").read_text())
    assert provenance["config_sha256"] == hashlib.sha256(SAMPLE.read_bytes()).hexdigest()
    assert "core/io_system.py" in provenance["code_manifest"]
    assert "network/build.py" in provenance["code_manifest"]
    assert "not economic resilience" in provenance["interpretation"]


def test_refuse_to_overwrite(tmp_path):
    output = run_experiment(SAMPLE, tmp_path / "existing")
    before = {p.name: p.read_bytes() for p in output.iterdir()}
    with pytest.raises(FileExistsError):
        run_experiment(SAMPLE, output)
    assert before == {p.name: p.read_bytes() for p in output.iterdir()}


@pytest.mark.parametrize("mutation", [
    lambda c: c.update(extra_setting=True),
    lambda c: c.update(seed=True),
    lambda c: c.update(seed=-1),
    lambda c: c.update(schema_version=True),
    lambda c: c["network"].update(threshhold=0.5),
    lambda c: c["dataset"].update(kind="mrio"),
    lambda c: c["dataset"].update(unit=""),
    lambda c: c["dataset"].update(name="name\nsha256=forged"),
])
def test_reject_invalid_config(tmp_path, mutation):
    config, _ = load_config(SAMPLE)
    mutation(config)
    invalid = tmp_path / "invalid.yaml"
    invalid.write_text(yaml.safe_dump(config), encoding="utf-8")
    with pytest.raises(ValueError):
        run_experiment(invalid, tmp_path / "must_not_exist")
    assert not (tmp_path / "must_not_exist").exists()


def test_reject_imbalance_before_output(tmp_path):
    config, _ = load_config(SAMPLE)
    config["dataset"]["y"][0] += 1
    invalid = tmp_path / "invalid.yaml"
    invalid.write_text(yaml.safe_dump(config), encoding="utf-8")
    with pytest.raises(ValueError, match="row balance|satisfy"):
        run_experiment(invalid, tmp_path / "must_not_exist")
    assert not (tmp_path / "must_not_exist").exists()


@pytest.mark.parametrize("payload", [
    "seed: 1\nseed: 2\n", "dataset: [unclosed", "[]",
    "? [invalid, key]\n: value\n", "1: value\nsetting: value\n",
])
def test_reject_duplicate_and_malformed_yaml(tmp_path, payload):
    invalid = tmp_path / "invalid.yaml"
    invalid.write_text(payload, encoding="utf-8")
    with pytest.raises(ValueError):
        load_config(invalid)


def test_cli_from_another_working_directory(tmp_path):
    outcome = subprocess.run([
        sys.executable, "-m", "ionet", "run", "--config", str(SAMPLE),
        "--output", str(tmp_path / "cli"),
    ], cwd=tmp_path, capture_output=True, text=True, timeout=30)
    assert outcome.returncode == 0, outcome.stderr
    assert (tmp_path / "cli" / "run_manifest.json").exists()


def test_import_has_no_experiment_side_effects(tmp_path):
    outcome = subprocess.run([
        sys.executable, "-c", "import ionet; print(ionet.__version__)",
    ], cwd=tmp_path, capture_output=True, text=True, timeout=30)
    assert outcome.returncode == 0, outcome.stderr
    assert outcome.stdout.strip() == "0.1.0.dev0"
    assert list(tmp_path.iterdir()) == []


def test_main_success_and_no_overwrite(tmp_path, monkeypatch, capsys):
    from ionet.__main__ import main

    monkeypatch.setattr(sys, "argv", [
        "ionet", "run", "--config", str(SAMPLE), "--output", str(tmp_path / "result"),
    ])
    main()
    assert "Completed:" in capsys.readouterr().out
    with pytest.raises(SystemExit) as failure:
        main()
    assert failure.value.code == 2
    assert "ionet:" in capsys.readouterr().err

