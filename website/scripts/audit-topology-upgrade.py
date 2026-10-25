"""Compare display rules without changing scientific threshold-network metrics."""
import json
from pathlib import Path
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from topology import TopologyEngine

root = Path(__file__).resolve().parents[1]
engine = TopologyEngine(root / "var/mrio.sqlite3")
results = []
for level in ("sector", "node"):
    for budget in (250, 1500):
        baseline = None
        for strategy in ("topk", "local"):
            config = {"year": "2023", "level": level, "threshold": "0.005", "max_edges": str(budget), "display": strategy}
            start = perf_counter()
            snapshot = engine.query(config)
            elapsed = perf_counter() - start
            science = (snapshot["nodes"], {k: v for k, v in snapshot["metrics"].items() if not k.startswith('displayed_')})
            if baseline is None:
                baseline = science
            assert science == baseline, 'Display rule changed scientific quantities'
            results.append({"config": snapshot["config"], "coverage": snapshot["coverage"],
                            "metrics": snapshot["metrics"], "source": snapshot["source"],
                            "seconds_this_machine": round(elapsed, 4)})
start = perf_counter()
for _ in range(10):
    engine.neighbors({"year": "2023", "node": "S12", "display": "local"})
report = {"results": results, "ten_neighbor_queries_seconds_this_machine": round(perf_counter() - start, 4),
          "cached_year_bytes": engine.year_bytes, "science_unchanged": True}
target = root / '.artifacts/topology/upgrade-20261022.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
