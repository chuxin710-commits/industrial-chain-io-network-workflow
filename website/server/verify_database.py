"""Independently compare every stored numeric cell and a full CSV export with source."""

import argparse
from contextlib import closing
import csv
import hashlib
import json
import math
from pathlib import Path

from mrio import DEFAULT_DB, axes, catalog, export_csv, open_readonly, prepare_query, sha256, stored_row


def equal(original, saved):
    return original == saved or math.isnan(original) and math.isnan(saved)


def verify_all(connection, source_root):
    verified = []
    for metadata in catalog(connection)["years"]:
        year = metadata["year"]
        source = source_root / str(year) / metadata["source"]
        if sha256(source) != metadata["sha256"]:
            raise ValueError(f"Source SHA256 mismatch: {year}")
        rows = axes(connection, year, "row")
        columns = axes(connection, year, "column")
        checked = 0
        with source.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle)
            header = next(reader)
            if header[1:] != [item["code"] for item in columns]:
                raise ValueError(f"Column labels differ: {year}")
            count = 0
            for index, record in enumerate(reader):
                count += 1
                if index >= len(rows) or record[0] != rows[index]["code"]:
                    raise ValueError(f"Row labels differ: {year}, {index}")
                saved = stored_row(connection, year, index, len(columns))
                if len(record) != len(saved) + 1:
                    raise ValueError(f"Source row width differs: {year}, {index}")
                original = [float(text) if text.strip() else math.nan for text in record[1:]]
                if not all(equal(left, right) for left, right in zip(original, saved)):
                    raise ValueError(f"Stored values differ: {year}, {index}")
                checked += len(saved)
            if count != len(rows):
                raise ValueError(f"Source row count differs: {year}")
        verified.append({"year": year, "cells_exactly_equal": checked, "sha256": metadata["sha256"]})
        print(f"{year}: all {checked:,} cells and both axes exactly equal to source", flush=True)
    return verified


def verify_export(connection, year):
    query = prepare_query(connection, {"year": str(year), "view": "full", "row_limit": "1",
                                      "col_limit": "1", "row_offset": "10", "col_offset": "10"})
    blocks = iter(export_csv(connection, query))
    if next(blocks) != b"\xef\xbb\xbf":
        raise ValueError("Export BOM missing")
    digest = hashlib.sha256(b"\xef\xbb\xbf")
    header = next(blocks)
    digest.update(header)
    if next(csv.reader([header.decode("utf-8")]))[1:] != [item["code"] for item in query["columns"]]:
        raise ValueError("Export column order differs")
    checked = 0
    exported_rows = 0
    for index, block in enumerate(blocks):
        digest.update(block)
        record = next(csv.reader([block.decode("utf-8")]))
        row = query["rows"][index]
        if record[0] != row["code"] or len(record) != len(query["columns"]) + 1:
            raise ValueError("Export row dimensions differ")
        source = stored_row(connection, year, row["index"], query["metadata"]["columns"])
        values = [float(text) if text else math.nan for text in record[1:]]
        if not all(equal(left, right) for left, right in zip(values, source)):
            raise ValueError("Exported numeric values differ")
        checked += len(values)
        exported_rows += 1
    if exported_rows != len(query["rows"]):
        raise ValueError("Export did not include every filtered row")
    print(f"Export {year}: {checked:,} cells exactly round-trip, independent of viewport", flush=True)
    return {"year": year, "rows": exported_rows, "columns": len(query["columns"]),
            "cells_exactly_equal": checked, "csv_sha256": digest.hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--export-year", type=int, default=2023)
    args = parser.parse_args()
    with closing(open_readonly(args.db)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Database integrity check failed")
        report = {"integrity_check": "ok", "full_source_comparison": verify_all(connection, args.source_root),
                  "full_csv_roundtrip": verify_export(connection, args.export_year)}
    report["total_cells_verified"] = sum(item["cells_exactly_equal"] for item in report["full_source_comparison"])
    path = args.db.with_suffix(".verification.json")
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Full verification report: {path.resolve()}", flush=True)


if __name__ == "__main__":
    main()
