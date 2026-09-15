# DSH 版本支持与传输适配（当前版本 0.6.4）

dsh-ui-auth **在同一份代码里同时支持两条 Host 传输线**，按能力探测自动选择，不需要用户配置；
本节说明两条线的差异、modern 线对普通用户的收紧项，以及可复现的验收方式。
（历史版本在各节的「修复记录」中说明。）

| Host | 传输面 | 本插件走的路径 |
|---|---|---|
| DSH `0.1.1-rc.2`（旧版基线，历史行为保持不变） | dotted `/api/<a>.<b>` + `apiProxy` 事件流（`/api/events.mux`、`/api/events.host`） | **legacy 路径**：dotted 方法表授权/过滤 + `apiProxy` 逐帧隔离 |
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
- Agent 预设：`agentPresets/list`（设置面板【Agent 预设】页与新建会话的预设选择器在加载时依赖它）、
  `agentPresets/read`、`agentPresets/select`（后两者是 agent 作用域，按会话属主校验）
- 插件清单：`pluginInventory/list`（【插件】页的只读清单；安装/卸载/启停不在白名单内）
- 共享只读元数据：`settings/describe`（宿主已脱敏）、`llm/listProviders`、`llm/listConfigurableProviders`
- 自有资源 URL：`/api/session.export?sessionId=`、`/api/session/uploadFileBinary?sessionId=`（属主校验）

### 普通用户一律拒绝（0.1.5）

`settings/{update,replace,mutate,openSettingsDocument,openAgentPresetDirectory,canOpenAgentPresetDirectory}`、
`credentials/*`、`llm/discoverModels`、`agentPresets/{copy,deletePreset}`（会写出新的预设组合，
而预设可以挂载插件与提示词）、`pluginInventory/{install,uninstall,enable,disable,update}`
（安装/卸载/启停插件属部署方能力；白名单按端点登记，宿主后续新增的写操作默认仍被拒）、
`workspace/create`、`directoryPicker/*`、`session/openWorkspacePath`、`commands/execute`、
`subagents/*`、`dynamicCordisRunner/*`、`/api/file`、`/api/present.*`、`/open-in-app/*`、
以及所有未列出的端点与事件。

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

## 4. 验收方法（可复现）

```bash
# 单元与回归（安全套件、modern 策略、主机/客户端冒烟、登录页与端点联通）
npm test

# 隔离的 0.1.5-rc.1 实例（一次性 DSH_HOME + 临时工作目录，任何临时路径均可）
#   1) 安装官方 CLI 并初始化 profile
npm install --prefix <tmp>/cli @deepseek-ai/dsh@0.1.5-rc.1
DSH_HOME=<tmp>/home dsh plugin --profile web add <本仓库路径>
#   2) 启动（端口自选，工作目录即插件状态根）
DSH_HOME=<tmp>/home dsh web --port 3201 --no-open
#   3) 端到端验收（HTTP/unary 与流式 mux）
DSH015_URL=http://127.0.0.1:3201 DSH015_BOOTSTRAP=<tmp>/work/dsh-ui-auth-bootstrap.txt node test/live-015-check.mjs
DSH015_URL=http://127.0.0.1:3201 DSH015_BOOTSTRAP=<tmp>/work/dsh-ui-auth-bootstrap.txt node test/live-015-mux.mjs

# 浏览器级验收（设置面板「用户管理」入口、页面渲染与通行密钥卡片状态）
DSH_UI_URL=http://127.0.0.1:3201 DSH_UI_USER=admin DSH_UI_PASSWORD=<一次性口令> node test/live-ui-check.mjs

# 普通用户视角的设置页可用性（modern 线）：Agent 预设 / 插件页必须能加载，写操作仍 403
DSH_PAGES_URL=http://localhost:3201 DSH_PAGES_ADMIN_PASSWORD=<一次性口令> node test/live-user-pages-check.mjs

# 通行密钥端到端（真实 Chrome + CDP 虚拟认证器；必须用 localhost）
DSH_PK_URL=http://localhost:3201 DSH_PK_USER=admin DSH_PK_PASSWORD=<一次性口令> node test/live-passkey-check.mjs

# 旧版基线 0.1.1-rc.2 回归（真实部署）
DSH_LEGACY_URL=http://127.0.0.1:3080 node test/live-legacy-check.mjs
```

