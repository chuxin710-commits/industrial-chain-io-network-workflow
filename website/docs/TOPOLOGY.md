# 年度网络拓扑与交互

## 数据和代码

数据只从 SQLite 中的完整年度 Z 与 X 读取，不使用数据库表格的分页截面。可任选 2000–2023 年中一个或多个年份，逐年计算；每个请求是一张年度图，不混合年度交易。

实际复用仓库 `src/ionet/core/io_system.py` 的 `IOSystem` 和 `src/ionet/network/build.py` 的 `build_network`，来源提交 `8f239665caa07f45f49901996ec2cd9afd4f8e79`。线上发布将对应 Python 源码及 MIT 许可打包到 `server/vendor/`，不另写一个冒充原内核的构网程序。

适配器 `server/topology.py` 负责读取数据、聚合、全网度和强度、展示边选择及关联查询。返回原表 SHA-256、内核来源提交和文件哈希、适配器哈希、计算库版本与参数。JSON 导出保存这些记录，以及初始坐标、用户调整后的坐标与被拖动节点。

## 数学口径

- 方向：供应部门（行）→ 使用部门（列）。仅支持 Z 或直接投入系数 A，不计算 L、冲击损失或韧性分数。
- 层级：全国行业 42 节点、省际 31 节点、省份×行业 1302 节点。先聚合 `Z_g = Q.T @ Z @ Q` 与 `x_g = Q.T @ x`，再算 `A_ij = Z_ij / x_j`，不对 A 求和。
- 负值和缺失：Z/X 不满足有限非负条件则拒绝，不填零、不截断。数据库中的原始负值仍照常保留，此限制仅属于构网模块的 Z/X 输入契约。
- 零产出：聚合前核验原始零产出节点的 Z 行列均为零，A 中对应使用列定义为零，节点保留。实际全量扫描发现 2018 年有 3 个此类节点，不能为了适配 `IOSystem` 擅自删除它们或填造正产出。
- 筛边：`weight > 0 and weight >= threshold`，网络视图排除自环，保留全部原节点。
- 指标：入/出强度分别为阈值矩阵列/行和，总强度为二者之和；度为相应正边个数；有向密度为 `E/[N(N-1)]`。阈值全网包含未显示的边，不跑在线全对最短路。
- 展示：仅画权重最强的前 K 条边，边界同权按原始来源、目标索引排序。调整 K 不改变全网度、强度、密度、孤立点或年度指标。
- 关联：选中节点时查询阈值全网的全部入/出边并叠加显示，不限于前 K 条；清单分别展示上游供应与下游使用、边权，可继续选取相邻节点。

## 多年与拖动

所有选中年度的展示边并集共用一次 D3-force 布局；年份切换不重新布局，节点大小与边宽按所选年份共用尺度。切换时只对视觉淡入淡出，不补造年份间数据。时间轴只包含实际选中年份，支持上一年、下一年、逐年播放和速度切换。

用户按住任意节点可单独拖动，连线实时跟随；拖动画布空白区域平移视图。节点调整对全部已选年份使用同一坐标，不改变交易或构网结果。恢复布局按钮回到初始布局，适应画布按钮只复位视角。定位框可通过节点名称或原始代码定位密集区域中的节点；触控使用 Pointer Events，桌面鼠标和模拟触控需分别验证。

## API

```text
GET /api/topology?year=2023&level=sector&weight=A&threshold=0.005&max_edges=250
GET /api/topology/neighbors?year=2023&level=sector&weight=A&threshold=0.005&max_edges=250&node=S12
```

`level` 为 `sector/province/node`；`weight` 为 `A/Z`；展示边上限 3000。计算并发上限 2；内存缓存最多 48 张参数确定的年度图，数据库真实路径按服务启动版本固定。没有随机/示例数据回退；取消或计算失败不覆盖上一组完整结果。

## 部署和验证

后端需要 Python 3.10+、NumPy 和 NetworkX。服务器在独立、按依赖文件哈希命名的运行环境中安装依赖，版本写入运行目录的 `installed.txt`。静态构建不能替代计算 API。

```sh
python -m pip install -r server/requirements.txt
python -m unittest discover -s scripts -p test_topology.py -v
node scripts/verify-topology.mjs
node scripts/verify-topology.mjs --base https://nn.rftf.cc.cd
python scripts/package-deploy.py --incremental
```

增量包复用线上原数据库与影片，但更新完整前端、后端和内核源码；`deploy/update-feature.py` 核对包后交给现有安装器启动、验证或回滚，不使用只允许静态文件的 UI 更新器。

金额单位、价格口径与行业名称尚未核实；A 也不消除相对价格变化。2005–2007 年可比性异常需独立核验，图上变化不能自动解释为真实经济冲击或韧性变化。网站声明、导出与方法窗口保留这些边界。
