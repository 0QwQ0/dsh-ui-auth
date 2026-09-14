# DSH 版本支持与 0.1.5 适配（dsh-ui-auth 0.6.0）

本插件**在同一份代码里同时支持两条 Host 传输线**，按能力探测自动选择，不需要用户配置：

| Host | 传输面 | 本插件走的路径 |
|---|---|---|
| DSH `0.1.1-rc.2`（开发基线，历史行为保持不变） | dotted `/api/<a>.<b>` + `apiProxy` 事件流（`/api/events.mux`、`/api/events.host`） | **legacy 路径**：dotted 方法表授权/过滤 + `apiProxy` 逐帧隔离 |
| DSH `0.1.2-rc.1` … `0.1.5-rc.1`（当前 `latest`） | slash Remote `/api/<ns>/<method>` + `/api/remote.mux` 流 mux + 原生浏览器 cookie 门 | **modern 路径**：carrier 桥接 + 按端点审查的 deny-by-default 策略 |

选择依据是 `typeof ctx.get('connection')?.authorizeIndex === 'function'`：该 API 在 0.1.1-rc.2 不存在，在 0.1.2 起存在。因此升级互不影响。

## 1. 为什么需要适配（0.1.5 相对 0.1.1-rc.2 的真实变化）

均以 `dsh-v0.1.5-rc.1`（tag `183f08e9`）源码为据：

- **`apiProxy` 服务整体移除**（全树仅归档笔记残留）。旧事件流端点 `/api/events.mux`、`/api/events.host` 不存在。
- **RPC 命名改为 slash**：`session.list` → `session/list`；并新增/改名大量端点（`session/page` 取代 `session.history`、`subagents/*`、`agentPresets/*`、`goals/*`、`directoryPicker/*`、`workspaceFiles/*`、`session/control`、`dynamicCordisRunner/*` 等）。旧插件按 dotted 名建表，若不改会造成**未知端点默认放行 → 按用户隔离静默失效**。
- **流式传输合并为一条 mux**：`/api/remote.mux`，消息为 `{type:'open'|'cancel'|'item'|'end'|'error', streamId, endpoint, payload, value, error}`；转发事件变成 `$events` 逻辑流（首帧 `ready {clientId}`，随后 `emit`/`waterfall`/`cancel`），回执为 `POST /api/$events/result`。
- **原生浏览器 cookie 门**：浏览器必须持有 `dsh-auth-<base64url(sha256(authority))>` 签名 cookie（由 `/?token=<进程启动令牌>` 换取），否则 `/` 与 `/api/*` 一律 401。**因此"插件登录成功"本身不足以让 UI 可用**。
- **绕过 Remote 的 `/api` 精确路由**：`/api/session.export`、`/api/session/uploadFileBinary`、`/api/file`、`/api/present.host|open`，以及 `/open-in-app/*`（不在 `/api` 下，自行调用 `requestRejection`）——只拦 Remote 会漏掉这些面。
- `timer` 服务**没有被移除**（base bundle 仍安装 `@deepseek-ai/cordis-plugin-timer`），但本插件已不再依赖它（改用 `setInterval` + `ctx.effect` 清理），以便在任何 profile 组合下都能激活。
- 凭据键语法 `^[a-z][a-z0-9-]*$` 是**基线就有的约束**（0.1.1-rc.2 同样存在），不是新版收紧：`grant` 记录写入时不校验键，但下次启动 `parseRecords` 会校验每个键——因此历史上"注册一个含大写/点的用户名"会让整个凭据库在重启时加载失败（fail-closed 503）。0.6.0 起对不合语法的新用户名使用 `user-<sha256>` 记录键，并保留小写用户名的原键（无迁移影响）。

## 2. modern 路径的设计

沿用上游草稿 PR #1（StormSeven1，`fix/dsh-012-auth-isolation`）中经过核验的设计，并按 0.1.5 的真实端点表重建：

