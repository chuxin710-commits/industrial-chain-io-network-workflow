# 科学计算内核审计与迁移门禁

审计日期：2026-09-30。范围为桌面 MRIO 工作区的 `empirical_redo/model.py`、`run_experiments.py`、`test_model.py`、`validate_results.py`、`METHODS.md`，以及已克隆仓库的两份 `code/` 脚本。下文 `empirical_redo/` 行号属于该桌面工作区，并非远端仓库已包含的文件；`code/` 行号属于当前仓库。本次不修改历史源码、数据或结果，不运行全量实证；新库网络层另行实现和测试，尚未提交或推送。

## 结论与证据强度

原项目是有清晰研究边界的论文复现工作流，不是已具备通用输入契约的课题组软件包。保留其已验证的核心公式和历史结果；将特定论文假设作为命名明确的 legacy 插件；先修复输入、输出及测试契约，再扩展经济功能模型。不能仅重排目录后宣称支持任意 MRIO 数据或 1302 节点逐节点传播。

- 已执行：捆绑 Python 3.12 下 10 项现有单元测试通过；只读边界探针复现以下缺陷。
- 已观察：PATH 的 `python` 为 Python 3.9；`model.py:10-12` 自动插入 `.runtime` 中的 CPython 3.12 NumPy，测试导入失败。此为环境兼容风险，不是原算法测试失败。
- 未执行：全量实证、实际产能级联、Leontief 产出损失、GitHub CI。文档中的历史 19 项检查不应当作本次新执行的证据。
- 未证实：数据可公开再分发的授权、行业名称映射、实际时间标定；没有为其补造信息。

## 优先发现

| 编号 | 风险与实际证据 | 现有常用实验的影响边界 |
|---|---|---|
| K-01 / 高 | `run_experiments.py:15-19` 只比对 Z 行标签与 X 标签，既不检查 Z 列标签顺序，也不检查重复标签。模拟两行表，Z 列为 `[b,a]` 而行为 `[a,b]`，`load()` 原样返回矩阵，后续按 `[a,b]` 解释列，导致依赖方向和归一化错位。 | 未证明现有聚合表存在错序；这是新增适配器必须阻断的输入风险。 |
| K-02 / 高 | `model.py:19-29` 不拒绝负值和非有限 Z。探针 `Z=[[0,-1],[1,0]], X=[10,10]` 得到负边且 `cohesion=0.05`；负边在距离处理中被静默当作无边，strength/exposure 却仍可计入。`inf` 也被接受。 | 原数据审计声明拒绝负 Z（`METHODS.md:19`），但独立公共函数没有这一门禁。不能假设第三方调用已预审计。 |
| K-03 / 高 | `model.py:136-157`：`strong,k=0` 的 `[-0:]` 选取所有正边；`weak,k=0` 没有选边却返回正 `added_Z`。探针三节点非对角总交易额10、预算5%时，weak 报告新增0.5、实际新增0。全零网络还触发除零。 | 现有主实验默认 k=5（`run_experiments.py:113`），未证明历史预算结果受此问题影响。最小修复先拒绝 strong/weak 的非正整数 k；不要顺手改变 k=5 选边、并列排序和成本口径。 |
| K-04 / 中 | `model.py:93-105` 在观察期内未捕捉峰值事件时一律回报 `i0`。`sir(1,.05,horizon=.1)` 返回 `peak_I=.03`，但 `terminal_I=.03282041285086863`，所报峰值低于已观察感染值。 | 适用于截断/删失且仍增长的情景；现有年度结果是否受影响需另核查，不据探针推翻全部历史数值。 |
| K-05 / 中 | `model.py:71-76` 未校验标定目标；`beta0=0` 除零，`beta0=2` 生成 `k_beta=-.5`。`sir:81-85` 只检查部分符号，未显式约束有限值、正 horizon/tolerance 或阈值与初始状态关系。 | 当前固定 `.30/.10` 合法；公共参数入口必须先检查，不允许把坏配置交给数值求解器。裸 SIR 的 beta/gamma 是率，不应为了饱和映射就错误限制所有裸率小于1。 |
| K-06 / 中 | `model.py:62` 对单节点图执行 `(n-1)*(n-2)/(n*(n-1))` 除零；`shock:128-132` 对整数数组原位乘小数抛出类型转换错误。 | 当前42/31节点且 CSV 转浮点通常不触发；玩具教学、零节点过滤及小图回归会触发。 |
| K-07 / 中 | `validate_results.py:28,31-44,49-54,57-61` 和 `run_experiments.py:18` 大量使用 `assert`，`python -O` 会移除这些检查。总行数不是完整笛卡尔积验证；等预算验证仅比较自报 `added_Z`（`validate_results.py:64-68`），不独立重算新增交易。 | 当前常规运行可以检查；不适合自称“fail-closed”的通用验收器。部分 `np.testing.assert_allclose` 在 -O 下仍执行，不能说所有检查都被关闭。 |
| K-08 / 中 | `run_experiments.py:11-12,22-23,52-56` 固定输出目录和年份；分阶段运行也写 calibration 文件。`validate_results.py:90-94,124-127` 验证过程会覆盖历史日志和清单。 | 并发研究任务容易互相覆盖。默认输出应独立 run_id；历史验证应有不写入模式。 |

