"""Read-only, evidence-backed knowledge graph over the existing annual MRIO data."""

from contextlib import closing
import hashlib
from pathlib import Path
from urllib.parse import urlencode

import numpy as np

from mrio import QueryError, PROVINCES, WARNINGS, axes, dataset, open_readonly
from topology import aggregate, parameters

VERSION = "io-knowledge-v1"
TYPES = {"sector": "行业", "province": "地区", "node": "地区行业"}


def config_from(params, entities=False):
    allowed = {"year", "level"} if entities else {"year", "level", "entity", "expanded", "direction", "threshold", "limit"}
    if set(params) - allowed:
        raise QueryError("存在不支持的知识图谱参数")
    base = parameters({k: v for k, v in params.items() if k in {"year", "level", "threshold"}})
    result = {k: base[k] for k in ("year", "level", "threshold")}
    if entities:
        return result
    try:
        limit = int(params.get("limit", "12"))
    except (TypeError, ValueError):
        raise QueryError("每次展开关系数须为整数") from None
    direction = params.get("direction", "both")
    if not 1 <= limit <= 30 or direction not in {"both", "incoming", "outgoing"}:
        raise QueryError("每次展开关系数须为 1–30，方向须为 both/incoming/outgoing")
    expanded = list(dict.fromkeys(filter(None, params.get("expanded", "").split(","))))
    if len(expanded) > 4:
        raise QueryError("最多追加展开四个对象，请收起分支后继续")
    return {**result, "entity": params.get("entity", ""), "expanded": expanded,
            "direction": direction, "limit": limit}


def entity_list(engine, params):
    config = config_from(params, entities=True)
    with closing(open_readonly(engine.database)) as db:
        dataset(db, config["year"])
        rows = [r for r in axes(db, config["year"], "row") if r["kind"] == "industry"]
    level = config["level"]
    if level == "node":
        items = [{"code": r["code"], "label": r["label"]} for r in rows]
    else:
        codes = dict.fromkeys(r[level] for r in rows)
        items = [{"code": c, "label": PROVINCES.get(c, c) if level == "province" else c} for c in codes]
    return {"year": config["year"], "level": level, "entities": items}


def filters(node, prefix):
    return {f"{prefix}_{key}": node[key] for key in ("province", "sector") if node.get(key)}


def table_link(year, source, target=None, output=False):
    params = {"year": year, "view": "x" if output else "z", **filters(source, "row")}
    if target is not None:
        params.update(filters(target, "col"))
    return "/workspace.html?" + urlencode(params) + "#database"


