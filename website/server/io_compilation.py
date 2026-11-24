"""Deterministic, stateless RAS for a single-area competitive product table."""

import hashlib
import json
import math
import re

import networkx as nx
import numpy as np

from library import LibraryError


VERSION = 'competitive-ras/1'
MAX_ITER = 1200
ATOL = 1e-9
RTOL = 1e-10
LOCKS = ('usage_authorized', 'scope_aligned', 'estimation_allowed')
FIELDS = {'region', 'year', 'base_year', 'classification', 'valuation', 'price_basis', 'unit',
          'source', 'sectors', 'final_uses', 'value_added', 'z0', 'x', 'm', 'y', 'va', *LOCKS}


def bad(message):
    raise LibraryError(400, message)


def canonical_hash(value):
    payload = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(payload.encode('ascii')).hexdigest()


def label(value, field, limit=120):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or re.search(r'[\x00-\x1f\x7f\ud800-\udfff]', value):
        bad(f'{field} 须为不超过 {limit} 字的单行文字')
    return value.strip()


def labels(value, field, cap):
    if not isinstance(value, list) or not 1 <= len(value) <= cap:
        bad(f'{field} 须列出 1–{cap} 项')
    result = [label(item, field, 70) for item in value]
    if len(set(result)) != len(result):
        bad(f'{field} 不能有重复项')
    return result


def values(value, field, shape, signed=False):
    def check(items, dims):
        if dims:
            if not isinstance(items, list) or len(items) != dims[0]:
                bad(f'{field} 维度须为 {" × ".join(map(str, shape))}')
            for item in items:
                check(item, dims[1:])
        elif type(items) not in (int, float) or not (-1e12 if signed else 0) <= items <= 1e12:
            bad(f'{field} 必须是{"有限" if signed else "非负"}数值，绝对值不超过 10¹²')
    check(value, shape)
    return np.asarray(value, dtype=float)


def prepare(data):
    if not isinstance(data, dict) or data.keys() != FIELDS:
        bad('输入字段与模板不符；首版不支持锁定单元、区间约束或附加块')
    sectors = labels(data['sectors'], 'sectors', 42)
    final_uses = labels(data['final_uses'], 'final_uses', 20)
    value_added = labels(data['value_added'], 'value_added', 20)
    n = len(sectors)
    if any(type(data[key]) is not int or not 1900 <= data[key] <= 2100 for key in ('year', 'base_year')):
        bad('year 和 base_year 须为 1900–2100 的整数')
    if data['base_year'] >= data['year']:
        bad('基年须早于目标年')
    if data['valuation'] != 'current':
        bad('首版仅支持现价：valuation 必须为 current')
    for key in LOCKS:
        if type(data[key]) is not bool:
            bad(f'{key} 必须为布尔值')
    snapshot = {key: label(data[key], key, 400 if key == 'source' else 120)
                for key in ('region', 'classification', 'valuation', 'price_basis', 'unit', 'source')}
    snapshot.update({key: data[key] for key in ('year', 'base_year', *LOCKS)})
    snapshot.update(sectors=sectors, final_uses=final_uses, value_added=value_added)
    x = values(data['x'], 'x', (n,))
    m = values(data['m'], 'm', (n,))
    y = values(data['y'], 'Y', (n, len(final_uses)), signed=True)
    va = values(data['va'], 'VA', (len(value_added), n), signed=True)
    z0 = values(data['z0'], 'Z⁰', (n, n))
    snapshot.update(x=x.tolist(), m=m.tolist(), y=y.tolist(), va=va.tolist(), z0=z0.tolist())
    return snapshot, z0, x + m - y.sum(axis=1), x - va.sum(axis=0)


def support_conflict(z, u, v, sectors):
    total_u, total_v = math.fsum(u), math.fsum(v)
    # Structural feasibility is checked to floating-point precision, not to a
    # potentially much wider output balance tolerance.
    epsilon = 8 * math.ulp(max(total_u, total_v))
    if abs(total_u - total_v) > epsilon:
        return {'code': 'margin_totals', 'message': '行列目标总额不一致；请核查控制量，不会自动改写边际。'}
    if total_u == 0:
        return None
    graph = nx.DiGraph()
    graph.add_nodes_from(('source', 'sink'))
    for i in range(len(u)):
        graph.add_edge('source', ('row', i), capacity=float(u[i]))
        graph.add_edge(('col', i), 'sink', capacity=float(v[i]))
    for i, j in zip(*np.nonzero((z > 0) & (u[:, None] > 0) & (v[None, :] > 0))):
        graph.add_edge(('row', i), ('col', j), capacity=2 * total_u)
    if any(u[i] > 0 and graph.out_degree(('row', i)) == 0 for i in range(len(u))) or any(
            v[j] > 0 and graph.in_degree(('col', j)) == 0 for j in range(len(v))):
        return {'code': 'empty_support', 'message': '正目标缺少可达的正支撑。',
                'rows': [sectors[i] for i in range(len(u)) if u[i] > 0 and graph.out_degree(('row', i)) == 0],
                'columns': [sectors[j] for j in range(len(v)) if v[j] > 0 and graph.in_degree(('col', j)) == 0]}
    flow, (reachable, _) = nx.minimum_cut(graph, 'source', 'sink', flow_func=nx.algorithms.flow.edmonds_karp)
    if total_u - flow > epsilon:
        return {'code': 'structural_support', 'message': '先验的正支撑无法同时满足行列目标。',
                'rows': [sectors[i] for i in range(len(u)) if ('row', i) in reachable],
                'columns': [sectors[j] for j in range(len(v)) if ('col', j) in reachable],
                'unallocated': total_u - flow}
    return None


