# 协作与 CI 增量审查

日期：2026-09-30。范围：CI、两个 Issue 表单、PR 模板和贡献指南的本地增量。审查为作者静态自查，待另一角色与仓库 maintainer 复审；尚未推送，不代表远程 CI 成功。

## Before / After

| 改动 | Before | After | 本地复核方式 |
| --- | --- | --- | --- |
| 核心 CI | 未见 `.github/workflows/ci.yml` | Python 3.10/3.12 安装 core dev、语法检查、pytest 覆盖报告 | YAML 解析、命令与包配置对照、官方 action tag SHA 核对 |
| Issue 表单 | 未见对应表单 | bug 和研究任务填写复现、方法、验收与授权信息 | YAML 字段、required 设置和敏感内容提醒检查 |
| PR 模板 | 未见对应模板 | 每处行为变化绑定 before/after、命令、独立基准、授权和异角色复审 | 逐项对照用户的验证监督要求 |
| 贡献指南 | 未见 `CONTRIBUTING.md` | 小切片、WIP、共享接口所有权、四类测试、结果变更治理 | 检查测试命令真实存在、治理声明未冒充已启用权限 |

## CI 安全与依赖核对

- 工作流只在 `push` / `pull_request` 运行，只有 `contents: read`；不用 secrets、私有数据、`pull_request_target` 或部署步骤。
- checkout 不保留凭据，两个 actions 固定完整 commit SHA；仅安装 `.[dev]`，不引入 Node2vec/PyTorch 等扩展。
- checkout `v7.0.0` 对应 `9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0`；setup-python `v6.2.0` 对应 `a309ff8b426b58ec0e2a45f0f869d46889d02405`。在官方仓库以 `git ls-remote` 核对 tag，而非从第三方示例复制 SHA。
- GitHub 建议以完整 SHA 固定 actions，并限制 token 权限；采用对应最小权限设计。[GitHub 安全参考](https://docs.github.com/en/actions/reference/security/secure-use)
- 官方 action 来源：[checkout v7.0.0](https://github.com/actions/checkout/tree/v7.0.0)、[setup-python v6.2.0](https://github.com/actions/setup-python/tree/v6.2.0)。这些 tag 的存在与 SHA 已核对，不表示它们在本仓库远程运行过。

## 验证命令

```console
git ls-remote https://github.com/actions/checkout.git refs/tags/v7.0.0
git ls-remote https://github.com/actions/setup-python.git refs/tags/v6.2.0
python -m pip install -e ".[dev]"
python -m compileall -q src tests
python -m pytest --cov=ionet --cov-report=term-missing
```

前两条已执行，SHA 与工作流一致。使用仓库 `.venv` 的 PyYAML 解析三个 YAML 文件，并检查仅有 push/PR 触发、只读 contents 权限、Python 3.10/3.12 矩阵及完整 40 位 action SHA，均通过。解析工作流使用 `yaml.BaseLoader` 保留 `on` 字符串键，避免 YAML 1.1 布尔词规则误判。系统 Python 初次检查因缺少 PyYAML 未运行成功，随后在开发环境完成解析。

后三条为新核心包集成验收命令，其整体执行结果由整合记录填写；本文件不会把未执行的远程 Python 矩阵称为通过。覆盖率只报告，不在缺少基线时设置 90% 等门槛。

## 科学与数据边界

这些文件不改变原有公式、数据或历史论文实验输出。新增核心测试入口只验证当前实现的行为，不意味着完整 IO → network → cascade → resilience 路线全部完成，更不认证旧 SIR 模型为经济产能传播模型。

已有 MIT 代码许可保留，未选择新许可；代码许可不自动覆盖投入产出数据及派生结果。CI 不读取源表。组员账号、CODEOWNERS、分支保护和审批权限待 maintainer 确认，本次不伪造配置。Issue 表单不会自动创建远程任务，PR 模板也不会自动授予合并权。

## 待复核与回退

待另一角色检查 YAML、安装/测试命令与包元数据的一致性；待 maintainer 确认贡献规范和远程安全设置。远程首次 push/PR 后才能核验实际 Actions 运行日志与平台兼容性。

后续切片：发行包允许清单、合成样例回归、run manifest 的指纹一致性、真实数据私有验收及手算科学测试。出现问题时只修正或回退本 PR 的治理文件，不覆盖历史科研输出。未执行 git add、commit、push 或远程 Issue 创建。
