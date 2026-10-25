"""Reproducible IO topology views using the repository's ionet network kernel."""

from collections import OrderedDict
from contextlib import closing
import hashlib
import importlib
import json
import math
from pathlib import Path
import sys
import threading
from types import SimpleNamespace

import numpy as np

from mrio import QueryError, WARNINGS, axes, dataset, open_readonly, stored_row


ROOT = Path(__file__).resolve().parents[1]
for folder in (ROOT / "server/vendor", ROOT.parent / "src"):
    if folder.is_dir():
        sys.path.insert(0, str(folder))

from ionet import IOSystem, build_network

KERNEL = Path(importlib.import_module("ionet.network.build").__file__)
KERNEL_SHA256 = hashlib.sha256(KERNEL.read_bytes()).hexdigest()
REPO_COMMIT = "8f239665caa07f45f49901996ec2cd9afd4f8e79"
VERSION = "io-topology-v2"


def parameters(params):
    allowed = {"year", "level", "weight", "threshold", "max_edges", "display"}
    if set(params) - allowed:
        raise QueryError("网络参数不支持：" + ", ".join(sorted(set(params) - allowed)))
    try:
        year = int(params.get("year", "2023"))
        limit = int(params.get("max_edges", "250"))
        threshold = float(params.get("threshold", "0.005"))
    except (ValueError, TypeError):
        raise QueryError("年份、阈值或展示边数格式不正确") from None
    if not 2000 <= year <= 2023 or not 1 <= limit <= 3000:
        raise QueryError("年份须为 2000–2023，展示边数须为 1–3000")
    if not math.isfinite(threshold) or threshold < 0 or threshold > 1e15:
        raise QueryError("阈值须为有限非负数，且不超过 1e15")
    level, weight = params.get("level", "sector"), params.get("weight", "A")
    if level not in {"sector", "province", "node"} or weight not in {"A", "Z"}:
        raise QueryError("请选择支持的节点层级与边权口径")
    display = params.get("display", "topk")
    if display not in {"topk", "local"}:
        raise QueryError("展示骨架须为 topk 或 local")
    return {"year": year, "level": level, "weight": weight,
            "threshold": threshold, "max_edges": limit, "display": display}


def display_edges(weights, ranked, limit, strategy):
    """Local nominees: strongest incoming/outgoing edge per nonisolated node.

    Cover unseen endpoints first, then missing incoming/outgoing directions;
    ties use local weight share, raw weight and stable matrix order. Remaining
    slots use global strongest edges. This is a display heuristic, not a model.
    """
    if strategy == "topk" or len(ranked) <= limit:
        return ranked[:limit]
    n = len(weights)
    outgoing, incoming = weights.sum(axis=1), weights.sum(axis=0)
    sources = np.flatnonzero(outgoing > 0)
    targets = np.flatnonzero(incoming > 0)
    nominees = np.unique(np.concatenate((sources * n + weights[sources].argmax(axis=1),
                                         weights[:, targets].argmax(axis=0) * n + targets)))
    src, dst = nominees // n, nominees % n
    values = weights.ravel()[nominees]
    importance = np.maximum(values / outgoing[src], values / incoming[dst])
    priority = np.lexsort((nominees, -values, -importance))
    nominees, src, dst = nominees[priority], src[priority], dst[priority]
    covered, seen_out, seen_in = (np.zeros(n, dtype=bool) for _ in range(3))
    available = np.ones(len(nominees), dtype=bool)
    chosen = []
    for _ in range(min(limit, len(nominees))):
        # Integer scores keep endpoint coverage strictly ahead of direction coverage.
        score = ((~covered[src]).astype(int) + (~covered[dst]).astype(int)) * 3
        score += (~seen_out[src]).astype(int) + (~seen_in[dst]).astype(int)
        score[~available] = -1
        index = int(np.argmax(score))
        chosen.append(int(nominees[index]))
        available[index] = False
        covered[src[index]] = covered[dst[index]] = True
        seen_out[src[index]] = seen_in[dst[index]] = True
    chosen_set = set(chosen)
    for edge in ranked:
        if len(chosen) >= limit:
            break
        if int(edge) not in chosen_set:
            chosen.append(int(edge))
    return np.asarray(chosen, dtype=np.int64)


