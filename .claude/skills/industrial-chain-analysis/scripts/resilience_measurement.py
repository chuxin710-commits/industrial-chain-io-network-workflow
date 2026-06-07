#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
产业链网络韧性指标体系构建与稳健性检验
========================================
包含：原始指标计算、熵权法合成、指标替代性检验

[修改说明]
所有网络指标的计算统一使用直接消耗系数矩阵 A = Z / x 作为边权，
消除了金额口径混入规模效应的问题。
- weighted_avg_degree: Z → A（核心修改，量级从万元级变为系数级）
- weighted_clustering_coefficient: Z → A（函数内已做 max 归一化，兼容）
- core_periphery_index: Z → A
- robustness_simulation: Z → A（比值形式，口径统一后更纯净）
- network_entropy: Z → A，同时修复归一化bug（p = Z.flatten() → p = W.flatten() / total）
- compute_community_resilience: Z → A
- 所有替代指标函数: Z → A
- input_diversity / key_sector_dependence: 份额型，结果不受影响
- spread_effect / recovery_centrality: 原本就用 L（从A推导），无需改动
"""

import os
import math
import warnings
import numpy as np
import pandas as pd
import networkx as nx
import matplotlib.pyplot as plt
import scipy.stats as stats

warnings.filterwarnings('ignore')

# ======================== 全局绘图设置 ========================
plt.rcParams['font.sans-serif'] = ['SimHei']
plt.rcParams['axes.unicode_minus'] = False

# ======================== 数据读取 ========================
def read_io_table(file_path, sheet_name=None):
    """读取投入产出表（CSV/Excel），返回国内中间投入矩阵Z、总产出向量x、部门代码列表"""
    if file_path.endswith('.csv'):
        df = pd.read_csv(file_path, index_col=0)
    else:
        df = pd.read_excel(file_path, sheet_name=sheet_name, index_col=0)

    dom_rows = df.index[df.index.str.startswith('DOM_', na=False)]
    codes = [row.replace('DOM_', '') for row in dom_rows]

    valid_cols = [col for col in df.columns if col in codes]
    if not valid_cols:
        raise ValueError("未找到匹配的中间投入列，请检查列名格式")

    Z_df = df.loc[dom_rows, valid_cols]
    Z_df = Z_df[codes]
    Z = Z_df.values.astype(float)

    if 'OUTPUT' in df.index:
        x = df.loc['OUTPUT', valid_cols].values.astype(float)
    else:
        raise ValueError("未找到总产出行'OUTPUT'")

    return Z, x, codes


# ======================== 原始韧性指标计算 ========================
# 所有函数的边权参数统一命名为 W（weight matrix），
# 在调用时统一传入直接消耗系数矩阵 A = Z / x

def weighted_avg_degree(W):
    """
    加权平均入度、出度
    基于直接消耗系数矩阵：平均入度 = 各部门后向关联系数（列和）的均值，
    平均出度 = 各部门前向关联系数（行和）的均值，量级约0.4-0.8
    """
    avg_in = np.mean(W.sum(axis=0))
    avg_out = np.mean(W.sum(axis=1))
    return avg_in, avg_out


def weighted_clustering_coefficient(W):
    """加权聚类系数 — Fagiolo (2007) 有向版本"""
    n = W.shape[0]
    W_copy = W.copy()
    max_w = W_copy.max()
    if max_w == 0:
        return 0.0
    W_norm = W_copy / max_w

    C = np.zeros(n)
    for i in range(n):
        s_tot = W_norm[i, :].sum() + W_norm[:, i].sum()
        d_tot = (np.count_nonzero(W_norm[i, :]) + np.count_nonzero(W_norm[:, i])
                 - np.count_nonzero(W_norm[i, :] * W_norm[:, i].T))
        s_bidir = np.sum(np.minimum(W_norm[i, :], W_norm[:, i].T))

        denom = 2 * (s_tot * (d_tot - 1) - 2 * s_bidir)
        if denom <= 1e-12:
            C[i] = 0.0
            continue

        numer = 0.0
        for j in range(n):
            if j == i:
                continue
            w_ji, w_ij = W_norm[j, i], W_norm[i, j]
            if w_ji == 0 and w_ij == 0:
                continue
            for k in range(n):
                if k == i or k == j:
                    continue
                w_ik, w_ki = W_norm[i, k], W_norm[k, i]
                w_jk, w_kj = W_norm[j, k], W_norm[k, j]
                numer += ((w_ji + w_ij) / 2) * ((w_ik + w_ki) / 2) * ((w_jk + w_kj) / 2)

        C[i] = numer / denom

    return np.nanmean(C)


def core_periphery_index(W, core_ratio=0.2):
    """
    核心-边缘指数：前core_ratio比例高总强度节点之间的流量占总流量之比
    基于直接消耗系数：核心节点 = 前后向关联系数之和最高的部门
    """
    total_flow = W.sum()
    if total_flow == 0:
        return 0.0
    total_strength = W.sum(axis=0) + W.sum(axis=1)
    n = len(total_strength)
    k = max(1, int(np.ceil(n * core_ratio)))
    core_nodes = np.argsort(total_strength)[-k:]
    core_flow = W[np.ix_(core_nodes, core_nodes)].sum()
    return core_flow / total_flow


def input_diversity(W):
    """
    投入多样性指数：逆赫芬达尔指数的平均值
    份额型指标，W 取 Z 或 A 结果一致
    """
    col_sum = W.sum(axis=0)
    col_sum2 = (W ** 2).sum(axis=0)
    with np.errstate(divide='ignore', invalid='ignore'):
        D = np.where(col_sum > 0, col_sum ** 2 / col_sum2, 0)
    return np.mean(D)


def key_sector_dependence(W):
    """
    关键部门依赖度：各部门最大供应商占比的平均值
    份额型指标，W 取 Z 或 A 结果一致
    """
    col_sum = W.sum(axis=0)
    max_val = W.max(axis=0)
    with np.errstate(divide='ignore', invalid='ignore'):
        K = np.where(col_sum > 0, max_val / col_sum, 0)
    return np.mean(K)


def robustness_simulation(W, core_ratio=0.2, n_random=100):
    """
    加权鲁棒性：定向攻击（移除核心部门）与随机攻击后的剩余流量比例
    基于直接消耗系数矩阵，比值形式抵消绝对量纲
    """
    total_flow = W.sum()
    if total_flow == 0:
        return 0.0, 0.0
    n = W.shape[0]
    k = max(1, int(np.ceil(n * core_ratio)))

    total_strength = W.sum(axis=0) + W.sum(axis=1)
    core_nodes = np.argsort(total_strength)[-k:]
    remaining = np.setdiff1d(np.arange(n), core_nodes)
    R_target = W[np.ix_(remaining, remaining)].sum() / total_flow if len(remaining) > 0 else 0.0

    R_rand_list = []
    for _ in range(n_random):
        rand_nodes = np.random.choice(n, size=k, replace=False)
        remaining_rand = np.setdiff1d(np.arange(n), rand_nodes)
        R_rand_list.append(
            W[np.ix_(remaining_rand, remaining_rand)].sum() / total_flow
            if len(remaining_rand) > 0 else 0.0
        )
    return R_target, np.mean(R_rand_list)


def spread_effect(L):
    """波及效应系数：列昂惕夫逆矩阵列和的平均值"""
    return np.mean(L.sum(axis=0))


def network_entropy(W):
    """
    网络结构熵：边权分布的香农熵
    [修复] 原代码 p = W.flatten() 缺少归一化，现已修正为 p = W.flatten() / total
    """
    total = W.sum()
    if total == 0:
        return 0.0
    p = W.flatten() / total
    p = p[p > 0]
    return -np.sum(p * np.log(p))


def compute_community_resilience(W):
    """
    网络群落韧性：基于Louvain算法检测群落并计算归一化模块度
    基于直接消耗系数对称化后的无向加权网络
    """
    n = W.shape[0]
    G = nx.Graph()
    G.add_nodes_from(range(n))
    for i in range(n):
        for j in range(i + 1, n):
            w = W[i, j] + W[j, i]
            if w > 0:
                G.add_edge(i, j, weight=w)

    if G.number_of_edges() == 0 or G.number_of_nodes() <= 1:
        return 0.0

    communities = nx.community.louvain_communities(G, weight='weight', seed=42)
    m = len(communities)
    Q = nx.community.modularity(G, communities, weight='weight')
    return Q / np.log(m) if m > 1 else Q


def recovery_centrality(L):
    """恢复中心性：基于随机游走平均首达时间"""
    n = L.shape[0]
    row_sum = L.sum(axis=1)
    P = np.zeros((n, n))
    for i in range(n):
        P[i] = L[i] / row_sum[i] if row_sum[i] > 0 else np.ones(n) / n

    pi = np.ones(n) / n
    for _ in range(1000):
        pi_new = pi @ P
        if np.linalg.norm(pi_new - pi) < 1e-12:
            break
        pi = pi_new
    pi /= pi.sum()

    H = np.zeros((n, n))
    for j in range(n):
        indices = [idx for idx in range(n) if idx != j]
        M = np.eye(n - 1) - P[np.ix_(indices, indices)]
        b = np.ones(n - 1)
        try:
            h = np.linalg.solve(M, b)
        except np.linalg.LinAlgError:
            h = np.linalg.lstsq(M, b, rcond=None)[0]
        for idx, i_orig in enumerate(indices):
            H[i_orig, j] = h[idx]

    RC = np.zeros(n)
    for i in range(n):
        denom = np.sum(pi * H[:, i])
        RC[i] = 1.0 / denom if denom > 0 else 0.0

    return np.mean(RC)


# ======================== 替代指标计算函数 ========================
# 同样统一使用直接消耗系数矩阵 W

def weighted_network_efficiency(W):
    """加权网络效率 (Latora & Marchiori, 2001)"""
    n = W.shape[0]
    if n <= 1:
        return 0.0

    G = nx.DiGraph()
    for i in range(n):
        for j in range(n):
            if W[i, j] > 0:
                G.add_edge(i, j, distance=1.0 / W[i, j])

    if G.number_of_edges() == 0:
        return 0.0

    try:
        dist = dict(nx.shortest_path_length(G, weight='distance'))
    except nx.NetworkXNoPath:
        dist = {}

    inv_d_sum = 0.0
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            d = dist.get(i, {}).get(j, np.inf)
            if d < np.inf:
                inv_d_sum += 1.0 / d

    return inv_d_sum / (n * (n - 1))


def weighted_transitivity(W):
    """加权网络传递性 (Barrat et al., 2004)"""
    n = W.shape[0]
    W_sym = W + W.T
    max_w = W_sym.max()
    if max_w == 0:
        return 0.0
    W_norm = W_sym / max_w
    np.fill_diagonal(W_norm, 0.0)

    numer, denom = 0.0, 0.0
    for i in range(n):
        for j in range(n):
            if j == i or W_norm[i, j] == 0:
                continue
            for k in range(j + 1, n):
                if k == i or W_norm[i, k] == 0:
                    continue
                triple_w = (W_norm[i, j] * W_norm[i, k]) ** (1.0 / 3.0)
                denom += triple_w
                if W_norm[j, k] > 0:
                    numer += (W_norm[i, j] * W_norm[i, k] * W_norm[j, k]) ** (1.0 / 3.0)

    return numer / denom if denom > 0 else 0.0


def theil_entropy_index(W):
    """Theil 熵指数 (Theil, 1967) — 替代核心-边缘指数"""
    n = W.shape[0]
    if n <= 1:
        return 0.0

    s = W.sum(axis=0) + W.sum(axis=1)
    s_mean = s.mean()
    if s_mean == 0:
        return 0.0

    ratio = s / s_mean
    mask = ratio > 0
    T = np.sum(ratio[mask] * np.log(ratio[mask])) / n
    return T


def shannon_diversity(W):
    """香农熵（列维归一化）：各部门投入分布的熵的均值"""
    n = W.shape[0]
    col_sum = W.sum(axis=0)
    H_total = 0.0
    for j in range(n):
        if col_sum[j] > 0:
            p = W[:, j] / col_sum[j]
            p = p[p > 0]
            H_total += -np.sum(p * np.log(p))
    return H_total / n if n > 0 else 0.0


def cr3_dependence(W):
    """CR3：前三大供应商采购占比的部门均值"""
    n = W.shape[0]
    col_sum = W.sum(axis=0)
    cr3_avg = 0.0
    for j in range(n):
        w = np.sort(W[:, j])[::-1]
        top3_sum = w[:3].sum()
        cr3_avg += top3_sum / col_sum[j] if col_sum[j] > 0 else 0.0
    return cr3_avg / n if n > 0 else 0.0


def random_attack_robustness(W, attack_ratio=0.2, n_sim=50):
    """随机攻击剩余流量比（20%节点，50次模拟均值）"""
    total_flow = W.sum()
    if total_flow == 0:
        return 0.0
    n = W.shape[0]
    k = max(1, int(np.ceil(n * attack_ratio)))
    R_list = []
    for _ in range(n_sim):
        rand_nodes = np.random.choice(n, size=k, replace=False)
        remaining = np.setdiff1d(np.arange(n), rand_nodes)
        R_list.append(
            W[np.ix_(remaining, remaining)].sum() / total_flow
            if len(remaining) > 0 else 0.0
        )
    return np.mean(R_list)


def eigenvector_centrality_mean(W):
    """加权特征向量中心性 (Bonacich, 1972)"""
    n = W.shape[0]
    if n <= 1:
        return 1.0 if n == 1 else 0.0

    G = nx.DiGraph()
    for i in range(n):
        for j in range(n):
            if W[i, j] > 0:
                G.add_edge(i, j, weight=W[i, j])

    if G.number_of_edges() == 0:
        return 1.0 / n

    try:
        ec = nx.eigenvector_centrality_numpy(G, weight='weight', max_iter=1000, tol=1e-6)
    except nx.PowerIterationFailedConvergence:
        ec = {i: 1.0 / n for i in range(n)}

    return np.mean(list(ec.values()))


def closeness_centrality_mean(W):
    """加权接近中心性 (Freeman, 1978)"""
    n = W.shape[0]
    if n <= 1:
        return 1.0 if n == 1 else 0.0

    G = nx.DiGraph()
    for i in range(n):
        for j in range(n):
            if W[i, j] > 0:
                G.add_edge(i, j, distance=1.0 / W[i, j])

    if G.number_of_edges() == 0:
        return 0.0

    cc = nx.closeness_centrality(G, distance='distance')
    return np.mean(list(cc.values()))


def gini_coefficient(W):
    """基尼系数：基于节点总强度（入强度+出强度）的分布"""
    strength = W.sum(axis=0) + W.sum(axis=1)
    total = strength.sum()
    if total == 0:
        return 0.0
    s_sorted = np.sort(strength)
    n = len(s_sorted)
    index = np.arange(1, n + 1)
    return (2 * index - n - 1).dot(s_sorted) / (n * total)


def participation_coefficient_mean(W):
    """平均参与系数 (Guimerà & Amaral, 2005) — 替代网络群落韧性"""
    n = W.shape[0]
    if n <= 1:
        return 0.0

    W_sym = W + W.T
    G = nx.Graph()
    for i in range(n):
        G.add_node(i)
        for j in range(i + 1, n):
            if W_sym[i, j] > 0:
                G.add_edge(i, j, weight=W_sym[i, j])

    if G.number_of_edges() == 0:
        return 0.0

    communities = nx.community.louvain_communities(G, weight='weight', seed=42)
    node_to_comm = {}
    for c_idx, comm in enumerate(communities):
        for node in comm:
            node_to_comm[node] = c_idx

    N_m = len(communities)
    if N_m <= 1:
        return 0.0

    P = np.zeros(n)
    for i in range(n):
        k_i = G.degree(i)
        if k_i == 0:
            P[i] = 0.0
            continue

        k_ic = np.zeros(N_m)
        for neighbor in G.neighbors(i):
            c = node_to_comm.get(neighbor, -1)
            if c >= 0:
                k_ic[c] += 1

        P[i] = 1.0 - np.sum((k_ic / k_i) ** 2)

    return np.mean(P)


# ======================== 主处理函数 ========================
def process_year(file_path, year, core_ratio=0.2):
    """
    处理单个年份，返回所有原始韧性指标。
    [修改] 所有指标统一基于直接消耗系数矩阵 A = Z / x 计算。
    """
    try:
        Z, x, codes = read_io_table(file_path)
    except Exception as e:
        print(f"  年份 {year} 读取失败: {e}")
        return None

    n = Z.shape[0]
    A = np.nan_to_num(Z / x)          # 直接消耗系数矩阵（统一边权）
    I = np.eye(n)
    try:
        L = np.linalg.inv(I - A)      # 列昂惕夫逆矩阵（完全消耗系数网络）
    except np.linalg.LinAlgError:
        print(f"  年份 {year} 矩阵不可逆")
        return None

    # [修改] 以下所有调用统一传入 A（直接消耗系数）
    avg_in, avg_out = weighted_avg_degree(A)
    avg_clus = weighted_clustering_coefficient(A)
    cc_index = core_periphery_index(A, core_ratio)
    avg_div = input_diversity(A)
    avg_dep = key_sector_dependence(A)
    R_target, _ = robustness_simulation(A, core_ratio)
    avg_spread = spread_effect(L)              # 基于 L，不涉及 A/Z 选择
    entropy_val = network_entropy(A)
    cr = compute_community_resilience(A)
    avg_recovery = recovery_centrality(L)      # 基于 L，不涉及 A/Z 选择

    return {
        'year': year,
        'avg_in_degree': avg_in,
        'avg_out_degree': avg_out,
        'avg_clustering': avg_clus,
        'core_periphery': cc_index,
        'avg_input_diversity': avg_div,
        'avg_key_dependence': avg_dep,
        'robustness_target': R_target,
        'avg_spread_effect': avg_spread,
        'network_entropy': entropy_val,
        'community_resilience': cr,
        'avg_recovery_centrality': avg_recovery
    }


# ======================== 主循环：计算所有年份原始指标 ========================
folder = r"../data/非竞争型"
years = list(range(1995, 2023))
all_metrics = []

print("=" * 60)
print("计算原始韧性指标（1995-2022）—— 统一使用直接消耗系数边权")
print("=" * 60)

for year in years:
    file_path = os.path.join(folder, f"CHN{year}dom.csv")
    if not os.path.exists(file_path):
        print(f"  警告：文件 {file_path} 不存在，跳过")
        continue
    metrics = process_year(file_path, year)
    if metrics is not None:
        all_metrics.append(metrics)
        print(f"  {year} 完成")

df_metrics = pd.DataFrame(all_metrics)
print(f"\n共处理 {len(df_metrics)} 个年份，数据维度: {df_metrics.shape}\n")

# ---- 保存原始指标表 ----
metric_names = {
    'avg_in_degree': '加权平均入度',
    'avg_out_degree': '加权平均出度',
    'avg_clustering': '平均加权聚类系数',
    'core_periphery': '核心-边缘指数',
    'avg_input_diversity': '平均投入多样性',
    'avg_key_dependence': '平均关键部门依赖度',
    'robustness_target': '加权鲁棒性（定向冲击）',
    'avg_spread_effect': '平均波及效应系数',
    'network_entropy': '网络结构熵',
    'community_resilience': '网络群落韧性',
    'avg_recovery_centrality': '平均恢复中心性'
}
df_metrics_chinese = df_metrics.rename(columns=metric_names)
df_metrics_chinese.to_csv('产业网络指标_原始数据.csv', index=False, encoding='utf-8-sig')
print("原始指标数据已保存至 '产业网络指标_原始数据.csv'")

# ---- 各指标单图 ----
for col, name in metric_names.items():
    plt.figure(figsize=(10, 6))
    plt.plot(df_metrics['year'], df_metrics[col], marker='o', linestyle='-', color='b')
    plt.title(f'{name} 随时间变化', fontsize=14)
    plt.xlabel('年份', fontsize=12)
    plt.ylabel(name, fontsize=12)
    plt.grid(True, linestyle='--', alpha=0.7)
    plt.tight_layout()
    plt.savefig(f'{name}.png', dpi=300)
    plt.close()
print("各指标单图已保存")


# ======================== 熵权法合成综合韧性指数 ========================
def entropy_weight_method(df, indicators):
    """熵权法：输入df（含'year'列）和指标方向字典 {'col': 'pos'|'neg'}"""
    data = df[list(indicators.keys())].copy()
    years_arr = df['year'].values

    data_norm = pd.DataFrame(index=data.index)
    for col, direction in indicators.items():
        min_val, max_val = data[col].min(), data[col].max()
        if max_val == min_val:
            data_norm[col] = 0.5
        elif direction == 'pos':
            data_norm[col] = (data[col] - min_val) / (max_val - min_val)
        else:
            data_norm[col] = (max_val - data[col]) / (max_val - min_val)

    p = data_norm / data_norm.sum(axis=0)
    p = p.replace(0, 1e-12)
    m = len(data)
    e = -1 / np.log(m) * (p * np.log(p)).sum(axis=0)
    w = (1 - e) / (1 - e).sum()
    score = (data_norm * w).sum(axis=1)

    return w, score, years_arr


indicators_direction = {
    'avg_in_degree': 'pos',
    'avg_out_degree': 'pos',
    'avg_clustering': 'pos',
    'core_periphery': 'neg',
    'avg_input_diversity': 'pos',
    'avg_key_dependence': 'neg',
    'robustness_target': 'pos',
    'avg_spread_effect': 'neg',
    'network_entropy': 'pos',
    'community_resilience': 'pos',
    'avg_recovery_centrality': 'pos'
}

if df_metrics.empty:
    print("\n无有效数据，跳过熵权法计算")
else:
    weights, scores, years_valid = entropy_weight_method(df_metrics, indicators_direction)

    print("\n熵权法权重：")
    for col, w in zip(indicators_direction.keys(), weights):
        print(f"  {metric_names[col]}: {w:.4f}")

    weights_df = pd.DataFrame({
        '指标': [metric_names[col] for col in indicators_direction.keys()],
        '权重': weights
    })
    weights_df.to_csv('熵权法权重.csv', index=False, encoding='utf-8-sig')

    score_df = pd.DataFrame({'年份': years_valid, '综合韧性指数': scores})
    score_df.to_csv('综合韧性指数.csv', index=False, encoding='utf-8-sig')

    plt.figure(figsize=(12, 6))
    plt.plot(years_valid, scores, marker='s', linestyle='-', color='red', linewidth=2)
    plt.title('中国产业链综合韧性指数（1995-2022）', fontsize=16)
    plt.xlabel('年份', fontsize=14)
    plt.ylabel('综合韧性指数', fontsize=14)
    plt.grid(True, linestyle='--', alpha=0.7)
    plt.xticks(years_valid, rotation=45)
    plt.tight_layout()
    plt.savefig('综合韧性指数.png', dpi=300)
    plt.close()
    print("熵权法结果已保存")


# ======================== 稳健性检验：指标替代性检验 ========================
robust_folder = "稳健性检验"
os.makedirs(robust_folder, exist_ok=True)
np.random.seed(42)


def rebuild_A_dict(folder, years):
    """
    [修改] 从原始文件重建直接消耗系数矩阵 A 字典。
    原函数名为 rebuild_z_dict，现在统一返回 A = Z / x。
    """
    A_dict = {}
    for year in years:
        file_path = os.path.join(folder, f"CHN{year}dom.csv")
        if not os.path.exists(file_path):
            continue
        try:
            Z, x, _ = read_io_table(file_path)
            A = np.nan_to_num(Z / x)
            A_dict[year] = A
        except Exception as e:
            print(f"  重建失败 {year}: {e}")
    return A_dict


def alternative_indicators_test(df_metrics, A_dict):
    """
    使用替代指标体系进行稳健性检验。
    [修改] 所有替代指标统一使用直接消耗系数矩阵 A。
    """
    print("\n[稳健性检验] 指标替代性检验（统一A口径）...")
    years = df_metrics['year'].values

    alt_efficiency    = []
    alt_transitivity  = []
    alt_theil         = []
    alt_shannon_div   = []
    alt_cr3_dep       = []
    alt_robust_rand   = []
    alt_eigenvector   = []
    alt_closeness     = []
    alt_gini          = []
    alt_participation = []

    for year in years:
        A = A_dict.get(year)
        if A is None or A.size == 0:
            for lst in [alt_efficiency, alt_transitivity, alt_theil,
                        alt_shannon_div, alt_cr3_dep, alt_robust_rand,
                        alt_eigenvector, alt_closeness, alt_gini,
                        alt_participation]:
                lst.append(np.nan)
            continue

        alt_efficiency.append(weighted_network_efficiency(A))
        alt_transitivity.append(weighted_transitivity(A))
        alt_theil.append(theil_entropy_index(A))
        alt_shannon_div.append(shannon_diversity(A))
        alt_cr3_dep.append(cr3_dependence(A))
        alt_robust_rand.append(random_attack_robustness(A))
        alt_eigenvector.append(eigenvector_centrality_mean(A))
        alt_closeness.append(closeness_centrality_mean(A))
        alt_gini.append(gini_coefficient(A))
        alt_participation.append(participation_coefficient_mean(A))

    df_alt = pd.DataFrame({
        'year': years,
        'alt_efficiency':    alt_efficiency,
        'alt_transitivity':  alt_transitivity,
        'alt_theil':         alt_theil,
        'alt_shannon_div':   alt_shannon_div,
        'alt_cr3_dep':       alt_cr3_dep,
        'alt_robust_rand':   alt_robust_rand,
        'alt_eigenvector':   alt_eigenvector,
        'alt_closeness':     alt_closeness,
        'alt_gini':          alt_gini,
        'alt_participation': alt_participation,
    })

    for col in df_alt.columns:
        if col == 'year':
            continue
        df_alt[col] = df_alt[col].fillna(df_alt[col].mean())

    df_alt.to_csv(os.path.join(robust_folder, '替代指标.csv'), index=False, encoding='utf-8-sig')

    print("  替代指标年度变异范围：")
    for col in df_alt.columns:
        if col == 'year':
            continue
        print(f"    {col}: [{df_alt[col].min():.6f}, {df_alt[col].max():.6f}]")

    merged = pd.merge(df_metrics, df_alt, on='year', how='inner')

    pairs = [
        ('avg_in_degree',          'alt_efficiency',    '加权平均入度 → 加权网络效率'),
        ('avg_out_degree',         'alt_efficiency',    '加权平均出度 → 加权网络效率'),
        ('avg_clustering',         'alt_transitivity',  '加权聚类系数 → 加权网络传递性'),
        ('core_periphery',         'alt_theil',         '核心-边缘指数 → Theil熵指数'),
        ('avg_input_diversity',    'alt_shannon_div',   '投入多样性指数 → 香农熵'),
        ('avg_key_dependence',     'alt_cr3_dep',       '关键部门依赖度 → CR3'),
        ('robustness_target',      'alt_robust_rand',   '加权鲁棒性 → 随机攻击剩余流量比'),
        ('avg_spread_effect',      'alt_eigenvector',   '波及效应系数 → 加权特征向量中心性'),
        ('avg_recovery_centrality','alt_closeness',     '恢复中心性 → 加权接近中心性'),
        ('network_entropy',        'alt_gini',          '网络结构熵 → 基尼系数'),
        ('community_resilience',   'alt_participation', '网络群落韧性 → 平均参与系数')
    ]

    with open(os.path.join(robust_folder, '指标替代性检验.txt'), 'w', encoding='utf-8') as f:
        f.write("指标替代性检验 — Spearman秩相关系数（统一A口径）\n")
        f.write("=" * 60 + "\n")

        for orig, alt, desc in pairs:
            valid = merged[[orig, alt]].dropna()
            if len(valid) > 1:
                if valid[orig].std() < 1e-15 or valid[alt].std() < 1e-15:
                    f.write(f"\n{desc}\n")
                    f.write(f"  警告：序列方差为零，无法计算相关系数\n")
                    f.write(f"  原指标 std={valid[orig].std():.2e}, "
                            f"替代指标 std={valid[alt].std():.2e}\n")
                    continue

                corr, p = stats.spearmanr(valid[orig], valid[alt])
                f.write(f"\n{desc}\n")
                f.write(f"  相关系数 = {corr:.4f}, p值 = {p:.4f}\n")
                if abs(corr) > 0.7:
                    f.write("  → 高度相关，通过稳健性检验 ★★★\n")
                elif abs(corr) > 0.5:
                    f.write("  → 中等相关，基本通过 ★★\n")
                else:
                    f.write("  → 弱相关，未通过检验\n")
            else:
                f.write(f"\n{desc}\n  → 数据不足，无法计算\n")

    print("  指标替代性检验完成")
    return df_alt
# ======================== 稳健性检验：赋权方法对照（CRITIC法 + 等权法） ========================
def critic_weight_method(df, indicators):
    """
    CRITIC法 (Diakoulaki et al., 1995)
    综合两个维度：指标变异程度（标准差）+ 指标间冲突性（1 - 相关系数）
    Cⱼ = σⱼ × Σₖ(1 - rⱼₖ)
    wⱼ = Cⱼ / ΣCⱼ
    """
    data = df[list(indicators.keys())].copy()
    years_arr = df['year'].values

    # Step 1: 极差标准化（与熵权法一致，保持方向性）
    data_norm = pd.DataFrame(index=data.index)
    for col, direction in indicators.items():
        min_val, max_val = data[col].min(), data[col].max()
        if max_val == min_val:
            data_norm[col] = 0.5
        elif direction == 'pos':
            data_norm[col] = (data[col] - min_val) / (max_val - min_val)
        else:
            data_norm[col] = (max_val - data[col]) / (max_val - min_val)

    # Step 2: 各指标标准差
    sigma = data_norm.std(ddof=0)  # 总体标准差

    # Step 3: 指标间相关系数矩阵（Pearson）
    corr_matrix = data_norm.corr()

    # Step 4: 冲突性 = Σ(1 - rⱼₖ)
    n = len(indicators)
    conflict = np.zeros(n)
    for j, col_j in enumerate(indicators.keys()):
        conflict[j] = np.sum(1.0 - corr_matrix.loc[col_j].values)

    # Step 5: 信息量 Cⱼ = σⱼ × conflictⱼ
    C = sigma.values * conflict
    w = C / C.sum()

    # Step 6: 线性加权合成
    score = (data_norm * w).sum(axis=1)

    return w, score, years_arr, data_norm


def equal_weight_method(df, indicators):
    """
    等权法：所有指标等权重 (1/n)
    """
    data = df[list(indicators.keys())].copy()
    years_arr = df['year'].values
    n = len(indicators)

    # 标准化（与熵权法一致）
    data_norm = pd.DataFrame(index=data.index)
    for col, direction in indicators.items():
        min_val, max_val = data[col].min(), data[col].max()
        if max_val == min_val:
            data_norm[col] = 0.5
        elif direction == 'pos':
            data_norm[col] = (data[col] - min_val) / (max_val - min_val)
        else:
            data_norm[col] = (max_val - data[col]) / (max_val - min_val)

    w = np.ones(n) / n
    score = (data_norm * w).sum(axis=1)

    return w, score, years_arr


def weighting_robustness_test(df_metrics, indicators_direction, metric_names, robust_folder):
    """
    赋权方法对照检验：
    比较熵权法、CRITIC法、等权法三种赋权方法下的综合韧性指数，
    计算两两之间的 Pearson 和 Spearman 相关系数，并绘制对比图。
    """
    print("\n" + "=" * 60)
    print("[稳健性检验] 赋权方法对照：熵权法 vs CRITIC法 vs 等权法")
    print("=" * 60)

    if df_metrics.empty:
        print("  无有效数据，跳过赋权方法对照检验")
        return

    # --- 1. 熵权法（已计算，直接复用） ---
    w_entropy, score_entropy, years_entropy = entropy_weight_method(df_metrics, indicators_direction)

    # --- 2. CRITIC法 ---
    w_critic, score_critic, years_critic, _ = critic_weight_method(df_metrics, indicators_direction)

    # --- 3. 等权法 ---
    w_equal, score_equal, years_equal = equal_weight_method(df_metrics, indicators_direction)

    # --- 权重对比表 ---
    indicator_list = list(indicators_direction.keys())
    df_weights = pd.DataFrame({
        '指标': [metric_names[col] for col in indicator_list],
        '维度': [
            '结构韧性' if col in ['avg_in_degree', 'avg_out_degree', 'avg_clustering', 'core_periphery'] else
            '依赖韧性' if col in ['avg_input_diversity', 'avg_key_dependence', 'robustness_target'] else
            '恢复韧性' if col in ['avg_spread_effect', 'avg_recovery_centrality'] else
            '适应韧性'
            for col in indicator_list
        ],
        '熵权法权重': w_entropy,
        'CRITIC法权重': w_critic,
        '等权法权重': w_equal
    })
    df_weights.to_csv(os.path.join(robust_folder, '赋权方法权重对比.csv'), index=False, encoding='utf-8-sig')
    print("\n  三种赋权方法权重对比：")
    print(df_weights.to_string(index=False))

    # --- 综合指数对比表 ---
    df_scores = pd.DataFrame({
        '年份': years_entropy,
        '熵权法': score_entropy,
        'CRITIC法': score_critic,
        '等权法': score_equal
    })
    df_scores.to_csv(os.path.join(robust_folder, '赋权方法综合指数对比.csv'), index=False, encoding='utf-8-sig')

    # --- 两两相关系数 ---
    methods = {'熵权法': score_entropy, 'CRITIC法': score_critic, '等权法': score_equal}
    method_names = list(methods.keys())

    with open(os.path.join(robust_folder, '赋权方法对照检验.txt'), 'w', encoding='utf-8') as f:
        f.write("赋权方法对照检验 — 熵权法 vs CRITIC法 vs 等权法\n")
        f.write("=" * 60 + "\n\n")

        f.write("一、三种方法权重对比\n")
        f.write("-" * 40 + "\n")
        f.write(df_weights.to_string(index=False))
        f.write("\n\n")

        f.write("二、综合韧性指数两两相关系数\n")
        f.write("-" * 40 + "\n")

        for i in range(len(method_names)):
            for j in range(i + 1, len(method_names)):
                name_i, name_j = method_names[i], method_names[j]
                score_i, score_j = methods[name_i], methods[name_j]

                pearson_r, pearson_p = stats.pearsonr(score_i, score_j)
                spearman_r, spearman_p = stats.spearmanr(score_i, score_j)

                f.write(f"\n{name_i} vs {name_j}:\n")
                f.write(f"  Pearson 相关系数 = {pearson_r:.4f} (p = {pearson_p:.4f})\n")
                f.write(f"  Spearman 秩相关系数 = {spearman_r:.4f} (p = {spearman_p:.4f})\n")

                if spearman_r > 0.9:
                    f.write("  → 极高相关，赋权方法选择不影响核心结论 ★★★\n")
                elif spearman_r > 0.8:
                    f.write("  → 高度相关，赋权方法稳健性良好 ★★\n")
                elif spearman_r > 0.6:
                    f.write("  → 中等相关，趋势大体一致 ★\n")
                else:
                    f.write("  → 弱相关，赋权方法对结论有显著影响\n")

        # 整体评价
        f.write("\n\n三、整体评价\n")
        f.write("-" * 40 + "\n")
        # 计算三组两两Spearman均值
        spearman_vals = []
        for i in range(len(method_names)):
            for j in range(i + 1, len(method_names)):
                _, sp = stats.spearmanr(methods[method_names[i]], methods[method_names[j]])
                spearman_vals.append(sp)
        avg_spearman = np.mean(spearman_vals)
        f.write(f"三种方法两两 Spearman 秩相关系数均值 = {avg_spearman:.4f}\n")
        if avg_spearman > 0.9:
            f.write("结论：三种赋权方法所得综合韧性指数高度一致，赋权方案的选择不影响核心结论，测度框架具有极强的稳健性。\n")
        elif avg_spearman > 0.8:
            f.write("结论：三种赋权方法所得综合韧性指数趋势较为一致，赋权方案稳健性良好，核心结论可靠。\n")
        else:
            f.write("结论：不同赋权方法所得结果存在一定差异，建议在论文中同时汇报多种赋权结果作为对照。\n")

    print(f"  赋权方法对照检验结果已保存至 '{robust_folder}/' 文件夹")

    # --- 三线对比图 ---
    fig, ax = plt.subplots(figsize=(14, 7))
    ax.plot(years_entropy, score_entropy, marker='s', linestyle='-', color='#D32F2F',
            linewidth=2, markersize=5, label='熵权法')
    ax.plot(years_critic, score_critic, marker='^', linestyle='--', color='#1976D2',
            linewidth=2, markersize=5, label='CRITIC法')
    ax.plot(years_equal, score_equal, marker='o', linestyle='-.', color='#388E3C',
            linewidth=2, markersize=5, label='等权法')

    ax.set_title('不同赋权方法下的产业链综合韧性指数对比（1995—2022）', fontsize=16, fontweight='bold')
    ax.set_xlabel('年份', fontsize=13)
    ax.set_ylabel('综合韧性指数', fontsize=13)
    ax.legend(fontsize=12, frameon=True, loc='upper left')
    ax.grid(True, linestyle='--', alpha=0.5)
    ax.set_xticks(years_entropy[::2])
    ax.set_xticklabels(years_entropy[::2], rotation=45)

    # 标注相关系数
    spearman_ew_critic, _ = stats.spearmanr(score_entropy, score_critic)
    spearman_ew_equal, _ = stats.spearmanr(score_entropy, score_equal)
    textstr = (f'熵权 vs CRITIC Spearman ρ = {spearman_ew_critic:.3f}\n'
               f'熵权 vs 等权  Spearman ρ = {spearman_ew_equal:.3f}')
    props = dict(boxstyle='round,pad=0.5', facecolor='wheat', alpha=0.7)
    ax.text(0.02, 0.98, textstr, transform=ax.transAxes, fontsize=11,
            verticalalignment='top', bbox=props)

    plt.tight_layout()
    plt.savefig(os.path.join(robust_folder, '赋权方法对比图.png'), dpi=300, bbox_inches='tight')
    plt.close()
    print("  赋权方法对比图已保存")

    return df_scores, df_weights
# ======================== 稳健性检验：缩尾处理检验 ========================
def winsorize_series(series, lower_percentile=0.01, upper_percentile=0.99):
    """
    对序列做缩尾处理：将低于下分位数和高于上分位数的值分别替换为边界值。
    默认双侧各缩1%。
    """
    lower = np.percentile(series, lower_percentile * 100)
    upper = np.percentile(series, upper_percentile * 100)
    return np.clip(series, lower, upper)
def winsorization_robustness_test(df_metrics, indicators_direction, metric_names, robust_folder,
                                  lower_pct=0.01, upper_pct=0.99):
    """
    缩尾处理稳健性检验：
    1. 对每个原始指标序列做双侧缩尾
    2. 基于缩尾后指标重新用熵权法合成综合韧性指数
    3. 与原始熵权法指数做对比（Pearson / Spearman 相关系数、趋势图）
    同时也汇报缩尾前后各指标被压缩的极值比例，便于评估缩尾幅度是否合理。
    """
    print("\n" + "=" * 60)
    print(f"[稳健性检验] 缩尾处理检验（双侧 {lower_pct*100:.0f}%—{upper_pct*100:.0f}%）")
    print("=" * 60)
    if df_metrics.empty:
        print("  无有效数据，跳过缩尾处理检验")
        return
    years = df_metrics['year'].values
    indicator_cols = list(indicators_direction.keys())
    # --- 1. 构造缩尾后的指标 DataFrame ---
    df_winsor = df_metrics.copy()
    winsor_info = []  # 记录每个指标被压缩的极值数量
    for col in indicator_cols:
        orig = df_metrics[col].values
        lower_bound = np.percentile(orig, lower_pct * 100)
        upper_bound = np.percentile(orig, upper_pct * 100)
        n_low = np.sum(orig < lower_bound)
        n_high = np.sum(orig > upper_bound)
        winsor_info.append({
            '指标': metric_names[col],
            '下界': lower_bound,
            '上界': upper_bound,
            '被压缩的低端值个数': n_low,
            '被压缩的高端值个数': n_high,
            '总年数': len(orig)
        })
        df_winsor[col] = winsorize_series(orig, lower_pct, upper_pct)
    # 打印缩尾信息
    df_winsor_info = pd.DataFrame(winsor_info)
    print("\n  缩尾处理详情（各指标被压缩极值情况）：")
    print(df_winsor_info.to_string(index=False))
    # --- 2. 基于缩尾数据重新做熵权法 ---
    w_winsor, score_winsor, years_winsor = entropy_weight_method(df_winsor, indicators_direction)
    # --- 3. 与原始熵权法结果对比 ---
    # 原始熵权法指数（复用函数）
    w_orig, score_orig, years_orig = entropy_weight_method(df_metrics, indicators_direction)
    # 相关系数
    pearson_r, pearson_p = stats.pearsonr(score_orig, score_winsor)
    spearman_r, spearman_p = stats.spearmanr(score_orig, score_winsor)
    print(f"\n  原始 vs 缩尾后综合韧性指数：")
    print(f"    Pearson  r = {pearson_r:.4f} (p = {pearson_p:.4g})")
    print(f"    Spearman ρ = {spearman_r:.4f} (p = {spearman_p:.4g})")
    # --- 4. 保存结果 ---
    # 缩尾后指数
    df_score_winsor = pd.DataFrame({
        '年份': years_winsor,
        '缩尾后综合韧性指数': score_winsor
    })
    df_score_winsor.to_csv(os.path.join(robust_folder, '缩尾处理后综合韧性指数.csv'),
                           index=False, encoding='utf-8-sig')
    # 原始与缩尾对比表
    df_compare = pd.DataFrame({
        '年份': years_orig,
        '原始熵权法指数': score_orig,
        '缩尾后熵权法指数': score_winsor
    })
    df_compare.to_csv(os.path.join(robust_folder, '缩尾处理对比.csv'),
                      index=False, encoding='utf-8-sig')
    # 缩尾信息表
    df_winsor_info.to_csv(os.path.join(robust_folder, '缩尾处理详情.csv'),
                          index=False, encoding='utf-8-sig')
    # 文本报告
    with open(os.path.join(robust_folder, '缩尾处理检验.txt'), 'w', encoding='utf-8') as f:
        f.write(f"缩尾处理稳健性检验（双侧 {lower_pct*100:.0f}%—{upper_pct*100:.0f}%）\n")
        f.write("=" * 60 + "\n\n")
        f.write("一、各指标缩尾边界与压缩情况\n")
        f.write("-" * 40 + "\n")
        f.write(df_winsor_info.to_string(index=False))
        f.write("\n\n")
        f.write("二、原始 vs 缩尾后综合韧性指数相关系数\n")
        f.write("-" * 40 + "\n")
        f.write(f"  Pearson  r = {pearson_r:.4f} (p = {pearson_p:.4g})\n")
        f.write(f"  Spearman ρ = {spearman_r:.4f} (p = {spearman_p:.4g})\n\n")
        if spearman_r > 0.95:
            f.write("结论：缩尾处理后综合韧性指数与原始结果高度一致（ρ > 0.95），"
                    "表明极端值对综合测度结果的影响极小，测度框架具有极强的稳健性 ★★★\n")
        elif spearman_r > 0.9:
            f.write("结论：缩尾处理后综合韧性指数与原始结果高度相关（ρ > 0.9），"
                    "极端值未改变核心结论，结果稳健 ★★\n")
        elif spearman_r > 0.8:
            f.write("结论：缩尾处理前后趋势大体一致（ρ > 0.8），"
                    "但个别年份受极值影响略有波动，整体结论仍稳健 ★\n")
        else:
            f.write("结论：缩尾处理对综合韧性指数产生了较明显影响，"
                    "建议关注极端值较多年份的数据质量\n")
    # --- 5. 双线对比图 ---
    fig, ax = plt.subplots(figsize=(14, 7))
    ax.plot(years_orig, score_orig, marker='s', linestyle='-', color='#D32F2F',
            linewidth=2, markersize=5, label='原始熵权法')
    ax.plot(years_winsor, score_winsor, marker='^', linestyle='--', color='#1976D2',
            linewidth=2, markersize=5, label=f'缩尾后熵权法 ({lower_pct*100:.0f}%—{upper_pct*100:.0f}%)')
    ax.set_title('缩尾处理前后综合韧性指数对比', fontsize=16, fontweight='bold')
    ax.set_xlabel('年份', fontsize=13)
    ax.set_ylabel('综合韧性指数', fontsize=13)
    ax.legend(fontsize=12, frameon=True, loc='upper left')
    ax.grid(True, linestyle='--', alpha=0.5)
    ax.set_xticks(years_orig[::2])
    ax.set_xticklabels(years_orig[::2], rotation=45)
    # 图内标注
    textstr = (f'Pearson r = {pearson_r:.4f}\n'
               f'Spearman ρ = {spearman_r:.4f}')
    props = dict(boxstyle='round,pad=0.5', facecolor='lightblue', alpha=0.7)
    ax.text(0.98, 0.03, textstr, transform=ax.transAxes, fontsize=11,
        verticalalignment='bottom', horizontalalignment='right', bbox=props)
    plt.tight_layout()
    plt.savefig(os.path.join(robust_folder, '缩尾处理对比图.png'), dpi=300, bbox_inches='tight')
    plt.close()
    print("  缩尾处理对比图已保存")
    return df_compare, df_winsor_info

# ======================== 运行稳健性检验 ========================
if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("开始稳健性检验（统一A口径）")
    print("=" * 60)

    valid_years = df_metrics['year'].tolist()
    A_dict = rebuild_A_dict(folder, valid_years)
    print(f"成功重建 {len(A_dict)} 个年份的A矩阵（直接消耗系数）")

    # 稳健性检验1：指标替代性检验
    alternative_indicators_test(df_metrics, A_dict)

    # 稳健性检验2：缩尾处理检验（新增/恢复）
    winsorization_robustness_test(df_metrics, indicators_direction, metric_names, robust_folder)

    # 稳健性检验3：赋权方法对照检验
    print("\n" + "=" * 60)
    print("开始赋权方法对照稳健性检验")
    print("=" * 60)
    weighting_robustness_test(df_metrics, indicators_direction, metric_names, robust_folder)

    print("\n" + "=" * 60)
    print("全部稳健性检验完成，结果已保存至 '稳健性检验/' 文件夹")
    print("=" * 60)

# ======================== 维度组合图 ========================
output_folder = "维度组合图"
os.makedirs(output_folder, exist_ok=True)

dimension_groups = {
    '结构韧性': ['avg_in_degree', 'avg_out_degree', 'avg_clustering', 'core_periphery'],
    '依赖韧性': ['avg_input_diversity', 'avg_key_dependence', 'robustness_target'],
    '恢复韧性': ['avg_spread_effect', 'avg_recovery_centrality'],
    '适应韧性': ['network_entropy', 'community_resilience']
}

if not df_metrics.empty:
    for dim_name, indicators in dimension_groups.items():
        n_plots = len(indicators)
        cols = n_plots if n_plots <= 3 else int(math.ceil(math.sqrt(n_plots)))
        rows = int(math.ceil(n_plots / cols))

        fig, axes = plt.subplots(rows, cols, figsize=(5 * cols, 4 * rows))
        axes = np.atleast_1d(axes).flatten()

        for idx, col in enumerate(indicators):
            axes[idx].plot(df_metrics['year'], df_metrics[col], marker='o', linestyle='-')
            axes[idx].set_title(metric_names[col], fontsize=12)
            axes[idx].set_xlabel('年份', fontsize=10)
            axes[idx].set_ylabel(metric_names[col], fontsize=10)
            axes[idx].grid(True, linestyle='--', alpha=0.7)

        for idx in range(n_plots, len(axes)):
            axes[idx].axis('off')

        plt.suptitle(f'{dim_name}指标随时间变化', fontsize=16)
        plt.tight_layout()
        plt.savefig(os.path.join(output_folder, f'{dim_name}.png'), dpi=300)
        plt.close()

    print(f"\n维度组合图已保存至 '{output_folder}/' 文件夹")
else:
    print("\n警告：df_metrics 为空，跳过组合图绘制")