# 数据说明 / Data Guide

本目录用于存放投入产出原始数据。受体积与数据许可限制，原始 IO 表**未随仓库分发**；下方说明数据来源、格式与放置方式，便于复现。

This directory holds the raw input–output data. Due to size and licensing, the raw IO tables are **not distributed with the repository**. Below are the sources, formats, and placement instructions for reproduction.

---

## 路径 A 数据 / Track A Data — OECD ICIO (1995–2022)

- **来源 / Source**：OECD Inter-Country Input-Output (ICIO) Tables，非竞争型，中国部分。
  下载 / Download: <https://www.oecd.org/sti/ind/inter-country-input-output-tables.htm>
- **粒度 / Granularity**：50 个国内部门（ISIC Rev.4），表内以 `DOM_*` 前缀标识国内中间投入行。
- **文件命名 / Filenames**：`CHN{year}dom.csv`，年份 1995–2022。
- **放置 / Placement**：

```
data/
└── 非竞争型/            # 或自定义；与 resilience_measurement.py 中 folder 变量一致
    ├── CHN1995dom.csv
    ├── ...
    └── CHN2022dom.csv
```

- **格式 / Format**：行/列均为部门代码；含 `OUTPUT` 行（总产出）、`DOM_*` 行（国内中间投入）。
  `read_io_table()` 自动提取国内中间矩阵 $Z$ 与总产出 $x$。

## 路径 B 数据 / Track B Data — 2023 China 211-sector IO Table

- **来源 / Source**：国家统计局《2023 年中国投入产出表》（211 部门，非竞争型）。
- **所需文件 / Required files**：
  - `Z_matrix.csv`：211×211 国内中间投入流量矩阵（UTF-8，首行/首列为部门名）。
  - `IO_2023.csv`：完整投入产出表（GBK 编码），需含「总产出」列。
- **放置 / Placement**：与 `vulnerability_nodes.py` 同目录，或调整脚本内 `file_path`。

---

## 字段口径 / Field Conventions

| 对象 / Object | 含义 / Meaning | 来源 / Derivation |
|---|---|---|
| $Z$ | 国内中间投入流量矩阵 / domestic intermediate flows | IO 表 `DOM_*` 区块 |
| $x$ | 总产出向量 / total output | IO 表 `OUTPUT` 行 / 「总产出」列 |
| $A=Z/x_j$ | 直接消耗系数（列归一，需求侧）| 计算 / computed |
| $B=Z/x_i$ | 分配系数（行归一，供给侧）| 计算 / computed |

> **重要 / Important**：务必使用**非竞争型**表（已剔除进口中间品）。竞争型表会把进口与国内投入混在一起，高估国内产业关联强度。
>
> Always use the **non-competitive** (import-separated) table. Competitive tables conflate imports with domestic inputs and over-estimate domestic linkages.