def load_io(connection, year):
    metadata = dataset(connection, year)
    rows = [row for row in axes(connection, year, "row") if row["kind"] == "industry"]
    columns = axes(connection, year, "column")
    lookup = {column["code"]: column["index"] for column in columns}
    if not rows or "X_output" not in lookup or any(row["code"] not in lookup for row in rows):
        raise QueryError("该年度行业轴或总产出列不完整，无法构网")
    indices = [lookup[row["code"]] for row in rows]
    z = np.empty((len(rows), len(rows)), dtype=float)
    x = np.empty(len(rows), dtype=float)
    for index, row in enumerate(rows):
        values = np.asarray(stored_row(connection, year, row["index"], metadata["columns"]))
        z[index] = values[indices]
        x[index] = values[lookup["X_output"]]
    if not np.isfinite(z).all() or not np.isfinite(x).all() or (z < 0).any() or (x < 0).any():
        raise QueryError("构网需要有限非负的 Z 与总产出；源数据不满足要求，未自动填补或截断")
    return rows, z, x, metadata


def aggregate(rows, z, x, level):
    if level == "node":
        return rows, z, x
    key = "sector" if level == "sector" else "province"
    groups = list(dict.fromkeys(row[key] for row in rows))
    mapping = np.array([groups.index(row[key]) for row in rows])
    result = np.zeros((len(groups), len(groups)))
    np.add.at(result, (mapping[:, None], mapping[None, :]), z)
    output = np.bincount(mapping, weights=x, minlength=len(groups))
    nodes = []
    for index, code in enumerate(groups):
        first = next(row for row in rows if row[key] == code)
        label = code if level == "sector" else first["label"].split(" · ")[0]
        nodes.append({"index": index, "code": code, "label": label,
                      "province": code if level == "province" else None,
                      "sector": code if level == "sector" else None})
    return nodes, result, output


