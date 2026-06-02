# 指标字典 / Indicator Dictionary

> 四维度十指标的完整定义、公式与经济含义（路径 A）。配合 [`code/resilience_measurement.py`](../code/resilience_measurement.py) 阅读。
>
> Complete definitions, formulas, and economic meanings of the 4-dimension, 10-indicator system (Track A). Read alongside [`code/resilience_measurement.py`](../code/resilience_measurement.py).

记号 / Notation：$A=[a_{ij}]$ 直接消耗系数矩阵（列归一）；$B=[b_{ij}]$ 分配系数矩阵（行归一）；$L=(I-A)^{-1}$ 列昂惕夫逆矩阵；$W$ 为统一的系数边权矩阵；$n$ 为部门数。

---

## 一、结构韧性 / Structural Resilience

### 1. 加权平均度 / Weighted Average Degree （方向 +）

$$\bar{d}^{in}=\frac{1}{n}\sum_j \sum_i w_{ij},\qquad \bar{d}^{out}=\frac{1}{n}\sum_i \sum_j w_{ij}$$

- **入强度**（列和）= 部门后向关联系数，衡量每单位产出所依赖的上游技术投入。
- **出强度**（行和）= 部门前向关联系数，衡量作为供应商被下游依赖的程度。
- 平均度越高 → 技术关联越广泛均衡 → 冗余与替代弹性越强 → 结构韧性越高。

### 2. 加权聚类系数 / Weighted Clustering Coefficient （方向 +）

采用 Fagiolo (2007) 有向加权版本，刻画部门 $i$ 的上下游之间"三角备份关系"的紧密程度。聚类系数越高 → 局部冗余越强 → 某条供应链中断时越易经邻居形成替代路径。

### 3. 核心–边缘指数 / Core–Periphery Index （方向 −）

$$CP=\frac{\sum_{i,j\in C} w_{ij}}{\sum_{i,j} w_{ij}},\quad C=\text{总强度排名前 20\% 的核心节点}$$

核心部门间流量占全网流量之比。指数越**低** → 核心集中度越低、结构越均衡 → "鲁棒却脆弱"风险越小（Wang & Huang, 2025）。

---

## 二、依赖韧性 / Dependence Resilience

### 4. 投入多样性指数 / Input Diversity （方向 +）

$$D_j=\frac{\left(\sum_i w_{ij}\right)^2}{\sum_i w_{ij}^2}\ \text{(逆 HHI)},\qquad \bar{D}=\frac{1}{n}\sum_j D_j$$

赫芬达尔指数的倒数 = 部门 $j$ 的"有效上游供应商数"。越大 → 投入来源越分散 → 越能避免单一供应商中断引发的连锁反应（Elliott et al., 2022; Li et al., 2025）。

### 5. 关键部门依赖度 / Key-Sector Dependence （方向 −）

$$K_j=\frac{\max_i w_{ij}}{\sum_i w_{ij}},\qquad \bar{K}=\frac{1}{n}\sum_j K_j$$

最大单一供应商占比 = "单点依赖"风险。越小 → 上游越分散 → 单点故障风险越低 → 依赖韧性越强。

### 6. 加权鲁棒性 / Weighted Robustness （方向 +）

$$R=\frac{\sum_{(i,j)\in E'} w'_{ij}}{\sum_{(i,j)\in E} w_{ij}}\ \text{(冲击后剩余流量 ÷ 冲击前总流量)}$$

对比**定向攻击**（优先移除核心节点）与**随机攻击**后的 $R$：定向冲击下 $R$ 下降越少 → 对核心节点依赖越低 → 结构韧性越优（何宇等, 2024; Kancs, 2024）。

---

## 三、恢复韧性 / Recovery Resilience

### 7. 波及效应系数 / Spread Effect （方向 −）

$$S_j=\sum_i l_{ij}\ \text{(列昂惕夫逆矩阵列和)},\qquad \bar{S}=\frac{1}{n}\sum_j S_j$$

部门 $j$ 单位最终需求变动对全产业链的完全（直接+间接）影响总和。越小 → 冲击传导范围越窄 → 产业链恢复越容易。

### 8. 恢复中心性 / Recovery Centrality （方向 +）

基于列昂惕夫逆矩阵行归一构建转移概率矩阵 $P$，求稳态分布 $\pi$ 与平均首达时间矩阵 $H$：

$$RC_i=\frac{1}{\sum_j \pi_j H_{ji}},\qquad \overline{RC}=\frac{1}{n}\sum_i RC_i$$

恢复信号（随机游走）传播效率。越大 → 各部门协同恢复能力越强（Zelenkovski et al., 2023）。

---

## 四、适应韧性 / Adaptation Resilience

### 9. 网络结构熵 / Network Structure Entropy （方向 +）

$$H=-\sum_{(i,j)} p_{ij}\ln p_{ij},\qquad p_{ij}=\frac{w_{ij}}{\sum_{kl} w_{kl}}$$

归一化边权分布的香农熵。熵越高 → 权重分布越均匀、结构越多样 → 长期适应能力越强（耗散结构理论）。

### 10. 网络群落韧性 / Modular Resilience （方向 +）

$$MR=\frac{Q_t}{\ln m_t}$$

$Q_t$ 为加权模块度（Newman, 2006），$m_t$ 为群落数，除以 $\ln m$ 消除群落数量的规模影响。反映模块化结构与演化潜力（徐维祥等, 2022）。

---

## 指标方向汇总 / Direction Summary

| 维度 | 指标 | 方向 | 替代指标（稳健性）|
|---|---|:-:|---|
| 结构 | 加权平均度 | + | 加权网络效率 |
| 结构 | 加权聚类系数 | + | 加权传递性 |
| 结构 | 核心–边缘指数 | − | Theil 熵指数 |
| 依赖 | 投入多样性 | + | 香农熵 |
| 依赖 | 关键部门依赖度 | − | CR3 集中率 |
| 依赖 | 加权鲁棒性 | + | 随机攻击剩余流量比 |
| 恢复 | 波及效应系数 | − | 特征向量中心性 |
| 恢复 | 恢复中心性 | + | 接近中心性 |
| 适应 | 网络结构熵 | + | 基尼系数 |
| 适应 | 网络群落韧性 | + | 平均参与系数 |

> 方向 `+` 表示数值越大韧性越强；`−` 表示数值越大韧性越弱（合成综合指数时反向标准化）。
> Direction `+`: higher = more resilient; `−`: higher = less resilient (reverse-normalized in synthesis).
