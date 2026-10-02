"""Small artificial example, not Chinese MRIO observations."""
import json
import numpy as np
import pandas as pd
from model import leontief, network, entropy_topsis, simulate, terminal_summary, cascade


def main(output):
    z = np.array([[2, 3, 0, 1], [1, 2, 3, 0], [0, 1, 2, 3], [3, 0, 1, 2]], float)
    x = np.array([20, 22, 24, 26], float)
    _, l, rho, residual = leontief(z, x)
    threshold = l[~np.eye(4, dtype=bool)].mean()
    w, graph, metrics = network(l, threshold)
    scores, _ = entropy_topsis(metrics)
    params = dict(b=np.full(4, .1), k=np.full(4, 2.), c=np.ones(4),
                  d=np.ones(4), e=np.ones(4), h=np.ones(4))
    states, _ = simulate(w, params, np.ones(4), trials=8, times=(0, 5, 10))
    resilience, activity, low = terminal_summary(states[:, :, -1], params["k"])
    failed, _, _, _ = cascade(graph, [int(np.argmax(scores))], tolerance=.1)
    pd.DataFrame(dict(code=[f"DEMO{i}" for i in range(1, 5)], topsis=scores,
                      terminal_consistency=resilience, activity=activity,
                      low_activity_share=low)).to_csv(output / "synthetic_summary.csv", index=False)
    evidence = dict(data="artificial_4_node_example", rho_a=rho, inverse_residual=residual,
                    threshold=float(threshold), cascade_failed_count=len(failed),
                    all_consistency_in_range=bool(((resilience >= 0) & (resilience <= 1)).all()))
    (output / "validation.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