def build_snapshot(rows, z, x, metadata, config):
    zero_raw = x == 0
    if np.any(z[:, zero_raw] != 0) or np.any(z[zero_raw, :] != 0):
        raise QueryError("原始零产出节点的交易行列必须全零；聚合前校验未通过")
    nodes, transactions, output = aggregate(rows, z, x, config["level"])
    codes = [node["code"] for node in nodes]
    zero = output == 0
    # A zero-output buyer is admissible only when its entire transaction column is zero.
    if config["weight"] == "A" and np.any(transactions[:, zero] != 0):
        raise QueryError("存在总产出为零但中间投入非零的使用部门，无法定义 A，不作猜测")
    if np.all(output > 0):
        io = IOSystem(transactions, output, codes, metadata={"source_sha256": metadata["sha256"]})
        raw = io.A if config["weight"] == "A" else io.Z
    else:
        raw = transactions.copy() if config["weight"] == "Z" else np.divide(
            transactions, output[None, :], out=np.zeros_like(transactions), where=output[None, :] > 0)
    if not np.isfinite(raw).all():
        raise QueryError("聚合或标准化产生非有限数值，无法构网")
    keep = (raw > 0) & (raw >= config["threshold"])
    np.fill_diagonal(keep, False)
    weights = np.where(keep, raw, 0.0)
    incoming, outgoing = weights.sum(axis=0), weights.sum(axis=1)
    in_degree, out_degree = keep.sum(axis=0), keep.sum(axis=1)
    candidates = np.flatnonzero(keep)
    # Rank ties by original source/target indices, never nondeterministic partition order.
    ranked = candidates[np.lexsort((candidates, -raw.ravel()[candidates]))]
    strategy = config.get("display", "topk")
    selected = display_edges(weights, ranked, config["max_edges"], strategy)
    display = np.zeros_like(raw)
    display.ravel()[selected] = raw.ravel()[selected]
    view = SimpleNamespace(sectors=codes, Z=display, A=display, metadata={
        "source_sha256": metadata["sha256"], "display_rule": strategy,
    })
    network = build_network(view, matrix=config["weight"], threshold=config["threshold"])
    count = len(nodes)
    node_data = []
    for i, node in enumerate(nodes):
        node_data.append({"id": node["code"], "label": node["label"],
                          "group": node.get("province") or "national",
                          "in_strength": float(incoming[i]), "out_strength": float(outgoing[i]),
                          "strength": float(incoming[i] + outgoing[i]),
                          "in_degree": int(in_degree[i]), "out_degree": int(out_degree[i]),
                          "output": float(output[i])})
    edges = [{"source": source, "target": target, "weight": attrs["weight"]}
             for source, target, attrs in network.graph.edges(data=True)]
    total_weight, displayed_weight = float(weights.sum()), float(display.sum())
    warnings = [WARNINGS[0], WARNINGS[1], WARNINGS[2],
                "2005–2007 年跨年可比性待独立核实；图形变化不等于经济韧性或因果变化。",
                "只构建 Z 或直接投入 A 网络，不包含最终需求、L 网络或冲击模型。"]
    if config["weight"] == "Z":
        warnings.append("Z 保留源金额口径；未知价格与单位条件下，不应把跨年金额差异直接解读为实际增长。")
    if zero.any():
        warnings.append(f"保留 {int(zero.sum())} 个零产出节点；A 的全零使用列定义为零，未删除孤立节点。")
    metrics = {"nodes": count, "edges": int(keep.sum()), "displayed_edges": len(edges),
               "density": float(keep.sum() / (count * (count - 1))) if count > 1 else 0.0,
               "isolates": int(((in_degree + out_degree) == 0).sum()),
               "total_weight": total_weight,
               "displayed_weight_share": displayed_weight / total_weight if total_weight else 0.0}
    active = (in_degree + out_degree) > 0
    visible = (display > 0).any(axis=0) | (display > 0).any(axis=1)
    coverage = {"connected_nodes": int(active.sum()), "visible_connected_nodes": int(visible.sum()),
                "hidden_connected_nodes": int((active & ~visible).sum()),
                "node_coverage": float(visible.sum() / active.sum()) if active.any() else 1.0}
    return {"year": config["year"], "config": config, "nodes": node_data, "edges": edges,
            "metrics": metrics, "coverage": coverage, "source": {"file": metadata["source"], "sha256": metadata["sha256"]},
            "method": {"version": VERSION, "kernel": "ionet.network.build.build_network",
                       "repository": "https://github.com/chuxin710-commits/industrial-chain-io-network-workflow",
                       "commit": REPO_COMMIT, "kernel_sha256": KERNEL_SHA256,
                       "kernel_source_commit": REPO_COMMIT,
                       "adapter_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                       "numpy_version": np.__version__,
                       "networkx_version": importlib.import_module("networkx").__version__,
                       "direction": "supplier_to_user", "aggregation": "sum_Z_and_x_before_A",
                       "weight_formula": "A_ij = Z_ij / x_j" if config["weight"] == "A" else "Z_ij",
                       "threshold_rule": "weight > 0 and weight >= threshold; exclude diagonal",
                       "metric_scope": "all_thresholded_edges_before_display_sparsification",
                       "display_rule": "strongest K; ties by source/target source-table order" if strategy == "topk" else "local nominees; endpoint then direction coverage; local share, weight, matrix-order ties; global fill; strict K cap",
                       "zero_output_policy": "validate raw zero-output rows and columns all zero before aggregation; retain nodes",
                       "negative_missing_policy": "reject Z/x; never impute or clamp"}, "warnings": warnings}


