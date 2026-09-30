# IOSystem 数据合同与首轮建设审计

日期：2026-09-30。已读取仓库基线 `7ab143c9ccc4bbe69e654fc2b2d40153f701907b` 和用户本地 empirical_redo 审计材料。此文件记录数据分区的发现、首轮实现、验证与下一轮验收；不是声称全部真实数据已经接入。

## 仓库证据

| 仓库文件与行号 | 发现 | 风险与行动 |
|---|---|---|
| `data/README.md:3` | 原始表因体积/许可未分发 | 延续该边界，新增示例仅使用人工合成数据 |
| `data/README.md:25` | 旧格式为 DOM_* + OUTPUT | 不能直接读取新数据的 Z/X/F 等分文件布局；单独建设 CSV-folder adapter |
| `README.md:84` | 行 x=Z1+f，列 x=Z.T1+v | 国内非竞争型 Z 的列边界还需要中间进口；f 的出口与残差边界必须声明 |
| `code/resilience_measurement.py:45` | reader 基于 DOM_* 标签并提取代码 | 格式假设属于旧 adapter，不放进通用 IOSystem |
| `code/resilience_measurement.py:496` | A 用 np.nan_to_num(Z/x) | 隐藏非有限性，不应迁移为核心默认逻辑 |
| `code/resilience_measurement.py:499` | 逆矩阵只检查可逆性 | 可逆不等于 rho(A)<1；新核心先检查生产性条件 |
| `code/vulnerability_nodes.py:59` | 非数产出强制转零 | 数据问题不可静默变成“停产节点”；显式数据异常 |
| `code/vulnerability_nodes.py:62` | 行列/产出取交集后继续计算 | 可能悄悄丢行业；新 adapter 应记录缺失映射并选择拒绝或显式子集 |
| `code/vulnerability_nodes.py:90` | 边权是 Z/x_i 的分配系数 | 不同于新核心 A=Z/x_j；不能沿用相同字段名混合两者 |
| `code/vulnerability_nodes.py:375` | 计算中再次清理 NaN/inf | 保留旧脚本，不把这类隐式修复带入可复用库 |
| `code/vulnerability_nodes.py:385` | 奇异 Ghosh 矩阵回退伪逆 | 新 Leontief 核心明确失败，不用伪逆制造经济解释 |

上述仅是静态代码发现。本轮不执行旧脚本，不修改 `code/`、`.claude/` 或真实数据，也不认证 README 中数据库年份与部门数量的外部来源声明。

## 本地材料核查边界

本地 `empirical_redo/inspect_sources.py:13` 已有重复标签和有限性检测；`:56` 独立重算两侧核算 gap；`:60` 使用 G.T@Z@G 和 G.T@x 聚合；`:90` 建立来源 hash。它仍绑定 24 年全扫描和论文抽取，不是通用 adapter。

本地 `empirical_redo/METHODS.md:12` 定义 Z 为国内中间交易、行供应方列使用方；`:16` 和 `:17` 给出不同于简单封闭系统的输入、输出恒等式；`:39` 指出网络构造删除自环，但完整 IO 核算保留自环。`empirical_redo/README.md:46` 明确缺行业名、金额单位、价格口径和 2D-LQ 编制说明。这里的路径是用户本地研究目录的证据，不是此 GitHub 仓库内已有文件。

本轮抽样读取 2023 年 X/VA/M_inter/M_final/F/E/Err 的标签和维度，未重新执行 24 年完整审计。VA 中存在 `VA_ResidualAdjustment`；M_final 的列按地区 × 最终需求类别排列，不是生产行业。既有审计提示 2018 年有零产出原始节点，以及 2005-2007 年来源结构断点；这些情况要原样进入 adapter 警告和运算门控，不得补 epsilon、插值或猜测原因。

## 首轮接口与经济口径

已实现 `ionet.core.IOSystem(Z, x, sectors, y=None, metadata=None)`，顶层导出由架构分区完成。本对象是正产出运算对象，不是保留源表一切异常的 raw data container。

- Z 必须是非空方阵；x 必须是一维同长度、有限且严格正；Z 必须有限非负。
- sectors 是按 Z 行列顺序的唯一非空字符串，保存为 tuple。
- Z/x/y 保存输入副本，原始数组只读；metadata 深拷贝，不把未知单位或行业名编成已确认值。
- y 可省略但不以差额生成；提供时允许有符号分项，但必须有限且对齐。
- A=Z/x[None,:] 保留行业内交易；L=solve(I-A,I)，rho(A)>=1 明确拒绝，不使用伪逆。
- row_balance() 仅在显式 y 下返回 x≈Z1+y 的 bool；缺 y 拒绝。不自行重平衡。
- to_network() 把 IO 对象交给网络分区构造独立视图；删自环/阈值不能修改完整 A 或 Z。

对本地国内非竞争型交易数据，应区分：

```text
y_domestic = F @ ones(final_use_categories)
y_physical = y_domestic + E
y_accounting = y_physical + Err
x = Z @ ones(n) + y_physical + Err
x = Z.T @ ones(n) + M_inter + VA_economic + VA_ResidualAdjustment
```

