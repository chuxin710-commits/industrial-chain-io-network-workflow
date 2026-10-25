"""Import 2000--2023 supplied consolidated tables; raw files stay outside the website."""

import argparse
from pathlib import Path
import sqlite3

from mrio import DEFAULT_DB, import_year, initialize, write_manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--start-year", type=int, default=2000)
    parser.add_argument("--end-year", type=int, default=2023)
    args = parser.parse_args()
    if not 2000 <= args.start_year <= args.end_year <= 2023:
        parser.error("Year range must be within 2000--2023")
    args.database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.database) as connection:
        initialize(connection)
        for year in range(args.start_year, args.end_year + 1):
            metadata = import_year(connection, args.source_root.resolve(), year)
            write_manifest(connection, args.database.with_suffix(".manifest.json"))
            print(f"{year}: {metadata['import_status']}; {metadata['rows']}x{metadata['columns']}; "
                  f"missing={metadata['missing_cells']}; sha256={metadata['sha256']}", flush=True)
        result = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {result}")
        print(f"Verified database: {args.database.resolve()}", flush=True)


if __name__ == "__main__":
    main()