## Keep / Adapt / Quarantine

| 原实现 | 决定 | 理由与迁移约束 |
|---|---|---|
| `weights`、有向 reciprocal-cost 距离、全局效率（`model.py:19-40`） | adapt | 保留公式，补完整输入契约；区分完整投入系数 A 和清零自环的网络 W；NetworkSystem 必须记录 normalization/方向/阈值。 |
| 固定原网络有序对分母的节点删除重要性（`model.py:50-68`） | keep + adapt | 防止删除低效节点造成归一化收益；补0/1节点约定、手算小图测试及原始未归一化损失；不能当作 GDP 重要性。 |
| NetworkX 与 SciPy 独立路径验证（`test_model.py:11-18`、`validate_results.py:76-85`） | keep | 独立后端核验真实小图具有价值；添加逆向图、断连、重新排序和阈值测试。 |
| 饱和参数映射 + 均质 SIR（`model.py:71-122`） | quarantine 为 legacy 插件 | 保存可复现条件模拟；不是实际疫情参数、行业逐边传播或产能级联。方法边界见 `METHODS.md:7,57,69-71`。 |
| literal 公式分支（`model.py:41-46,57-58`） | quarantine 为展开式对照 | 原公式有歧义，不作为默认科学口径；与主分支共用名称会误导。保留其删失作为历史敏感性结果。 |
| 固定 X 的行列交易折减（`model.py:125-133`） | adapt 为 `incident_transaction_scale` | 交叉单元只乘一次已测试；不是产出内生调整或供应与需求侧分开的冲击。不要命名为 capacity cascade。 |
| strong/weak/uniform 交易增加（`model.py:136-157`） | adapt 为拓扑压力工具 | 拒绝空选边且正预算，明确现存边而非补零边；记录实际交易增量、选择依据与会计可行性状态。不能叫最优投资配置。 |
| 年度、冲击、政策、参数网格编排（`run_experiments.py:47-145`） | adapt | 由配置提供年份、路径、模型、预算；输出隔离和重入。原脚本留作历史复现入口。 |
| 现有10项测试（`test_model.py`） | keep | 作为一组 legacy characterization；不能据此声称完整通用包覆盖。 |
| 历史数字和图表 | quarantine 为有来源的研究快照 | 不自动装入默认教学数据集，不因迁移而重新覆写；发布前单独确认再分发许可。 |

## 统一对象：最少必要字段与不可混用规则

以下为实现建议，不声称这些类型已存在。遵循计划书的四类对象，不先增加插件框架、数据库或复杂抽象。

