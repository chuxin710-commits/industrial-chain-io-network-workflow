# 两篇论文的可复用研究案例

本目录将论文的研究问题、理论口径、算法、实验和结果摘要连在一起。它是研究案例层，不是 `ionet` 稳定公共 API，也不是经外部同行评审的最终论文版本。两个案例保留各自的数学对象，不能把指标数值直接拼接。

| 案例 | 论文与问题 | 主要方法 | 文档 |
| --- | --- | --- | --- |
| `structure_resilience` | 《产业链网络结构视角下我国产业韧性研究》：网络结构与条件稳定性有何关系？ | 完整 Leontief 逆、结构诊断、互惠 ODE、容量级联、描述性面板分析 | [介绍](structure_resilience/README.md) · [理论方法](structure_resilience/METHODS.md) · [结果](structure_resilience/RESULTS.md) |
| `critical_sectors` | 《投入产出网络中关键行业识别与产业链韧性提升：基于结构诊断和冲击模拟》：结构重要性是否等于冲击重要性？相同预算下如何恢复？ | 直接投入网络、两种冲击口径、排名对照、有约束恢复、辅助 SIR | [介绍](critical_sectors/README.md) · [理论方法](critical_sectors/METHODS.md) · [结果](critical_sectors/RESULTS.md) |

原有《中国产业链韧性测度及提升路径研究》的“结构指标 + 传播动力学”路线，通过第二个案例的 `legacy_sir.py` 保留并明确参数。这里没有把旧论文的结果冒充新样本结果；仓库根目录的历史 Workflow 仍单独保留。

## 先跑通合成案例

在仓库根目录，使用 Python 3.10 或更高版本：

```sh
python -m venv .venv
# 激活虚拟环境后：
python -m pip install -e ".[dev,research]"
python research/run_case.py structure_resilience --synthetic --output outputs/structure-demo-01
python research/run_case.py critical_sectors --synthetic --output outputs/critical-demo-01
python research/test_runner.py
```

Windows 可将 `python` 替换为 `.venv/Scripts/python.exe`；Linux/macOS 为 `.venv/bin/python`。
独立 ZIP 解压后使用 `python -m pip install -r research/requirements.txt`，再执行对应案例命令。每个 ZIP 仅包含一个案例，另一个案例的文档链接不适用；完整导航请访问 GitHub 仓库。

合成案例是四节点人工网络，只验证代码链路，不生成论文中中国行业的结论。每次运行自动执行该案例的模型单元测试，输出 `model_tests.txt`、`run_manifest.json`、示例结果及验证记录。输出目录必须不存在，不覆盖旧证据；失败状态也会留存。不要使用 `python -O`。

## 用有权使用的 MRIO 数据复算

```sh
python research/run_case.py structure_resilience --data-root "D:/private/MRIO" --output outputs/structure-real-01
python research/run_case.py critical_sectors --data-root "D:/private/MRIO" --output outputs/critical-real-01
```

输入目录和必需字段见[数据契约](DATA_CONTRACT.md)。实证程序固定复算 2009–2023 年，原始 31 省 × 42 行业汇总为全国 42 行业；不是运行文件夹全部 2000–2023 年。正式入口是 `run_case.py`，不要直接运行保留默认路径的内部脚本。

第一案依次完成主实验、共同初值敏感性、独立核验；第二案依次完成冲击/恢复实验、简单指标对照、并列值诊断和独立核验。结果中的 `aggregated/`、行业面板和金额必须留在本地，不能因为程序生成成功就上传。

## 内容和复用边界

- `published/`：通过白名单导出的无金额结果摘要、参数、依赖版本与文件哈希，不包含原始数据或可直接复建交易矩阵的聚合表。
- `model.py`、`legacy_sir.py`：保留本轮论文的研究内核。通用化之前应补充更多异常输入测试，不承诺任意数据集均适用。
- `run_experiments.py` 与扩展脚本：特定 42 行业、15 年样本的完整复算程序，不是数据格式自动适配器。
- `test_model.py`、`test_runner.py`：模型与运行入口测试；GitHub Actions 只运行合成数据，不托管或索取私有 MRIO。
- `export_public.py`：仅从成功的完整实证运行中导出选定摘要；`build_bundles.py`：生成独立源代码 ZIP 和 SHA256 清单。

保留 S01–S42，不猜行业名称。金额单位、价格口径和 2D-LQ 编制来源尚未补齐。文中“损失”“恢复”“时间”均须结合案例定义理解，不等于实测产值损失、财政支出或日历时间。

## 敏捷扩展顺序

1. 当前版本：两个案例可独立阅读、安装、合成运行，原始数据持有者能完整复算。
2. 下一小步：补齐来源元数据和行业代码表，再决定是否增加面向真实行业名称的解释。
3. 后续小步：按独立议题增加替代阈值、外样本验证、其他冲击或实际成本约束；每次同时提交方法变更说明、针对性测试及前后结果差异。
4. 只有跨案例契约、反例和测试充分的函数才迁入 `src/ionet/`，避免论文假设变成课题组默认事实。

参见 [本次发布与验证记录](../docs/RESEARCH_CASES_V1.md) 和 [贡献规则](../CONTRIBUTING.md)。
