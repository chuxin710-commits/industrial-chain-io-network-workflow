# 网络分区独立交叉复审

日期：2026-09-30。复审者：数据/IOSystem 分区。范围：`src/ionet/network/build.py`、`tests/test_network.py` 及其与完整 IO A/L 的接口。复审只读网络实现，不修改 B 分区文件。

## 发现

### 来源元数据嵌套别名会破坏运行快照

证据：`src/ionet/network/build.py:86` 使用 `dict(io.metadata)`，只复制顶层。嵌套 provenance/config 字典仍与源 IOSystem 共享；构网后修改源元数据，既有网络的来源版本会变化。反向修改网络也会污染 IOSystem 元数据。涉及科研追溯准确性，应在本轮合并前修复。

已执行的复现：

```python
io = IOSystem([[10, 20], [5, 10]], [100, 80], ["supplier", "buyer"],
              y=[70, 65], metadata={"provenance": {"version": "v1"}})
net = io.to_network(matrix="L")
io.metadata["provenance"]["version"] = "v2"
print(net.metadata["source_metadata"]["provenance"])
# Observed: {'version': 'v2'}; expected snapshot: {'version': 'v1'}
net.metadata["source_metadata"]["provenance"]["version"] = "v3"
print(io.metadata["provenance"])
# Observed: {'version': 'v3'}; expected source unchanged: {'version': 'v2'}
```

建议：使用 deepcopy 建立 source_metadata 的独立快照，补充源 → 网络、网络 → 源两个方向的嵌套隔离测试。发现已报告根分区和 B 分区；此处记录的是修复前行为，修复后应追加验证状态而非删除审计轨迹。

另有低风险命名差异：`tests/test_network.py:123` 使用 `unit`，核心标准字段为 `amount_unit`。虽 metadata 允许扩展，但标准测试应确认 `amount_unit` 未知仍为 unknown，避免教程形成两套单位字段。

## 已核验通过

- 完整 A 按买方 x_j 归一化，IO 中自环保留；构网只清理派生 view，不改源 IO Z/A/L。
- L 网络使用完整 Leontief 逆的非对角项，不是用过滤后的 A 再求逆；独立手算两行业 L 权重与供应行 → 使用列方向匹配。
- 无边、孤立节点、单节点处理正确；效率分母包含原始所有有序节点对。
- 阈值只保留 weight>0 且 weight>=threshold，临界值包含，且不丢孤立节点。
- 图中 distance=1/weight 与原权重分开；强依赖不被误作长距离。
- `_validate_graph_matrix` 在 metrics 前核对图节点/矩阵、边数、边权与距离；篡改图属性的失败测试已覆盖。
- A/L 对共同货币缩放不变；Z 网络效率随金额单位缩放，这是定义结果不是不变性失败。未知货币单位不应因 Z 效率有数值就获得经济含义认证。

## 实际执行

统一 `.venv` 下执行：

```text
.venv/Scripts/python.exe -m pytest tests/test_io_system.py tests/test_network.py -q
27 passed, 43 subtests passed
.venv/Scripts/python.exe -O -m pytest tests/test_io_system.py tests/test_network.py -q
27 passed, 43 subtests passed
```

`-O` 有 PytestConfigWarning 提醒生产 assert 被优化移除；已检查核心与网络验证使用显式异常，本轮失败边界测试仍通过。它不是忽略警告的豁免，也不能替代后续生产代码审查。

额外命令级手算复核：A=[[0.1,0.25],[0.05,0.125]]；L=[[0.875,0.25],[0.05,0.9]]/0.775；net(L) 对角线零且非对角值与手算 L 相同；构网后完整 L 不变，row_balance=True，unknown amount_unit 传入网络仍为 unknown。以上均实际通过；同一命令也复现了嵌套元数据别名问题。

## 合并意见

先修复来源快照别名并重新运行 focused tests，再交根分区全包联调。未发现需要推翻本轮 IO/network 接口的方向、自环或完整逆矩阵错误。仍不声称真实数据 adapter、经济产出损失、恢复机制、完整版本功能或全课题组验收已经完成。

## 修复后复核

B 分区已把来源 snapshot 改为 deepcopy，并增加双向隔离测试，单位测试字段统一为 amount_unit。本复审者实际重跑最初别名反例：构网后把 IO 来源版本改成 v2，网络来源仍为 v1；再把网络改成 v3，IO 保持 v2。该发现已闭环。

随后核心分区按根和 B 的独立复审补上 unordered sector 容器和可变数组状态门禁。联合 focused tests 最终为 33 项、66 个 subtests，普通和 -O 均通过；git diff --check 通过。初始发现、复现和修复记录均保留，作为小步实现 → 交叉复审 → 回归验证的监督证据。