1. **IOSystem**：`Z, x, y, A, L, sectors, countries, year, metadata`。允许未知 y 或尚未计算 L 为显式 `None`；缺少经济功能必要量时相关模型拒绝运行，不补零伪装已知。A 保留对角线并以 `A_ij=Z_ij/x_j` 定义；L 仅在模型需要时计算/求解，不强制每份 MRIO 常驻 dense inverse。metadata 含节点顺序、币种/金额单位/价格基期/行业分类/来源/许可/聚合层级，未知值为 unknown，不猜测。适配器接受原始零产出节点的条件应明确：对应 Z 行列确实为零；网络转换对这些节点采用显式保留/排除政策，不能静默改变人口分母。
2. **NetworkSystem**：`graph, matrix, node_metadata, edge_metadata, threshold, normalization`；附 `source_io_id, node_order, level, direction, self_loop_policy`。matrix 是用于网络分析的 W，不是经济 A 的别名。方向为 supplier row -> consumer column。`threshold` 记录作用于 Z 还是 A/W、数值、单位及 `<`/`<=` 约定；稀疏化必须保存删除交易份额、边数和可达性变化。
3. **ShockScenario**：`name, target, type, magnitude, duration, recovery, metadata`。target 使用稳定的节点 ID，不允许把列表位置当跨年行业编码。type 区分供应产能、需求、边交易压力；只有 legacy 适配器解释 `remaining`，公共 magnitude 的“损失比例”与“剩余比例”不得共用一个无标签数字。冲击生成与传播/恢复演化分离，未实现 duration/recovery 的模型须显式拒绝非默认值。
4. **SimulationResult**：`history, output_loss, topology, resilience, recovery_time, metadata`。SIR 的 history 是 S/I/R/感染负担，不是节点产出轨迹；`output_loss=None` 并附 unsupported 状态，不能填0。legacy recovery_time 是模型时间阈值事件；economic 模型的时间与恢复标准另行定义。metadata 记录模型 ID/版本/完整 config/源数据哈希/基准校准年/代码版本/实际终止时刻/删失/警告。

最小模型接口建议为 `run(io_system, network_system, shock, config) -> SimulationResult` 加一个模型能力描述（接受何种冲击、是否输出产出历史、单位、是否支持恢复）。无需先实现动态插件注册；初期一个明确路由表足够。`legacy_homogeneous_sir_efficiency_v1` 与 `legacy_literal_comparator_v1` 单独命名；未知 model_id 抛 `NotImplementedError`，不能回落到默认模型。IO/Network 的验证在入路由前统一执行，模型只做自身额外前提验证。

## 科学解释与扩展门禁

- **拓扑维度**：C、可达性、中心性、节点删除损失描述网络结构。共同货币缩放不变已经有测试，但相对价格变化仍可能改变系数（`METHODS.md:39`）。其变化不等于经济产出、增加值或福利损失。
- **经济维度**：当前只有 X_share（`run_experiments.py:68-70`），可作规模暴露代理，不是冲击乘数或经济损失。计划书二维分类先展示“经济规模暴露 × 网络删除重要性”；在功能模型验收前不要把第一轴改称因果经济重要性。
- **功能韧性**：需要独立的经济功能 history、基准产出、明确损失聚合与时间积分。不能从 SIR 累计受影响比例反推 output_loss，也不能用 `ICR=C/T` 冒充产出曲线面积。
- **政策可行性**：原政策报告完整 A 的最大列和（`run_experiments.py:117`），这一点应保留。超过1仅能标记超出当前固定 X 国内中间投入约束；列和不超过1也不是完整会计平衡证明。正式经济建议还需非负/可解释剩余项目、平衡状态、技术约束、预算单位及模型适用性。固定交易额不能自动解释成投资成本（`METHODS.md:83`）。
- **恢复与损失分离**：T 变短可能因为快速广泛感染；同时看 peak_I、ever_affected、burden，而非只比较 ICR（`METHODS.md:35,69-71`）。由 C 同时构造抵抗与 gamma 的相关性不能当作两项独立证据。
- **可扩展性**：`structure()` 为每个节点重算 Floyd-Warshall（`model.py:27-29,54-56`），总体工作量量级 O(n^4)。1302节点逐节点删除不可据42节点成功直接承诺。先测耗时/内存，讨论采样、近似或替代重要性时必须另建方法 ID 和精度对照，而不是暗改公式。

