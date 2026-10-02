"""Directed weighted cohesion and homogeneous SIR, with explicit calibration.

The theoretical architecture of the thesis is retained. Corrections to the
cohesion equation, dimensionless weights and unspecified f1/f2 are documented
in METHODS.md. This is a conditional simulation, not estimated causal recovery.
"""
import numpy as np
from scipy.sparse.csgraph import shortest_path
from scipy.integrate import solve_ivp


def weights(z, x):
    if (x <= 0).any():
        raise ValueError('Aggregate output must be positive')
    w = np.asarray(z, dtype=float) / x[None, :]
    np.fill_diagonal(w, 0)
    return w


def distances(w):
    cost = np.divide(1., w, out=np.zeros_like(w), where=w > 0)
    return shortest_path(np.ascontiguousarray(cost), directed=True, method='FW')


def cohesion(w, kind='efficiency'):
    n = len(w)
    if n < 2 or not np.any(w > 0):
        return 0.
    d = distances(w)
    mask = ~np.eye(n, dtype=bool)
    if kind == 'efficiency':
        inv = np.divide(1., d, out=np.zeros_like(d), where=(d > 0) & np.isfinite(d))
        return float(inv.sum() / (n*(n-1)))
    if kind == 'literal':
        # Literal arithmetic-distance expansion of thesis Eq. 3-1.
        q = (w > 0).sum(axis=1)
        s = np.divide(w.sum(axis=1), q, out=np.zeros(n), where=q > 0).sum()
        length = d[mask].mean()
        return float(1/(s*length)) if s > 0 and np.isfinite(length) else 0.
    raise ValueError(kind)


def structure(w, kind='efficiency'):
    n = len(w)
    c = cohesion(w, kind)
    deleted = np.zeros(n)
    for i in range(n):
        keep = np.arange(n) != i
        deleted[i] = cohesion(w[np.ix_(keep, keep)], kind)
    if kind == 'literal':
        importance = np.abs(1 - np.divide(c, deleted, out=np.ones(n), where=deleted > 0))
    else:
        # Restore the ORIGINAL pair denominator: deletion cannot benefit cohesion
        # just by removing endpoints from the normalization population.
        deleted *= (n-1)*(n-2)/(n*(n-1))
        importance = np.maximum(0., 1-deleted/c) if c > 0 else np.zeros(n)
    importance = importance/importance.sum() if importance.sum() > 0 else np.full(n, 1/n)
    degree = (w > 0).sum(axis=1)
    means = np.divide(w.sum(axis=1), degree, out=np.zeros(n), where=degree > 0)
    exposure = float(importance @ means)
    return c, exposure, importance


def calibration(w, kind='efficiency', beta0=.30, gamma0=.10):
    c, exposure, _ = structure(w, kind)
    if c <= 0 or exposure <= 0:
        raise ValueError('Calibration network must have positive cohesion/exposure')
    return dict(kind=kind, k_beta=exposure*(1-beta0)/beta0,
                k_gamma=c*(1-gamma0)/gamma0, beta0=beta0, gamma0=gamma0)


def sir(beta, gamma, eps=1e-4, initial=(.95,.03,.02), horizon=5000.,
        rtol=1e-8, atol=1e-10, trajectory=False):
    if beta < 0 or gamma < 0 or eps <= 0:
        raise ValueError('Invalid SIR parameter')
    s0, i0, r0 = initial
    if min(initial) < 0 or not np.isclose(sum(initial), 1):
        raise ValueError('Initial state must be a probability vector')
    def rhs(t, y):
        flow = beta*y[0]*y[1]
        return [-flow, flow-gamma*y[1], gamma*y[1], y[1]]
    def extinction(t, y):
        return y[1]-eps
    extinction.direction = -1
    extinction.terminal = True
    def peak(t, y):
        return beta*y[0]-gamma
    peak.direction = -1
    sol = solve_ivp(rhs, [0,horizon], [s0,i0,r0,0], events=[extinction,peak],
                    rtol=rtol, atol=atol, dense_output=trajectory)
    if not sol.success:
        raise RuntimeError(sol.message)
    reached = bool(len(sol.t_events[0]))
    t = float(sol.t[-1])
    peak_i = float(sol.y_events[1][0,1]) if len(sol.t_events[1]) else i0
    out = dict(T=t if reached else np.nan, censored=not reached,
               ICRC=1/t if reached and t > 0 else np.nan,
               peak_I=peak_i, ever_affected=float(i0+s0-sol.y[0,-1]),
               burden=float(sol.y[3,-1]), terminal_I=float(sol.y[1,-1]),
               conservation_error=float(np.abs(sol.y[:3].sum(axis=0)-1).max()),
               minimum_state=float(sol.y[:3].min()))
    if trajectory:
        ts = np.linspace(0,t,301)
        out['trajectory'] = np.column_stack([ts, sol.sol(ts).T])
    return out


def evaluate(w, cal, eps=1e-4, initial=(.95,.03,.02), trajectory=False):
    c, exposure, importance = structure(w, cal['kind'])
    beta = exposure/(exposure+cal['k_beta']) if exposure > 0 else 0.
    gamma = c/(c+cal['k_gamma']) if c > 0 else 0.
    result = sir(beta, gamma, eps=eps, initial=initial, trajectory=trajectory)
    result.update(cohesion=c, ICV=1/c if c > 0 else np.inf, beta=beta,
                  gamma=gamma, exposure=exposure, ICR=c*result['ICRC'])
    return result, importance


def shock(z, node, remaining):
    if not 0 <= remaining <= 1:
        raise ValueError(remaining)
    out = z.copy()
    touched = np.zeros_like(z, dtype=bool)
    touched[node,:] = True
    touched[:,node] = True
    out[touched] *= remaining
    return out


def policy(z, mode, size, equal_budget=True, k=5):
    selected = np.zeros_like(z, dtype=bool)
    for i in range(len(z)):
        ids = np.where((z[i] > 0) & (np.arange(len(z)) != i))[0]
        ranked = ids[np.argsort(z[i,ids], kind='stable')]
        if mode == 'strong':
            chosen = ranked[-k:]
        elif mode == 'weak':
            chosen = ranked[:k]
        elif mode == 'uniform':
            chosen = ranked
        else:
            raise ValueError(mode)
        selected[i,chosen] = True
    off_total = float(z.sum()-np.trace(z))
    selected_total = float(z[selected].sum())
    cost = size*off_total if equal_budget else size*selected_total
    factor = cost/selected_total if selected_total else 0.
    out = z.copy()
    out[selected] *= 1+factor
    return out, dict(added_Z=cost, budget_share=cost/off_total,
                     selected_edge_increase=factor, selected_edges=int(selected.sum()))
