"""Hand-calculated and independent-backend checks of the network contract."""

from types import SimpleNamespace
import unittest

import networkx as nx
import numpy as np
from scipy.sparse.csgraph import shortest_path

from ionet.core import IOSystem
from ionet.network import build_network, structural_metrics


class NetworkTests(unittest.TestCase):
    def io(self, z, x=None):
        z = np.asarray(z, dtype=float)
        if x is None:
            x = np.full(len(z), 10.0)
        return IOSystem(z, x, [f"S{i:02d}" for i in range(len(z))])

    def test_direction_strength_and_manual_efficiency(self):
        io = self.io([[0., 2., .1], [0., 0., 3.], [0., 0., 0.]])
        net = build_network(io, matrix="Z")
        first, middle, last = net.node_order
        self.assertTrue(net.graph.has_edge(first, middle))
        self.assertFalse(net.graph.has_edge(middle, first))
        self.assertAlmostEqual(nx.shortest_path_length(net.graph, first, last,
                                                     weight="distance"), 1 / 2 + 1 / 3)
        result = structural_metrics(net)
        self.assertAlmostEqual(result["global_efficiency"], (2 + 3 + 1.2) / 6)
        self.assertEqual(result["in_strength"], {first: 0., middle: 2., last: 3.1})
        self.assertEqual(result["out_strength"], {first: 2.1, middle: 3., last: 0.})
        self.assertAlmostEqual(result["reachable_share"], .5)
        self.assertNotIn("economic_resilience", result)

    def test_scipy_independent_paths_and_efficiency(self):
        io = self.io([[0., 2., .1], [.4, 0., 3.], [1., .2, 0.]])
        net = build_network(io, matrix="Z")
        w = net.matrix
        cost = np.divide(1., w, out=np.zeros_like(w), where=w > 0)
        expected = shortest_path(cost, directed=True, method="FW")
        for i, source in enumerate(net.node_order):
            actual = nx.single_source_dijkstra_path_length(net.graph, source,
                                                          weight="distance")
            for j, target in enumerate(net.node_order):
                self.assertAlmostEqual(actual.get(target, np.inf), expected[i, j])
        inv = np.divide(1., expected, out=np.zeros_like(expected),
                        where=(expected > 0) & np.isfinite(expected))
        self.assertAlmostEqual(structural_metrics(net)["global_efficiency"], inv.sum() / 6)

    def test_isolates_stay_in_efficiency_denominator(self):
        net = build_network(self.io([[0., 2., 0.], [0., 0., 0.], [0., 0., 0.]]),
                            matrix="Z")
        self.assertEqual(len(net.graph), 3)
        self.assertEqual(net.graph.degree(net.node_order[-1]), 0)
        self.assertAlmostEqual(structural_metrics(net)["global_efficiency"], 2 / 6)
        empty = build_network(self.io(np.zeros((3, 3))))
        self.assertEqual(structural_metrics(empty)["global_efficiency"], 0.)
        single = build_network(self.io([[1.]]))
        self.assertEqual(structural_metrics(single)["global_efficiency"], 0.)
        self.assertEqual(structural_metrics(single)["density"], 0.)

    def test_threshold_is_inclusive_and_loops_excluded(self):
        io = self.io([[1., .2, .19], [0., 1., 0.], [0., 0., 1.]])
        before_z, before_a = io.Z.copy(), io.A.copy()
        net = build_network(io, matrix="Z", threshold=.2)
        self.assertEqual(net.graph.number_of_edges(), 1)
        self.assertEqual(net.matrix[0, 1], .2)
        self.assertEqual(np.diag(net.matrix).sum(), 0.)
        np.testing.assert_array_equal(io.Z, before_z)
        np.testing.assert_array_equal(io.A, before_a)
        self.assertEqual(net.metadata["threshold_rule"], "weight > 0 and weight >= threshold")
        self.assertEqual(net.metadata["self_loop_policy"], "exclude_from_network_only")
        self.assertEqual(len(net.graph), 3)
        with self.assertRaises(ValueError):
            net.matrix[0, 1] = 0.
        with self.assertRaises(nx.NetworkXError):
            net.graph.remove_node(net.node_order[0])

    def test_units_scaling_a_l_invariant_z_changes(self):
        z = np.array([[1., 2.], [1., 1.]])
        io = self.io(z, np.array([10., 20.]))
        scaled = self.io(z * 1000., np.array([10., 20.]) * 1000.)
        for kind in ("A", "L"):
            first, second = build_network(io, matrix=kind), build_network(scaled, matrix=kind)
            np.testing.assert_allclose(first.matrix, second.matrix)
            self.assertAlmostEqual(structural_metrics(first)["global_efficiency"],
                                   structural_metrics(second)["global_efficiency"])
        first, second = build_network(io, matrix="Z"), build_network(scaled, matrix="Z")
        self.assertAlmostEqual(structural_metrics(second)["global_efficiency"],
                               1000 * structural_metrics(first)["global_efficiency"])
        self.assertEqual(build_network(io).normalization, "buyer_output")
        self.assertEqual(build_network(io, matrix="L").normalization,
                         "leontief_total_requirements")

    def test_stronger_weight_shortens_path(self):
        original = build_network(self.io([[0., 1.], [0., 0.]]), matrix="Z")
        stronger = build_network(self.io([[0., 2.], [0., 0.]]), matrix="Z")
        u, v = original.node_order
        self.assertLess(stronger.graph[u][v]["distance"], original.graph[u][v]["distance"])
        self.assertGreater(structural_metrics(stronger)["global_efficiency"],
                           structural_metrics(original)["global_efficiency"])

    def test_invalid_thresholds_and_matrix_modes(self):
        io = self.io([[0., 1.], [0., 0.]])
        for value in (-1., np.inf, np.nan, True, "0", [0.]):
            with self.subTest(threshold=value):
                with self.assertRaises(ValueError):
                    build_network(io, threshold=value)
        with self.assertRaises(ValueError):
            build_network(io, matrix="B")

    def test_invalid_network_matrices_fail_closed(self):
        for w in ([[0., -1.], [1., 0.]], [[0., np.inf], [1., 0.]],
                  [[0., np.nan], [1., 0.]], [[0., 1e-320], [1., 0.]], [[0.]]):
            io = SimpleNamespace(A=np.array(w), sectors=("a", "b"), metadata={})
            with self.subTest(w=w):
                with self.assertRaises(ValueError):
                    build_network(io)

    def test_keeps_node_and_matrix_provenance(self):
        io = IOSystem([[0., 1.], [0., 0.]], [10., 20.], ["supplier", "user"],
                      metadata={"amount_unit": "unknown", "year": 2023})
        net = build_network(io)
        self.assertEqual(net.node_order, ("supplier", "user"))
        self.assertEqual(net.direction, "supplier_to_user")
        self.assertEqual(net.distance, "inverse_positive_weight")
        self.assertEqual(net.metadata["source_metadata"]["amount_unit"], "unknown")
        self.assertAlmostEqual(net.graph["supplier"]["user"]["weight"], 1 / 20)

    def test_source_metadata_is_snapshotted(self):
        io = IOSystem([[0., 1.], [0., 0.]], [10., 20.], ["a", "b"],
                      metadata={"source": {"classification": "unknown"}})
        net = build_network(io)
        io.metadata["source"]["classification"] = "changed"
        self.assertEqual(net.metadata["source_metadata"]["source"]["classification"],
                         "unknown")
        net.metadata["source_metadata"]["source"]["classification"] = "network_change"
        self.assertEqual(io.metadata["source"]["classification"], "changed")

    def test_edge_attribute_tampering_is_rejected(self):
        for attribute, value in (("weight", 5.), ("distance", 5.)):
            net = build_network(self.io([[0., 1.], [0., 0.]]), matrix="Z")
            source, target = net.node_order
            net.graph[source][target][attribute] = value
            with self.subTest(attribute=attribute):
                with self.assertRaises(ValueError):
                    structural_metrics(net)


if __name__ == "__main__":
    unittest.main()
