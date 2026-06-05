# 通用投入产出复杂网络产业链韧性与脆弱性实证 Workflow

# A General Empirical Workflow for Industrial-Chain Resilience and Vulnerability Analysis via Input–Output Networks

> **作者 / Author**：储信 Chu Xin
>
> **指导教师 / Advisor**：韩爱华 Han Aihua
>
> **机构 / Affiliation**：中南财经政法大学统计与数学学院 / School of Statistics and Mathematics, Zhongnan University of Economics and Law

> **中文** | 适用场景：将投入产出（IO）表转化为有向加权产业网络，测度产业链**韧性**的动态演变（多期面板）、识别产业链**结构脆弱性关键节点**（单期截面）、并量化供给/需求冲击的**波及效应**。
>
> **English** | Applicable to: converting input–output (IO) tables into directed weighted industrial networks to (i) measure the dynamic evolution of industrial-chain **resilience** (multi-period panels), (ii) identify **structurally critical / vulnerable nodes** (single-period cross-sections), and (iii) quantify the **ripple effects** of supply- or demand-side shocks.

> **参考文献 / References**：Leontief (1936), Ghosh (1958), Acemoglu et al. (2012), Carvalho & Tahbaz-Salehi (2019), Serrano et al. (2009), Grover & Leskovec (2016), Fagiolo (2007), Newman (2006), Martin (2012), Miller & Blair (2022).

> 🤖 **配套对话 Agent / Companion agent**：本仓库附带「**链析 ChainLens**」——一个只回答产业链领域问题、并能在你提供投入产出表时直接生成适配建网与分析代码的专家 agent。用法见 [`agent/`](agent/README.md)（可部署为 Claude.ai 项目 / Claude Code 子代理 / API）。
>
> A companion expert agent that answers only industrial-chain questions and emits tailored network-building & analysis code from your IO table — see [`agent/`](agent/README.md).

-----

## 目录 / Table of Contents

