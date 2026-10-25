"""Lossless numeric MRIO storage and a deliberately small read-only query layer."""

from __future__ import annotations

from array import array
from datetime import datetime, timezone
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sqlite3
import sys
import zlib


SCHEMA_VERSION = 1
DEFAULT_DB = Path(__file__).resolve().parents[1] / "var" / "mrio.sqlite3"
PROVINCES = {
    "Beijing": "北京", "Tianjin": "天津", "Hebei": "河北", "Shanxi": "山西",
    "InnerMongolia": "内蒙古", "Liaoning": "辽宁", "Jilin": "吉林",
    "Heilongjiang": "黑龙江", "Shanghai": "上海", "Jiangsu": "江苏",
    "Zhejiang": "浙江", "Anhui": "安徽", "Fujian": "福建", "Jiangxi": "江西",
    "Shandong": "山东", "Henan": "河南", "Hubei": "湖北", "Hunan": "湖南",
    "Guangdong": "广东", "Guangxi": "广西", "Hainan": "海南", "Chongqing": "重庆",
    "Sichuan": "四川", "Guizhou": "贵州", "Yunnan": "云南", "Tibet": "西藏",
    "Shaanxi": "陕西", "Gansu": "甘肃", "Qinghai": "青海", "Ningxia": "宁夏",
    "Xinjiang": "新疆",
}
FINAL_DEMAND = {
    "RuralCon": "农村居民消费", "UrbanCon": "城镇居民消费", "GovCon": "政府消费",
    "FixedCapital": "固定资本形成", "InvChange": "存货变动",
}
SPECIAL = {
    "E_exports": ("出口", "exports"), "Err": ("误差项", "error"),
    "X_output": ("总产出", "output"),
    "International_Imports_M": ("国际进口", "imports"),
    "VA_CompensationOfEmployees": ("劳动者报酬", "value_added"),
    "VA_NetTaxesOnProduction": ("生产税净额", "value_added"),
    "VA_DepreciationOfFixedCapital": ("固定资本折旧", "value_added"),
    "VA_OperatingSurplus": ("营业盈余", "value_added"),
    "VA_ResidualAdjustment": ("增加值残差调整", "value_added"),
    "Total_Input_X": ("总投入", "total_input"),
}
VIEWS = [
    {"id": "z", "label": "中间投入 Z", "description": "供给行业（行）→ 使用行业（列）"},
    {"id": "f", "label": "最终需求 F", "description": "供给行业（行）× 地区最终需求（列）"},
    {"id": "va", "label": "增加值 VA", "description": "增加值分项（行）× 生产行业（列）"},
    {"id": "x", "label": "总产出 X", "description": "省份行业（行）× 总产出（列）"},
    {"id": "full", "label": "完整投入产出表", "description": "原始合并表全部行列，保留空缺"},
]
WARNINGS = [
    "来源文件未附金额单位及现价/不变价说明；数值按原始文件展示，不作单位或价格换算。",
    "行业名称对照表未提供，保留 S01–S42 原始行业代码，不推测行业名称。",
    "数据目录标注为 2D-LQ 法；编制机构、方法说明和再分发许可尚待补充，不等同于官方逐年实测表。",
    "空白单元格表示源文件缺失或不适用，不替换为 0；负数原样保留。",
]
SECTOR_RE = re.compile(r"S(?:0[1-9]|[1-3][0-9]|4[0-2])\Z")


class QueryError(ValueError):
    """Invalid public query, suitable for a non-sensitive 400 response."""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def axis_item(index: int, code: str) -> dict:
    if "_" in code:
        province, suffix = code.split("_", 1)
        if province in PROVINCES and SECTOR_RE.fullmatch(suffix):
            return {"index": index, "code": code, "label": f"{PROVINCES[province]} · {suffix}",
                    "province": province, "sector": suffix, "kind": "industry"}
        if province in PROVINCES and suffix in FINAL_DEMAND:
            return {"index": index, "code": code,
                    "label": f"{PROVINCES[province]} · {FINAL_DEMAND[suffix]}",
                    "province": province, "sector": None, "kind": "final_demand"}
    label, kind = SPECIAL.get(code, (code, "other"))
    return {"index": index, "code": code, "label": label, "province": None,
            "sector": None, "kind": kind}


def encode_row(values: list[float]) -> bytes:
    packed = array("d", values)
    if sys.byteorder != "little":
        packed.byteswap()
    return zlib.compress(packed.tobytes(), level=6)