最近一次完整验收的结果见下方「0.6.4：通行密钥与浏览器对 RP ID 的硬性约束」一节；
更早版本（0.6.0–0.6.2）在两条传输线上的验收结果保留在「历史验收」小节。

## 5. 已知问题与修复记录

### 0.6.5：modern 线上普通用户的【Agent 预设】与【插件】页面加载失败

**现象**（真实用户报告）：DSH `0.1.2+` 的部署里，普通用户有两个设置页失败——
【Agent 预设】显示「无法加载 Agent 预设。」（日志 `agentPresets/list failed: HTTP 403`），
【插件】显示「暂时无法读取插件。」（`pluginInventory/list` 被拒）。

**根因**：modern 路径对普通用户是 deny-by-default，而 `agentPresets/*` 与 `pluginInventory/*`
被整体拒绝；这两页在加载时先取清单，一处被拒即整页失败。被拒的是**只读元数据**，
不是需要保护的写操作。

**修复**（按端点登记白名单）：放行 `agentPresets/list`、`pluginInventory/list`，以及 agent 作用域
（按会话属主校验，规则同 `skills/list`、`goals/*`）的 `agentPresets/read` 与 `agentPresets/select`。
仍然拒绝且**不会**因这次放行而开放的：`agentPresets/{copy,deletePreset}`（预设会组装插件与提示词，
创建预设是提权面）、`pluginInventory/{install,uninstall,enable,disable,update}`（安装/卸载/启停属
部署方能力）、`settings/*`（含插件设置）与 `credentials/*`。
`settings/canOpenAgentPresetDirectory`、`settings/openAgentPresetDirectory`、`settings/update`
仍被拒——客户端把它们的失败按"该功能不可用"处理，不影响页面加载。

**回归防护**：`test/live-user-pages-check.mjs`（HTTP + 真实浏览器，**24 项**）覆盖两页的加载
与写操作拒绝对照；`test/modern-policy.test.mjs` 同步新增策略单测（**15 项**）；
`test/live-015-check.mjs` 把"普通用户可读插件清单"与"安装/卸载仍 403"都固定成断言（**29 项**）。

**同类排查**：审计了全部设置页客户端 bundle 的加载期调用（`remote.<ns>.<method>`），
除以上两页外没有第三个"加载即 403"的页面；其余可见的设置项属于**有意的收紧**，见下表。

**legacy 线审计（0.1.1-rc.2，同一份真实部署）**：不存在同类问题——该线用的是单数 `agentPreset.*`
端点，且本插件在 legacy 路径只拦管理员面，普通用户调用 `agentPreset.list` 得到 **200 + ok=true**
（浏览器实测【Agent 预设】与【插件】两页均正常渲染，无失败文案）。
`pluginInventory.list` 在该组合下返回 404（宿主未挂载该 Remote）——关键不变量是**插件层不得返回 403**，
它已随 `test/live-legacy-check.mjs` 固定成断言（**16 项**）。

> 两线的**有意差异**（modern 更严）在预设作者权限上体现得最明显：legacy 允许普通用户调用
> `agentPreset.copy/remove`（单用户 DSH 下预设在用户自己的 `DSH_HOME` 内，属 DSH 设计能力）；
> modern 多用户部署里预设有**共享清单**且可挂载插件与提示词，因此 `agentPresets/{copy,deletePreset}`
> 对普通用户保持拒绝。需要放开的部署可用 `uiAuth.registerPolicy()` 逐条登记。

### 已知边界：普通用户设置页中仍被有意收紧的部分（0.1.2+）

以下端点在 modern 路径下对普通用户保持拒绝，因此对应界面元素会显示"不可用"或按操作报错；
它们**不会**让整页加载失败（除【插件】页会显示占位错误文案）：

