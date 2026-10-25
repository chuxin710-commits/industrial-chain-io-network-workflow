"""Generate labelled synthetic method illustrations with the existing scientific code."""
import json
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'research/critical_sectors'))
from model import network, apply_shock, restore, incident
from legacy_sir import cohesion

z = np.array([[20., 12., 4.], [6., 24., 10.], [8., 4., 18.]])
x = np.array([100., 120., 80.])
a = z / x[None, :]
frames = []
for tau in [0, .04, .08, .12, .16]:
    mask = (a > 0) & (a >= tau)
    np.fill_diagonal(mask, False)
    for fraction in [0, .25, .5, .75, 1]:
        damaged = apply_shock(z, 1, fraction)
        for share in [0, .1, .2, .5, 1]:
            budget = share * float((z - damaged).sum())
            recovered = restore(z, damaged, budget, np.zeros_like(mask), multiplier=4)
            base = network(z, x, mask=mask)
            shock = network(damaged, x, mask=mask)
            final = network(recovered, x, mask=mask)
            frames.append(dict(threshold=tau, fraction=fraction, share=share,
                               base=base.tolist(), damaged=shock.tolist(), recovered=final.tolist(),
                               efficiency=[cohesion(w) for w in [base, shock, final]],
                               loss=float((z-damaged).sum()), budget=budget))
payload = dict(synthetic=True, labels=['U', 'V', 'W'], Z=z.tolist(), x=x.tolist(), A=a.tolist(),
               rule='supplier_to_buyer; baseline A>=threshold and positive; diagonal excluded; fixed support during shock/restoration',
               source='research/critical_sectors/model.py + legacy_sir.py', frames=frames)
(ROOT / 'website/src/method-demo.json').write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'Method demonstration: {len(frames)} synthetic states generated from existing code')
