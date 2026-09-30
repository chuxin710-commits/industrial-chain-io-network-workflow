# 实验入口与打包独立复审

日期：2026-09-30。复审角色：非本分区实现者的代理检查；不是人工 maintainer 批准。范围为 `pyproject.toml`、`src/ionet/experiment.py`、`__main__.py`、`__init__.py`、`tests/test_experiment.py` 和 `examples/synthetic_config.yaml`。未修改被审查源码，未提交或推送。

## 初检发现与修复复查

| 严重度 | 初检问题与复现 | 修复 / 独立复查结论 |
| --- | --- | --- |
| P2 | provenance 只有固定发行版本；同一 editable 版本下源码变动不可区分 | 实现者增加逐源文件 SHA-256 与总 code hash；复查产物存在 `code_manifest` 与 `code_sha256`，不再只依赖版本号 |
| P2 | 配置 `? [bad, key]\n: 1` 抛未捕获 TypeError；完整样例增加 `1: a` 和 `wrong: b` 也因 sorted 混合类型抛 TypeError | 实现者要求 mapping key 为字符串；独立 probe 两例均为 ValueError，且没有创建输出目录；新增回归测试通过 |
| P2 | 将 dataset.name 改为 `"synthetic_three_sector\nsha256=forged"`，data_version.txt 可被插入额外键行 | 实现者增加单行元数据约束；独立 probe 拒绝换行名称且不创建输出；新增回归测试通过 |
| P3 | 初次隔离构建的 sdist 包含 tests，但不包含其依赖的 examples/synthetic_config.yaml；解压后的源码测试无法找到固定样例 | 已报告实现者；建议通过明确允许清单收录该合成样例，并在 sdist 解压目录测试，或明确目前只支持 clone 仓库验证；不是 legacy 数据误打包问题 |

P2 的初始问题不能因随后修复而从审查历史消失。以上仅为本轮所见问题，不是对所有科研模块的全面认证。

## 已执行的独立验证

命令环境：仓库 `.venv/Scripts/python.exe`，Python 3.12.14 / Windows。执行：

```console
.venv/Scripts/python.exe -m pytest tests/test_experiment.py -q
```

初检 15 项通过，修复后复查 19 项通过。另以临时文件/目录进行以下独立 probe，未向仓库写入测试输入或结果：

- unsafe YAML `!!python/object/apply:os.system` 被 SafeLoader 拒绝为 ValueError，未执行构造命令。
- network.threshold 的嵌套重复 key 被拒绝；畸形 YAML、列表 mapping key、数字 mapping key 和换行元数据均明确失败，无输出目录。
- 既有 focused test 验证同一 output 再运行抛 FileExistsError，原文件内容不变；CLI 重跑返回错误，跨工作目录可运行。
- 用 `unittest.mock.patch` 注入 `run.log` 写入 OSError，确认已产生的部分文件不会伴随 `run_manifest.json`。完整 marker 在正常产物之后写入；失败目录仍保留，不声称事务性清理或原子文件写入。
- 用 Python csv.reader 独立读取正常结果：metrics.csv 为 1 条数据记录，io_importance.csv 与 node_metrics.csv 各 3 条；所有记录列数一致。列名分别是系统结构指标、行业产出乘数、行业 in/out strength，没有虚构经济损失或恢复曲线。
- import 子进程测试没有创建实验文件；包入口与 CLI 的作用域明确，导入不启动实验。

环境产物包含 Python、platform 与核心分发/numpy/scipy/networkx/PyYAML 版本；配置字节有 hash 和快照，合成 Z/x/y/行业序列有 hash。该数据 hash 的口径是数值及行业序列，单位/价格语义仍需结合 config_snapshot.yaml 与 config hash 使用，不能单独将数值 hash 当作完整经济口径认证。

## 发行包边界

为避免与其他分区共享构建输出冲突，复制当前工作树至系统临时目录，排除 `.git`、`.venv`、缓存、既有 build/dist；在副本执行默认隔离的 `python -m build --outdir <temp>/dist`，然后用 zipfile/tarfile 检查全部成员。

- 默认隔离构建退出码 0：wheel 13 个成员、sdist 28 个成员。
- 两种产物均未包含 legacy `code/`、`data/`、`.claude/`、`.git/` 或 `.venv/`。
- 此次产物均未包含 examples/synthetic_config.yaml，对应上表 P3。打包成员数是该次构建的观测值，不是之后所有构建的固定合同。
- 初次尝试 `--no-isolation` 因该虚拟环境缺少 setuptools 后端失败；默认隔离构建通过。因此未把开发环境未装构建后端误报为项目无法构建。

