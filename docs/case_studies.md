# 实证案例 / Empirical Case Studies

本 Workflow 由两项互补的实证研究提炼而成。以下为两者的关键设定与核心发现，作为复现与对照基准。

This workflow is distilled from two complementary empirical studies. Their settings and key findings serve as reproduction benchmarks.

---

## 案例 A：中国产业链韧性的动态测度（1995–2022）

**Case A: Dynamic Measurement of China's Industrial-Chain Resilience (1995–2022)**

| 项目 / Item | 设定 / Setting |
|---|---|
| 数据 / Data | OECD 非竞争型 ICIO 表，1995–2022，50 部门（国内 `DOM_*` 行）|
| 网络 / Network | 有向加权，边权 = 直接消耗系数 $A=Z/x$；间接关联用 $L=(I-A)^{-1}$ |
| 方法 / Method | 四维十指标 → 熵权法综合韧性指数 |
| 稳健性 / Robustness | 指标替代 / 缩尾 / 赋权对照（熵权·CRITIC·等权）/ 阈值敏感 |
| 代码 / Code | [`code/resilience_measurement.py`](../code/resilience_measurement.py) |

**核心发现 / Key findings**

- 综合韧性指数从 1995 年的 **0.29** 升至 2022 年的 **0.39**，呈**波动上升**；亚洲金融危机、2008 国际金融危机、中美贸易摩擦、新冠疫情均在曲线上留下显著回落印记，近年韧性中枢呈下行。
- 分维度：结构韧性在技术关联密度上基本稳定，但局部冗余趋弱；依赖韧性与恢复韧性阶段性波动，"单点依赖"风险突出；**适应韧性长期低位徘徊**，是制约整体韧性的核心短板。
- 稳健性：十项指标全部通过替代检验；缩尾前后相关系数 > 0.99；三种赋权方案 Spearman ρ̄ > 0.97 → 测度框架稳健。

---

## 案例 B：中国产业链结构脆弱性节点识别与冲击效应（2023）

**Case B: Structural Vulnerability Node Identification & Shock Effects (2023)**

| 项目 / Item | 设定 / Setting |
|---|---|
| 数据 / Data | 国家统计局 2023 年中国 211 部门非竞争型 IO 表 |
| 网络 / Network | 有向加权，边权 = 分配系数 $B=Z/x_i$（供给侧）；Disparity Filter (α=0.05) 骨架提取 |
| 方法 / Method | Node2vec(p=1,q=0.5,seed=211) + K-means(10) → 结构关键性；7 中心性 → 规模关键性；混合关键性指数 |
| 冲击 / Shock | Ghosh 逆 $(I-B)^{-1}$，单/多节点 × 10/30/50% 供给收缩 |
| 稳健性 / Robustness | 5 种权重设定 / α∈{0.3,0.5,0.7} / 与传统方法对比 |
| 代码 / Code | [`code/vulnerability_nodes.py`](../code/vulnerability_nodes.py) |

**核心发现 / Key findings**

- 网络高密度（密度 0.698，平均度 147），58 个部门出度达最大值 211，构成核心供给骨架；高密度下传统中心性区分度下降 → 需 Node2vec 高阶结构识别。
- **混合关键性指数前 5 = 农机 + 汽车产业链**（农林牧渔专用机械、汽柴油车整车、汽车用发动机、农林牧渔服务产品、新能源车整车，结构关键性得分均 0.9356）；轻工制造（服装/鞋/皮革）为第二梯队，呈"多点并发"集群式脆弱性。
- 与传统规模关键性识别结果**几乎无重合**：α=0.7（规模优先）退化为批发/零售/电力等基础部门，**论证了结构关键性的增量价值**。
- Ghosh 冲击：单节点 30% 供给收缩 → 国民经济总产出平均降 4.79%（约 6.6 万亿元）；前 5 节点联合 30% → 接近 20%；第二产业损失占比 > 80%。
- 传导呈"**漏斗式汇聚**"：无论冲击源为何，**批发、道路货物运输**始终是风险传导核心枢纽；能源（煤炭、石油天然气）是传导源头，电力/化工/黑色金属冶炼为中游核心中介。

---

## 两案例的统一性 / Unification

| 维度 | 案例 A（韧性）| 案例 B（脆弱性）|
|---|---|---|
| 时间视角 | 动态多期 | 静态单期 |
| 分析对象 | 整网聚合指标 | 单节点识别 |
| 边权/逆矩阵 | 直接消耗系数 / Leontief | 分配系数 / Ghosh |
| 冲击机制 | 需求拉动（隐含）| 供给推动（显式模拟）|
| 共同底座 | **非竞争型 IO 表 → 有向加权产业网络** | 同左 |

二者共享同一数据底座与网络范式，分别回答"产业链整体韧性如何演变"与"哪些节点最脆弱、断供后果多大"，构成从**宏观测度**到**节点诊断**再到**冲击量化**的完整链条。

The two cases share the same data foundation and network paradigm, answering "how does aggregate resilience evolve?" and "which nodes are most fragile, and how severe is a disruption?"—forming a complete chain from macro measurement to node diagnosis to shock quantification.