class TopologyEngine:
    def __init__(self, database):
        self.database = Path(database).resolve()
        self.cache = OrderedDict()
        self.lock = threading.Lock()
        self.load_lock = threading.Lock()
        self.year_cache = OrderedDict()
        self.year_bytes = 0
        self.year_budget = 64 * 1024 * 1024
        self.data_version = None
        self.slots = threading.BoundedSemaphore(2)

    def version(self):
        paths = [self.database, Path(str(self.database) + "-wal")]
        return tuple((p.stat().st_mtime_ns, p.stat().st_size) if p.exists() else None for p in paths)

    def load_year(self, year):
        # Serializes cache misses only; repeated neighbor queries reuse immutable Z/x.
        with self.load_lock:
            version = self.version()
            if version != self.data_version:
                self.year_cache.clear()
                self.year_bytes = 0
                self.data_version = version
            if year in self.year_cache:
                self.year_cache.move_to_end(year)
                return self.year_cache[year]
            with closing(open_readonly(self.database)) as connection:
                result = load_io(connection, year)
            result[1].setflags(write=False)
            result[2].setflags(write=False)
            size = result[1].nbytes + result[2].nbytes
            if size <= self.year_budget and version == self.version():
                while self.year_cache and self.year_bytes + size > self.year_budget:
                    _, old = self.year_cache.popitem(last=False)
                    self.year_bytes -= old[1].nbytes + old[2].nbytes
                self.year_cache[year] = result
                self.year_bytes += size
            return result

    def query(self, params):
        config = parameters(params)
        key = (self.version(), json.dumps(config, sort_keys=True))
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
        if not self.slots.acquire(blocking=False):
            raise RuntimeError("Topology workers busy")
        try:
            rows, z, x, metadata = self.load_year(config["year"])
            result = build_snapshot(rows, z, x, metadata, config)
            with self.lock:
                self.cache[key] = result
                while len(self.cache) > 48:
                    self.cache.popitem(last=False)
            return result
        finally:
            self.slots.release()

    def neighbors(self, params):
        params = dict(params)
        node_id = params.pop("node", "")
        config = parameters(params)
        snapshot = self.query(params)
        node_lookup = {node["id"]: node for node in snapshot["nodes"]}
        if node_id not in node_lookup:
            raise QueryError("所选节点不在此网络层级中")
        if not self.slots.acquire(blocking=False):
            raise RuntimeError("Topology workers busy")
        try:
            rows, z, x, metadata = self.load_year(config["year"])
            nodes, z, x = aggregate(rows, z, x, config["level"])
            codes = [node["code"] for node in nodes]
            index = codes.index(node_id)
            incoming = z[:, index].copy()
            outgoing = z[index, :].copy()
            if config["weight"] == "A":
                incoming = incoming / x[index] if x[index] > 0 else np.zeros_like(incoming)
                outgoing = np.divide(outgoing, x, out=np.zeros_like(outgoing), where=x > 0)
            incoming[index] = outgoing[index] = 0
            edges = []
            for direction, values in (("incoming", incoming), ("outgoing", outgoing)):
                for i in np.flatnonzero((values > 0) & (values >= config["threshold"])):
                    source, target = (codes[i], node_id) if direction == "incoming" else (node_id, codes[i])
                    edges.append({"source": source, "target": target, "weight": float(values[i]), "direction": direction})
            edges.sort(key=lambda edge: (-edge["weight"], edge["source"], edge["target"]))
            neighbor_ids = {edge["source"] for edge in edges} | {edge["target"] for edge in edges}
            return {"year": config["year"], "node": node_lookup[node_id], "edges": edges,
                    "nodes": [node_lookup[code] for code in codes if code in neighbor_ids],
                    "scope": "all_incident_thresholded_edges_not_topK", "source": snapshot["source"],
                    "config": config}
        finally:
            self.slots.release()