## 小 Ticket 与逐次验收

每张 ticket 一个可审阅 PR，先失败用例，再最小实现，再独立检查；原数据和 legacy 快照不变。所列都是建议 backlog，未标为已完成。

| Ticket | 可独立实施范围 | 必须验收的证据 | 合并阻断 |
|---|---|---|---|
| SCI-01 | 新输入契约 + 玩具 IO 表，不改 legacy 数值内核 | 方阵/有限值/非负 Z/长度/双轴标签唯一与一致；合法重排可正确对齐；重复与缺标签拒绝；整数输入不被意外截断；原数组不变；币值同步缩放不变。 | 任一错位输入被静默解释、私自裁剪负 F/VA 或猜行业名称。 |
| SCI-02 | 新库 policy 包装或最小 k 门禁 | strong/weak k=0、负数、非整数拒绝；k=5 与旧源码在密集/稀疏/并列边上逐元素一致；实际增量等于新增额，零预算明确 no-op；空正边网络明确拒绝正预算。 | 仍存在报账新增与实际矩阵不一致；改变历史常用 k=5 而无方法版本。 |
| SCI-03 | 截断 SIR 峰值修复及参数配置 | peak 至少覆盖初始、终点和已捕捉峰值；短 horizon 用例重现并修复；beta=0解析衰减；概率守恒/单调性；删失 T/ICRC 保留缺失；默认 `.3/.1` T/burden 与旧值容差一致。 | 峰值低于已观察状态，伪造删失恢复时间，或用 days 替代 model_time。 |
| SCI-04 | legacy 模型到四对象的薄适配 | 不改变默认公式；功能 output_loss 为 unsupported 而非0；duration/recovery 不支持就拒绝；未知模型不自动fallback；基准校准 metadata 稳定。 | 把均质 SIR 当作逐行业网络感染、产能传播或损失曲线。 |
| SCI-05 | 独立只读验证与输出隔离 | `python` 与 `python -O` 门禁同样有效；完整 scenario 主键集合而非仅总行数；新运行目录不覆盖旧结果；验证不改日志/源哈希；一项被破坏的字段能明确失败。 | CI 静默省略数据约束，或并行任务写同一路径。 |
| SCI-06 | 首个功能模型，只用已授权玩具数据 | 先书面定义供应/需求冲击、代替性、恢复、单位、守恒/约束；零冲击/单节点/小手算/断连对照；有节点产出 history 才计算 output_loss/功能韧性；模型间不共用未定义的恢复时刻。 | 公式缺参数、无基准产出、把配置网格当置信区间或把数学可解当政策可行。 |

推荐顺序：SCI-01 与 SCI-02/03 的测试编写并行；各分区只拥有自己的新库模块/测试；统一对象合同先冻结最少字段，再分别实现薄适配和只读验证。首轮不要同时重写全部公式、跑全量实证和引入多个功能模型，避免复核范围失控。

## 未合并回归样例

以下代码仅是红灯验收样例，不是已修复测试。旧源码当前在三个测试上失败属于预期；迁移 PR 用新公共函数替代 `model` 导入后应转绿。刻意不用 `assert`，便于 -O 下同样生效。

```python
import unittest
import numpy as np
import model

class ProposedContractTests(unittest.TestCase):
    def test_nonpositive_k_rejected(self):
        z = np.array([[0., 2., 1.], [3., 0., 1.], [1., 2., 0.]])
        for mode in ['strong', 'weak']:
            with self.subTest(mode=mode):
                with self.assertRaises(ValueError):
                    model.policy(z, mode, .05, k=0)

    def test_truncated_peak_covers_terminal_state(self):
        result = model.sir(1., .05, horizon=.1)
        self.assertGreaterEqual(result['peak_I'], result['terminal_I'])

    def test_negative_z_rejected(self):
        with self.assertRaises(ValueError):
            model.weights(np.array([[0., -1.], [1., 0.]]), np.array([10., 10.]))
```

