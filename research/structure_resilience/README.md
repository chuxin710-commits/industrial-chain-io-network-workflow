# 产业链网络结构视角下我国产业韧性研究

## 研究介绍

本案例保留原论文的复杂网络、系统动力学与容量级联框架，使用新 MRIO 数据重建实证。核心问题是：全国行业网络具有怎样的结构，结构重要行业是否也是模型中状态稳定的行业，以及局部节点失效会在怎样的容量假设下放大。

理论链条为 **投入产出依赖 → 完全需求联系 → 结构诊断 → 条件动力学响应 → 容量失效实验**。这里区分结构重要性、末态一致性、活动水平和级联稳健性，不把它们当作同一个“韧性分数”。

样本为 2009–2023 年全国 42 行业，来自 31 省 × 42 行业的年度 MRIO 聚合。保留 S01–S42。实证结果表明，主设定下末态指标存在明显饱和，必须同时报告共同初值敏感性和低活动比例；因此本案例也展示了如何识别模型指标的解释局限，而不是只发布显著结果。

## 阅读和运行

- [理论、公式、参数](METHODS.md)
- [结果、结论及不能推出的结论](RESULTS.md)
- [公开结果摘要和复算版本](published/)
- [输入数据契约](../DATA_CONTRACT.md)

在仓库根目录安装研究依赖后：

```sh
python research/run_case.py structure_resilience --synthetic --output outputs/structure-demo-01
python research/run_case.py structure_resilience --data-root "D:/private/MRIO" --output outputs/structure-real-01
python research/structure_resilience/test_model.py
```

完整复算顺序：主实验 → 共同初值扩展 → 独立矩阵聚合/配对检验/回归核验。运行入口还执行 13 项模型测试。完整结果保存在指定本地输出目录；本案例不是 `ionet` 稳定 API 的组成部分。

## 与合并论文的关系

本案例提供结构诊断和对“模拟韧性”解释的反思。[合并论文](../critical_sectors/README.md)进一步把研究重点转向结构排名的外部检验，即排名能否预测统一定义的冲击损失，以及有约束恢复是否有效。两案的网络分别由 L 和 A 构造，主阈值、效率定义和动力学模型不同，不应混用数值。
