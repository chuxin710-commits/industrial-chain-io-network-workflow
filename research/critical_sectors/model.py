"""Unified direct-input network experiments; all monetary budgets are flow units."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent

import numpy as np
import networkx as nx
from scipy.stats import spearmanr
from legacy_sir import cohesion, calibration, evaluate, sir, structure

METRICS = ['degree', 'closeness', 'betweenness', 'clustering']


def network(z, x, threshold=0.0, mask=None):
    z, x = np.asarray(z, float), np.asarray(x, float)
    if z.shape != (len(x), len(x)) or not np.isfinite(z).all() or not np.isfinite(x).all():
        raise ValueError('Invalid IO arrays')
    if (z < 0).any() or (x <= 0).any() or threshold < 0:
        raise ValueError('Nonnegative Z, positive X and threshold required')
    a = z / x[None, :]
    if mask is None:
        mask = a > threshold
    w = np.where(mask, a, 0.0)
    np.fill_diagonal(w, 0.0)
    return w


def topology(w):
    g = nx.from_numpy_array(w, create_using=nx.DiGraph)
    n = len(w)
    degree = np.array([g.degree(i)/(2*(n-1)) for i in range(n)])
    close = nx.closeness_centrality(g.reverse(copy=False), wf_improved=True)
    between = nx.betweenness_centrality(g, normalized=True, weight=None)
    cluster = nx.clustering(g, weight=None)
    m = np.column_stack([degree, [close[i] for i in range(n)],
                         [between[i] for i in range(n)], [cluster[i] for i in range(n)]])
    return m, dict(edges=g.number_of_edges(), density=nx.density(g),
                   mean_clustering=float(m[:, 3].mean()))


def topsis(values):
    values = np.asarray(values, float)
    spread = np.ptp(values, axis=0)
    valid = spread > 1e-12
    u = np.zeros_like(values)
    u[:, valid] = (values[:, valid]-values[:, valid].min(axis=0))/spread[valid]
    p = np.divide(u, u.sum(axis=0), out=np.zeros_like(u), where=u.sum(axis=0)>0)
    logs = np.zeros_like(p)
    np.log(p, out=logs, where=p>0)
    information = np.where(valid, 1+(p*logs).sum(axis=0)/np.log(len(values)), 0)
    if information.sum() < 1e-12:
        return np.full(len(values), .5), np.zeros(values.shape[1])
    weights = information/information.sum()
    v = u*weights
    plus = np.linalg.norm(v-v.max(axis=0), axis=1)
    minus = np.linalg.norm(v-v.min(axis=0), axis=1)
    return np.divide(minus, plus+minus, out=np.full(len(values), .5), where=plus+minus>0), weights


def top_ids(values, k=5):
    return np.argsort(-np.asarray(values), kind='stable')[:k]


def incident(z, i):
    mask = np.zeros_like(z, dtype=bool)
    mask[i, :] = True
    mask[:, i] = True
    np.fill_diagonal(mask, False)
    return mask


def incident_amounts(z):
    return z.sum(axis=0)+z.sum(axis=1)-2*np.diag(z)


def apply_shock(z, i, fraction):
    if not 0 <= fraction <= 1:
        raise ValueError('Shock fraction outside [0,1]')
    out = z.copy()
    mask = incident(z, i)
    out[mask] *= 1-fraction
    return out


def ranking_summary(scores, impacts, random_sets):
    selected, actual = top_ids(scores), top_ids(impacts)
    common = len(set(selected) & set(actual))
    references = impacts[random_sets].mean(axis=1)
    value = float(impacts[selected].mean())
    rho = float(spearmanr(scores, impacts).statistic) if np.ptp(scores)>1e-12 and np.ptp(impacts)>1e-12 else np.nan
    return dict(spearman=rho, overlap5=common, jaccard5=common/(10-common),
                selected_mean_loss=value, population_mean_loss=float(impacts.mean()),
                random_q025=float(np.quantile(references,.025)), random_q975=float(np.quantile(references,.975)),
                random_exceed_share=float((np.count_nonzero(references>=value)+1)/(len(references)+1)))


def priority_mask(z, w, strategy, selected=None):
    chosen = np.zeros_like(z, dtype=bool)
    if strategy in ('structure', 'impact'):
        for i in selected:
            chosen |= incident(z, int(i))
    elif strategy == 'weak':
        for i in range(len(z)):
            ids = np.flatnonzero(w[i]>0)
            chosen[i, ids[np.argsort(w[i, ids],kind='stable')[:5]]] = True
    elif strategy != 'uniform':
        raise ValueError(strategy)
    np.fill_diagonal(chosen, False)
    return chosen


def restore(z, damaged, budget, preferred, multiplier=4.0):
    """Bounded proportional allocation; never exceed the pre-shock transaction."""
    lost = np.maximum(z-damaged, 0.0)
    if (damaged > z+1e-8).any() or budget < 0 or budget > lost.sum()+1e-7 or multiplier < 1:
        raise ValueError('Infeasible restoration request')
    remaining = lost.copy()
    restored = np.zeros_like(z)
    left = float(budget)
    priority = np.where(preferred, multiplier, 1.0)
    for _ in range(z.size+1):
        if left <= max(1e-9, budget*1e-12):
            break
        weight = remaining*priority
        if weight.sum() <= 0:
            raise RuntimeError('Insufficient restoration headroom')
        alloc = np.minimum(left*weight/weight.sum(), remaining)
        restored += alloc
        remaining -= alloc
        left -= float(alloc.sum())
    if not np.isclose(restored.sum(),budget,rtol=1e-10,atol=1e-7):
        raise RuntimeError('Restoration budget not conserved')
    return damaged+restored
