"""Explicit matrix, direction, and distance contracts for IO networks."""

from dataclasses import dataclass
from copy import deepcopy
from numbers import Real
from typing import Any, TYPE_CHECKING

import networkx as nx
import numpy as np

if TYPE_CHECKING:
    from ionet.core import IOSystem


@dataclass(frozen=True)
class NetworkSystem:
    """A filtered directed matrix with its source interpretation recorded.

    Use ``build_network`` to construct matching matrix, graph, and metadata.
    Graph structure is frozen; its edge attributes are not immutable.
    """

    graph: nx.DiGraph
    matrix: np.ndarray
    node_order: tuple
    matrix_type: str
    threshold: float
    normalization: str
    direction: str
    distance: str
    node_metadata: dict
    edge_metadata: dict
    metadata: dict


def build_network(
    io: "IOSystem", matrix: str = "A", threshold: float = 0.0
) -> NetworkSystem:
    """Keep positive weights at or above an absolute threshold; exclude loops.

    Rows supply columns. Z has the source currency units, A is normalized by
    buyer output, and L is the full Leontief inverse, not L minus identity.
    Filtering never changes IO matrices and never removes isolated nodes.
    """
    if matrix not in ("Z", "A", "L"):
        raise ValueError("matrix must be one of 'Z', 'A', or 'L'")
    if isinstance(threshold, (bool, np.bool_)) or not isinstance(threshold, Real):
        raise ValueError("threshold must be a finite nonnegative scalar")
    threshold = float(threshold)
    if not np.isfinite(threshold) or threshold < 0:
        raise ValueError("threshold must be a finite nonnegative scalar")

    raw = np.asarray(getattr(io, matrix), dtype=float)
    nodes = tuple(io.sectors)
    if raw.shape != (len(nodes), len(nodes)):
        raise ValueError("matrix shape must match the IO node order")
    if len(set(nodes)) != len(nodes):
        raise ValueError("IO node labels must be unique")
    if not np.isfinite(raw).all() or (raw < 0).any():
        raise ValueError("network matrix must be finite and nonnegative")

    keep = (raw > 0) & (raw >= threshold)
    np.fill_diagonal(keep, False)
    filtered = np.where(keep, raw, 0.0)
    with np.errstate(over="ignore", divide="ignore"):
        distances = 1.0 / filtered[keep]
    if not np.isfinite(distances).all():
        raise ValueError("positive weights must have finite reciprocal distances")

    normalization = {
        "Z": "none",
        "A": "buyer_output",
        "L": "leontief_total_requirements",
    }[matrix]
    direction = "supplier_to_user"
    distance = "inverse_positive_weight"
    metadata = {
        "matrix_type": matrix,
        "threshold": threshold,
        "threshold_rule": "weight > 0 and weight >= threshold",
        "threshold_basis": "absolute_matrix_weight",
        "normalization": normalization,
        "direction": direction,
        "distance": distance,
        "self_loop_policy": "exclude_from_network_only",
        "pair_denominator": "all_original_ordered_distinct_node_pairs",
        "source_metadata": deepcopy(dict(io.metadata)),
    }
    graph = nx.DiGraph(**metadata)
    node_metadata = {node: {"matrix_index": i} for i, node in enumerate(nodes)}
    graph.add_nodes_from((node, attrs.copy()) for node, attrs in node_metadata.items())
    edge_metadata = {}
    for (i, j), length in zip(zip(*np.where(keep)), distances):
        attrs = {"weight": float(filtered[i, j]), "distance": float(length)}
        graph.add_edge(nodes[i], nodes[j], **attrs)
        edge_metadata[(nodes[i], nodes[j])] = attrs.copy()
    filtered.setflags(write=False)
    return NetworkSystem(
        graph=nx.freeze(graph),
        matrix=filtered,
        node_order=nodes,
        matrix_type=matrix,
        threshold=threshold,
        normalization=normalization,
        direction=direction,
        distance=distance,
        node_metadata=node_metadata,
        edge_metadata=edge_metadata,
        metadata=metadata,
    )


def _validate_graph_matrix(net: NetworkSystem) -> None:
    graph = net.graph
    nodes = net.node_order
    matrix = net.matrix
    if not graph.is_directed() or graph.is_multigraph():
        raise ValueError("network graph must be a directed simple graph")
    if tuple(graph.nodes) != nodes:
        raise ValueError("graph nodes must match the recorded node order")
    if matrix.shape != (len(nodes), len(nodes)):
        raise ValueError("network matrix must match the recorded node order")
    if not np.isfinite(matrix).all() or (matrix < 0).any() or np.any(np.diag(matrix)):
        raise ValueError("network matrix must be finite, nonnegative, and loop-free")
    if graph.number_of_edges() != np.count_nonzero(matrix):
        raise ValueError("graph edges must match the network matrix")
    positions = {node: i for i, node in enumerate(nodes)}
    for source, target, attrs in graph.edges(data=True):
        weight = float(matrix[positions[source], positions[target]])
        if weight <= 0 or attrs.get("weight") != weight:
            raise ValueError("graph edge weight does not match the network matrix")
        if attrs.get("distance") != 1.0 / weight:
            raise ValueError("graph edge distance must equal inverse positive weight")


def structural_metrics(net: NetworkSystem) -> dict[str, Any]:
    """Measure topology and weighted strength, not economic resilience/loss.

    Unreachable ordered pairs contribute zero to global efficiency, including
    isolated nodes in its original n*(n-1) denominator. Reciprocal distances
    are used, rather than treating a stronger dependency as a longer path.
    """
    if not isinstance(net, NetworkSystem):
        raise TypeError("net must be a NetworkSystem")
    _validate_graph_matrix(net)
    graph = net.graph
    nodes = net.node_order
    n = len(nodes)
    incoming = {node: float(value) for node, value in graph.in_degree(weight="weight")}
    outgoing = {node: float(value) for node, value in graph.out_degree(weight="weight")}
    if not all(np.isfinite(value) for value in (*incoming.values(), *outgoing.values())):
        raise ValueError("network strength overflowed; rescale the source units")
    efficiency = 0.0
    reachable = 0
    if n > 1:
        denominator = n * (n - 1)
        for source, paths in nx.all_pairs_dijkstra_path_length(graph, weight="distance"):
            for target, length in paths.items():
                if source != target and not np.isfinite(length):
                    raise ValueError("path distance overflowed; rescale the source units")
                if source != target and length > 0:
                    efficiency += (1.0 / length) / denominator
                    reachable += 1
    return {
        "nodes": n,
        "edges": graph.number_of_edges(),
        "density": float(nx.density(graph)),
        "global_efficiency": float(efficiency),
        "reachable_share": reachable / (n * (n - 1)) if n > 1 else 0.0,
        "in_strength": incoming,
        "out_strength": outgoing,
        "mean_in_strength": sum(value / n for value in incoming.values()) if n else 0.0,
        "mean_out_strength": sum(value / n for value in outgoing.values()) if n else 0.0,
    }
