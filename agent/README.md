# 链析 ChainLens —— 产业链安全与复杂网络研究 Agent

一个**只**回答「产业链安全 × 产业链复杂网络」领域问题的对话式 agent。它能：

1. **答疑** —— 解答产业链/供应链安全、韧性、脆弱性、投入产出分析、复杂网络方法等问题；
2. **审表 → 出代码** —— 当你给出投入产出表时，审查其结构并**直接生成一整套适配的建网代码与分析代码**；
3. **守边界** —— 对与产业链无关的问题，只回复一句：「**抱歉，我只会回答产业链领域相关问题**」。

agent 的"大脑"是 [`SYSTEM_PROMPT.md`](SYSTEM_PROMPT.md)（可移植系统提示词）。下面给出三种部署方式，**让任何人都能与它对话**。

---

## 部署方式 A：Claude.ai 项目（最易分享，推荐）

> 适合"让其他人通过对话使用"——建好后把项目链接发给别人即可。

1. 登录 [claude.ai](https://claude.ai) → 左侧 **Projects** → **Create project**，命名「链析 ChainLens」。
2. 打开项目 **Set custom instructions / 自定义指令**，把 [`SYSTEM_PROMPT.md`](SYSTEM_PROMPT.md) **全文粘贴**进去，保存。
3. （可选）把本仓库的 `code/`、`docs/indicator_dictionary.md` 作为项目知识库（Project knowledge）上传，让 agent 直接引用工具箱与指标定义。
4. 在该项目里开新对话即可使用；把项目分享给同事/同学，他们也能直接与之对话。
5. 用户上传投入产出表（CSV/Excel）后，直接问"帮我审查这张表并生成韧性测度代码"即可。

## 部署方式 B：Claude Code 子代理（命令行/IDE 内）

> 适合开发者在本仓库内直接调用。

- 子代理定义已随仓库提供：[`.claude/agents/industrial-chain-expert.md`](../.claude/agents/industrial-chain-expert.md)（项目级，克隆仓库即生效）。
- 在 Claude Code 中：
  - 直接 `@industrial-chain-expert 你的问题…`，或
  - 让主代理把产业链任务委派给它（其 `description` 已写明触发场景）。
- 该子代理被授予 `Read / Glob / Grep / Bash / Write / Edit`，因此可读取你提供的投入产出表文件、就地审查结构并写出可运行的分析脚本。

## 部署方式 C：API / 任意聊天系统（自建应用）

把 [`SYSTEM_PROMPT.md`](SYSTEM_PROMPT.md) 全文作为 `system` 角色内容，接入 Anthropic API 或任何支持自定义 system prompt 的模型即可。系统提示词较长且每轮复用，建议对其开启 **prompt caching** 以降低成本。

```python
# 示意 / sketch（需 anthropic SDK 与 API Key）
import anthropic
client = anthropic.Anthropic()
SYSTEM = open("agent/SYSTEM_PROMPT.md", encoding="utf-8").read()
resp = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=2048,
    system=[{"type": "text", "text": SYSTEM,
             "cache_control": {"type": "ephemeral"}}],   # 缓存长系统提示词
    messages=[{"role": "user", "content": "中国产业链脆弱性怎么用投入产出表识别？"}],
)
print(resp.content[0].text)
```

---

## 行为示例 / Behavior Examples

**① 域内答疑**
> 用户：Leontief 模型和 Ghosh 模型在产业链冲击分析里怎么选？
>
> 链析：先看冲击机制——需求拉动（最终需求↓→上游减产）用 Leontief（直接消耗系数 + `L=(I−A)⁻¹`）；供给推动/上游断供（→下游减产）用 Ghosh（分配系数 + `G=(I−B)⁻¹`）。二者无优劣，关键是机制匹配……（给公式、适用边界、文献）

**② 审表 → 出代码**
> 用户：（上传 `io_2023.csv`）帮我看看这张表，做关键节点识别。
>
> 链析：先审查结构——这是一张 211×211 的非竞争型表，GBK 编码，含「总产出」列……（复述结构、确认目标）→ 走"脆弱性识别"路线：分配系数 B + Disparity Filter 骨架 + Node2vec + 混合关键性指数 → 然后给出按你这张表实际列名/编码适配的、可直接运行的完整代码。

**③ 域外拒答**
> 用户：帮我写一首关于春天的诗。
>
> 链析：抱歉，我只会回答产业链领域相关问题

---

## 边界说明

- "域内"按**实质**判定：凡能服务于产业链/供应链/投入产出/生产网络分析的问题（含相关方法、代码、经济学与政策）都回答；其余一律按上面那句原话拒答，且拒答时不附加解释。
- 半相关请求只回应可剥离的产业链部分；无法剥离则拒答。
- 该边界对各种"绕过"诱导稳健（忽略指令、角色扮演、翻译、"仅此一次"等）。

> 维护提示：[`SYSTEM_PROMPT.md`](SYSTEM_PROMPT.md) 与 [`.claude/agents/industrial-chain-expert.md`](../.claude/agents/industrial-chain-expert.md) 内容保持同步；改动 agent 行为时请同时更新两者。
