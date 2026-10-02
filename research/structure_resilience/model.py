"""Leontief networks, entropy TOPSIS, mutualistic ODE, and capacity cascades."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

import numpy as np
import networkx as nx
from scipy.integrate import solve_ivp

METRICS = ['degree', 'closeness', 'betweenness', 'clustering']


def leontief(z, x):
    z, x = np.asarray(z, float), np.asarray(x, float)
    if z.shape != (len(x), len(x)) or not np.isfinite(z).all() or not np.isfinite(x).all():
        raise ValueError('Invalid IO shape or nonfinite values')
    if (z < 0).any() or (x <= 0).any():
        raise ValueError('Z must be nonnegative; X strictly positive')
    a = z / x[None, :]
    rho = float(np.max(np.abs(np.linalg.eigvals(a))))
    if rho >= 1:
        raise ValueError('Nonproductive IO coefficients')
    eye = np.eye(len(x))
    l = np.linalg.solve(eye-a, eye)
    return a, l, rho, float(np.max(np.abs((eye-a) @ l-eye)))


def network(l, threshold):
    w = np.where(np.asarray(l) > threshold, l, 0.0)
    np.fill_diagonal(w, 0.0)
    g = nx.from_numpy_array(w, create_using=nx.DiGraph)
    # Binary topology is intentional; monetary flows are not hop distances.
    n = len(w)
    degree = np.array([g.degree(i) / (2*(n-1)) for i in range(n)])
    closeness = nx.closeness_centrality(g.reverse(copy=False), wf_improved=True)
    between = nx.betweenness_centrality(g, normalized=True, weight=None)
    cluster = nx.clustering(g, weight=None)
    nodes = np.column_stack([degree, [closeness[i] for i in range(n)],
                             [between[i] for i in range(n)], [cluster[i] for i in range(n)]])
    return w, g, nodes


def graph_summary(g, denominator_n=None):
    n = len(g)
    lengths, inverse, row_lengths = [], 0.0, np.full(n, float(max(n, 1)))
    for i, source in enumerate(g):
        distances = nx.single_source_shortest_path_length(g, source)
        reachable = [d for target, d in distances.items() if target != source]
        lengths.extend(reachable)
        inverse += sum(1/d for d in reachable)
        if n > 1:
            row_lengths[i] = (sum(reachable)+(n-1-len(reachable))*max(n, 1))/(n-1)
    den = n if denominator_n is None else denominator_n
    return dict(nodes=n, edges=g.number_of_edges(), density=nx.density(g),
                average_total_degree=2*g.number_of_edges()/n if n else 0.0,
                path_reachable=float(np.mean(lengths)) if lengths else np.nan,
                clustering=float(nx.average_clustering(g)) if n else 0.0,
                reachable_share=len(lengths)/(n*(n-1)) if n > 1 else 0.0,
                efficiency=inverse/(den*(den-1)) if den > 1 else 0.0), row_lengths


def entropy_topsis(values):
    values = np.asarray(values, float)
    if values.ndim != 2 or len(values) < 2 or not np.isfinite(values).all():
        raise ValueError('Invalid TOPSIS values')
    spread = np.ptp(values, axis=0)
    valid = spread > 1e-12
    u = np.zeros_like(values)
    u[:, valid] = (values[:, valid]-values[:, valid].min(axis=0))/spread[valid]
    p = np.divide(u, u.sum(axis=0), out=np.zeros_like(u), where=u.sum(axis=0)>0)
    plogp = np.zeros_like(p)
    np.log(p, out=plogp, where=p>0)
    entropy = -(p*plogp).sum(axis=0)/np.log(len(values))
    information = np.where(valid, 1-entropy, 0.0)
    if information.sum() <= 1e-12:
        return np.full(len(values), 0.5), np.zeros(values.shape[1])
    weights = information/information.sum()
    v = u*weights
    dp = np.linalg.norm(v-v.max(axis=0), axis=1)
    dn = np.linalg.norm(v-v.min(axis=0), axis=1)
    scores = np.divide(dn, dp+dn, out=np.full(len(values), 0.5), where=dp+dn>1e-12)
    return scores, weights


def rhs_batch(state, w, params, denominator='corrected'):
    b, k, c, d, e, h = [np.asarray(params[key])[:, None] for key in ['b','k','c','d','e','h']]
    y = state
    own = y[:, None, :]
    neighbor = y[None, :, :]
    base = d[:, None, :] + h[:, None, :]*neighbor
    denom = base + e[:, None, :]*(own if denominator == 'corrected' else 1.0)
    interactions = (w.T[:, :, None] * neighbor / denom).sum(axis=1)*y
    return b+y*(1-y/k)*(y/c-1)+interactions


def simulate(w, params, q, amplitude=.2, trials=64, seed=20261001,
             times=(0, 5, 10, 20), denominator='corrected', rtol=1e-7, atol=1e-9):
    if not 0 <= amplitude < 1 or trials < 2:
        raise ValueError('Invalid perturbation ensemble')
    q = np.asarray(q, float)
    n = len(q)
    rng = np.random.default_rng(seed)
    starts = q[:, None]*(1+rng.uniform(-amplitude, amplitude, (n, trials)))
    times = np.asarray(times, float)
    sol = solve_ivp(lambda t, flat: rhs_batch(flat.reshape(n, trials), w, params, denominator).ravel(),
                    (0.0, float(times[-1])), starts.ravel(), t_eval=times,
                    method='DOP853', rtol=rtol, atol=atol)
    if not sol.success or not np.isfinite(sol.y).all() or sol.y.min() < -1e-7:
        raise RuntimeError('Failed/nonphysical ODE ensemble: '+sol.message)
    trajectory = np.maximum(sol.y.reshape(n, trials, -1), 0)
    final = trajectory[:, :, -1]
    return trajectory, sol.nfev


def terminal_summary(ensemble, k):
    lo, hi = ensemble.min(axis=1), ensemble.max(axis=1)
    r = np.divide(lo, hi, out=np.zeros_like(lo), where=hi>1e-12)
    return r, ensemble.mean(axis=1), (ensemble/np.asarray(k)[:, None]<.1).mean(axis=1)


def cascade(g, seeds, tolerance=.1):
    if tolerance < 0 or not set(seeds) <= set(g):
        raise ValueError('Invalid cascade specification')
    nodes = list(g)
    load = {i:float(g.degree(i)) for i in nodes}
    capacity = {i:(1+tolerance)*load[i] for i in nodes}
    failed, frontier, steps, dropped = set(seeds), set(seeds), [], 0.0
    round_id = 0
    while frontier:
        round_id += 1
        increment = dict.fromkeys(nodes, 0.0)
        for i in sorted(frontier):
            # Original capacity formula uses total C, NOT unused capacity C-load.
            neighbors = (set(g.predecessors(i)) | set(g.successors(i)))-failed
            total = sum(capacity[j] for j in neighbors)
            if total > 0:
                for j in neighbors:
                    increment[j] += load[i]*capacity[j]/total
            else:
                dropped += load[i]
            steps.append(dict(round=round_id, failed_node=i, load=load[i]))
            load[i] = 0.0
        for j in nodes:
            load[j] += increment[j]
        frontier = {j for j in nodes if j not in failed and load[j] > capacity[j]+1e-10}
        failed |= frontier
    surviving = [i for i in nodes if i not in failed]
    if not np.isclose(sum(load.values())+dropped, sum(g.degree(i) for i in nodes), rtol=1e-10):
        raise RuntimeError('Cascade load accounting failed')
    return failed, g.subgraph(surviving).copy(), steps, dropped