1. **carrier 桥接**：对每个已通过插件登录的请求，进程内调用
   `connection.authenticatedUrl()` + `connection.authorizeIndex()` 换取原生 cookie，
   剥离客户端自带的 `dsh-auth-*`，只注入本进程刚签发的那一枚；随后 `connection.requestRejection(req)` 复核。
   **浏览器永远拿不到原生 cookie，也拿不到进程启动令牌。**
2. **deny-by-default 策略**：普通用户只被允许访问经过审查的端点，且逐条做属主校验；未列出的端点一律 403。
3. **属主绑定与过滤**：`session/create|fork` 返回前先落盘归属（失败则回滚并拒绝返回）；
   `session/list|search` 过滤 `items`；`workspace/follow`、`session/control` 的 baseline/增量帧按键裁剪
   （`queues`/`jobs`/`projections` 三张表按 SessionId 裁剪）。
4. **流式逐帧复核**：`/api/remote.mux` 每次投递前重新校验登录态与属主；登出/改权 1 秒内关闭长连接。
5. **事件回执不悬置**：被过滤掉的 `waterfall`（`approval/request`、`user-questions/request`）由插件
   代答 `$events/result {kind:'next'}`，否则 owner 的 `next()` 会永久等待。
   `$events/result` 本身只接受与"本登录 + 本次连接 + 已投递事件"三者匹配的回执。
6. **投影响应**：需要改写响应体的路径强制上游返回 `accept-encoding: identity`（压缩体无法投影），
   并在写回时清除继承的 `content-encoding`/`transfer-encoding`/`content-length`。

### 普通用户可达面（0.1.5）

- 自己的会话：`session/create`（限已被分配的 workspace、禁止 `cwd` 覆盖）、`page`、`follow`、`prompt`、
  `attachment`、`cancel`、`rename`、`selectModel`、`updateQueue`、`fork`、`list`、`search`、`modelCatalog`、`canOpenWorkspacePath`
- 自己的 workspace：`rename`、`delete`、`insertBefore`、`insertSessionBefore`、`archiveSession`、`follow`
- 自己的文件范围：`workspaceFiles/{read,readBytes,readAll,readRelated,stat,list,changes}`（按 `workspaceFileScopeId` 属主）
- 自己的 agent 范围：`skills/list`、`fileReferences/list`、`sessionReferenceResolver/candidates`、
  `fileUploads/upload`、`commands/list`、`goals/*`
- 自己的会话反馈：`messageFeedback/*`、`sessionFeedback/record`
- 共享只读元数据：`settings/describe`（宿主已脱敏）、`llm/listProviders`、`llm/listConfigurableProviders`
- 自有资源 URL：`/api/session.export?sessionId=`、`/api/session/uploadFileBinary?sessionId=`（属主校验）

### 普通用户一律拒绝（0.1.5）

`settings/{update,replace,mutate,openSettingsDocument,openAgentPresetDirectory}`、`credentials/*`、
`workspace/create`、`directoryPicker/*`、`session/openWorkspacePath`、`commands/execute`、
`subagents/*`、`agentPresets/*`、`llm/discoverModels`、`pluginInventory/list`、
`dynamicCordisRunner/*`、`/api/file`、`/api/present.*`、`/open-in-app/*`、以及所有未列出的端点与事件。

> 与 legacy 路径的两处**有意差异**（modern 更严）：legacy 允许普通用户创建 workspace 与改 `general` 设置；
> modern 路径把 workspace 创建视为**部署方能力**（`cwd`/路径属于宿主能力，不是用户能力），
> 且普通用户不得写任何设置命名空间。需要放开的部署可通过 `uiAuth.registerPolicy()` 逐条登记。

## 3. 下游插件接口（`ctx.get('uiAuth')`，仅 modern 路径）