def build_graph(rows, z, x, metadata, config):
    if not np.isfinite(z).all() or not np.isfinite(x).all() or (z < 0).any() or (x < 0).any():
        raise QueryError("图谱需要有限非负的 Z 与总产出，不自动填补或截断")
    zero = x == 0
    if np.any(z[:, zero] != 0) or np.any(z[zero, :] != 0):
        raise QueryError("原始零产出节点的交易行列必须全零")
    nodes, transactions, output = aggregate(rows, z, x, config["level"])
    codes = [n["code"] for n in nodes]
    centers = list(dict.fromkeys([config["entity"], *config["expanded"]]))
    if any(c not in codes for c in centers):
        raise QueryError("所选对象不在该年度和层级中")
    raw = np.divide(transactions, output[None, :], out=np.zeros_like(transactions), where=output[None, :] > 0)
    if not np.isfinite(raw).all():
        raise QueryError("计算结果非有限，无法生成图谱")
    keep = (raw > 0) & (raw >= config["threshold"])
    np.fill_diagonal(keep, False)
    all_pairs, shown_pairs = set(), set()
    for code in centers:
        k = codes.index(code)
        pairs = []
        if config["direction"] in {"incoming", "both"}:
            pairs.extend((int(i), k) for i in np.flatnonzero(keep[:, k]))
        if config["direction"] in {"outgoing", "both"}:
            pairs.extend((k, int(j)) for j in np.flatnonzero(keep[k]))
        pairs.sort(key=lambda ij: (-raw[ij], ij))
        all_pairs.update(pairs)
        shown_pairs.update(pairs[:config["limit"]])
    ordered = sorted(all_pairs, key=lambda ij: (-raw[ij], ij))
    node_type = config["level"]
    uid = lambda code: f"{node_type}:{code}"
    year = config["year"]
    relations = []
    for i, j in ordered:
        source, target = nodes[i], nodes[j]
        relations.append({
            "id": f"input:{codes[i]}:{codes[j]}", "source": uid(codes[i]), "target": uid(codes[j]),
            "type": "input", "label": "中间投入", "source_label": source["label"], "target_label": target["label"],
            "coefficient": float(raw[i, j]), "transaction": float(transactions[i, j]), "buyer_output": float(output[j]),
            "year": year, "visible": (i, j) in shown_pairs,
            "table_url": table_link(year, source, target), "output_url": table_link(year, target, output=True),
            "status": "数据计算", "evidence_id": f"dataset:{year}", "method_id": "method:direct-input",
        })
    graph_codes = set(centers)
    for i, j in shown_pairs:
        graph_codes.update((codes[i], codes[j]))
    graph_nodes = [{"id": uid(n["code"]), "code": n["code"], "label": n["label"], "type": node_type,
                    "type_label": TYPES[node_type], "expandable": True, "center": n["code"] in centers,
                    "output": float(output[i]), "table_url": table_link(year, n),
                    "in_degree": int(keep[:, i].sum()), "out_degree": int(keep[i].sum())}
                   for i, n in enumerate(nodes) if n["code"] in graph_codes]
    context_edges = []
    if node_type == "node":
        root = nodes[codes.index(config["entity"])]
        for field, label in (("sector", "属于行业"), ("province", "位于地区")):
            code = root[field]
            context_id = f"{field}:{code}"
            graph_nodes.append({"id": context_id, "code": code, "label": PROVINCES.get(code, code),
                                "type": field, "type_label": TYPES[field], "expandable": False})
            context_edges.append({"id": f"{field}:{root['code']}", "source": uid(root["code"]), "target": context_id,
                                  "type": "membership", "label": label, "status": "源表轴映射"})
    graph_nodes.extend([
        {"id": f"dataset:{year}", "label": f"{year} 年投入产出表", "type": "dataset", "type_label": "数据来源", "expandable": False},
        {"id": "method:direct-input", "label": "直接投入系数 A", "type": "method", "type_label": "计算方法", "expandable": False},
    ])
    context_edges.extend([
        {"id": "evidence:source", "source": uid(config["entity"]), "target": f"dataset:{year}", "type": "provenance", "label": "数据来源"},
        {"id": "evidence:method", "source": uid(config["entity"]), "target": "method:direct-input", "type": "provenance", "label": "关系计算方法"},
    ])
    return {"version": VERSION, "config": config, "root": uid(config["entity"]), "nodes": graph_nodes,
            "edges": [r for r in relations if r["visible"]] + context_edges,
            "relations": relations, "centers": centers,
            "summary": {"relations": len(relations), "displayed": len(shown_pairs), "hidden": len(relations) - len(shown_pairs),
                        "expanded": len(centers), "scope": "union_of_incident_thresholded_edges_of_expanded_entities"},
            "source": {"file": metadata["source"], "sha256": metadata["sha256"], "year": year,
                       "unit": metadata.get("unit", "待核实"), "status": "原始文件导入；编制与口径待核实"},
            "method": {"formula": "A_ij = Z_ij / x_j", "direction": "供给部门 i → 使用部门 j",
                       "aggregation": "先对 Z 与 x 求和，再按使用部门总产出计算 A；不对 A 直接求和或平均。",
                       "threshold": "A > 0 且 A >= 阈值；不含自环；零产出交易行列须全零。",
                       "selection": "每个展开对象按 A 从大到小保留指定条数；同值按源表轴顺序；完整关系表不受展示条数影响。",
                       "numpy_version": np.__version__,
                       "aggregation_sha256": hashlib.sha256(Path(__file__).with_name("topology.py").read_bytes()).hexdigest(),
                       "adapter_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},
            "warnings": WARNINGS[:3] + ["2005–2007 年跨年可比性待核实。", "投入产出联系不等于企业供货关系；关联路径不构成因果传播证据。",
                                        "当前为数据与方法图谱，尚未自动关联文献论断。"]}


def query(engine, params):
    config = config_from(params)
    if not engine.slots.acquire(blocking=False):
        raise RuntimeError("Knowledge workers busy")
    try:
        return build_graph(*engine.load_year(config["year"]), config)
    finally:
        engine.slots.release()