## 审计者自我复核

1. K-01 用 mock pandas 表复现，不改真实聚合文件；故不声称原年度排序已错。K-03 仅 k=0/空图是现有默认之外的已复现缺陷，修复需验证默认 k=5 不漂移。K-04 仅短截断期已复现；legacy 年度结论不能据此擅自更新。
2. 输入通用化会引入非原始数据集条件，因此清零负 Z、改变零产出节点分母、移除自环或更改归一化均须显式方法/配置，不能作为“清洗”悄然发生。
3. 本报告未使用未来年份重新标定；原 `run_experiments.py:52-56` 也在年度循环前固定2000基准。不存在据此可以认定的时间泄露；若后续调参，则训练/验证时间分隔和基准选择记录需另加验收。
4. 科学输入门禁与安全发布门禁不同：哈希保证未改文件，不保证来源真实性或发布许可；该范围内未发现令牌或个人字段，不等于整个待发布仓库已通过敏感信息审计。
5. 未承诺计划书列出的每个字段/模型已实现。经济功能能力与数据授权均是明确的 go/no-go 条件，不能靠 README 的功能列表补齐。

## 已克隆 GitHub 仓库的新增静态审计

本节只读检查 `code/resilience_measurement.py`、`code/vulnerability_nodes.py`，未 import 或运行。不能把桌面 empirical_redo 的10项测试当作这两份脚本已通过的测试。

| 编号 | 可定位事实与风险 | 处置 |
|---|---|---|
| REM-01 / 高 | `resilience_measurement.py:533-569` 在模块顶层读取1995-2022数据并写CSV；`vulnerability_nodes.py:38-75` 顶层读取当前目录两CSV，后续顶层建图/嵌入/模拟。直接 import 会执行研究工作流。 | 两脚本保留为 historical examples，不作为新包导入源；新 src 不能依赖其 import。迁移函数先提取再测试，最后才增加有 main guard 的兼容CLI。 |
| REM-02 / 高 | `resilience_measurement.py:496-499,675` 用 `np.nan_to_num(Z/x)` 消解坏数据再直接求逆，不检查谱半径；`vulnerability_nodes.py:375-385` 消解非有限 B 并在奇异时回落伪逆。伪逆能够给数值不等于经济生产系统有效。 | 通用 IOSystem 应显式拒绝不满足前提的 L；不把坏数据填0或奇异伪逆当作默认修复。保留 legacy 算法标签以便研究者检查差异。 |
| REM-03 / 高 | `vulnerability_nodes.py:313-314` 使用 dependency `weight` 作为介数和接近中心性的距离；强权重因而被解释为更长路径。`resilience_measurement.py:266-276` 的效率函数则明确采用 reciprocal distance，两个路径口径不一致。 | 新网络层明示 `distance=1/positive_weight`；修正旧排名前必须独立重跑和对照，不能只更名指标后沿用旧表。 |
| REM-04 / 高 | `vulnerability_nodes.py:359-361,370-372` 按供应方产出构造 B。若使用标准行向量会计关系 `x^T = v^T + x^T B`，则 `delta_x^T = delta_v^T (I-B)^(-1)`；但 `:396-399` 用 `G.dot(delta_f)` 作列向量计算，且把 `-shock_ratio*x_i` 当作外生冲击。 | 按该明确行列约定须核对转置，并明确冲击是否是增加值变化；固定比例产能约束并不自动等价于外生增加值向量。此分支隔离，不直接升级为动态容量级联插件。本结论来自代码的 B 定义和代数，不是已对实际数据完成的模型验证。 |
| REM-05 / 中 | `resilience_measurement.py:63-76` 的平均行和与平均列和都等于 `sum(W)/n`；`:613-614` 将其同时作为正指标纳入综合得分。 | 分别命名 mean_in/out_strength 用于方向说明，但全国均值并非两项独立信息。合成前必须去重或明确权重，不能把重复维度当作证据增强。 |
| REM-06 / 中 | `resilience_measurement.py:594-607` 使用全样本 min/max 和熵权；单年 m=1 导致 log(m)=0，全常数指标信息量可能无法归一化。 | 作为事后描述可以明确全样本归一化；若做预测/滚动评估则属于未来样本影响，需冻结训练统计。新增 m>=2、常数列、全常数表、缺失/非有限值测试。不要把桌面2000基准标定的无未来重估结论泛化到此脚本。 |
| REM-07 / 中 | `vulnerability_nodes.py:47-71` 用行列及产出标签的交集静默删掉未匹配行业；`:58` 将无法转数值的产出填0；`:195-206` 权重再 safe_fillna。 | 通用适配器默认严格拒绝不完整标签；允许有意识取交集时必须显式配置并报告删除节点及交易占比。编码与单位未知不自动猜测。 |
| REM-08 / 中 | `resilience_measurement.py:31` 与 `vulnerability_nodes.py:23` 全局忽略警告；前者随机攻击 `:175-183,366-381` 依赖全局随机状态，后者顶层重设全局 seed。 | 新包不全局改警告或随机状态；随机模型用显式 RNG/seed 参数并记录版本。Node2vec 用固定种子并不保证跨依赖版本严格一致。 |
| REM-09 / 中 | `vulnerability_nodes.py:234-245` 对骨架再行归一化；`:271-285` 根据簇心模长/到中心距离给结构重要性；`:339-346` 将多个网络中心性均值命名“规模关键性”。 | 可保留为特定研究假设，不直接成为通用关键节点标准。row-normalized 分配网络不是 A，簇距离不是已经验证的技术不可替代性，网络中心性也不是产出规模。先采用二维分开呈现，再做已定义经济轴和网络轴的对照/消融。 |