| 界面/能力 | 被拒端点 | 理由 |
|---|---|---|
| 【模型】页与 API Key | `credentials/*`、`llm/discoverModels`、`settings/mutate` | 模型与密钥属部署方能力；客户端对普通用户已替换为提示页 |
| 【插件】页里的单个插件设置 | `credentials/*`、`settings/*` | 插件设置即部署级配置与密钥；清单本身（`pluginInventory/list`）已对普通用户开放 |
| 预设的创建/删除 | `agentPresets/{copy,deletePreset}` | 预设可挂载插件与提示词，属提权面 |
| 插件的安装/卸载/启停 | `pluginInventory/{install,uninstall,enable,disable,update}` | 属部署方能力（白名单按端点登记） |
| 打开设置/预设目录 | `settings/openSettingsDocument`、`settings/openAgentPresetDirectory`、`settings/canOpenAgentPresetDirectory` | 文件系统路径属宿主能力 |
| 任意设置写入 | `settings/{update,replace,mutate}` | 部署级配置 |
| 斜杠命令/子代理/目录选择器/Dynamic Cordis | `commands/execute`、`subagents/*`、`directoryPicker/*`、`dynamicCordisRunner/*` | 可改权限、文件系统访问或加载插件 |

需要放开的部署可通过 `uiAuth.registerPolicy()` 逐条登记（见 §3）；这是**有意的白名单收紧**，
而不是"还没做完"。若某天发现普通用户的某个**只读**页面因此整页失败，请按 0.6.5 的方式修：
放行只读端点（必要时按属主校验），保留写操作的管理员限制。

### 0.6.4：通行密钥（Passkey）与浏览器对 RP ID 的硬性约束

两条传输线都不受影响：通行密钥的全部端点都在 `/auth/*` 之下（登录页/注册页/脚本/登录接口），
而 modern 网关只接管 `/api`，因此 0.1.1-rc.2（legacy）与 0.1.2+（modern）走的是同一条插件内
处理路径，无需为传输线做分支。

**实测发现的浏览器约束**（`test/webauthn-probe.mjs`，Chrome 152 / Windows，CDP 虚拟认证器）：

| 访问来源 | 注册 | 免用户名登录 | 说明 |
|---|---|---|---|
| `http://localhost:<port>` | ✅ | ✅ | 回环地址被浏览器视为安全上下文；RP ID = `localhost` |
| `http://127.0.0.1:<port>` | ❌ | ❌ | `SecurityError: 127.0.0.1 is an invalid domain` —— Blink 不接受 IP 字面量作为 RP ID |
| `http://<内网 IP>:<port>` | ❌ | ❌ | 明文 HTTP 非安全上下文 + IP 不能作为 RP ID |
| `https://<域名>` | ✅ | ✅ | 推荐的生产部署方式 |

因此插件把这条约束**前置到服务端**：`assessRelyingParty()` 判定地址不可用时，
`/auth/passkey/*` 直接返回 409（含 `issue` 与 `suggestedHost`），登录页不注入通行密钥按钮而是显示
「请改用 http://localhost:<端口>」，设置面板的通行密钥卡片同样给出该提示——不会出现"按钮点了没反应"。
反向代理或子域共享场景可用 `DSH_AUTH_RP_ID` / `DSH_AUTH_ORIGIN` 显式指定。

**验收（2026-09-16，两条宿主线均以 0.6.4 构建实测）**：

| 验证项 | 结果 |
|---|---|
| `npm test`（离线全链） | 安全套件 **147/147**、modern 策略 **13/13**、host-smoke（含通行密钥 16 项）、client-smoke（含通行密钥 9 项）、登录页/端点 **24/24** —— 全绿 |
| 隔离 0.1.5-rc.1 实例：通行密钥端到端（真实 Chrome + CDP 虚拟认证器） | **27/27** —— 注册（`residentKey=required` + UV）、免用户名登录（可发现凭据）、计数器推进、2FA 第二步走通行密钥断言、反锁死拒删、结束复位 |
| 隔离 0.1.5-rc.1 实例：HTTP/unary 与授权面（`live-015-check`） | **28/28** |
| 隔离 0.1.5-rc.1 实例：`/api/remote.mux` 流与逐帧隔离（`live-015-mux`） | **12/12** |
| 隔离 0.1.5-rc.1 实例：浏览器级设置面板 | **8/8**（含通行密钥卡片与按地址给出的状态） |
| 真实 0.1.1-rc.2 部署：legacy 回归（dotted RPC / `apiProxy` / 授权面） | **14/14** |
| 真实 0.1.1-rc.2 部署：浏览器级设置面板（`http://127.0.0.1:3080`） | **7/7** |
| 真实 0.1.1-rc.2 部署：浏览器级设置面板（`http://localhost:3080`） | **7/7** |
| `npm run store:check` | **20/20**（新增运行依赖已登记，权限信号集合不变） |
| `npm run verify:clean` | 通过（`lib/` 与 `src/` 一致，构建可复现） |

