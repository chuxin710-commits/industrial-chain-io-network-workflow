"""Small deterministic IO/network run with explicit, inspectable provenance."""

import csv
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import platform
import sys

import yaml

from .core import IOSystem
from .network import build_network, structural_metrics


class _UniqueSafeLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        self.flatten_mapping(node)
        seen = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str):
                raise ValueError("Configuration mapping keys must be strings")
            if key in seen:
                raise ValueError(f"Duplicate configuration key: {key}")
            seen.add(key)
        return super().construct_mapping(node, deep=deep)


def _keys(mapping, required, optional=(), context="configuration"):
    if not isinstance(mapping, dict):
        raise ValueError(f"{context} must be a mapping")
    missing = set(required) - mapping.keys()
    unknown = mapping.keys() - set(required) - set(optional)
    if missing or unknown:
        raise ValueError(f"{context}: missing={sorted(missing)}, unknown={sorted(unknown)}")


def load_config(path):
    raw = Path(path).read_bytes()
    try:
        config = yaml.load(raw, Loader=_UniqueSafeLoader)
    except yaml.YAMLError as exc:
        raise ValueError("Configuration must be valid safe YAML") from exc
    _keys(config, ("schema_version", "dataset", "network", "seed"))
    if type(config["schema_version"]) is not int or config["schema_version"] != 1:
        raise ValueError("Only schema_version: 1 is supported")
    seed = config["seed"]
    if type(seed) is not int or not 0 <= seed < 2**32:
        raise ValueError("seed must be an integer in [0, 2**32)")
    dataset = config["dataset"]
    _keys(dataset, ("kind", "name", "Z", "x", "y", "sectors", "unit", "price_basis"),
          context="dataset")
    if dataset["kind"] != "synthetic_inline":
        raise ValueError("This first slice supports only synthetic_inline, not real-data adapters")
    for key in ("name", "unit", "price_basis"):
        if not isinstance(dataset[key], str) or not dataset[key].strip():
            raise ValueError(f"dataset.{key} must be a nonempty string")
        if any(ord(char) < 32 for char in dataset[key]):
            raise ValueError(f"dataset.{key} must be single-line printable metadata")
    _keys(config["network"], ("matrix", "threshold"), context="network")
    return config, raw


def run_experiment(config_path, output_dir):
    config, raw = load_config(config_path)
    dataset = config["dataset"]
    system = IOSystem(
        Z=dataset["Z"], x=dataset["x"], y=dataset["y"], sectors=dataset["sectors"],
        metadata={"dataset": dataset["name"], "amount_unit": dataset["unit"],
                  "price_basis": dataset["price_basis"], "source_type": dataset["kind"],
                  "accounting_scope": "synthetic_closed_system",
                  "y_scope": "explicit_synthetic_final_use"},
    )
    if not system.row_balance():
        raise ValueError("Synthetic data must satisfy x = Z @ 1 + y with explicitly supplied y")
    network = build_network(system, **config["network"])
    metrics = structural_metrics(network)
    incoming = metrics.pop("in_strength")
    outgoing = metrics.pop("out_strength")
    # Full A, including its diagonal, is used for economic IO calculations.
    multipliers = system.L.sum(axis=0)
    data_hash = hashlib.sha256(json.dumps(
        {key: dataset[key] for key in ("Z", "x", "y", "sectors")},
        sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    ).encode("utf-8")).hexdigest()
    environment = {"python": platform.python_version(), "platform": sys.platform}
    for package in ("industrial-chain-io-network-workflow", "numpy", "scipy", "networkx", "PyYAML"):
        environment[package] = version(package)
    package_root = Path(__file__).resolve().parent
    code_manifest = {
        path.relative_to(package_root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(package_root.rglob("*.py"))
    }
    provenance = {
        "schema_version": 1,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_name": dataset["name"], "data_sha256": data_hash,
        "config_sha256": hashlib.sha256(raw).hexdigest(),
        "code_sha256": hashlib.sha256(json.dumps(code_manifest, sort_keys=True).encode()).hexdigest(),
        "code_manifest": code_manifest,
        "seed": config["seed"], "randomness": "deterministic; no random draws in this slice",
        "environment": environment,
        "interpretation": "structural metrics and IO multipliers; not economic resilience or causal loss",
    }
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=False)
    (output / "config_snapshot.yaml").write_bytes(raw)
    (output / "environment.txt").write_text(
        "".join(f"{key}={value}\n" for key, value in environment.items()), encoding="utf-8",
    )
    (output / "data_version.txt").write_text(
        f"dataset={dataset['name']}\nsha256={data_hash}\nsource_type=synthetic_inline\n", encoding="utf-8",
    )
    with (output / "metrics.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(metrics))
        writer.writeheader()
        writer.writerow(metrics)
    with (output / "io_importance.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(("sector", "output_multiplier"))
        writer.writerows(zip(system.sectors, multipliers))
    with (output / "node_metrics.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(("sector", "in_strength", "out_strength"))
        writer.writerows((node, incoming[node], outgoing[node]) for node in system.sectors)
    (output / "provenance.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8",
    )
    (output / "run.log").write_text(
        "PASS: explicit row balance; productive Leontief system; directed network metrics.\n"
        "Only synthetic inputs were used. No shock, cascade, or recovery model was executed.\n",
        encoding="utf-8",
    )
    files = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in output.iterdir()}
    # The complete marker is written last; failed writes must not look like a completed run.
    (output / "run_manifest.json").write_text(
        json.dumps({"status": "complete", "sha256": files}, indent=2) + "\n", encoding="utf-8",
    )
    return output