| 方法 | 契约 |
|---|---|
| `ready` | 账号与归属状态加载完成的 Promise；宿主 provisioning 代码应 await |
| `user(username)` | 可信后台执行用的当前账号 principal，账号删除后为 undefined |
| `principal(request)` | 本请求被接纳的不可变 `{username, role}`；**不得**从请求头或报文里推断身份 |
| `ownerOfSession(id)` / `ownerOfWorkspace(id)` | 当前归属；未登记的按 `admin` 处理 |
| `claimSession(id, username)` / `claimWorkspace(id, username)` | 先等待就绪再落盘归属；未知用户/非法 id/冲突归属会被拒绝 |
| `registerPolicy(id, rules)` | 登记唯一策略并返回 disposer；命中歧义时 fail-closed |

`rules` 支持 `http`（`matches({pathname,method})`/`authorize(principal, request)`）、
`rpc`（替换匹配端点的内建规则）、`remote`（在内建规则之上追加限制，全部须通过）、
`stream`（`matches(endpoint)`/`authorize`/`project`，`project` 返回 `null` 抑制该帧）、
`upgrade`（自有 WebSocket 传输）。**登录成功不等于业务插件的数据隔离**：业务插件仍须自己做对象级授权与状态分区。

## 4. 已执行的验收（可复现）

```bash
# 单元与既有回归（147 项安全套件 + 13 项 modern 策略）
npm test

# 隔离的 0.1.5-rc.1 实例（一次性 DSH_HOME + 临时工作目录）
#   1) 安装官方 CLI 并初始化 profile
npm install --prefix <tmp>/cli @deepseek-ai/dsh@0.1.5-rc.1
DSH_HOME=<tmp>/home dsh plugin --profile web add <本仓库路径>
#   2) 启动（端口自选，工作目录即插件状态根）
DSH_HOME=<tmp>/home dsh web --port 3201 --no-open
#   3) 端到端验收
DSH015_URL=http://127.0.0.1:3201 DSH015_BOOTSTRAP=<tmp>/work/dsh-ui-auth-bootstrap.txt node test/live-015-check.mjs

# 开发基线 0.1.1-rc.2 回归（真实部署）
DSH_LEGACY_URL=http://127.0.0.1:3080 node test/live-legacy-check.mjs
```

实测结果（2026-09-14）：

- `npm test`：**147/147 + modern 策略 13/13** 通过
- 隔离 0.1.5-rc.1 实例：**28/28** 通过——登录门 302、未认证 API 401、登录后原生 UI 200（carrier 桥接成功）、
  slash Remote 可用、创建会话归属落盘、普通用户看不到他人会话、跨用户 `session/page` 403、
  他人 workspace 建会话 403、`cwd` 覆盖 403、9 项管理面逐条 403、未知端点 403、登出后 401
- 0.1.1-rc.2 真实部署：**14/14** 通过——dotted Remote 仍可用、普通用户 LLM/凭据管理面 403、
  会话导出属主检查 403、登出吊销生效

## 5. 上游草稿的复用与差异

本版本的 modern 路径**复用了上游 PR #1 的设计与代码骨架**
（`lib/modern-gateway.js` 的 carrier 桥接、mux 处理、correlation 与 waterfall 释放；`lib/modern-policy.js` 的
策略形状与 `uiAuth` 接口；`test/modern-policy.test.mjs` 的回归用例），并按 0.1.5 的真实面重建了
端点表、事件表与绕过 Remote 的 `/api` 路由处理，另外：

- 修掉了 PR #1 未覆盖的 gzip 投影失败（强制 `identity` + 清理编码头）；
- PR #1 声称"`timer` 依赖阻止激活"经核实在 0.1.2 与 0.1.5 均不成立（两版 base bundle 都安装 timer）；
  本版本仍去掉该依赖，理由是**可移植性**而非激活阻断；
- PR #1 的 0.1.2 目标已被上游跳过两个小版本，其端点/事件白名单对 0.1.5 不适用。
