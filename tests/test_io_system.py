"""Independent hand-calculated IO contract and failure-boundary tests."""

import unittest

import numpy as np

from ionet.core import IOSystem


class IOSystemTests(unittest.TestCase):
    def setUp(self):
        self.z = np.array([[10.0, 20.0], [5.0, 10.0]])
        self.x = np.array([100.0, 80.0])
        self.y = np.array([70.0, 65.0])
        self.io = IOSystem(self.z, self.x, ["S01", "S02"], y=self.y)

    def test_hand_calculated_coefficients_retain_self_transactions(self):
        expected = np.array([[0.1, 0.25], [0.05, 0.125]])
        np.testing.assert_allclose(self.io.A, expected)
        np.testing.assert_allclose(self.io.A @ self.io.x, self.z.sum(axis=1))
        self.assertGreater(self.io.A[0, 0], 0)

    def test_hand_calculated_leontief_inverse_and_output_closure(self):
        expected = np.array([[0.875, 0.25], [0.05, 0.9]]) / 0.775
        np.testing.assert_allclose(self.io.L, expected)
        np.testing.assert_allclose((np.eye(2) - self.io.A) @ self.io.L, np.eye(2), atol=1e-14)
        np.testing.assert_allclose(self.io.L @ self.y, self.x)
        self.assertTrue(self.io.row_balance())

    def test_full_output_uses_not_domestic_demand_only(self):
        demand_only = IOSystem(self.z, self.x, ["S01", "S02"], y=[60.0, 50.0])
        self.assertFalse(demand_only.row_balance())
        net_exports_wrong = IOSystem(self.z, self.x, ["S01", "S02"], y=[62.0, 50.0])
        self.assertFalse(net_exports_wrong.row_balance())

    def test_missing_y_is_not_silently_inferred(self):
        io = IOSystem(self.z, self.x, ["S01", "S02"])
        self.assertIsNone(io.y)
        with self.assertRaisesRegex(ValueError, "explicit y"):
            io.row_balance()

    def test_input_copy_and_nested_metadata_isolation(self):
        sectors = ["S01", "S02"]
        metadata = {"provenance": {"status": "unverified"}}
        io = IOSystem(self.z, self.x, sectors, self.y, metadata)
        self.z[0, 0] = 999
        self.x[0] = 999
        self.y[0] = 999
        sectors[0] = "changed"
        metadata["provenance"]["status"] = "changed"
        self.assertEqual(io.Z[0, 0], 10)
        self.assertEqual(io.x[0], 100)
        self.assertEqual(io.y[0], 70)
        self.assertEqual(io.sectors, ("S01", "S02"))
        self.assertEqual(io.metadata["provenance"]["status"], "unverified")
        with self.assertRaises(ValueError):
            io.Z[0, 0] = 999

    def test_derived_coefficients_do_not_modify_source(self):
        derived = self.io.A
        derived[0, 0] = 0
        self.assertEqual(self.io.Z[0, 0], 10)
        self.assertEqual(self.io.A[0, 0], 0.1)

    def test_unknown_metadata_stays_unknown(self):
        for key in ("amount_unit", "price_basis", "accounting_scope", "y_scope"):
            self.assertEqual(self.io.metadata[key], "unknown")
        self.assertNotIn("sector_names", self.io.metadata)

    def test_signed_y_is_preserved(self):
        io = IOSystem([[0.0, 2.0], [0.0, 0.0]], [1.0, 3.0], ["a", "b"], y=[-1.0, 3.0],
                      metadata={"y_scope": "signed_accounting_closure"})
        self.assertTrue(io.row_balance())
        self.assertEqual(io.y[0], -1)

    def test_currency_scaling_invariance(self):
        scaled = IOSystem(self.z * 1000, self.x * 1000, self.io.sectors, self.y * 1000)
        np.testing.assert_allclose(scaled.A, self.io.A)
        np.testing.assert_allclose(scaled.L, self.io.L)
        self.assertTrue(scaled.row_balance())

    def test_node_permutation_equivariance(self):
        order = [1, 0]
        io = IOSystem(self.z[np.ix_(order, order)], self.x[order], ["S02", "S01"], self.y[order])
        np.testing.assert_allclose(io.A, self.io.A[np.ix_(order, order)])
        np.testing.assert_allclose(io.L, self.io.L[np.ix_(order, order)])
        self.assertTrue(io.row_balance())

    def test_zero_or_negative_output_is_rejected(self):
        for x in ([0.0, 80.0], [-1.0, 80.0]):
            with self.subTest(x=x), self.assertRaisesRegex(ValueError, "strictly positive"):
                IOSystem(self.z, x, self.io.sectors)

    def test_invalid_shapes_and_codes_are_rejected(self):
        cases = [([], [], []), ([1, 2], [1, 2], ["a", "b"]),
                 ([[1, 2, 3]], [1], ["a"]), (self.z, [[100], [80]], ["a", "b"]),
                 (self.z, [100], ["a", "b"]), (self.z, self.x, ["a"]),
                 (self.z, self.x, ["a", "a"]), (self.z, self.x, ["a", ""]),
                 (self.z, self.x, [1, 2]), (self.z, self.x, "ab")]
        for z, x, codes in cases:
            with self.subTest(z=z, x=x, codes=codes), self.assertRaises(ValueError):
                IOSystem(z, x, codes)

    def test_unordered_or_missing_sector_containers_are_rejected(self):
        for codes in ({"a", "b"}, frozenset({"a", "b"}), {"a": 1, "b": 2}, None, 42):
            with self.subTest(codes=codes), self.assertRaisesRegex(ValueError, "ordered iterable"):
                IOSystem(self.z, self.x, codes)

    def test_ordered_sector_arrays_and_generators_are_supported(self):
        for codes in (np.array(["S01", "S02"]), (code for code in ["S01", "S02"])):
            io = IOSystem(self.z, self.x, codes, self.y)
            self.assertEqual(io.sectors, ("S01", "S02"))
            self.assertTrue(io.row_balance())

    def test_nonfinite_and_negative_transactions_are_rejected(self):
        for bad in (np.nan, np.inf, -np.inf, -1.0):
            z = self.z.copy()
            z[0, 1] = bad
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                IOSystem(z, self.x, self.io.sectors)
        for bad in (np.nan, np.inf, -np.inf):
            with self.subTest(bad_x=bad), self.assertRaises(ValueError):
                IOSystem(self.z, [bad, 80], self.io.sectors)

    def test_invalid_y_and_metadata_are_rejected(self):
        for y in ([1], [[1], [2]], [np.nan, 1], [np.inf, 1]):
            with self.subTest(y=y), self.assertRaises(ValueError):
                IOSystem(self.z, self.x, self.io.sectors, y=y)
        with self.assertRaisesRegex(ValueError, "metadata"):
            IOSystem(self.z, self.x, self.io.sectors, metadata=["unknown"])

    def test_spectral_radius_one_or_greater_is_rejected(self):
        for z in ([[1.0]], [[1.1]], [[0.0, 2.0], [0.5, 0.0]]):
            codes = [str(i) for i in range(len(z))]
            io = IOSystem(z, np.ones(len(z)), codes)
            with self.subTest(z=z), self.assertRaisesRegex(ValueError, "spectral radius"):
                _ = io.L

    def test_single_sector_empty_transaction_is_supported(self):
        io = IOSystem([[0.0]], [1.0], ["S01"], y=[1.0])
        np.testing.assert_array_equal(io.A, [[0.0]])
        np.testing.assert_array_equal(io.L, [[1.0]])
        self.assertTrue(io.row_balance())

    def test_invalid_balance_tolerance_is_rejected(self):
        for rtol, atol in ((-1.0, 0.0), (0.0, -1.0), (np.inf, 0.0), (0.0, np.nan)):
            with self.subTest(rtol=rtol, atol=atol), self.assertRaises(ValueError):
                self.io.row_balance(rtol=rtol, atol=atol)

    def test_reassigned_invalid_output_blocks_a_l_and_balance(self):
        for x in (np.array([-10.0, 20.0]), np.array([0.0, 20.0]),
                  np.array([np.nan, 20.0]), np.array([[100.0], [80.0]])):
            io = IOSystem(self.z, self.x, self.io.sectors, self.y)
            io.x = x
            for operation in (lambda: io.A, lambda: io.L, io.row_balance):
                with self.subTest(x=x), self.assertRaises(ValueError):
                    operation()

    def test_unlocked_negative_transactions_block_a_l_and_balance(self):
        self.io.Z.setflags(write=True)
        self.io.Z[0, 1] = -1.0
        for operation in (lambda: self.io.A, lambda: self.io.L, self.io.row_balance):
            with self.assertRaisesRegex(ValueError, "nonnegative"):
                operation()

    def test_reassigned_bad_matrix_labels_and_y_are_rejected(self):
        for z in (np.ones((2, 3)), np.array([[np.inf, 1.0], [0.0, 0.0]])):
            io = IOSystem(self.z, self.x, self.io.sectors, self.y)
            io.Z = z
            with self.subTest(z=z), self.assertRaises(ValueError):
                _ = io.A
        for codes in (["a", "a"], {"a", "b"}):
            io = IOSystem(self.z, self.x, self.io.sectors, self.y)
            io.sectors = codes
            with self.subTest(codes=codes), self.assertRaises(ValueError):
                _ = io.A
        for y in (np.array([1.0]), np.array([np.nan, 1.0])):
            io = IOSystem(self.z, self.x, self.io.sectors, self.y)
            io.y = y
            with self.subTest(y=y), self.assertRaises(ValueError):
                io.row_balance()


if __name__ == "__main__":
    unittest.main()