## 复查时的源码指纹

尚未提交这轮增量，以文件哈希定位本次复查状态，不伪造 commit SHA：

| 文件 | SHA-256 |
| --- | --- |
| pyproject.toml | 9de60257854be7053901aaa4949c014affdb7b135dd364dcff0f1d2a33a08392 |
| src/ionet/experiment.py | c1cb567db5d85fe955f6b7d4896362218dd555dd8d43ec69bae15ff2d2345497 |
| src/ionet/__main__.py | 2b29c35235cc0508206090857f5ae01a2c5705c90efc1f9d11f7fe5f80c2f0c9 |
| src/ionet/__init__.py | 715581ee0f53a3d2af67cbb04a0dbc0b9338d7db29f112993379c5567cd14211 |
| tests/test_experiment.py | d83e46c22025c5e25d0571d506af4061a567890e7b78108ac0d97318e071c0b2 |
| examples/synthetic_config.yaml | 3922a62ad2cf3af9a4b332f7679dc0cc1ff894e3ed9a51a959d7249bde74ceeb |

## 决策边界

初检三项 P2 已获得实现者修复及独立复查证据，本分区暂未发现其他需阻止当前小切片本地整合的高严重度问题。P3 发行样例缺失仍按上述状态留存，若后续修复需追加复验，而非修改初检事实。

未执行 GitHub 远程 CI、Linux 或 Python 3.10 的本地独立测试，未认证真实 MRIO 数据，未验证完整冲击/级联/恢复流程。本复审不代替另一方法分区的科学审查，也不代替用户/maintainer 的发布与合并批准。

## 第二批复验：P3 闭环

实现者添加 `MANIFEST.in`，明确仅收录 `examples/synthetic_config.yaml`，并新增手算回归测试。`pyproject.toml` 改用 MIT SPDX 元数据及 license-files；本轮只确认源包与安装验证边界，不替代实现者的官方元数据文档核验。前文的原始文件哈希、初检成员数和 P3 待修复状态保留为第一批事实，以下是后续批次结论。

独立检查本次 `dist/industrial_chain_io_network_workflow-0.1.0.dev0.tar.gz`：

- SHA-256：`fb1e412bc63c009b7097de729a4e00c4df0928cfe0c0c4b596ba07ab2b717653`。
- 32 个成员；确实包含 `examples/synthetic_config.yaml` 和 `tests/test_regression.py`。
- 成员路径不含 legacy code/data、`.git`、`.venv`、`.env`、`.claude`、artifacts、empirical_redo 或 repository_workbench。
- 逐个文本成员扫描 Windows 用户/CodexData 路径与 Unix 用户 home 路径模式，未发现个人绝对路径。该模式扫描不是所有隐私或授权风险的完备证明，公开边界仍需 maintainer 审查。

使用系统临时目录解包：先 resolve 并逐项检查所有目标路径仍在临时根目录内，拒绝符号/硬链接，再调用 `tar.extractall(..., filter="data")`。未在原仓库解包或覆盖源文件。

在解包后的源码根目录，使用原开发虚拟环境的解释器并显式设置 `PYTHONPATH=<temporary_source>/src`：

```console
python -c "import ionet; print(ionet.__file__)"
python -m pytest -q
```

已断言导入位置为临时解包源码的 `src/ionet/__init__.py`，不是原仓库 editable 源码或其 wheel 安装目录。解包源码测试退出码 0：**53 passed, 66 subtests passed**，耗时 4.59 秒。因此 P3 的缺失样例问题在该源包上已闭环；没有仅使用原仓库测试通过来替代发行包验证。

新批次文件哈希：

| 文件 | SHA-256 |
| --- | --- |
| pyproject.toml | 7dbf3f5370f599b99fdc48ddfad2cd16ed58a4e6940d10f2b1797c1ea9b8bebf |
| MANIFEST.in | 72f9fe4fa1f46dfa1afa541571893812cc242e2a81d6de5ceb8c1b171f3a36e4 |
| tests/test_regression.py | 3dfb44ec6c84e31622df3c320827093de3d63f0cd5fbf5477e63d233c55c454e |

第二批决策：本次复审所提的三项 P2 与一项 P3 均有修复和独立复验记录，不再保留未闭环发现。此结论只适用于上述产物和当前小切片；远程 CI、真实 MRIO、未实现的模型与人工批准边界不变。本次只追加本审查文件，未修改受审源码、提交或推送。