真实部署复核要点：面板的重启由独立计划任务完成（原面板进程即承载验收会话的进程），
重启后 `/auth/passkey/login/options` 返回 **409 + `issue: ip-literal` + `suggestedHost: localhost`**
（旧构建在同一路径返回 404），证明线上加载的确实是 0.6.4 构建。

同一面板的两种来源复核说明：以 `http://127.0.0.1:3080` 访问时，通行密钥卡片显示
「请改用 http://localhost:3080」提示而不是添加入口；改用 `http://localhost:3080` 访问即显示
「＋ 本机通行密钥 / 📱 手机扫码添加」两个入口——这就是 IP 字面量不能作为 RP ID 时的预期行为，
插件据实提示而非给出一个按了没反应的按钮。

### 0.6.2：TypeScript 重写（行为不变）

`src/*.ts` 成为唯一源码，`lib/*.js` 改为构建产物：

| 源码 | 产物 | 构建 |
|---|---|---|
| `src/index.ts` | `lib/index.js`（ESM） | `tsc -p tsconfig.json` |
| `src/webauthn.ts` | `lib/webauthn.js` | 同上（0.6.4 新增） |
| `src/modern-gateway.ts` | `lib/modern-gateway.js` | 同上 |
| `src/modern-policy.ts` | `lib/modern-policy.js` | 同上 |
| `src/client.ts` | `lib/client.js` | `node build/client.mjs`（esbuild + `__ModuleLoader__` 工厂包装） |
| `src/passkey-browser.ts` | `lib/passkey-browser.js` | 同上（IIFE，暴露全局 `SWA`；登录页通过 `/auth/passkey/browser.js` 加载，0.6.4 新增） |

客户端必须用 esbuild 包装的原因：DSH 客户端模块契约是经典脚本 + 工厂形式
（`window.__ModuleLoader__.load({ id, factory: (require) => … })`，`require('react')`
取自宿主冻结模块表），`build/client.mjs` 复刻该包装并在构建后自检产物形状。

**保真核验方法**（`node test/port-fidelity.mjs <git-ref>`）：直接逐行 diff 无意义（tsc 会重排格式），
因此对比**可观察要素的多重集**——字符串字面量、数字字面量、导出名——因为本插件的行为载荷几乎都在
字符串里（登录/注册/引导页 HTML、CSS 规则、错误文案、凭据键、端点名）。

结论（对比 `HEAD`，即重写前的手写实现）：

| 模块 | 结果 |
|---|---|
| `lib/index.js`（宿主主体） | 字符串/数字/导出名**完全一致**；手写版与构建版经 esbuild 压缩后 **sha256 完全相同**（token 级一致，仅格式与类型擦除差异） |
| `lib/modern-gateway.js` | 仅注释中 `index.js` → `index.ts` 措辞差异 |
| `lib/modern-policy.js` | 仅注释措辞差异（两处纯结构性改写已改回原实现） |
| `lib/client.js` | 剩余差异全部来自 esbuild（剥离注释、`undefined` 打印为 `void 0`、引号规范化）；两份 bundle 经同一 esbuild 规范化重打印后**逐字节相同** |

行为由现有测试链与端到端验收覆盖：`npm test`（147 + 13 + 21 场景 + 向量）、隔离 0.1.5 实例
（HTTP **28/28**、mux **12/12**、浏览器 **6/6**）、真实 0.1.1-rc.2（legacy **14/14**、浏览器 **5/5**）、
`store:check` **20/20**。

### 0.6.0 → 0.6.1：客户端菜单注入在 0.1.2+ 上静默失效

