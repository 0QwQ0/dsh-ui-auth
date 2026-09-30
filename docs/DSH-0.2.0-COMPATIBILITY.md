# DSH 0.2.0 兼容性（v0.7.0 起）

> **面向：**升级与集成者。

> 本文取代 `docs/DSH-0.1.5-COMPATIBILITY.md`（该文对应 v0.7.0 之前的双传输线时代）。
> 配套设计文档：[按用户隔离的模型与 API Key](RBAC-MODEL-PROFILES.md)、开发基线 [v0.7.0 路线图](ROADMAP.md)。

## 1. 三档兼容矩阵

| 档位 | DSH 版本 | 结论 | 依据 |
|---|---|---|---|
| **目标** | `0.2.0-rc.2` | ✅ **compatible** | 一次性实例实测：插件启动并完成初始化、登录门覆盖页面/`/api`/`/plugins`/WS 升级、端点面按下文实测登记 |
| 中间 | `0.2.0-rc.1` | ✅ compatible | 2026-09-16 实测：`test:compat:0.2.0` **38/38**（与目标版本同结论） |
| 中间 | `0.1.7-rc.2` / `0.1.7-rc.1` | ✅ compatible | 2026-09-16 实测：两者均 **38/38**（该线出现过宿主包改名 `dsh-agent-presets` → `dsh-agent-preset`，但端点命名空间仍为 `agentPresets/*`） |
| 中间 | `0.1.6-alpha.2` | ⚠️ 能力收窄 | 2026-09-16 实测：**37/38**，唯一失败是 `pluginManager/registries` → 404（该 alpha 尚无此端点） |
| 中间 | `0.1.6-alpha.1` | ❌ **无法评估** | 2026-09-16 实测：**宿主自身启动失败**（上游缺陷，与本插件无关）：`SyntaxError: The requested module '@deepseek-ai/dsh-app-boot' does not provide an export named 'watchUserPatches'` → CLI 无法引导，插件根本未加载 |
| 中间 | `0.1.5-rc.3` | ✅ compatible（能力面收窄） | 2026-09-16 实测：**34/38**；4 项失败均为该宿主**不存在的端点**（`pluginManager/*`、`permissionPresets/catalog` → 404），其余（登录门、载体桥接、Remote 授权、用户隔离、profile RPC 未解锁拒绝、R2/Q2 阻断）全部通过 |
| 中间 | `0.1.5-rc.2` / `0.1.5-rc.1` | ✅ compatible（能力面收窄） | 2026-09-16 实测：两者均 **34/38**；4 项失败均为该宿主**不存在的端点**（`pluginManager/{listPlugins,listBundles,registries}`、`permissionPresets/catalog` → 404） |
| legacy | `0.1.1-rc.2` | ❌ **已移除** | dotted `/api/<a>.<b>`、`apiProxy` 事件流、自研 WS 帧编解码全部删除；缺失 `connection.authorizeIndex` 时 **fail-closed** |

> **宿主版本声明的坑（v0.7.0 修复）**：旧声明 `>=0.1.1-rc.2 <0.2.0` 在 npm 的**预发布匹配规则**下
> 只匹配 `0.1.1-rc.2` —— 范围里必须存在"同一 `major.minor.patch` 元组且带预发布"的比较器，
> 才会纳入该元组的预发布版本。现声明 `>=0.2.0-rc.2 <0.3.0`（`npm view` 实测解析为 `0.2.0-rc.2`），
> 并接受后续稳定 `0.2.x`；**逐版本结论以 `dshReleases` 矩阵为准**，不以范围的语义猜测。

## 2. 相符性硬前置

- 启动时检查 `ctx.get('connection')?.authorizeIndex`：**不存在即 fail-closed** —— 移除宿主监听器并装上一对"明确拒绝"监听器（HTTP 503 + 可操作文案、WS 直接销毁），
  **不**回退旧传输线、**不**无门放行。
- `webServer` 服务与 `this.server` 仍然存在；自家 `/auth/*` 通过 **官方路由注册**
  （`webServer.register({kind:'prefix', path:'/auth', handler})`）交给宿主路由表分发。

## 3. 现代传输线的接入点（0.2.0 实测）

| 接入点 | 0.2.0 状态 |
|---|---|
| `connection.authorizeIndex` / `authenticatedUrl` / `requestRejection` / `createSharedFetchHandler` | ✅ 全在且签名一致（由 `@deepseek-ai/dsh-client-connection` 提供） |
| `/api/remote.mux` 流式通道 | ✅ 路径与语义不变 |
| 原生载体 Cookie（`dsh-auth-…`） | ✅ 网关在 `prepare()` 阶段下发并回填 |
| 线上信封 | ✅ `{ type:'client-request', rpcId, method, payload:{args} }`；位置参数形态（如 `officeToPdf/render`）亦支持 |
| 客户端契约 | ✅ `__ModuleLoader__`、`settings.section` 槽位、`dsh.bundle.patch` 单 `insert` 形状不变 |

## 4. 普通用户可达面（按登录用户，0.2.0 实测 + 登记）