def decode_row(blob: bytes, expected: int) -> array:
    try:
        raw = zlib.decompress(blob)
    except zlib.error as error:
        raise RuntimeError("Stored matrix row compression is invalid") from error
    if len(raw) != expected * 8:
        raise RuntimeError("Stored row length is inconsistent with dataset metadata")
    values = array("d")
    values.frombytes(raw)
    if sys.byteorder != "little":
        values.byteswap()
    return values


def numeric(text: str) -> float:
    if not text.strip():
        return math.nan
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("Non-finite numeric source cell; only blank cells may be missing")
    return value


def open_readonly(path: Path | str = DEFAULT_DB) -> sqlite3.Connection:
    connection = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    connection.execute("BEGIN")
    return connection


def initialize(connection: sqlite3.Connection) -> None:
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version not in (0, SCHEMA_VERSION):
        raise RuntimeError(f"Unsupported database schema {version}")
    connection.executescript("""
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS datasets (
            year INTEGER PRIMARY KEY, metadata TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS axes (
            year INTEGER NOT NULL REFERENCES datasets(year) ON DELETE CASCADE,
            axis TEXT NOT NULL CHECK(axis IN ('row', 'column')),
            position INTEGER NOT NULL, metadata TEXT NOT NULL,
            PRIMARY KEY(year, axis, position)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS matrix_rows (
            year INTEGER NOT NULL REFERENCES datasets(year) ON DELETE CASCADE,
            position INTEGER NOT NULL, payload BLOB NOT NULL,
            PRIMARY KEY(year, position)
        ) WITHOUT ROWID;
    """)
    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    connection.commit()


def dataset(connection: sqlite3.Connection, year: int) -> dict:
    record = connection.execute("SELECT metadata FROM datasets WHERE year = ?", (year,)).fetchone()
    if record is None:
        raise QueryError("该年份尚未入库")
    return json.loads(record[0])


def axes(connection: sqlite3.Connection, year: int, axis: str) -> list[dict]:
    return [json.loads(row[0]) for row in connection.execute(
        "SELECT metadata FROM axes WHERE year = ? AND axis = ? ORDER BY position", (year, axis))]


def stored_row(connection: sqlite3.Connection, year: int, position: int, width: int) -> array:
    record = connection.execute(
        "SELECT payload FROM matrix_rows WHERE year = ? AND position = ?", (year, position)).fetchone()
    if record is None:
        raise RuntimeError("Stored matrix row is missing")
    return decode_row(record[0], width)