0.6.0 在 0.1.5-rc.1 实例上登录、隔离、原生 UI 都正常，但设置面板导航里**没有「用户管理」**。

根因：`slots` 服务的提供方在 0.1.5 从 `@deepseek-ai/dsh-client-runtime` 变为
`@deepseek-ai/dsh-client-ui-renderer`，且客户端模块到达顺序在该版本变成显式依赖
（`dsh.client.inject` 由信息性元数据变为工厂到达屏障）。本插件客户端行未声明依赖
（boot 图中该行为 `{"id":"dsh-ui-auth","url":...}`，无 `inject` 字段），可能在服务就绪前
`apply`；旧实现在 `ctx.get('slots') === undefined` 时**静默 return**，于是设置项从未注册。
HTTP/RPC 级验收完全看不到该故障，只有真实浏览器能暴露。

修复（0.6.1）：客户端插件显式声明 `exports.inject = ['slots']`，并保留有界重试与**失败时明确报错**；
新增浏览器级验收 `test/live-ui-check.mjs` 覆盖该回归。纪律：**客户端注册类改动必须用真实浏览器验收**。

另注（非缺陷）：登录后浏览器仍会对 `/manifest.webmanifest` 发一个不带 cookie 的请求并被门拒绝（401），
这是 PWA manifest 的取用方式所致，不影响功能；0.1.1-rc.2 上行为相同。

### 历史验收（0.6.0–0.6.2，保留原始记录）

`npm test` **147/147 + modern 策略 13/13** 通过。端到端：

- **隔离 0.1.5-rc.1 实例：28/28**（HTTP/unary Remote）——登录门 302、未认证 API 401、
  登录后原生 UI 200（carrier 桥接成功）、slash Remote 可用、创建会话归属落盘、
  普通用户看不到他人会话、跨用户 `session/page` 403、他人 workspace 建会话 403、`cwd` 覆盖 403、
  9 项管理面逐条 403、未知端点 403、登出后 401
- **同一实例 mux 流式：12/12**——未认证升级被拒（socket 被销毁，未建立 101）、
  admin `$events` 首帧 `ready{clientId}`、`session/control` 首帧 baseline、
  普通用户 `workspace/follow` baseline 已裁剪为空、admin 收到自有会话 `api-session/added` 而
  **普通用户同刻未收到该帧**（逐帧隔离）、普通用户未收到任何 waterfall
- **浏览器级**：设置导航 `[通用设置 | 模型 | 插件 | Agent 预设 | 用户管理]`，
  「用户管理」页渲染出「我的账号 / 修改密码 / 两步验证」，管理员额外看到「创建用户 / 邀请码管理」，
  无插件级错误——隔离实例 **6/6**、旧版 0.1.1-rc.2 面板 **5/5**
- **0.1.1-rc.2 真实部署：14/14**——dotted Remote 仍可用、普通用户 LLM/凭据管理面 403、
  会话导出属主检查 403、登出吊销生效
- `store:check` **20/20**

> 0.6.4 起浏览器级用例增加了两项通行密钥断言，因此同一批验收的数字相应变为 **8/8**（隔离实例）
> 与 **7/7**（0.1.1-rc.2 面板）；数字差异来自新增用例，不是行为回归。

## 6. 上游草稿的复用与差异
本版本的 modern 路径**复用了上游 PR #1 的设计与代码骨架**
（`lib/modern-gateway.js` 的 carrier 桥接、mux 处理、correlation 与 waterfall 释放；`lib/modern-policy.js` 的
策略形状与 `uiAuth` 接口；`test/modern-policy.test.mjs` 的回归用例），并按 0.1.5 的真实面重建了
端点表、事件表与绕过 Remote 的 `/api` 路由处理，另外：

- 修掉了 PR #1 未覆盖的 gzip 投影失败（强制 `identity` + 清理编码头）；
- PR #1 声称"`timer` 依赖阻止激活"经核实在 0.1.2 与 0.1.5 均不成立（两版 base bundle 都安装 timer）；
  本版本仍去掉该依赖，理由是**可移植性**而非激活阻断；
- PR #1 的 0.1.2 目标已被上游跳过两个小版本，其端点/事件白名单对 0.1.5 不适用。
