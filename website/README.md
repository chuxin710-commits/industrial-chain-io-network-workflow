# 链研 CHAINLAB：科研工作台与投入产出数据库

当前版本保留概念首页与 MV，并提供科研工作台框架、2000–2023 年完整投入产出表的只读查询。方法执行、项目协同、团队文献管理和在线核验仍为框架，不作为已完成的服务宣传。

2026-10-15 已部署至 [线上首页](https://nn.rftf.cc.cd/) 和 [投入产出数据库](https://nn.rftf.cc.cd/workspace.html#database)。当前客户端的普通浏览器沿既有系统代理通过查询及导出验证；无代理直连仍出现连接重置，不能据此保证所有网络均可直连。详细边界见 [首版部署验收](docs/DEPLOYMENT_STATUS_20261015.md)。

## 年度数据库

`/workspace.html#database` 支持按年份、数据分块、行列地区和行业组合筛选；两轴独立分页、固定表头、热力着色、显示精度切换、原始值及来源查看、完整筛选结果 CSV 导出。微小非零值用科学计数显示，不误写成显示意义上的零。

本次入库为 24 年 × 1309 行 × 1460 列，共 45,867,360 个 float64 数值单元格。包含 Z、F、VA、X，以及完整表中的进口、出口、误差和总投入；未删除负值、未把空白补为零。全部数值和轴标签与合并原表逐项核对，另有 Z/F/VA/X 独立分表样本验证。`var/mrio.verification.json` 保存核验记录。

金额单位、价格口径、行业名称对照表、2D-LQ 编制机构与再分发许可尚未核实。界面保留 S01–S42，不编造行业名，不把数据解释成官方逐年实测表。数据库位于忽略的 `var/`，不放进 `public`、前端包或 GitHub；用户已授权的服务器部署通过只读接口提供查询。

```sh
python server/import_mrio.py --source-root "原始数据根目录"
npm start
npm run test:database
npm run qa:workspace
```

`npm start` 在数据库存在时自动启动本机只读 API（127.0.0.1:8787）和预览网站（127.0.0.1:5188）。Vite 将 `/api` 代理至 API。数据库查询层使用 Python 标准库；新增网络计算需要 Python 3.10+、NumPy 和 NetworkX，无需另装数据库服务器。启动器优先采用仓库 `.venv`，可用 `PYTHON` 指定环境。

## 年度网络拓扑

2026-10-18 新增 `/workspace.html#topology`：任选一个或多个年份生成真实投入产出网络，可切换全国行业、省际、省份×行业三个层级，以及 A/Z 边权、阈值和展示边数。实际复用仓库 `ionet` 内核，记录原表、内核和适配器哈希；初始页面不加载示例图冒充计算结果。

多年图共用坐标及大小尺度，支持时间轴、逐年播放、暂停、速度切换、定位和缩放。任意节点可单独拖动，连线实时跟随；拖动位置在选中年份间保持一致，也可恢复初始布局。点选后展示阈值全网中的全部上下游节点和边权，不会因为只画前 K 条边而漏掉关联。支持原生重绘的高分辨率 PNG 和含数据、参数、坐标、人工调整记录的 JSON 导出。

完整口径和 API 见 [网络拓扑说明](docs/TOPOLOGY.md)。自动测试包含聚合守恒、A 买方分母、阈值等号、展示与全网分离、2018 年零产出节点、完整邻居、真实鼠标拖动、多年坐标保持和移动端布局。图形变化不是韧性数值或经济冲击结论。

生产部署、增量发布与验证说明见 [服务器部署](docs/SERVER_DEPLOYMENT.md)。

## 界面

- 全屏视频背景，中央“进入科研平台”入口，跳转至 `workspace.html`。
- 下滚进入科研工具链与研究底座，使用 Lenis 和 GSAP 连续滚动/显隐过渡。
- 新增关键行业、跨区域关联、冲击与恢复、研究证据链四个连续板块。桌面为左文右图，手机为上下排列；右侧分别使用球状复杂网络、带流向箭头的地球、断裂后重组的金属链条、研究证据树。
- 四个场景响应鼠标位置，各有暂停按钮，进入可视区域才加载、离开后停止渲染；减少动态效果偏好下保持静态。WebGL 不可用时显示本地静态后备图。
- 可开启/关闭背景音乐，暂停/播放背景，打开完整影片、原生全屏或下载 MP4。
- 工作台链接现有的两个 GitHub 研究案例；数据库提供用户授权数据的只读查询，原始文件和数据库不提交到 GitHub。
- 适配桌面和移动端；减少动态效果偏好下默认暂停视频并关闭滚动动画。

## 启动

需要 Node.js 20.19+ 或 22.12+；本次制作使用 Node.js 26.2.0。

Windows 推荐双击 `Start-Chainlab.cmd`。启动器会自动打开浏览器，在后台运行预览服务；重复点击复用已运行的本站服务，5188 端口被其他程序占用时自动选择其他端口并打开正确地址。关闭启动窗口或浏览器不会停止服务；电脑重启后再次双击即可。

首次使用且尚未安装依赖时，在本目录执行 `npm ci --cache .npm-cache`。不要直接双击 `index.html`，页面的模块、媒体和导航需要通过 HTTP 服务加载。`127.0.0.1` 仅供运行服务的本机访问，不是公网网址。

```sh
npm ci --cache .npm-cache
npm start
npm start -- --no-open
npm run dev
npm run build
npm run test:preview
npm run qa
npm run qa:live
npm run qa:production
npm run test:research
npm run qa:research
npm run qa:research:production
```

首页为 `/`，工作台为 `/workspace.html`。Vite 构建输出 `dist/`；生产部署还需要只读 API 和服务端数据库，不能只上传静态文件就宣称查询可用。本机预览与线上部署独立运行。

`npm start` 与双击入口等价；`npm run dev` 是前台开发服务，需要保持终端运行。启动状态和实际地址记录于 `.artifacts/preview-5188.json`，启动日志为 `.artifacts/preview-5188.log`，都不提交至 GitHub。启动器确认本站健康响应后才打开浏览器，不会只输出一个尚未就绪的链接。`qa:live` 验证实际交付的后台服务，常规 `qa` 使用独立临时端口。

## 概念影片

影片：《The Chain of Discovery / 研究的连接》V2。32 秒，1920 × 1080，30 fps，H.264 视频 / AAC 立体声音频。

| 时间    | 场景                                  | 动态文字                                          |
| ------- | ------------------------------------- | ------------------------------------------------- |
| 00–04 s | 数据矩阵层叠展开，288 个数据柱起伏    | 让数据，立体起来。/ DATA BECOMES DIMENSION        |
| 04–08 s | 工业生产线、传送带与往返机械臂        | 进入产业现场。/ INSIDE THE PRODUCTION CHAIN       |
| 08–12 s | 三层空间网络，42 个节点与高速流动信号 | 每个连接，都有力量。/ EVERY CONNECTION COUNTS     |
| 12–16 s | 关键枢纽近景、关联路径与扫描环        | 找到牵动全局的节点。/ FIND THE CRITICAL SECTORS   |
| 16–20 s | 冲击扫过，五列产业积木连续倾倒        | 直面冲击。/ FOLLOW THE SHOCK                      |
| 20–24 s | 主路径中断，三条替代路径搭建与重连    | 重连，就是新的可能。/ REROUTE. RECOVER. REBUILD.  |
| 24–28 s | 研究记录经过四道核验关口              | 从实验，到可信证据。/ FROM EXPERIMENT TO EVIDENCE |
| 28–32 s | 金属链环从分离到组装，品牌收束        | 链研 / CHAINLAB                                   |

八幕均为独立 Three.js 场景，不是同一个物体的八次换角度。剪辑每 4 秒切换，与原创配乐的两个小节对应，包含推进、横向穿越、环绕、节拍微推和短边缘擦拭；使用金属倒角、定向光和阴影增强立体感，不使用全屏频闪。所有网络、数据柱、冲击与恢复运动均是概念动画，不代表实际投入产出金额、论文网络或实证结果。没有引入第三方影片或图像素材。

音乐由 `scripts/compose.mjs` 原创编排并合成：120 BPM，D 小调，Dm/Bb/F/C 和弦组，包含暖色合成器铺底、琶音、低音和电子鼓；无歌词、无人声、不使用第三方音频采样。浏览器为符合自动播放限制默认静音，音乐由用户点击开启。

## 媒体和源文件

- `public/media/chainlab-concept-v2-1080p30.mp4`：含动态排版的八幕完整 MV，用于影片弹窗和下载。
- `public/media/chainlab-background-v2-1080p30.mp4`：同源八幕 3D 画面的网页背景版，字幕由 HTML 按影片时间同步显示，避免移动端裁切或入口文字叠放。
- `public/media/chainlab-original-score.wav`：48 kHz / 16 bit / 立体声原创音乐母带。
- `public/media/chainlab-poster-v2.jpg`、`chainlab-background-poster-v2.jpg`：影片海报及视频加载后备画面。
- `public/media/film-v2-manifest.json`、`background-v2-manifest.json`、`score-manifest.json`：参数、分镜、源文件、像素核验及哈希记录。
- `src/film-world.js`：八套独立 3D 场景与镜头；`src/film.js`：中英文动态排版；`src/film-storyboard.js`：影片和网页字幕共享的时间轴。
- `src/network-scene.js`：保留的 V1 场景源文件，不再用于研究底座。
- `src/research-scenes.js`、`research-models.js`：五个交互概念场景的生命周期、地理坐标映射、路径几何与冲击时间轴；不运行或展示论文实证模型。
- `src/foundation-scene.js`：沿用原始矩阵与 42 节点网络视觉，采用分层连线、重点路径和轻微鼠标视差，不附加步骤文字与公式；`src/resilience-scene.js`：分支链网、碎裂、级联、备用路径与分段重建。
- `public/media/research-*.jpg`：由对应 Three.js 场景生成的静态后备图，可运行 `npm run qa:research -- --desktop --posters` 更新。
- `.artifacts/film/`、`.artifacts/site/`：本地核验截图与记录，默认不提交。

V1 媒体仍保留供版本比较；页面已切换到带 `v2` 的新地址，不会继续使用浏览器缓存的旧影片。

## 地球轮廓素材与展示边界

地球陆地轮廓来自 [Natural Earth 1:110m land](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson)，本地文件 `public/media/ne-110m-land.geojson`。使用原始 GeoJSON 多边形生成等距柱状纹理，不使用手绘假地图，不绘制国界；Natural Earth 数据为[公有领域](https://www.naturalearthdata.com/about/terms-of-use/)。这是新增网页场景使用的地理素材，原有 MV 本身未引入外部图像或影片。

球状网络、地球路线、冲击时序及证据树均为概念设计，未使用原始 MRIO、真实贸易流或论文实证结果。地球轮廓是真实地理数据，路线与节点位置用于示意，不代表研究覆盖范围。工作台数据库另行查询真实入库表，不能把首页动画当作数据库或模型计算结果。

新增场景核验覆盖六种屏幕尺寸：检查桌面右侧布局、手机无重叠、Canvas 非空、时间变化、真实鼠标事件、暂停、离屏停绘、地理数据加载、减少动态效果和无 WebGL 后备图；生产构建另外核验桌面和手机。报告与截图位于 `.artifacts/research/`。

### 研究机制与分支链网

研究底座根据最新批注回到原来的三维矩阵与网络视觉，不再使用带步骤标题、公式和说明的四步流程图。三块无字矩阵板连接 42 个分层节点，主路径强调、次级连线弱化，关键节点以大小和色彩区分；动画通过矩阵扫描、方向信号和节点逐层响应表达联系。没有轨道装饰、随机长跨边或图内文字，保留原有底部非实证标记和暂停按钮。完整设计见 [视觉机制说明](docs/visual-method-redesign.md)。

地球增加至 30 个示意位置，以近邻连接和跨区域主路径构成 76 条示意路线。主路径与次级路径采用不同粗细、透明度及箭头尺寸；近程路线贴近球面，远程路线更高，保留陆地轮廓的可辨识度。

冲击恢复模块改为 20 秒分支链网循环：8 个连接点、9 条分支、59 个金属链环。局部断裂后，冲击依次沿两条分支扩散；每处破裂包含 6 段链环碎片及 8 个碎屑，伴随回弹与下坠。备用链先承压绕行、维持下游连接，受损连接随后按不同时间窗口逐段重建，采用缓入缓出和衰减摆动，避免整体同时变色或生硬复位。六段阶段控件支持查看稳态、破裂、连锁、绕行、重建及恢复，点击后暂停，播放按钮从所选阶段继续。

这是一套手工编排的概念视觉，不是物理仿真、投入产出冲击求解器或韧性数值结果；循环时间不对应经济恢复时间。备用路径的可达性通过示意有向图检查，但不能据此推断真实行业具备技术替代能力。原有 MV 不随此次网页调整重制。

`npm run qa:research -- --comments --posters` 聚焦研究底座与分支链网，包含用户批注时的 1625×884、1440×960、390×844 和 320×568 尺寸，检查六个阶段、局部破碎、延迟级联、维修前备用路径可达性、渐进重建、阶段选择、画面边界与像素变化。静态后备图由相同场景重新生成；生产构建使用 `npm run qa:research:production -- --comments` 复查。

`npm run qa:research -- --foundation --posters` 只复查本次研究底座调整：42 节点、三块矩阵、无新增文字、画面边界、运动、鼠标交互、暂停、离屏停绘及静态后备图。对应生产构建复查加 `--production --foundation`。

## 重新制作影片

需要 FFmpeg 和 Playwright 可用浏览器。Windows 的脚本自动寻找本机 Edge/Chrome；其他系统可运行 `npx playwright install chromium`。也可显式设置 `BROWSER_PATH`。FFmpeg 从 PATH 或 `FFMPEG_PATH` 读取，不在项目中附带可执行程序。

```sh
npm run score
npm run film -- --qa
npm run film -- --both
npm run test:film
```

Windows PowerShell 指定 FFmpeg 示例：

```powershell
$env:FFMPEG_PATH = 'D:/tools/ffmpeg/bin/ffmpeg.exe'
npm run film -- --both
```

每帧以真实 1920 × 1080 分辨率渲染，固定导出 960 帧，不将低分辨率视频放大成 1080p。`--both` 复用每帧 3D 渲染，同步生成完整与无字背景版；编码完成后才替换目标文件。程序检查八幕分别非空、有运动、彼此不同，并检查剪辑边界。网站核验包含六种尺寸、八幕字幕同步、入口、音频、暂停、影片弹窗、下载文件哈希、键盘关闭、3D 像素变化与鼠标响应。
