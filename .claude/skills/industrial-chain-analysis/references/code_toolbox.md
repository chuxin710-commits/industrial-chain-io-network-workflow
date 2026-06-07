# 代码工具箱 / Code Toolbox（链析 ChainLens）

> 供「能力二：审表→出代码」复用。生成方案时**按用户表的真实结构裁剪读取部分**（编码、列名、前缀），其余按所选路线组装。完整可运行参考实现见 `../scripts/resilience_measurement.py`（路径 A）与 `../scripts/vulnerability_nodes.py`（路径 B）。

依赖 / Deps：`numpy pandas networkx scipy scikit-learn node2vec matplotlib`

## 1. 读取与矩阵抽取 / Read & Extract

```python
import numpy as np, pandas as pd, networkx as nx

def read_io_table(path, encoding='utf-8'):
    """读取非竞争型 IO 表 → 中间投入矩阵 Z、总产出 x、部门代码。按实际编码/列名调整。"""
    df = pd.read_csv(path, index_col=0, encoding=encoding)
    dom = df.index[df.index.str.startswith('DOM_', na=False)]    # 国内中间投入块；视表结构调整
    codes = [r.replace('DOM_', '') for r in dom]
    Z = df.loc[dom, codes].values.astype(float)
    x = df.loc['OUTPUT', codes].values.astype(float)            # 或 '总产出' 列：pd.to_numeric(df['总产出'])
    return Z, x, codes

# 若为 211 部门式（Z_matrix.csv + IO_2023.csv 分离、GBK 编码）：
#   io = pd.read_csv('Z_matrix.csv', index_col=0, encoding='utf-8')   # 中间矩阵
#   full = pd.read_csv('IO_2023.csv', index_col=0, encoding='gbk')    # 取 full['总产出']
#   对齐 index∩columns 后再计算系数。
```

## 2. 系数与逆矩阵 / Coefficients & Inverses

```python
def coefficients(Z, x):
    A = np.nan_to_num(Z / x)             # 直接消耗系数 a_ij=z_ij/x_j（列归一，需求侧/Leontief）
    B = np.nan_to_num(Z / x[:, None])    # 分配系数     b_ij=z_ij/x_i（行归一，供给侧/Ghosh）
    return A, B

def leontief_inverse(A):                 # L=(I−A)^-1
    return np.linalg.inv(np.eye(len(A)) - A)

def ghosh_inverse(B):                     # G=(I−B)^-1
    I = np.eye(len(B))
    try:    return np.linalg.inv(I - B)
    except np.linalg.LinAlgError: return np.linalg.pinv(I - B)
```

## 3. 建网与拓扑 / Network & Topology

```python
def build_network(W, codes):
    G = nx.DiGraph(); G.add_nodes_from(codes)
    n = W.shape[0]
    for i in range(n):
        for j in range(n):
            if W[i, j] > 0:
                G.add_edge(codes[i], codes[j], weight=W[i, j])
    return G

def network_summary(G):
    ins, outs = dict(G.in_degree(weight='weight')), dict(G.out_degree(weight='weight'))
    return {'n': G.number_of_nodes(), 'm': G.number_of_edges(), 'density': nx.density(G),
            'avg_in_strength': float(np.mean(list(ins.values()))),
            'avg_out_strength': float(np.mean(list(outs.values())))}
```

## 4. 骨架提取（高密度网络）/ Backbone Extraction

```python
def disparity_filter(W, alpha=0.05):
    n = W.shape[0]; out = np.zeros_like(W)
    for i in range(n):
        w = W[i, :]; k = int((w > 0).sum()); s = w.sum()
        if k <= 1 or s == 0:
            out[i, :] = w; continue
        p = w / s
        for j in range(n):
            if w[j] > 0 and (1 - p[j]) ** (k - 1) < alpha:
                out[i, j] = w[j]
    return out
```

## 5. 路径 A 指标示例 / Resilience Indicators (excerpt)

```python
def weighted_avg_degree(W):                       # 结构韧性
    return np.mean(W.sum(0)), np.mean(W.sum(1))   # 平均入强度(后向), 平均出强度(前向)

def input_diversity(W):                           # 依赖韧性：逆 HHI（有效供应商数）
    cs, cs2 = W.sum(0), (W**2).sum(0)
    with np.errstate(divide='ignore', invalid='ignore'):
        D = np.where(cs > 0, cs**2 / cs2, 0)
    return np.mean(D)

def spread_effect(L):                             # 恢复韧性：Leontief 列和均值
    return np.mean(L.sum(0))

def network_entropy(W):                           # 适应韧性：边权分布香农熵
    p = W.flatten(); p = p[p > 0] / W.sum()
    return -np.sum(p * np.log(p))
```

> 完整十指标 + 熵权法/CRITIC/等权合成 + 稳健性见 `../scripts/resilience_measurement.py` 与 `indicator_dictionary.md`。

## 6. 路径 B 关键节点 + Ghosh 冲击 / Critical Nodes + Shock

```python
from sklearn.preprocessing import MinMaxScaler, StandardScaler
from sklearn.cluster import KMeans
from node2vec import Node2Vec

def structural_criticality(G_backbone, k=10, seed=211):   # 结构关键性
    n2v = Node2Vec(G_backbone, dimensions=32, walk_length=20, num_walks=40,
                   p=1, q=0.5, workers=1, seed=seed, weight_key='weight')
    model = n2v.fit(window=5, min_count=1, epochs=20, sg=1, seed=seed, workers=1)
    nodes = list(G_backbone.nodes())
    Xs = StandardScaler().fit_transform(np.array([model.wv[v] for v in nodes]))
    km = KMeans(n_clusters=k, random_state=seed, n_init=10).fit(Xs)
    norms = np.linalg.norm(km.cluster_centers_, axis=1)
    dist  = np.linalg.norm(Xs - km.cluster_centers_[km.labels_], axis=1)
    raw   = norms[km.labels_] / (1 + dist)
    return pd.Series(MinMaxScaler().fit_transform(raw.reshape(-1, 1)).ravel(), index=nodes)

def supply_shock(G_inv_df, x, shocked, ratio):            # Ghosh 供给冲击 Δx=G·Δf
    f = pd.Series(0.0, index=G_inv_df.index)
    for s in ([shocked] if isinstance(shocked, str) else shocked):
        f.loc[s] = -ratio * x.loc[s]
    dx = G_inv_df.dot(f)
    return dx, -dx.sum()
```

> 混合关键性指数 `α·规模+(1−α)·结构`、7 项中心性、α 敏感性、传导路径见 `../scripts/vulnerability_nodes.py`。

## 可复现性 / Reproducibility
全流程固定随机种子：`random.seed`、`np.random.seed`、`Node2Vec(seed=)`、`KMeans(random_state=)`、网络布局 `seed=`。