def preflight(data):
    snapshot, z0, u, v = prepare(data)
    params = {'version': VERSION, 'max_iterations': MAX_ITER, 'atol': ATOL, 'rtol': RTOL,
              'numpy': np.__version__, 'networkx': nx.__version__}
    result = dict(snapshot_hash=canonical_hash({'input': snapshot, 'recipe': params}),
                  recipe=params, row_targets=u.tolist(), column_targets=v.tolist(),
                  row_total=math.fsum(u), column_total=math.fsum(v))
    missing = [key for key in LOCKS if not snapshot[key]]
    negative_rows = [name for name, target in zip(snapshot['sectors'], u) if target < 0]
    negative_cols = [name for name, target in zip(snapshot['sectors'], v) if target < 0]
    if missing:
        blocking = {'code': 'confirmation', 'message': '需确认数据使用授权、口径已对齐及用途允许估计。', 'missing': missing}
    elif negative_rows or negative_cols:
        blocking = {'code': 'negative_targets', 'message': '存在负的中间使用目标，不能使用非负 RAS。',
                    'rows': negative_rows, 'columns': negative_cols}
    else:
        blocking = support_conflict(z0, u, v, snapshot['sectors'])
    result.update(status='blocked' if blocking else 'ready', blocking=blocking)
    return result, snapshot, z0, u, v


def run(data, expected_hash, approved):
    check, snapshot, z0, u, v = preflight(data)
    if not check['status'] == 'ready':
        raise LibraryError(422, check['blocking']['message'], preflight=check)
    if expected_hash != check['snapshot_hash'] or approved is not True:
        raise LibraryError(409, '请预检当前数据，并确认对应配方后再运行')
    z = np.where((u[:, None] > 0) & (v[None, :] > 0), z0, 0.0)
    rows, cols = u[:, None] > 0, v[None, :] > 0
    converged = False
    for iteration in range(1, MAX_ITER + 1):
        for axis, target, active in ((1, u[:, None], rows), (0, v[None, :], cols)):
            denominator = z.sum(axis=axis, keepdims=True)
            if np.any(active & (denominator <= 0)):
                raise LibraryError(422, '迭代中出现零分母；没有生成表体', state='numerical_failure')
            # Divide before multiplying to avoid overflow in a scaling factor.
            z = np.divide(z, denominator, out=np.zeros_like(z), where=active) * target
        row_error = z.sum(axis=1) - u
        col_error = z.sum(axis=0) - v
        if np.all(abs(row_error) <= ATOL + RTOL * abs(u)) and np.all(abs(col_error) <= ATOL + RTOL * abs(v)):
            converged = True
            break
    if not converged:
        raise LibraryError(422, '达到迭代上限，双向残差未同时通过；没有生成表体',
                           state='not_converged', iterations=iteration,
                           max_row_error=float(abs(row_error).max()), max_column_error=float(abs(col_error).max()))
    table = {'z': z.tolist(), 'y': snapshot['y'], 'va': snapshot['va'], 'x': snapshot['x'], 'm': snapshot['m']}
    return dict(status='balanced_estimate', input=snapshot, preflight=check, table=table,
                result_hash=canonical_hash({'snapshot': expected_hash, 'table': table}),
                verification=dict(iterations=iteration, row_residuals=row_error.tolist(), column_residuals=col_error.tolist(),
                                  absolute_adjustment=float(abs(z - z0).sum()),
                                  structural_zeros_preserved=True, independent_validation='not_performed'))


def route(handler, path, method, data):
    from library_http import reply
    if method != 'POST':
        raise LibraryError(405, '此接口仅接受 POST')
    if path == '/api/library/io-compilation/preflight':
        reply(handler, 200, preflight(data.get('input'))[0])
    elif path == '/api/library/io-compilation/run':
        reply(handler, 200, run(data.get('input'), data.get('snapshot_hash'), data.get('confirmed')))
    else:
        raise LibraryError(404, '编表接口不存在')