1. [数据与投入产出网络构建 / Data and IO Network Construction](#1-数据与投入产出网络构建--data-and-io-network-construction)
1. [边权与矩阵选择：需求侧 vs 供给侧 / Edge Weights and Matrix Choice](#2-边权与矩阵选择需求侧-vs-供给侧--edge-weights-and-matrix-choice)
1. [网络骨架提取与拓扑刻画 / Backbone Extraction and Topology](#3-网络骨架提取与拓扑刻画--backbone-extraction-and-topology)
1. [路径 A：四维韧性指标体系 / Track A: Four-Dimension Resilience Indicators](#4-路径-a四维韧性指标体系--track-a-four-dimension-resilience-indicators)
1. [综合韧性指数合成 / Composite Resilience Index Synthesis](#5-综合韧性指数合成--composite-resilience-index-synthesis)
1. [路径 B：结构关键节点识别 / Track B: Structural Critical Node Identification](#6-路径-b结构关键节点识别--track-b-structural-critical-node-identification)
1. [供给冲击模拟（Ghosh）/ Supply-Shock Simulation (Ghosh)](#7-供给冲击模拟ghosh--supply-shock-simulation-ghosh)
1. [稳健性检验 / Robustness Checks](#8-稳健性检验--robustness-checks)
1. [结果呈现与解读 / Presentation and Interpretation](#9-结果呈现与解读--presentation-and-interpretation)
1. [政策含义 / Policy Implications](#10-政策含义--policy-implications)
1. [完整 Workflow 一览 / Complete Workflow Overview](#完整-workflow-一览--complete-workflow-overview)
1. [软件包清单 / Software Packages](#软件包清单--software-packages)
1. [参考文献 / References](#参考文献--references)

-----

## 1. 数据与投入产出网络构建 / Data and IO Network Construction

### 1.1 数据源选择 / Data Source Selection

**中文**：投入产出表是产业链网络分析的唯一数据底座。选表的两个关键维度——**竞争型 vs 非竞争型**、**部门粒度**——直接决定网络边权能否真实反映"国内产业链"的关联。

**English**: The IO table is the sole data foundation. Two choices—**competitive vs non-competitive** and **sector granularity**—determine whether edge weights faithfully capture *domestic* industrial linkages.

|维度 / Dimension|推荐 / Recommended|理由 / Rationale|
|---|---|---|
|表类型 / Table type|**非竞争型** / Non-competitive (import-separated)|剔除进口中间品，避免高估国内产业关联 / Strips imported intermediates, preventing over-estimation of domestic linkages|
|部门粒度 / Granularity|尽量细 / As fine as feasible（50 / 211 部门）|粗粒度（42 部门）掩盖细分链关联 / Coarse sectors mask fine-grained chains|
|时间结构 / Time structure|多期（韧性演化）或单期（脆弱性诊断）/ Multi-period (resilience) or single-period (vulnerability)|对应路径 A / B / Maps to Track A / B|

> **本 Workflow 的两个实证基准 / Two empirical benchmarks in this workflow**
> - **路径 A（动态韧性）/ Track A (dynamic resilience)**：OECD 非竞争型 ICIO 表，1995–2022，**50 部门**（`DOM_*` 国内行）。
> - **路径 B（静态脆弱性）/ Track B (static vulnerability)**：国家统计局 2023 年中国 **211 部门**非竞争型 IO 表。

### 1.2 从 IO 表抽取核心矩阵 / Extracting Core Matrices

**中文**：无论何种表，三个对象贯穿全流程：国内中间投入流量矩阵 $Z$（$z_{ij}$ = 部门 $i$ 投入到部门 $j$）、总产出向量 $x$、最终使用向量 $f$。

**English**: Three objects recur: the domestic intermediate-flow matrix $Z$ ($z_{ij}$ = flow from sector $i$ to $j$), the total-output vector $x$, and the final-use vector $f$.

```python
import numpy as np
import pandas as pd

def read_io_table(path):
    """读取非竞争型 IO 表，返回国内中间投入矩阵 Z、总产出 x、部门代码。
    Read a non-competitive IO table; return domestic Z, total output x, sector codes."""
    df = pd.read_csv(path, index_col=0)
    dom_rows = df.index[df.index.str.startswith('DOM_', na=False)]   # 国内中间投入行 / domestic rows
    codes = [r.replace('DOM_', '') for r in dom_rows]
    Z = df.loc[dom_rows, codes].values.astype(float)                 # n×n 中间流量矩阵
    x = df.loc['OUTPUT', codes].values.astype(float)                 # 总产出向量
    return Z, x, codes
```

### 1.3 行平衡关系：需求侧与供给侧的对偶 / Row Balance: the Demand–Supply Duality

$$\underbrace{x_i = \sum_j z_{ij} + f_i}_{\text{行平衡 / row balance}} \qquad \underbrace{x_j = \sum_i z_{ij} + v_j}_{\text{列平衡 / column balance}}$$

**中文**：同一张 $Z$ 矩阵按**行**归一得到供给侧分配系数，按**列**归一得到需求侧直接消耗系数——这正是 §2 两条建模路线的数学起点。

**English**: Normalizing the same $Z$ by **rows** yields supply-side allocation coefficients; by **columns** yields demand-side technical (direct-consumption) coefficients—the mathematical fork underlying the two modeling routes in §2.

-----

## 2. 边权与矩阵选择：需求侧 vs 供给侧 / Edge Weights and Matrix Choice

> **核心原则 / Core principle**：**边权定义必须与研究的冲击机制匹配**。需求拉动 → 直接消耗系数 + 列昂惕夫逆；供给推动 → 分配系数 + Ghosh 逆。两者无优劣之分（Miller & Blair, 2022; de Mesnard, 2009）。
>
> **The edge weight must match the shock mechanism under study.** Demand-pull → technical coefficients + Leontief inverse; supply-push → allocation coefficients + Ghosh inverse. Neither model is superior to the other.

### 2.1 两套系数与两个逆矩阵 / Two Coefficient Systems, Two Inverses

|  |需求侧 / Demand-side (Leontief)|供给侧 / Supply-side (Ghosh)|
|---|---|---|
|系数 / Coefficient|直接消耗系数 $a_{ij}=z_{ij}/x_j$（列归一）|分配系数 $b_{ij}=z_{ij}/x_i$（行归一）|
|经济含义 / Meaning|$j$ 每产一单位需直接消耗 $i$ 的量 / input $i$ per unit of $j$|$i$ 的产出分配给 $j$ 的比例 / share of $i$ allocated to $j$|
|逆矩阵 / Inverse|$L=(I-A)^{-1}$ 完全需求 / total requirements|$G=(I-B)^{-1}$ 完全前向关联 / total forward linkage|
|冲击解读 / Shock reading|最终需求 ↓ → 上游减产 / final demand → upstream|上游断供 → 下游减产 / upstream supply → downstream|
|关联方向 / Linkage|后向关联（列和）/ backward (column sum)|前向关联（行和）/ forward (row sum)|

```python
def coefficient_matrices(Z, x):
    """返回直接消耗系数 A（列归一）与分配系数 B（行归一）。
    Return technical coefficients A (column-normalized) and allocation coefficients B (row-normalized)."""
    A = np.nan_to_num(Z / x)                 # a_ij = z_ij / x_j  (demand-side / Leontief)
    B = np.nan_to_num(Z / x[:, None])        # b_ij = z_ij / x_i  (supply-side / Ghosh)
    return A, B

def leontief_inverse(A):
    return np.linalg.inv(np.eye(A.shape[0]) - A)          # L = (I - A)^-1

def ghosh_inverse(B):
    I = np.eye(B.shape[0])
    try:
        return np.linalg.inv(I - B)                       # G = (I - B)^-1
    except np.linalg.LinAlgError:
        return np.linalg.pinv(I - B)                      # 奇异时用伪逆 / pseudo-inverse if singular
```

> **中文统一口径建议**：在网络拓扑指标中**统一使用系数矩阵（A 或 B）而非原始流量 $Z$ 作为边权**。系数矩阵消除了金额口径的规模效应，使量级从"万元级"收敛为"系数级"，跨年份、跨部门可比性更强。
>
> **Unified-scale tip**: For topological metrics, use the **coefficient matrix (A or B), not the raw flow $Z$**, as edge weight. Coefficients remove the magnitude/scale effect of monetary units, making metrics comparable across years and sectors.

### 2.2 网络对象定义 / Network Object Definition

$$\mathcal{G} = (\mathcal{V}, \mathcal{E}, W), \quad |\mathcal{V}| = n \text{ 部门 / sectors},\ \ w_{ij} = a_{ij}\ \text{或/or}\ b_{ij}$$

```python
import networkx as nx

def build_network(W, codes, directed=True):
    """由系数矩阵 W 构建有向加权产业网络。Build directed weighted industrial network from coefficient matrix W."""
    G = nx.DiGraph() if directed else nx.Graph()
    G.add_nodes_from(codes)
    n = W.shape[0]
    for i in range(n):
        for j in range(n):
            if W[i, j] > 0:
                G.add_edge(codes[i], codes[j], weight=W[i, j])
    return G
```

-----

## 3. 网络骨架提取与拓扑刻画 / Backbone Extraction and Topology

### 3.1 为什么要做骨架提取 / Why Extract a Backbone

**中文**：非竞争型细分表构成的产业网络是**高密度网络**（如 211 部门网络密度 0.698，平均度 147）。高密度下传统中心性指标的区分度天然下降——多数节点的局部连接趋于同质。Disparity Filter（Serrano et al., 2009）在保留统计显著边的前提下过滤弱连接，是高阶结构识别（§6）前的标准预处理。

**English**: Fine-grained non-competitive tables yield **high-density** networks (e.g., the 211-sector network has density 0.698, average degree 147). At such density, classic centrality metrics lose discriminative power. The Disparity Filter (Serrano et al., 2009) retains statistically significant edges while pruning weak ones—a standard preprocessing step before higher-order structure identification (§6).

```python
def disparity_filter(W, alpha=0.05):
    """Disparity Filter：保留显著边。对每个节点，权重份额 p_ij 满足 (1-p_ij)^(k-1) < alpha 的边被保留。
    Keep edges whose normalized weight is significant against a null uniform model."""
    n = W.shape[0]
    out = np.zeros_like(W)
    for i in range(n):
        w = W[i, :]
        k = int(np.sum(w > 0))            # 出度 / out-degree
        s = w.sum()
        if k <= 1 or s == 0:
            out[i, :] = w
            continue
        p = w / s
        for j in range(n):
            if w[j] > 0 and (1 - p[j]) ** (k - 1) < alpha:
                out[i, j] = w[j]
    return out
```

### 3.2 整体拓扑特征清单 / Whole-Network Topology Checklist

|指标 / Metric|含义 / Meaning|韧性/脆弱性解读 / Reading|
|---|---|---|
|网络密度 ρ / Density|实际边数 ÷ 最大可能边数 / realized ÷ possible edges|越高越紧密、级联风险越高 / denser = tighter, higher cascade risk|
|平均度 / Average degree|节点平均连接数 / mean connections|关联广度 / breadth of linkage|
|入/出强度 / In/out strength|加权后向/前向关联 / weighted backward/forward|入强度=对上游依赖；出强度=对下游影响 / dependence vs influence|
|度分布 / Degree distribution|是否长尾/无标度 / long-tail / scale-free?|长尾 → 少数枢纽部门主导供给骨架 / few hubs dominate the backbone|
|核心–边缘结构 / Core–periphery|核心节点间流量占比 / core-to-core flow share|核心集中度过高 → "鲁棒却脆弱" / over-concentration → "robust-yet-fragile"|

```python
def network_summary(G):
    ins  = dict(G.in_degree(weight='weight'))
    outs = dict(G.out_degree(weight='weight'))
    return {
        'n_nodes':   G.number_of_nodes(),
        'n_edges':   G.number_of_edges(),
        'density':   nx.density(G),
        'avg_in_strength':  np.mean(list(ins.values())),
        'avg_out_strength': np.mean(list(outs.values())),
    }
```

-----

## 4. 路径 A：四维韧性指标体系 / Track A: Four-Dimension Resilience Indicators

> **理论原型 / Theoretical template**：Martin (2012) 区域韧性四维框架，经投入产出网络重构为可观测的四维度链条：**抗冲击 → 限扩散 → 可恢复 → 能适应**。
>
> Martin's (2012) four-capacity regional-resilience framework, recast onto IO networks as a measurable chain: **resist → contain → recover → adapt**.

### 4.1 四维度十指标总览 / The 4×10 Indicator Map

|维度 / Dimension|指标 / Indicator|核心经济含义 / Economic meaning|方向 / Dir.|
|---|---|---|:-:|
|**结构韧性** Structural|加权平均度 Weighted avg degree|技术关联密度与冗余 / linkage density & redundancy|+|
| |加权聚类系数 Weighted clustering|上下游"三角备份关系" / triangular backup links|+|
| |核心–边缘指数 Core–periphery index|核心集中度（越低越均衡）/ core concentration|−|
|**依赖韧性** Dependence|投入多样性指数 Input diversity|上游来源分散度（逆 HHI）/ supplier diversification|+|
| |关键部门依赖度 Key-sector dependence|最大单一供应商占比（单点依赖）/ single-point reliance|−|
| |加权鲁棒性 Weighted robustness|冲击后剩余流量占比 / surviving flow share|+|
|**恢复韧性** Recovery|波及效应系数 Spread effect|冲击在全链的传导深度 / propagation depth|−|
| |恢复中心性 Recovery centrality|恢复信号传播效率（随机游走）/ recovery diffusion speed|+|
|**适应韧性** Adaptation|网络结构熵 Network entropy|边权分布均匀度 / weight-distribution evenness|+|
| |网络群落韧性 Modular resilience|模块化与演化潜力 / modularity & evolvability|+|

### 4.2 代表性指标的实现 / Reference Implementations

```python
# ── 结构韧性 / Structural ──────────────────────────────────────────────
def weighted_avg_degree(W):
    """加权平均入度(列和均值,后向关联) 与 平均出度(行和均值,前向关联)。"""
    return np.mean(W.sum(axis=0)), np.mean(W.sum(axis=1))

def core_periphery_index(W, core_ratio=0.2):
    """核心节点(总强度前 core_ratio)之间的流量占全网流量之比；越低越均衡。"""
    strength = W.sum(0) + W.sum(1)
    k = max(1, int(np.ceil(len(strength) * core_ratio)))
    core = np.argsort(strength)[-k:]
    return W[np.ix_(core, core)].sum() / W.sum() if W.sum() else 0.0

# ── 依赖韧性 / Dependence ──────────────────────────────────────────────
def input_diversity(W):
    """投入多样性 = 逆赫芬达尔指数的部门均值（有效供应商数）。Inverse-HHI mean (effective #suppliers)."""
    cs, cs2 = W.sum(0), (W ** 2).sum(0)
    with np.errstate(divide='ignore', invalid='ignore'):
        D = np.where(cs > 0, cs ** 2 / cs2, 0)
    return np.mean(D)

def key_sector_dependence(W):
    """关键部门依赖度 = 各部门最大供应商占比的均值（单点依赖风险）。Max-supplier share, averaged."""
    cs, mx = W.sum(0), W.max(0)
    with np.errstate(divide='ignore', invalid='ignore'):
        K = np.where(cs > 0, mx / cs, 0)
    return np.mean(K)

# ── 恢复韧性 / Recovery ────────────────────────────────────────────────
def spread_effect(L):
    """波及效应系数 = 列昂惕夫逆矩阵列和均值（完全后向关联深度）。Leontief column-sum mean."""
    return np.mean(L.sum(axis=0))

# ── 适应韧性 / Adaptation ──────────────────────────────────────────────
def network_entropy(W):
    """网络结构熵 = 归一化边权分布的香农熵。Shannon entropy of the normalized edge-weight distribution."""
    p = W.flatten()
    p = p[p > 0] / W.sum()
    return -np.sum(p * np.log(p))

def modular_resilience(W):
    """群落韧性 = 归一化模块度 Q/ln(m)，基于对称化无向网络的 Louvain 群落。"""
    n = W.shape[0]; G = nx.Graph()
    G.add_nodes_from(range(n))
    for i in range(n):
        for j in range(i + 1, n):
            w = W[i, j] + W[j, i]
            if w > 0: G.add_edge(i, j, weight=w)
    if G.number_of_edges() == 0: return 0.0
    comm = nx.community.louvain_communities(G, weight='weight', seed=42)
    Q = nx.community.modularity(G, comm, weight='weight')
    m = len(comm)
    return Q / np.log(m) if m > 1 else Q
```

> 完整的十项指标（含 Fagiolo 2007 有向加权聚类系数、基于随机游走平均首达时间的恢复中心性、定向/随机攻击鲁棒性）见 [`code/resilience_measurement.py`](code/resilience_measurement.py) 与 [`docs/indicator_dictionary.md`](docs/indicator_dictionary.md)。
>
> Full implementations of all ten indicators are in [`code/resilience_measurement.py`](code/resilience_measurement.py) and [`docs/indicator_dictionary.md`](docs/indicator_dictionary.md).

-----

## 5. 综合韧性指数合成 / Composite Resilience Index Synthesis

### 5.1 熵权法（基准）/ Entropy Weight Method (baseline)

**中文**：客观赋权，依据各指标的**变异程度**分配权重——变异越大、信息量越多、权重越高。流程：极差标准化（按指标方向）→ 计算信息熵 → 差异系数 → 归一权重 → 线性加权合成。

**English**: Objective weighting by **variability**—indicators that vary more carry more information and receive higher weight. Pipeline: range-normalize (by direction) → information entropy → divergence coefficient → normalized weights → linear synthesis.

```python
def entropy_weight(df, indicators):
    """indicators: {col: 'pos'|'neg'}。返回 (权重, 综合得分)。Returns (weights, composite score)."""
    X = df[list(indicators)].copy()
    N = pd.DataFrame(index=X.index)
    for c, d in indicators.items():
        lo, hi = X[c].min(), X[c].max()
        if hi == lo:               N[c] = 0.5
        elif d == 'pos':           N[c] = (X[c] - lo) / (hi - lo)
        else:                      N[c] = (hi - X[c]) / (hi - lo)
    p = (N / N.sum(0)).replace(0, 1e-12)
    e = -1 / np.log(len(N)) * (p * np.log(p)).sum(0)     # 信息熵 / entropy
    w = (1 - e) / (1 - e).sum()                          # 熵权 / weights
    return w, (N * w).sum(1)
```

### 5.2 三种赋权方案对照 / Three Weighting Schemes

|方法 / Method|权重依据 / Basis|角色 / Role|
|---|---|---|
|熵权法 / Entropy|指标变异程度 / variability|基准 / baseline|
|CRITIC|变异 × 指标间冲突性 / variability × conflict|稳健性对照 / robustness check|
|等权法 / Equal|$1/n$|下界参照 / lower-bound reference|

> **判断标准 / Criterion**：三种方案综合指数的两两 **Spearman ρ 均值 > 0.9** → 赋权方案不影响核心结论（框架稳健）。本基准案例 ρ̄ > 0.97。
>
> Mean pairwise **Spearman ρ > 0.9** across the three schemes implies the conclusion is weighting-invariant. In the benchmark case ρ̄ > 0.97.

-----

## 6. 路径 B：结构关键节点识别 / Track B: Structural Critical Node Identification

> **核心范式升级 / Paradigm shift**：从"**规模关键性**"（体量大、连接广）升级到"**结构关键性**"（位置独特、不可替代）。许多"规模不大但位置关键"的脆弱节点只有后者能识别。
>
> Upgrade from "**scale criticality**" (large, well-connected) to "**structural criticality**" (uniquely positioned, irreplaceable). Many "small-but-critical" vulnerable nodes surface only under the latter.

### 6.1 规模关键性：七项传统中心性 / Scale Criticality: Seven Centralities

```python
from sklearn.preprocessing import MinMaxScaler

def scale_criticality(G):
    """7 项中心性归一化后取均值 → 规模关键性。Mean of 7 min-max-scaled centralities → scale criticality."""
    feats = pd.DataFrame({
        '入度': dict(G.in_degree()),  '出度': dict(G.out_degree()),
        '入强度': dict(G.in_degree(weight='weight')),
        '出强度': dict(G.out_degree(weight='weight')),
        '介数': nx.betweenness_centrality(G, weight='weight', normalized=True, seed=211),
        '接近': nx.closeness_centrality(G, distance='weight'),
        '特征向量': nx.eigenvector_centrality_numpy(G, weight='weight'),
    })
    feats[:] = MinMaxScaler().fit_transform(feats)
    return feats.mean(axis=1)              # 规模关键性 / scale criticality
```

### 6.2 结构关键性：Node2vec + 聚类 / Structural Criticality: Node2vec + Clustering

**中文**：Node2vec（Grover & Leskovec, 2016）通过**有偏随机游走 + Skip-gram** 将高维稀疏邻接矩阵压缩为低维稠密向量，捕捉节点的**结构等价性**（而非一阶邻居数量）。返回参数 $p$、出入参数 $q$ 控制游走策略：$q<1$ 偏深度优先，更易挖掘结构等价的远端节点。

**English**: Node2vec embeds nodes into dense low-dimensional vectors via **biased random walks + Skip-gram**, capturing **structural equivalence** rather than first-order degree. With $q<1$ the walk is depth-first-leaning, surfacing structurally equivalent distant nodes.

|参数 / Param|取值 / Value|说明 / Note|
|---|:-:|---|
|dimensions|32|向量维度 / embedding size|
|walk_length|20|每条游走步数 / steps per walk|
|num_walks|40|每节点游走数 / walks per node|
|p / q|1 / 0.5|q<1 → 深度优先，挖结构等价性 / DFS-leaning|
|seed|211|**全流程固定随机种子保证可复现** / fixed seed for reproducibility|

```python
from node2vec import Node2Vec
from sklearn.cluster import KMeans

def structural_criticality(G_backbone, k_clusters=10, seed=211):
    """Node2vec 嵌入 → K-means → 距离加权结构关键性得分。
    score_i = ||c_k|| / (1 + dist(node_i, c_k)) ，再 Min-Max 归一。"""
    n2v   = Node2Vec(G_backbone, dimensions=32, walk_length=20, num_walks=40,
                     p=1, q=0.5, workers=1, seed=seed, weight_key='weight')
    model = n2v.fit(window=5, min_count=1, epochs=20, sg=1, seed=seed, workers=1)
    nodes = list(G_backbone.nodes())
    emb   = np.array([model.wv[v] for v in nodes])
    from sklearn.preprocessing import StandardScaler
    Xs    = StandardScaler().fit_transform(emb)
    km    = KMeans(n_clusters=k_clusters, random_state=seed, n_init=10).fit(Xs)
    norms = np.linalg.norm(km.cluster_centers_, axis=1)       # 簇心模长 = 结构显著性
    dist  = np.linalg.norm(Xs - km.cluster_centers_[km.labels_], axis=1)
    raw   = norms[km.labels_] / (1 + dist)                    # 距离加权 / distance-weighted
    return pd.Series(MinMaxScaler().fit_transform(raw.reshape(-1, 1)).ravel(), index=nodes)
```

> **结构关键性得分的经济学含义 / Economic meaning**：簇心模长衡量结构角色的**不可替代性**（角色越独特，模长越大）；距离调整项衡量节点的**角色典型性**。二者结合，既保留类别间差异，又实现类别内区分。
>
> The cluster-centroid norm measures **irreplaceability** of a structural role; the distance term measures **role typicality**. Together they preserve between-cluster differences while discriminating within clusters.

### 6.3 混合关键性指数 / Hybrid Criticality Index

$$\text{HybridCrit}_i = \alpha \cdot \text{ScaleCrit}_i + (1-\alpha)\cdot \text{StructCrit}_i$$

```python
def hybrid_criticality(scale, struct, alpha=0.5):
    df = pd.DataFrame({'规模关键性': scale, '结构关键性': struct}).fillna(0)
    df['混合关键性'] = alpha * df['规模关键性'] + (1 - alpha) * df['结构关键性']
    return df.sort_values('混合关键性', ascending=False)
```

> **α 敏感性 / α-sensitivity**：报告 α∈{0.3, 0.5, 0.7} 的排名。$\alpha$ 偏小（结构优先）应稳定识别中游"小而关键"节点；$\alpha$ 偏大（规模优先）会退化为传统中心性，识别批发/电力等基础部门——二者的分化恰恰**论证了结构关键性的增量价值**。
>
> Report rankings for α∈{0.3, 0.5, 0.7}. Small α (structure-first) should stably surface "small-but-critical" midstream nodes; large α (scale-first) degenerates to classic centrality—the divergence itself **demonstrates the incremental value** of structural criticality.

### 6.4 节点功能分类 / Node Functional Typology

|类型 / Type|拓扑特征 / Topology|脆弱性逻辑 / Vulnerability logic|
|---|---|---|
|瓶颈型 / Bottleneck|入强度极高、出强度低、介数高 / high in-strength|上游依赖深、下游难替代 / deep upstream dependence|
|桥梁型 / Bridge|出入度均衡、介数极高 / balanced, very high betweenness|多链交汇，失效切断多路径 / cuts multiple chains|
|枢纽型 / Hub|出入度均衡、各指标均匀 / uniformly high|连接广，失效引发大范围扩散 / broad cascade|

-----

## 7. 供给冲击模拟（Ghosh）/ Supply-Shock Simulation (Ghosh)

### 7.1 模型逻辑 / Model Logic

**中文**：以 §6 识别的结构关键节点为**冲击源**，模拟其国内产能下降比例 $s$（分别取 10%、30%、50%），通过 Ghosh 逆矩阵 $G=(I-B)^{-1}$ 前向传导，量化国民经济总产出与各部门的损失。这实现了"**结构脆弱性识别 → 供给冲击效应**"的研究闭环——因为结构关键性正是在供给侧分配网络 $B$ 中定义的。

**English**: Using the structurally critical nodes from §6 as **shock sources**, simulate a domestic capacity drop of ratio $s$ (10%, 30%, or 50%) and propagate it forward through the Ghosh inverse $G=(I-B)^{-1}$, quantifying losses in aggregate and sectoral output. This closes the loop from **identification → impact**, since structural criticality is itself defined on the supply-side allocation network $B$.

$$\Delta x = G^{\top} \Delta f, \qquad \Delta f_i = -s \cdot x_i \quad (\text{shocked sector } i)$$

```python
def simulate_supply_shock(G_inv, x, shocked, shock_ratio):
    """单/多节点供给冲击：返回各部门产出变化 Δx 与总损失。
    Single/joint supply shock; returns sectoral Δx and total loss (亿元)."""
    delta_f = pd.Series(0.0, index=G_inv.index)
    for s in ([shocked] if isinstance(shocked, str) else shocked):
        delta_f.loc[s] = -shock_ratio * x.loc[s]
    delta_x = G_inv.dot(delta_f)
    return delta_x, -delta_x.sum()
```

### 7.2 冲击情景设计 / Shock Scenario Design

|情景 / Scenario|强度 / Intensity|冲击源 / Source|用途 / Purpose|
|---|---|---|---|
|0 基准 / Baseline|0%|—|对照 / reference|
|1 轻度 / Mild|10%|Top-5 关键节点|局部波动 / local fluctuation|
|2 中度 / Moderate|30%|Top-5 关键节点|**基准情景** / main scenario|
|3 重度 / Severe|50%|Top-5 关键节点|极端断链 / extreme rupture|
|4 联合 / Joint|30%|Top-5 同时|系统性冲击 / systemic shock|

### 7.3 冲击传导路径识别 / Shock Transmission Paths

**中文**：基于 Ghosh 逆矩阵元素 $g_{ij}$（完全波及系数）识别"上游能源原材料 → 中游基础加工 → 下游高端制造/终端"的核心传导链条，并通过**完全前向关联系数**与**感应度系数**定位风险传导枢纽。

**English**: Use Ghosh-inverse entries $g_{ij}$ (total ripple coefficients) to trace dominant "upstream energy/materials → midstream processing → downstream manufacturing/consumption" chains, and locate transmission hubs via **total forward-linkage** and **sensitivity-of-dispersion** coefficients.

-----

## 8. 稳健性检验 / Robustness Checks

> **中文**：稳健性检验是测度类研究的生命线。下表的五类检验应在论文附录系统报告，正文仅引用结论。
>
> **English**: Robustness is the lifeblood of measurement studies. Report all five families in the appendix; cite conclusions in the main text.

```
A. 指标替代性检验 / Indicator Substitution（Track A）
   每个原始指标 → 一个理论等价替代指标，重算综合指数，Spearman 秩相关
   ├── 加权平均度      → 加权网络效率 (Latora & Marchiori, 2001)
   ├── 加权聚类系数    → 加权传递性   (Barrat et al., 2004)
   ├── 核心-边缘指数   → Theil 熵指数 (Theil, 1967)
   ├── 投入多样性      → 香农熵       (Shannon, 1948)
   ├── 关键部门依赖度  → CR3 集中率
   ├── 加权鲁棒性      → 随机攻击剩余流量比 (Albert et al., 2000)
   ├── 波及效应系数    → 特征向量中心性 (Bonacich, 1972)
   ├── 恢复中心性      → 接近中心性   (Freeman, 1978)
   ├── 网络结构熵      → 基尼系数
   └── 网络群落韧性    → 平均参与系数 (Guimerà & Amaral, 2005)
   判据 / Criterion：|ρ| > 0.7 通过 ★★★

B. 缩尾处理检验 / Winsorization（双侧 1%–99%）
   极端值替换为分位边界，重算综合指数，与原始指数比 Pearson / Spearman
   判据：ρ > 0.95 → 极端值影响极小

C. 赋权方法对照 / Weighting-Scheme Comparison
   熵权法 vs CRITIC vs 等权法，两两 Spearman ρ̄ > 0.9

D. 阈值敏感性检验 / Threshold Sensitivity（Track A 网络构建）
   阈值 ∈ {0, 1e-5, 5e-5, 1e-4*, 2e-4, 5e-4, 1e-3} 重构网络，趋势一致性

E. 权重设定 / 识别方法对照（Track B）
   ├── 5 种分配系数权重（国内/全口径含进口/增加值加权/总产出加权/等权重）
   ├── α 敏感性（0.3 / 0.5 / 0.7）
   └── 与传统方法对比（规模关键性 / 单一介数 / 出强度 vs 混合关键性指数）
```

```python
import scipy.stats as stats

def substitution_test(original, alternative):
    """指标替代性检验：原指标 vs 替代指标的 Spearman 秩相关。"""
    rho, p = stats.spearmanr(original, alternative)
    verdict = '通过 ★★★' if abs(rho) > 0.7 else ('基本通过 ★★' if abs(rho) > 0.5 else '未通过')
    return rho, p, verdict
```

-----

## 9. 结果呈现与解读 / Presentation and Interpretation

|结果 / Result|呈现方式 / Format|要点 / Key points|
|---|---|---|
|综合韧性时序 / Resilience time series|折线图 / line plot|标注重大冲击年份（金融危机、贸易摩擦、疫情）/ annotate shock years|
|分维度演化 / Dimension-wise evolution|多子图 / small multiples|哪一维拖累整体 / which dimension drags|
|赋权对照 / Weighting comparison|三线叠加图 + ρ 标注 / overlaid lines|证明稳健 / prove robustness|
|关键节点排名 / Node ranking|表（前 10）/ top-10 table|规模 vs 结构 vs 混合三列对照 / three-column contrast|
|冲击损失 / Shock loss|情景对照表 / scenario table|总产出 % + 三次产业拆分 / aggregate % + sectoral split|
|传导路径 / Transmission paths|Top-10 路径表 / path table|上游→中游→下游三级链条 / three-tier chains|

> **解读模板 / Interpretation template**：
> "综合韧性指数从 X 年的 a 上升至 Y 年的 b，呈波动上升态势；[冲击事件] 在曲线上留下显著回落印记。分维度看，[维度] 长期处于低位，是制约整体韧性的核心短板。"
>
> "The composite resilience index rose from a (year X) to b (year Y) with fluctuations; [shock event] left a visible dip. By dimension, [dimension] remains persistently low and is the binding constraint on overall resilience."

-----

## 10. 政策含义 / Policy Implications

**中文**：测度与诊断的最终落点是政策。基于本 Workflow 的结果可支撑：

1. **风险分级监测**：将结构关键节点（而非仅规模大的部门）纳入产业链安全重点监测清单。
2. **补链强链精准施策**：把有限资源投向"规模不大但结构关键"的中游脆弱环节，避免"撒胡椒面"。
3. **传导枢纽加固**：强化批发、物流等风险传导枢纽的抗冲击能力，筑牢"防火墙"。
4. **国产替代优先级**：以结构关键性 + 冲击损失幅度联合排序，为国产替代提供量化依据。
5. **分类治理**：瓶颈型→国产化替代与战略储备；桥梁型→多元供应商与协同研发；枢纽型→集群数字化与联合采购。

**English**: Measurement ultimately serves policy. This workflow's outputs support:

1. **Tiered risk monitoring** of structurally critical nodes (not merely large sectors).
2. **Precision chain-strengthening**: channel scarce resources to "small-but-critical" midstream nodes.
3. **Hardening transmission hubs** (wholesale, logistics) as firewalls against propagation.
4. **Localization priorities**: rank by structural criticality × shock-loss magnitude.
5. **Differentiated governance** by node type (bottleneck / bridge / hub).

-----

## 完整 Workflow 一览 / Complete Workflow Overview

```
§1  数据与网络构建 / Data & Network
    ├── 非竞争型 IO 表（剔除进口）/ Non-competitive IO table
    ├── 抽取 Z, x, f / Extract Z, x, f
    └── 多期（路径A）或单期（路径B）/ Multi-period (A) or single-period (B)

§2  边权与矩阵选择 / Edge Weight & Matrix
    ├── 需求侧：A=Z/x_j → L=(I-A)^-1 / Demand-side (Leontief)
    └── 供给侧：B=Z/x_i → G=(I-B)^-1 / Supply-side (Ghosh)

§3  骨架提取与拓扑刻画 / Backbone & Topology
    ├── Disparity Filter (α=0.05)
    └── 密度/度分布/强度/核心-边缘 / density, degree, strength, core-periphery

┌── 路径 A：动态韧性测度 / Track A ──────────────┐  ┌── 路径 B：静态脆弱性诊断 / Track B ──────────┐
│ §4 四维十指标 / 4×10 indicators              │  │ §6 结构关键节点识别 / Critical-node ID      │
│    结构/依赖/恢复/适应                         │  │    规模关键性(7中心性)                       │
│ §5 熵权法综合指数 + CRITIC/等权对照            │  │    结构关键性(Node2vec+KMeans)               │
│    → 综合韧性指数时序                          │  │    → 混合关键性指数 + α敏感性                 │
└────────────────────────────────────────────┘  │ §7 Ghosh 供给冲击模拟                        │
                                                 │    单/多节点 × 10/30/50% + 传导路径         │
                                                 └─────────────────────────────────────────┘

§8  稳健性检验 / Robustness（附录 / appendix）
    指标替代 / 缩尾 / 赋权对照 / 阈值敏感 / 权重设定 / 方法对比

§9  结果呈现与解读 / Presentation              §10 政策含义 / Policy Implications
```

-----

## 软件包清单 / Software Packages

```bash
pip install numpy pandas networkx scipy matplotlib scikit-learn node2vec
```

|包 / Package|用途 / Use|
|---|---|
|`numpy` / `pandas`|矩阵运算、数据处理 / matrix algebra, data handling|
|`networkx`|网络构建、中心性、Louvain 群落 / network, centrality, community|
|`node2vec`|图嵌入（结构关键性）/ graph embedding|
|`scikit-learn`|K-means、标准化 / clustering, scaling|
|`scipy.stats`|Spearman/Pearson 稳健性检验 / robustness correlations|
|`matplotlib`|可视化 / plotting|

> **可复现性 / Reproducibility**：全流程固定随机种子（`random` / `numpy` / `node2vec` / `KMeans` / 网络布局），确保结果稳定可复现。
>
> Fix random seeds across `random`, `numpy`, `node2vec`, `KMeans`, and layout to guarantee reproducible results.

-----

## 参考文献 / References

- Acemoglu, D., Carvalho, V. M., Ozdaglar, A., & Tahbaz-Salehi, A. (2012). The network origins of aggregate fluctuations. *Econometrica*, 80(5), 1977–2016.
- Albert, R., Jeong, H., & Barabási, A.-L. (2000). Error and attack tolerance of complex networks. *Nature*, 406, 378–382.
- Barrat, A., Barthélemy, M., Pastor-Satorras, R., & Vespignani, A. (2004). The architecture of complex weighted networks. *PNAS*, 101(11), 3747–3752.
- Carvalho, V. M., & Tahbaz-Salehi, A. (2019). Production networks: A primer. *Annual Review of Economics*, 11, 635–663.
- de Mesnard, L. (2009). Is the Ghosh model interesting? *Journal of Regional Science*, 49(2), 361–375.
- Fagiolo, G. (2007). Clustering in complex directed networks. *Physical Review E*, 76(2), 026107.
- Ghosh, A. (1958). Input-output approach in an allocation system. *Economica*, 25(97), 58–64.
- Grover, A., & Leskovec, J. (2016). node2vec: Scalable feature learning for networks. *KDD '16*, 855–864.
- Guimerà, R., & Amaral, L. A. N. (2005). Functional cartography of complex metabolic networks. *Nature*, 433, 895–900.
- Leontief, W. (1936). Quantitative input and output relations in the economic systems of the United States. *Review of Economics and Statistics*, 18(3), 105–125.
- Martin, R. (2012). Regional economic resilience, hysteresis and recessionary shocks. *Journal of Economic Geography*, 12(1), 1–32.
- Miller, R. E., & Blair, P. D. (2022). *Input–Output Analysis: Foundations and Extensions* (3rd ed.). Cambridge University Press.
- Newman, M. E. J. (2006). Modularity and community structure in networks. *PNAS*, 103(23), 8577–8582.
- Serrano, M. Á., Boguñá, M., & Vespignani, A. (2009). Extracting the multiscale backbone of complex weighted networks. *PNAS*, 106(16), 6483–6488.

-----

*最后更新 / Last updated: 2026-06-02 | Framework version: 1.0 | 中英双语版 / Bilingual Edition*
