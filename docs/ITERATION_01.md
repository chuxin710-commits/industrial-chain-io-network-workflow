# 迭代 01 实施与复核记录

本记录描述首轮本地交付时的状态；后续提交、推送与远程CI状态以Git历史和GitHub Actions为准。

## 范围

日期：2026-09-30。基于远程起点 `7ab143c9ccc4bbe69e654fc2b2d40153f701907b`。
首轮本地交付时，工作分支为 `work/agile-foundation-20260930`；尚未提交、推送或创建远程Issue/PR。
只新增可复用试验核心、合成样例、测试与治理文件，并修改README/.gitignore入口。
旧 `code/` 和 Skill 脚本、作者署名与许可证保持原样；真实表与外部论文结果没有迁入本库。

## 改动和非作者复审

| 改动 | 复审发现 | 处理 | 验证状态 |
| --- | --- | --- | --- |
| IO合同/A/L | 构造后替换x或重新开放数组可绕过初始门禁；unordered sector容器 | 增补运算前状态检查、ordered标签与负例 | 普通/-O及最终联调通过 |
| 网络视图 | frozen graph仍能改edge属性而污染指标 | 核对matrix/graph/方向/距离一致性，失败明确拒绝 | 非作者复现、修复回归及整合通过 |
| 网络来源快照 | 嵌套metadata浅拷贝会污染历史来源 | 深拷贝来源，双向修改隔离测试 | 非作者双向修改复验通过 |
| 配置与追溯 | editable版本号不足以标识源码；非字符串key抛TypeError；元数据换行影响文本记录 | 源码SHA清单、显式key/单行metadata门禁及回归 | 独立故障探针及19项focused测试通过 |
| 实验输出 | 强度字典不能作为可分析标量塞进metrics CSV | 节点强度拆到node_metrics.csv，complete清单最后写 | 解析/两次运行/校验清单通过 |
| CI与治理 | 本地测试不等于远程CI，模板不能自动授予合并权限 | 只读权限、固定action SHA、小PR与异角色review | YAML本地解析通过，远程未运行 |

AI分区作者进行了交叉复核；这不是课题组维护者的人工批准。具体文件和证据保留在 `docs/reviews/`。

## 可复现命令

以下从仓库根运行，Python需至少3.10。Windows可将 `python` 换成 `.venv/Scripts/python.exe`：

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e ".[dev]"
.venv/Scripts/python.exe -m compileall -q src tests
.venv/Scripts/python.exe -m pytest --cov=ionet --cov-report=term-missing
.venv/Scripts/python.exe -m ionet run --config examples/synthetic_config.yaml --output outputs/demo-01
```

最后一条拒绝覆盖已经存在的输出目录，第二次演示请使用另一个目录。
每次成功输出：config_snapshot.yaml、metrics.csv、node_metrics.csv、io_importance.csv、environment.txt、data_version.txt、provenance.json、run.log、run_manifest.json。
两个数值CSV/节点表重复运行须一致；时间戳不同属于预期，不要求完整目录字节一致。

## 最终实测状态

实测环境为 Windows / Python 3.12.14；新建独立虚拟环境使用普通PyPI依赖，不继承外部MRIO的 `.runtime`。

| 验证 | 观测结果 |
| --- | --- |
| `pip install -e ".[dev]"` | 干净开发环境安装成功；numpy2.5.3/scipy1.18.1/networkx3.7/PyYAML6.0.3 |
| `pytest --cov=ionet --cov-report=term-missing` | 53项测试通过；报告总覆盖率93%，没有据此宣称全面科学认证 |
| Python `-O` 模式 | 最终53项及66个子测试通过；pytest对测试外assert失效发出预期警告，核心门禁使用显式异常 |
| `compileall -q src tests` / `pip check` | 语法检查通过；开发环境无依赖冲突 |
| 两次标准CLI实验 | 三份数值CSV和data_version字节一致；8个run文件hash均匹配complete清单 |
| 合成例子独立回归 | 6对路径距离4/8/20/4/36/16；乘数为(1604,2132,2040)/1337，与输出一致 |
| 默认隔离 `python -m build` | wheel/sdist成功；明确允许清单包含合成样例，未收录真实数据 |
| 第二个干净环境普通安装wheel | 无editable、无dev依赖；从site-packages导入，标准CLI成功，pip check无冲突 |
| 旧研究内容对比 | `git diff --exit-code -- code .claude LICENSE requirements.txt data docs/case_studies.md docs/indicator_dictionary.md` 返回0 |
| `git diff --check` | 已跟踪改动无空白错误；新文件另由作者逐项检查 |
| GitHub CI | 文件与YAML本地核验；没有提交/推送，远程未运行 |

合成演示结构指标为3节点、4边、密度2/3、全局效率约0.1275463。它不是中国产业链的实证结果。
最终sdist解包后由非作者确认从解包源码导入并运行：53项测试和66个子测试通过；合成样例及解析回归已包含，具体记录见 `reviews/integration_review.md`。
不得以历史MRIO的10项测试/19项检查代替本库的新测试。

用户要求先交付一版，停止追加重复检查。本轮交付 `0.1.0.dev0` 源码和安装包，后续按使用反馈选取下一小流程；不继续扩张第一版的审查范围。

## 暂未放行的能力

真实IO/MRIO loader、HEM/关键性四象限、ShockScenario/SimulationResult、级联、功能韧性、恢复和GNN均尚未实现。
第一轮CLI只有明确合成数据和结构分析；参数seed用于追溯，当前流程无随机抽样。
Linux/Python3.10的远程CI、本机GitHub写入认证、main保护和实际维护者review仍需后续完成。