def _sample_indices(length: int) -> list[int]:
    return sorted({0, length - 1, length // 2, min(41, length - 1), min(42, length - 1)})


def verify_components(connection: sqlite3.Connection, folder: Path, year: int,
                      row_codes: list[str], column_codes: list[str]) -> list[dict]:
    """Compare deterministic coordinates against independently supplied component CSVs."""
    row_lookup = {code: index for index, code in enumerate(row_codes)}
    col_lookup = {code: index for index, code in enumerate(column_codes)}
    row_cache: dict[int, array] = {}
    audits = []
    for component in ("Z", "F", "VA", "X"):
        path = folder / f"{component}_{year}.csv"
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle)
            header = next(reader)
            records = list(reader)
        checked = 0
        for ri in _sample_indices(len(records)):
            record = records[ri]
            source_row = row_lookup.get(record[0])
            if source_row is None:
                raise ValueError(f"{path.name}: component row absent from consolidated table")
            if source_row not in row_cache:
                row_cache[source_row] = stored_row(connection, year, source_row, len(column_codes))
            for ci in ([0] if component == "X" else _sample_indices(len(header) - 1)):
                code = "X_output" if component == "X" else header[ci + 1]
                if code not in col_lookup:
                    raise ValueError(f"{path.name}: component column absent from consolidated table")
                original = numeric(record[ci + 1])
                saved = row_cache[source_row][col_lookup[code]]
                if not (original == saved or math.isnan(original) and math.isnan(saved)):
                    raise ValueError(f"{path.name}: independent sample mismatch at {record[0]}, {code}")
                checked += 1
        audits.append({"file": path.name, "sha256": sha256(path), "samples": checked, "matched": True})
    return audits


def import_year(connection: sqlite3.Connection, source_root: Path, year: int) -> dict:
    if not 2000 <= year <= 2023:
        raise ValueError("Years must be between 2000 and 2023")
    folder = source_root / str(year)
    source = folder / f"Consolidated_MRIO_Table_{year}.csv"
    digest = sha256(source)
    previous = connection.execute("SELECT metadata FROM datasets WHERE year = ?", (year,)).fetchone()
    if previous:
        metadata = json.loads(previous[0])
        if metadata["sha256"] == digest and all(
            sha256(folder / audit["file"]) == audit["sha256"] for audit in metadata["verification"]
        ):
            return {**metadata, "import_status": "unchanged"}
    with connection:
        connection.execute("DELETE FROM datasets WHERE year = ?", (year,))
        connection.execute("INSERT INTO datasets(year, metadata) VALUES(?, '{}')", (year,))
        row_codes = []
        missing = negative = zero = 0
        minimum, maximum = math.inf, -math.inf
        with source.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle)
            header = next(reader)
            column_codes = header[1:]
            width = len(column_codes)
            if not width or len(set(column_codes)) != width or any(not code for code in column_codes):
                raise ValueError(f"{source.name}: invalid or duplicate column labels")
            for ri, record in enumerate(reader):
                if len(record) != width + 1:
                    raise ValueError(f"{source.name}: inconsistent width at source row {ri + 2}")
                if not record[0]:
                    raise ValueError(f"{source.name}: missing row code at source row {ri + 2}")
                row_codes.append(record[0])
                values = [numeric(text) for text in record[1:]]
                present = [value for value in values if not math.isnan(value)]
                missing += width - len(present)
                negative += sum(value < 0 for value in present)
                zero += sum(value == 0 for value in present)
                if present:
                    minimum, maximum = min(minimum, min(present)), max(maximum, max(present))
                connection.execute("INSERT INTO matrix_rows VALUES(?, ?, ?)",
                                   (year, ri, encode_row(values)))
        if not row_codes or len(set(row_codes)) != len(row_codes):
            raise ValueError(f"{source.name}: invalid or duplicate row labels")
        for axis, codes in (("row", row_codes), ("column", column_codes)):
            connection.executemany("INSERT INTO axes VALUES(?, ?, ?, ?)", [
                (year, axis, i, json.dumps(axis_item(i, code), ensure_ascii=False))
                for i, code in enumerate(codes)
            ])
        verification = verify_components(connection, folder, year, row_codes, column_codes)
        row_meta = [axis_item(i, code) for i, code in enumerate(row_codes)]
        col_meta = [axis_item(i, code) for i, code in enumerate(column_codes)]
        metadata = {
            "year": year, "rows": len(row_codes), "columns": width,
            "industry_rows": sum(item["kind"] == "industry" for item in row_meta),
            "industry_columns": sum(item["kind"] == "industry" for item in col_meta),
            "final_demand_columns": sum(item["kind"] == "final_demand" for item in col_meta),
            "source": source.name, "sha256": digest, "source_bytes": source.stat().st_size,
            "unit": "原始单位（未注明）", "price_basis": "未注明", "method": "目录标注 2D-LQ，编制说明待补",
            "missing_cells": missing, "negative_cells": negative, "zero_cells": zero,
            "minimum": minimum if math.isfinite(minimum) else None,
            "maximum": maximum if math.isfinite(maximum) else None,
            "imported_at": datetime.now(timezone.utc).isoformat(),
            "storage": "float64-le / zlib; NaN encodes source blank only",
            "verification": verification,
        }
        connection.execute("UPDATE datasets SET metadata = ? WHERE year = ?",
                           (json.dumps(metadata, ensure_ascii=False, allow_nan=False), year))
    return {**metadata, "import_status": "imported"}