**放行（只读或按归属）**：`settings/describe`、`llm/listProviders`、`llm/listConfigurableProviders`、
`session/{list,search,modelCatalog,canOpenWorkspacePath}`、`agentPresets/{list,read,select}`、
`pluginInventory/list`、`pluginManager/{listPlugins,listBundles,registries,inspect}`、
`permissionPresets/catalog`、`userQuestions/{answer,attachWait}`、`session/workspacePathApplications`、
`officeToPdf/*`（session + workspace + user 三重归属）、以及按 session/agent 归属的会话读写与
`workspaceFiles/*`、`fileReferences/list`、`commands/list`、`goals/*`、`sessionFeedback/record`、`fileUploads/upload`。

**拒绝（未登记即默认拒绝）**：`pluginManager/{installBundle,removeBundle,setPluginEnabled,setBundleEnabled,cancelInstall,waitForInstall}`、
`pluginRegistryProbe/*`、`account/*`（原生账户页对普通用户整体隐藏；余额改由本插件的 `balanceQuery` 按用户配置提供）、
`settings/mutate`、`credentials/*` 直连、`llm/discoverModels` 直连、`session/initializeDefaultModel`、
`productAnalytics/*`、`dynamicCordisRunner/*`、`workspace/create`、`commands/execute` 等。

**模型与密钥的按用户隔离**：每用户拥有自己的 provider/模型/API Key；
私有配置用**口令派生 KEK + 每配置 DEK**（AES-256-GCM，AAD 绑定 `uid/profileId`）加密，**宿主明文存储中永不出现**；
管理员可把自己的模型分享给指定用户（被授权者可用、**看不到 Key**、**可看余额**），
且**任何管理员都不能读取他人（含其他管理员）的私有配置**。详见 [RBAC 设计](RBAC-MODEL-PROFILES.md)。

## 5. 验收与证据

| 项目 | 证据 |
|---|---|
| 启动与闸门 | 0.2.0-rc.2 一次性实例：插件完成初始化、未登录访问 `/` → 302 `/auth/login`、`/api/*` 未认证 → 401、`/api/remote.mux` 普通用户 → 403 |
| 端点面 | 普通用户逐个端点实测（200/403 分类）并据此登记策略；单测 `test/modern-policy.test.mjs` |
| 密钥隔离 | `test/profile-crypto.test.mjs`（INV-4：主密钥解不开私有配置；存储无明文）、`test/profile-envelope.test.mjs`（信封、AAD、改密重包裹） |
| 服务层语义 | `test/profile-service.test.mjs`（Q2 阻断、Q6 撤销 fail-closed、Q11(c) 继承、分享可见性、用量、余额缓存/限流） |
| 全链 | `npm test`（含 `security-suite` 126/126、`host-smoke`、`login-page-check`）与 `npm run store:check`（20/0） |

> 未实测的中间版本**不会**被标为 compatible；矩阵填表以实际运行为准，详见 `docs/V0.7.0-ROADMAP.md` 的 WP8。

## 6. 如何测一个矩阵数据点（可复现）

每个版本用一个**一次性实例**（把 `<ver>` 换掉，端口逐次递增）：

```powershell
$ev = "$env:TEMP\dsh-<ver>"
npm install --prefix "$ev\cli" "@deepseek-ai/dsh@<ver>"
$env:DSH_HOME = "$ev\home"
& "$ev\cli\node_modules\.bin\dsh.cmd" plugin --profile web add '<repo 或 npm 包>'
& "$ev\cli\node_modules\.bin\dsh.cmd" web --port 3203 --no-open
$env:DSH020_URL = 'http://127.0.0.1:3203'
$env:DSH020_BOOTSTRAP = "$ev\work\dsh-ui-auth-bootstrap.txt"
node test/live-020-check.mjs
```

判读规则：
- **目标版本**期望 38/38；
- **中间版本**缺少 0.2.0 才有的端点/能力时会**预期失败**（例如 0.1.5 没有 `pluginManager/*`、`webServer.register`、
  `registerDeepSeekProvider`）——这类失败记为 `degraded`/`unsupported`，**不是回归**；插件会走防御性回退
  （闸门内处理 `/auth/*`）并打印明确日志；
- 任何版本都**不会**因为缺失现代能力而放行：`connection.authorizeIndex` 缺失即 fail-closed。

结果写回 §1 表格（结论 + 日期 + 通过数），并同步 `CHANGELOG.md` 的"已知边界"。

## 升级（WebSocket）与 mux 的处理（实测修订）

`/api/remote.mux` 是 0.2.0 客户端的**主连接通道**，且**普通用户也需要它**。
v0.6.x 时代的自研 mux（`gateUp` 内的 `WebSocketServer`）与 0.2.0 客户端协议不兼容，
会让设置页一直「重新连接中」（管理员与普通用户都会复现）。现改为：**校验本插件会话后，把升级请求转交宿主处理**。
代价见 README「已知边界」：该通道上的逐帧按用户过滤尚未实现。