若使用 row_balance 和 Leontief 精确基准重建，提供的 y 应覆盖完整输出侧闭合用途；这不是把 Err 当成可冲击的经济需求。下一轮 adapter 应独立保留 F/E/M_inter/M_final/VA 各分项/两侧残差，并以 y_scope 显式选出模型用途。E 保持出口分项，不把中间进口又扣成净出口；M_final 对齐 F 的消费目的类别，不可塞入 n 维行业 y。

rho(A)<1 仅是 Leontief 使用条件之一，不证明来源真实、分类一致、价格可比或产能冲击模型成立。原有 SIR 网络边权压力实验不等于功能产出损失模型，必须作为 legacy_conditional_sir 另行登记，不把 ICR 填为 output_loss 或 GDP_loss。

## 首轮验收

人工两行业 fixture：

```text
Z = [[10,20],[5,10]]
x = [100,80]
domestic_final_uses = [60,50]
exports = [7,12]
output_residual = [3,3]
y_accounting = [70,65]
M_inter = [8,15]
VA_economic = [77,35]
A = [[0.1,0.25],[0.05,0.125]]
L = [[0.875,0.25],[0.05,0.9]] / 0.775
```

手算两套核算恒等式、A@x=Z1、L@y=x 已独立通过；rho(A)=0.225。`tests/test_io_system.py` 包含 17 项单元/科学边界测试：手算 A/L、对角线保留、基准重建、缺 y、误用国内需求和净出口、输入副本、未知 metadata、signed y、货币缩放、节点置换、非有限/负数/形状错误、零产出、谱半径失败、单节点及 tolerance 检查。

首次调用默认 Python 失败的原因是本机默认解释器为 3.9，低于此轮包要求的 3.10；随后改用 Python 3.12.14 / NumPy 2.3.5。并行构建期间顶层包暂时提前导入未落地的 network 模块，因此先隔离加载 core 执行 17 项测试，普通及 -O 模式均通过。标准完整包导入与网络联调仍由根分区在全部文件到齐后复核。不能把这项隔离测试报告为全仓库通过。

### 首轮独立复审后的修复

根分区指出 sectors 若接受 set/dict 会丢失稳定行业顺序，None 会给出不清楚的 TypeError。已新增 ordered iterable 门禁：拒绝 set/frozenset/Mapping/str/bytes/None/非可迭代输入，支持 list/tuple/NumPy 字符串数组和按调用方既有次序产生的 generator，并在构造时固定为 tuple。

网络分区独立复审发现 NumPy 只读不等于深不可变：用户可以重新赋值 io.x，或对 io.Z 调用 setflags(write=True)。已在 A 的计算入口重验当前 Z/x 的 shape、finite、nonnegative Z、positive x 和行业标签；L 使用该 A 门禁。row_balance 同样重验当前状态及 y 的 shape/finite，不把对象声称为防篡改的不可变系统。

新增 5 项测试覆盖无序标签、ordered generator/array、x 赋值绕过、解锁 Z 后负修改，以及 Z/行业标签/y 的异常赋值。统一仓库 `.venv` 下 core + network 联合 focused tests 普通和 -O 模式均通过：33 项测试、66 个 subtests。其中核心现为 22 项测试；这仍不是完整真实数据实证或全功能验收。近 rho(A)=1 的数值条件风险没有人为加阈值，应在后续 condition-number/capability ticket 中明确报告。

## 下一轮小 Tickets

| Ticket | 可并行交付 | 必须回审的验收 |
|---|---|---|
| DATA-01 | CSV-folder schema、accounting_scope/y_scope、元数据模板 | 方法负责人独立核算；不把差额当未声明的纯最终需求 |
| DATA-02 | 人工合成含进口/残差/负库存/零产出的 fixtures | 逐分项手算；公开样例不截取真实表 |
| DATA-03 | 单年本地 CSV adapter | 不改源码换路径；错位/重复/缺值/负 Z 明确拒绝 |
| DATA-04 | 结构及两侧核算 validator | 正常与 -O 均 fail-closed，Diag 不代替独立计算 |
| DATA-05 | 行业/地区聚合、零产出 active view | Z/x/F/E/进口/VA/残差一起聚合守恒；raw view 不被破坏 |
| DATA-06 | 私有来源 manifest 与公共导出 sanitizer | 公共产物无真实矩阵、论文、个人路径或未授权结果 |
| DATA-07 | 单年真实授权 smoke + 42 行业权重回归 | 先轻量运行再评审；完整 24 年实证另设私有回归 gate |
| DATA-08 | 数据接入指南与新增 adapter 模板 | 第二位组员按文档独立完成合成例；unknown 状态可见 |

合并依赖以最小接口为准，不等待全部数据认证才写合成 tests，也不让未知元数据污染正式科研输出。数据合同/fixtures/来源规范可与网络、配置和 CI 同时进行；每张 ticket 的交付都包括源码、科学测试和证据回审。

## 发布门控

本轮仅允许公开人工 synthetic 数据、实现代码、理论/API 说明、测试期望值和配置模板。源表、真实聚合矩阵、现有实证结果包与论文的再分发权限尚未确认，不复制进仓库。代码 LICENSE 不覆盖数据 LICENSE；gitignore 不会删除已 tracked 文件或 Git 历史。公开来源 hash/manifest 也需权限与隐私审查，不能当作数据授权替代。