远端与本地数据不是同一schema：两旧脚本分别要求 DOM_ 行+OUTPUT、211部门Z+中文总产出；桌面数据为31省×42行业MRIO。不改文件名后直接投喂旧脚本，不将老211行业标签映射到S01-S42。

## 新网络层本轮实现边界

候选实现位于 `src/ionet/network/build.py`，专项测试位于 `tests/test_network.py`。入口为 `build_network(io, matrix='A', threshold=0.0)`、`structural_metrics(net)`；`NetworkSystem` 记录 matrix_type/threshold/normalization/direction/distance/node_order/元数据。

- 支持显式 Z/A/L；默认 A，行供应至列使用；L 是完整 Leontief 逆的跨节点权重，而非偷偷改成 L-I。
- 阈值是对应矩阵权重的绝对下界，正边且 `>=threshold`；默认仅在网络副本排除对角线，保留全部节点及孤立点。
- 路径取 `1/weight`，有向；结构指标只返回节点、边、密度、全局效率、可达率及入出强度，不输出经济损失或功能韧性。
- 本轮11项网络专项测试在仓库独立 `.venv` 普通和 `-O` 模式均通过，覆盖手算路径/效率、SciPy独立路径、孤立/无边/单节点、阈值边界、原IO不变、A/L货币缩放不变与Z按比例变化、强边缩短距离、非法数值、元数据嵌套双向隔离及edge属性篡改。此处计数仅为网络分区；全库总数见本轮整体验收记录。
- graph 结构冻结但属性字典仍可变，matrix只读；不声称完全深度不可变。`structural_metrics` 先核对graph/matrix节点、边数、逐边权重和reciprocal距离，一旦不一致拒绝计算；来源metadata深复制，避免与IO嵌套metadata相互污染。属性是否可修改与结果是否可无声漂移是两类不同承诺。
