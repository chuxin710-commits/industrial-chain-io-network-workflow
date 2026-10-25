"""Read-only comparison of full threshold networks with the current display rule."""

import json
from pathlib import Path
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from topology import TopologyEngine


def main():
    root = Path(__file__).resolve().parents[1]
    engine = TopologyEngine(root / "var/mrio.sqlite3")
    results = []
    for year, level, threshold in [
        (2023, "sector", 0.005), (2023, "province", 0.005), (2023, "node", 0.005),
        *((2023, "sector", threshold) for threshold in (0, 0.001, 0.01, 0.02)),
    ]:
        config = {"year": str(year), "level": level, "threshold": str(threshold), "max_edges": "250"}
        start = perf_counter()
        snapshot = engine.query(config)
        elapsed = perf_counter() - start
        incident = {edge[key] for edge in snapshot["edges"] for key in ("source", "target")}
        hidden_connected = sum(node["in_degree"] + node["out_degree"] > 0 and node["id"] not in incident for node in snapshot["nodes"])
        results.append({"config": snapshot["config"], "metrics": snapshot["metrics"],
                        "display_connected_nodes": len(incident), "connected_but_visually_isolated": hidden_connected,
                        "cold_seconds_this_machine": round(elapsed, 4), "source": snapshot["source"]})
    target = root / ".artifacts/topology/method-audit-20261020.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