def write_manifest(connection: sqlite3.Connection, path: Path) -> None:
    manifests = [json.loads(row[0]) for row in connection.execute(
        "SELECT metadata FROM datasets ORDER BY year")]
    content = {"schema_version": SCHEMA_VERSION, "years": manifests, "warnings": WARNINGS,
               "generated_at": datetime.now(timezone.utc).isoformat()}
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(content, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def catalog(connection: sqlite3.Connection) -> dict:
    years = [json.loads(row[0]) for row in connection.execute("SELECT metadata FROM datasets ORDER BY year")]
    if not years:
        raise RuntimeError("No imported MRIO years are available")
    latest = axes(connection, years[-1]["year"], "row")
    province_codes = list(dict.fromkeys(item["province"] for item in latest if item["province"]))
    sector_codes = list(dict.fromkeys(item["sector"] for item in latest if item["sector"]))
    return {"years": years, "provinces": [{"code": code, "label": PROVINCES[code]} for code in province_codes],
            "sectors": [{"code": code, "label": code} for code in sector_codes],
            "views": VIEWS, "warnings": WARNINGS,
            "limits": {"row_limit": 200, "col_limit": 60},
            "complete_year_coverage": [item["year"] for item in years] == list(range(2000, 2024))}


PARAMETERS = {"year", "view", "row_province", "row_sector", "col_province", "col_sector",
              "row_offset", "col_offset", "row_limit", "col_limit"}


def _integer(params: dict[str, str], name: str, default: int, low: int, high: int) -> int:
    text = params.get(name, str(default))
    if not re.fullmatch(r"[0-9]{1,8}", text):
        raise QueryError(f"{name} 必须为非负整数")
    value = int(text)
    if not low <= value <= high:
        raise QueryError(f"{name} 应在 {low}–{high} 范围内")
    return value


def prepare_query(connection: sqlite3.Connection, params: dict[str, str]) -> dict:
    if set(params) - PARAMETERS:
        raise QueryError("存在不支持的查询参数")
    year = _integer(params, "year", 2023, 2000, 2023)
    metadata = dataset(connection, year)
    view = params.get("view", "z")
    if view not in {item["id"] for item in VIEWS}:
        raise QueryError("view 应为 z、f、va、x 或 full")
    filters = {}
    for name in ("row_province", "col_province", "row_sector", "col_sector"):
        value = params.get(name, "all")
        if value != "all" and not (value in PROVINCES if name.endswith("province") else SECTOR_RE.fullmatch(value)):
            raise QueryError(f"无效筛选：{name}")
        filters[name] = value
    rows, columns = axes(connection, year, "row"), axes(connection, year, "column")
    if view in ("z", "f", "x"):
        rows = [item for item in rows if item["kind"] == "industry"]
    elif view == "va":
        rows = [item for item in rows if item["kind"] == "value_added"]
    column_kind = {"z": "industry", "f": "final_demand", "va": "industry", "x": "output"}.get(view)
    if column_kind:
        columns = [item for item in columns if item["kind"] == column_kind]
    for name, items in (("row", rows), ("col", columns)):
        for field in ("province", "sector"):
            value = filters[f"{name}_{field}"]
            if value != "all":
                items[:] = [item for item in items if item[field] == value]
    row_offset = _integer(params, "row_offset", 0, 0, 10_000_000)
    col_offset = _integer(params, "col_offset", 0, 0, 10_000_000)
    row_limit = _integer(params, "row_limit", 20, 1, 200)
    col_limit = _integer(params, "col_limit", 10, 1, 60)
    return {"year": year, "view": view, "metadata": metadata, "rows": rows, "columns": columns,
            "row_offset": row_offset, "col_offset": col_offset, "row_limit": row_limit,
            "col_limit": col_limit, "filters": filters}


def table(connection: sqlite3.Connection, query: dict) -> dict:
    rows = query["rows"][query["row_offset"]:query["row_offset"] + query["row_limit"]]
    columns = query["columns"][query["col_offset"]:query["col_offset"] + query["col_limit"]]
    values = []
    for item in rows:
        source = stored_row(connection, query["year"], item["index"], query["metadata"]["columns"])
        values.append([None if math.isnan(source[col["index"]]) else source[col["index"]] for col in columns])
    return {"year": query["year"], "view": query["view"], "unit": query["metadata"]["unit"],
            "rows": rows, "columns": columns, "values": values,
            "total_rows": len(query["rows"]), "total_columns": len(query["columns"]),
            "row_offset": query["row_offset"], "col_offset": query["col_offset"],
            "source": {"file": query["metadata"]["source"], "sha256": query["metadata"]["sha256"]},
            "warnings": WARNINGS, "filters": query["filters"]}


def export_csv(connection: sqlite3.Connection, query: dict):
    """Yield all filtered rows, ignoring viewport offsets and limits by design."""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n")

    def line(items):
        buffer.seek(0)
        buffer.truncate(0)
        writer.writerow(items)
        return buffer.getvalue().encode("utf-8")

    yield b"\xef\xbb\xbf"
    yield line(["row_code", *(column["code"] for column in query["columns"])])
    for item in query["rows"]:
        values = stored_row(connection, query["year"], item["index"], query["metadata"]["columns"])
        yield line([item["code"], *("" if math.isnan(values[col["index"]]) else format(values[col["index"]], ".17g")
                                   for col in query["columns"])])
