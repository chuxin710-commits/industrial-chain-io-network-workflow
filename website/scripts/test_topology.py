"""Hand-check the network adapter independently of the browser's display graph."""

import json
from pathlib import Path
import sys
import unittest
import urllib.request
import threading
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from mrio import QueryError
from topology import aggregate, build_snapshot, parameters, TopologyEngine, load_io
from app import create_server


class TopologyTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {"code": "Beijing_S01", "label": "Beijing S01", "province": "Beijing", "sector": "S01"},
            {"code": "Beijing_S02", "label": "Beijing S02", "province": "Beijing", "sector": "S02"},
            {"code": "Shanghai_S01", "label": "Shanghai S01", "province": "Shanghai", "sector": "S01"},
        ]
        self.z = np.array([[5., 2., 1.], [3., 6., 4.], [7., 8., 9.]])
        self.x = np.array([10., 20., 40.])
        self.metadata = {"source": "synthetic.csv", "sha256": "0" * 64}

    def snapshot(self, **kwargs):
        config = parameters({"year": "2023", "level": "node", "weight": "A", "threshold": "0.1", "max_edges": "2", **kwargs})
        return build_snapshot(self.rows, self.z, self.x, self.metadata, config)

    def test_aggregate_Z_and_x_before_A_conserves_totals(self):
        nodes, z, x = aggregate(self.rows, self.z, self.x, "sector")
        np.testing.assert_array_equal(z, [[22., 10.], [7., 6.]])
        np.testing.assert_array_equal(x, [50., 20.])
        self.assertEqual(z.sum(), self.z.sum())
        self.assertEqual(x.sum(), self.x.sum())
        result = self.snapshot(level="sector", max_edges="10", threshold="0")
        edge = next(e for e in result["edges"] if e["source"] == "S01")
        self.assertEqual(edge["weight"], 10/20)
        self.assertEqual([n["id"] for n in result["nodes"]], ["S01", "S02"])

    def test_direction_inclusive_threshold_self_loops_and_full_metrics(self):
        result = self.snapshot()
        self.assertEqual(result["metrics"]["edges"], 5)
        self.assertEqual(result["metrics"]["displayed_edges"], 2)
        self.assertEqual(result["metrics"]["density"], 5/6)
        first = result["nodes"][0]
        self.assertEqual(first["out_degree"], 1)
        self.assertAlmostEqual(first["out_strength"], .1)
        self.assertFalse(any(e["source"] == e["target"] for e in result["edges"]))
        self.assertEqual(result["metrics"], {**self.snapshot(max_edges="6")["metrics"],
                         "displayed_edges": 2, "displayed_weight_share": result["metrics"]["displayed_weight_share"]})

    def test_display_limit_does_not_change_strengths_and_ties_are_stable(self):
        a, b = self.snapshot(max_edges="1"), self.snapshot(max_edges="5")
        self.assertEqual(a["nodes"], b["nodes"])
        self.assertEqual(a["metrics"]["edges"], b["metrics"]["edges"])
        self.assertEqual(a["edges"], self.snapshot(max_edges="1")["edges"])
        tied = self.snapshot(max_edges="4")["edges"]
        self.assertTrue(any(e["source"] == "Beijing_S01" and e["target"] == "Beijing_S02" for e in tied))
        self.assertFalse(any(e["source"] == "Beijing_S02" and e["target"] == "Shanghai_S01" for e in tied))

    def test_A_currency_scale_invariance(self):
        config = parameters({"level": "node", "threshold": "0", "max_edges": "20"})
        a = build_snapshot(self.rows, self.z, self.x, self.metadata, config)
        b = build_snapshot(self.rows, self.z * 100, self.x * 100, self.metadata, config)
        self.assertEqual(a["edges"], b["edges"])

    def test_zero_output_preserves_nodes_and_rejects_inconsistent_buyers(self):
        self.z[:, 2] = 0; self.z[2, :] = 0; self.x[2] = 0
        result = self.snapshot()
        self.assertEqual(result["metrics"]["nodes"], 3)
        self.assertEqual(result["metrics"]["isolates"], 1)
        self.z[0, 2] = 1
        with self.assertRaises(QueryError):
            self.snapshot()

    def test_zero_output_is_validated_before_aggregation(self):
        self.x[2] = 0
        for level in ("sector", "province", "node"):
            with self.assertRaises(QueryError):
                self.snapshot(level=level)

    def test_invalid_params(self):
        for params in ({"year": "2024"}, {"level": "fake"}, {"weight": "L"},
                       {"threshold": "nan"}, {"threshold": "-1"}, {"max_edges": "3001"}, {"sql": "x"}):
            with self.assertRaises(QueryError):
                parameters(params)
        with self.assertRaises(QueryError):
            parameters({"display": "unknown"})

    def test_local_backbone_preserves_metrics_budget_and_determinism(self):
        base = self.snapshot(display="topk")
        local = self.snapshot(display="local")
        self.assertEqual(base["nodes"], local["nodes"])
        for key in ("edges", "density", "isolates", "total_weight"):
            self.assertEqual(base["metrics"][key], local["metrics"][key])
        self.assertLessEqual(len(local["edges"]), 2)
        self.assertEqual(local["edges"], self.snapshot(display="local")["edges"])
        self.assertEqual(len({(e["source"], e["target"]) for e in local["edges"]}), len(local["edges"]))
        for budget in (1, 2, 5, 100):
            view = self.snapshot(display="local", max_edges=str(budget))
            self.assertLessEqual(len(view["edges"]), budget)
            self.assertGreaterEqual(view["coverage"]["hidden_connected_nodes"], 0)

    def test_local_backbone_covers_weak_component(self):
        rows = [{"code": str(i), "label": str(i)} for i in range(4)]
        z = np.array([[0, 100, 0, 0], [90, 0, 0, 0], [0, 0, 0, 2], [0, 0, 1, 0]], dtype=float)
        config = parameters({"level": "node", "weight": "Z", "threshold": "0", "max_edges": "2"})
        top = build_snapshot(rows, z, np.ones(4), self.metadata, config)
        local = build_snapshot(rows, z, np.ones(4), self.metadata, {**config, "display": "local"})
        self.assertEqual(top["coverage"]["hidden_connected_nodes"], 2)
        self.assertEqual(local["coverage"]["hidden_connected_nodes"], 0)
        self.assertEqual(local["metrics"]["edges"], 4)
        empty = build_snapshot(rows, z * 0, np.ones(4), self.metadata, {**config, "display": "local"})
        self.assertEqual(empty["coverage"]["node_coverage"], 1)
        self.assertEqual(empty["edges"], [])

    def test_year_cache_reuse_budget_and_readonly(self):
        database = Path(__file__).resolve().parents[1] / "var/mrio.sqlite3"
        if not database.exists(): self.skipTest("Private local database is not present")
        engine = TopologyEngine(database)
        with patch("topology.load_io", wraps=load_io) as reader:
            engine.query({"year": "2023", "display": "local"})
            engine.query({"year": "2023", "display": "topk", "max_edges": "100"})
            engine.neighbors({"year": "2023", "node": "S12"})
            self.assertEqual(reader.call_count, 1)
            self.assertFalse(engine.load_year(2023)[1].flags.writeable)
            engine.year_budget = engine.year_bytes
            engine.query({"year": "2022"})
            self.assertLessEqual(engine.year_bytes, engine.year_budget)
            self.assertEqual(len(engine.year_cache), 1)
            with patch.object(engine, "version", return_value=("changed",)):
                engine.query({"year": "2022"})
            self.assertEqual(reader.call_count, 3)

    def test_real_years_zero_nodes_and_http_contract(self):
        database = Path(__file__).resolve().parents[1] / "var/mrio.sqlite3"
        if not database.exists(): self.skipTest("Private local database is not present")
        engine = TopologyEngine(database)
        result = engine.query({"year": "2018", "level": "node"})
        self.assertEqual(len(result["nodes"]), 1302)
        for code in ("InnerMongolia_S21", "Guizhou_S23", "Tibet_S14"):
            node = next(n for n in result["nodes"] if n["id"] == code)
            self.assertEqual(node["strength"], 0)
        for level, n in (("province", 31), ("sector", 42)):
            self.assertEqual(engine.query({"level": level})["metrics"]["nodes"], n)
        snapshot = engine.query({"year": "2023", "max_edges": "1"})
        neighbor = engine.neighbors({"year": "2023", "max_edges": "1", "node": "S12"})
        node = next(n for n in snapshot["nodes"] if n["id"] == "S12")
        self.assertEqual(len([e for e in neighbor["edges"] if e["direction"] == "incoming"]), node["in_degree"])
        self.assertEqual(len([e for e in neighbor["edges"] if e["direction"] == "outgoing"]), node["out_degree"])
        self.assertGreater(len(neighbor["edges"]), 1)
        self.assertAlmostEqual(sum(e["weight"] for e in neighbor["edges"] if e["direction"] == "incoming"), node["in_strength"])
        server = create_server(database, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/api/topology?year=2000&level=sector"
            with urllib.request.urlopen(url) as response:
                data = json.load(response)
            self.assertEqual(data["year"], 2000)
            self.assertEqual(len(data["source"]["sha256"]), 64)
            self.assertEqual(data["method"]["kernel"], "ionet.network.build.build_network")
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__":
    unittest.main()
