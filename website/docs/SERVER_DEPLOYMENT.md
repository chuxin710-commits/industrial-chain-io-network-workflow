# CHAINLAB 服务器部署

目标为用户指定的 Linux 服务器，独立域名 `nn.rftf.cc.cd`。不覆盖现有研究助手的站点、3000 端口应用或其他域名。密码与 SSH 私钥不写入项目、发布包或核验报告。

## 目录与运行

- `/opt/chainlab/releases/<版本>/public`：Vite 静态构建，含现有 MV 和三维交互场景。
- `/opt/chainlab/releases/<版本>/server`：只读查询 API，Python 标准库运行。
- `/opt/chainlab/releases/<版本>/data/mrio.sqlite3`：完整年度数据库，不在网站静态根目录内。
- `/opt/chainlab/current`：当前完整版本链接，匹配前端、后端与数据库。
- `chainlab-api.service`：独立非 root 账户运行，只监听 `127.0.0.1:8787`。
- `/etc/nginx/sites-available/chainlab-nn-rftf`：独立 Nginx 站点；其他站点保持原样。
- `/var/backups/chainlab/<时间>`：站点与服务文件备份。

查询支持 GET；不开放任意 SQL、数据修改接口或原始数据库文件下载。Nginx 对查询和导出分别限流，CSV 导出保留全部筛选结果，而非当前可见页。反向代理路径保持原始 `/api/...` 路径，遵循 [Nginx proxy_pass 语义](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)。

## 发布

```sh
npm run build
npm run package:deploy
python scripts/deploy.py --host 服务器IP --domain nn.rftf.cc.cd --identity 本机授权密钥路径 --manifest .artifacts/deployment/版本.manifest.json
```

部署工具只读取指定密钥，或通过隐藏的交互提示读取密码。按白名单打包静态构建、服务代码和部署文件；数据库单独传输。高延迟链路采用四路分块续传，最终合并后校验 SHA-256，再执行安装。服务端运行不依赖本机 Windows 工具。

安装先检查同域名配置冲突，备份旧站点和服务单元，再切换 `current`。启动、查询健康检查、Nginx 语法与代理验证未通过时统一回滚。后续发布保留已有 Certbot HTTPS 配置，不重新覆盖为 HTTP 模板。证书签发使用已有 Certbot Nginx 插件；相关域名校验要求见 [Let's Encrypt HTTP-01](https://letsencrypt.org/docs/challenge-types/#http-01-challenge)。

## 小步界面更新

当数据库与影片不变时，可运行 `python scripts/package-ui-update.py` 生成小型界面增量包。将增量包、对应 manifest 和 `deploy/update-ui.py` 传到服务器后执行：

```sh
python3 update-ui.py --archive 增量包.tar.gz --manifest 增量包.manifest.json
```

更新器把当前版本硬链接到新目录，用原子替换写入变化的前端文件，再原子切换 `current`；不会覆盖旧版本的共享文件。数据库与影片无需重复上传，版本收据记录基础版本及增量哈希。API 在启动时固定数据库真实路径，界面更新不改变运行中的数据快照。

## 计算功能增量

网络拓扑需要更新后端及依赖，不能使用只更新静态界面的 UI 增量包。运行 `npm run package:feature`，上传包、对应 manifest 与 `deploy/update-feature.py`，执行：

```sh
python3 update-feature.py --archive 功能增量包.tar.gz --manifest 功能增量包.manifest.json --domain nn.rftf.cc.cd
```

该更新复用数据库和影片，替换前端、后端及 `ionet` 内核源码；安装器准备 Python 独立环境，再切换服务和核验拓扑端点。依赖清单位于 `server/requirements.txt`，按哈希保存在 `/opt/chainlab/runtimes/`；每个发布目录的 `runtime` 链接对应环境。启动或核验失败时恢复旧服务与发布链接。原有 `/api/table` 查询和 CSV 导出仍保留。

## 核验

```sh
npm run test:database
npm run qa:workspace
node scripts/verify-workspace.mjs --base https://nn.rftf.cc.cd
node scripts/verify-deployment.mjs --base https://nn.rftf.cc.cd
```

数据核验记录保留在 `var/mrio.manifest.json` 和 `var/mrio.verification.json`；界面测试在 `.artifacts/workspace/`。覆盖 24 年目录、5 种分块、双轴筛选及分页、完整筛选导出、精确单元格、来源哈希、手机布局与异常重试。

公网成功需从普通客户端直接访问域名并实际查询。服务器内 curl 或 SSH 隧道只证明服务器/隧道链路，不可替代公网验证。原始行业名称、金额单位与价格口径缺失说明应始终保留。

浏览器核验使用页面原生 `fetch`，与用户浏览器采用相同的网络配置。Playwright 的独立 `APIRequestContext` 不一定沿用系统代理，不能把两者的连通性混为一谈；使用系统代理的测试也不能证明无代理直连。当前发布状态与测试边界见 [首版部署验收](DEPLOYMENT_STATUS_20261015.md)。
