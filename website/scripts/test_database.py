"""Run with: python -X utf8 -m unittest discover -s scripts -p test_database.py -v"""

from contextlib import closing
import csv
import io
import json
import math
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from app import create_server
from mrio import (QueryError, catalog, export_csv, import_year, initialize, open_readonly,
                  prepare_query, table, write_manifest)


def write_csv(path, rows):
    with path.open("w", encoding="utf-8", newline="") as handle:
        csv.writer(handle).writerows(rows)


def fixture(root, year):
    folder = root / str(year)
    folder.mkdir()
    industries = ["Beijing_S01", "Beijing_S02", "Tianjin_S01"]
    final = ["Beijing_RuralCon", "Tianjin_InvChange"]
    columns = industries + final + ["E_exports", "Err", "X_output"]
    row_codes = industries + ["International_Imports_M", "VA_CompensationOfEmployees", "Total_Input_X"]
    records = [[code] + [(ri + 1) * 100 + ci + year / 10000 for ci in range(len(columns))]
               for ri, code in enumerate(row_codes)]
    records[0][1] = -17.125
    records[1][2] = ""
    records[2][3] = 0
    write_csv(folder / f"Consolidated_MRIO_Table_{year}.csv", [[""] + columns] + records)
    write_csv(folder / f"Z_{year}.csv", [[""] + industries] + [r[:4] for r in records[:3]])
    write_csv(folder / f"F_{year}.csv", [[""] + final] + [[r[0]] + r[4:6] for r in records[:3]])
    write_csv(folder / f"VA_{year}.csv", [[""] + industries] + [records[4][:4]])
    write_csv(folder / f"X_{year}.csv", [["node", "value"]] + [[r[0], r[-1]] for r in records[:3]])
    return folder


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.database = self.root / "test.sqlite3"
        fixture(self.root, 2000)
        fixture(self.root, 2023)
        with closing(sqlite3.connect(self.database)) as connection:
            initialize(connection)
            self.metadata = import_year(connection, self.root, 2023)
            import_year(connection, self.root, 2000)

    def tearDown(self):
        self.temporary.cleanup()

    def query(self, **params):
        with closing(open_readonly(self.database)) as connection:
            return table(connection, prepare_query(connection, {name: str(value) for name, value in params.items()}))

    def test_catalog_reports_only_actual_coverage_and_unverified_metadata(self):
        with closing(open_readonly(self.database)) as connection:
            data = catalog(connection)
        self.assertEqual([item["year"] for item in data["years"]], [2000, 2023])
        self.assertFalse(data["complete_year_coverage"])
        self.assertEqual(data["sectors"], [{"code": "S01", "label": "S01"}, {"code": "S02", "label": "S02"}])
        self.assertEqual(data["provinces"][0], {"code": "Beijing", "label": "北京"})
        self.assertIn("未注明", data["years"][0]["unit"])
        self.assertEqual(len(data["views"]), 5)

    def test_views_preserve_full_table_null_negative_zero_and_source(self):
        result = self.query(view="full")
        self.assertEqual((result["total_rows"], result["total_columns"]), (6, 8))
        self.assertEqual(result["values"][0][0], -17.125)
        self.assertIsNone(result["values"][1][1])
        self.assertEqual(result["values"][2][2], 0)
        self.assertEqual(result["source"]["sha256"], self.metadata["sha256"])
        for view, shape in (("z", (3, 3)), ("f", (3, 2)), ("va", (1, 3)), ("x", (3, 1))):
            result = self.query(view=view)
            self.assertEqual((result["total_rows"], result["total_columns"]), shape)

    def test_both_axes_filters_and_pagination(self):
        result = self.query(row_province="Beijing", col_province="Tianjin", row_sector="S02")
        self.assertEqual(result["rows"][0]["code"], "Beijing_S02")
        self.assertEqual(result["columns"][0]["code"], "Tianjin_S01")
        self.assertAlmostEqual(result["values"][0][0], 202.2023)
        paged = self.query(row_offset=1, col_offset=1, row_limit=1, col_limit=1)
        self.assertEqual(len(paged["rows"]), 1)
        self.assertIsNone(paged["values"][0][0])
        self.assertEqual(self.query(row_offset=5000)["rows"], [])
        self.assertEqual(self.query(view="va", row_province="Beijing")["total_rows"], 0)

    def test_export_is_bom_csv_all_filtered_cells_not_viewport(self):
        with closing(open_readonly(self.database)) as connection:
            query = prepare_query(connection, {"view": "full", "row_offset": "1", "col_offset": "1",
                                               "row_limit": "1", "col_limit": "1"})
            content = b"".join(export_csv(connection, query))
        self.assertTrue(content.startswith(b"\xef\xbb\xbf"))
        records = list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))
        self.assertEqual((len(records), len(records[0])), (7, 9))
        self.assertEqual(records[1][1], "-17.125")
        self.assertEqual(records[2][2], "")
        self.assertEqual(records[-1][0], "Total_Input_X")
        self.assertEqual(records[0][-1], "X_output")
        with closing(open_readonly(self.database)) as connection:
            filtered = prepare_query(connection, {"row_province": "Beijing", "row_sector": "S02",
                                                   "col_province": "Beijing"})
            content = b"".join(export_csv(connection, filtered))
        records = list(csv.reader(io.StringIO(content.decode("utf-8-sig"))))
        self.assertEqual((len(records), len(records[0])), (2, 3))
        self.assertEqual(records[1][0], "Beijing_S02")
        self.assertEqual(records[1][2], "")

    def test_invalid_years_limits_filters_and_injection_are_rejected(self):
        bad = [{"year": "1999"}, {"year": "2024"}, {"year": "2001"}, {"year": "2023 OR 1=1"},
               {"row_limit": "201"}, {"row_limit": "0"}, {"col_limit": "61"}, {"col_offset": "-1"},
               {"view": "sqlite_master"}, {"query": "DROP TABLE datasets"}, {"row_sector": "S43"},
               {"row_province": "Beijing' OR 1=1--"}, {"year": ""}]
        with closing(open_readonly(self.database)) as connection:
            for params in bad:
                with self.subTest(params=params), self.assertRaises(QueryError):
                    prepare_query(connection, params)
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute("DELETE FROM datasets")
            self.assertEqual(connection.execute("SELECT count(*) FROM datasets").fetchone()[0], 2)

    def test_resume_hash_and_component_verification_are_atomic(self):
        with closing(sqlite3.connect(self.database)) as connection:
            initialize(connection)
            self.assertEqual(import_year(connection, self.root, 2023)["import_status"], "unchanged")
            component = self.root / "2023" / "X_2023.csv"
            write_csv(component, [["node", "value"], ["Beijing_S01", 1], ["Beijing_S02", 1], ["Tianjin_S01", 1]])
            with self.assertRaisesRegex(ValueError, "independent sample mismatch"):
                import_year(connection, self.root, 2023)
            self.assertEqual(table(connection, prepare_query(connection, {}))["values"][0][0], -17.125)
            manifest = self.root / "manifest.json"
            write_manifest(connection, manifest)
            data = json.loads(manifest.read_text(encoding="utf-8"))
            self.assertEqual(len(data["years"]), 2)
            self.assertTrue(all(audit["matched"] for audit in data["years"][1]["verification"]))

    def test_http_endpoints_errors_and_csv_contract(self):
        server = create_server(self.database, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(origin + "/api/health") as response:
                self.assertEqual(json.load(response)["year_count"], 2)
            with urlopen(origin + "/api/table?view=x&row_province=Beijing") as response:
                self.assertEqual(json.load(response)["total_rows"], 2)
            with urlopen(origin + "/api/export?view=z&row_limit=1") as response:
                self.assertEqual(response.headers["X-MRIO-Rows"], "3")
                self.assertEqual(response.headers["X-MRIO-Source-SHA256"], self.metadata["sha256"])
                self.assertEqual(len(response.read().decode("utf-8-sig").splitlines()), 4)
            for path, status in (("/api/table?year=2023&year=2000", 400),
                                 ("/api/table?year=2024", 400), ("/api/catalog?sql=anything", 400),
                                 ("/api/missing", 404)):
                with self.subTest(path=path), self.assertRaises(HTTPError) as raised:
                    urlopen(origin + path)
                self.assertEqual(raised.exception.code, status)
        finally:
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()


if __name__ == "__main__":
    unittest.main()
