"""Paired shocks and bounded restoration on artificial transactions."""
import json
import numpy as np
import pandas as pd
from model import network, topology, topsis, cohesion, incident_amounts, apply_shock, restore


def main(output):
    z = np.array([[2, 3, 0, 1], [1, 2, 3, 0], [0, 1, 2, 3], [3, 0, 1, 2]], float)
    x = np.array([20, 22, 24, 26], float)
    w = network(z, x)
    scores, _ = topsis(topology(w)[0])
    amounts = incident_amounts(z)
    base = cohesion(w)
    rows = []
    for i in range(4):
        for mode in ("proportional", "equal_amount"):
            fraction = .5 if mode == "proportional" else .5 * amounts.min() / amounts[i]
            damaged = apply_shock(z, i, fraction)
            budget = .1 * (z - damaged).sum()
            restored = restore(z, damaged, budget, np.zeros_like(z, dtype=bool))
            before = cohesion(network(damaged, x, mask=w > 0))
            after = cohesion(network(restored, x, mask=w > 0))
            assert np.isclose((restored - damaged).sum(), budget)
            assert np.all(restored <= z) and np.all(restored >= damaged)
            rows.append(dict(code=f"DEMO{i+1}", mode=mode, topsis=scores[i],
                             efficiency_loss=1-before/base, restored_gain=(after-before)/base))
    pd.DataFrame(rows).to_csv(output / "synthetic_summary.csv", index=False)
    (output / "validation.json").write_text(json.dumps(dict(
        data="artificial_4_node_example", shock_cases=len(rows),
        budget_conservation=True, restoration_bounds=True), indent=2), encoding="utf-8")
