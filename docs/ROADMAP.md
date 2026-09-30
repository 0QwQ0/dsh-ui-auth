# v0.7.0 开发路线图（基线已冻结）

> **面向：**关注进度者 / 贡献者。

> 状态：**基线冻结，开发进行中（分支 `feat/v0.7.0`）**。决策 Q1–Q11 已由项目所有者确认。
> **进度台账**（每次提交后更新；接续开发请从"未完成"一节开始）：

| WP | 状态 | 提交 | 备注 |
|---|---|---|---|
| WP0 spike | ✅ | `814f3dc`(main docs) | 凭据解析路径 → R1 可行 |
| WP1 legacy 移除 + 硬前置 | ✅ | `89f7f3a` `0f7dbb5` | 代码 −1669 行；缺失 `authorizeIndex` → fail-closed |
| WP2 端点策略重写 | ✅ | `b725473` | pluginManager 只读、permissionPresets、userQuestions、officeToPdf 三重归属、account 全拒绝 |
| WP2b 官方路由注册 | ✅ | `7c9043e` | `/auth` 前缀路由；最外层闸门保留（0.2.0 无全局前置钩子） |
| WP3 存储分离 + 加密 | ✅ | `00ce9ab` | uid 分区、PBKDF2→AES-GCM、AAD 绑定、`assertSameUser` |
| WP4a 信封加密 + KekRegistry | ✅ | `7f2e325` | userKek + 每配置 DEK；会话不持口令 |
| WP4b ProfileService | ✅ | `61e18c2` | CRUD/分享/R1 解析/余额（缓存+限流） |
| WP4c RPC + 显式解锁 | ✅ | `79de916` | 全部以登录者身份运行；Key 永不回传 |
| WP4d 密钥生命周期 | ✅ | `58eff85` | 改密重包裹、登出/删用户/重置丢弃 KEK；修掉"每次 RPC 重建服务导致解锁后 locked" |
| WP4e R2 策略侧 | ✅ | `61a19af` | entitlement 裁剪目录/provider + selectModel 授权 |
| WP4f R2 接线 | ✅ | `c12ea04` | index.ts → 网关 → 策略；未配置 → 空授权（Q2 阻断） |
| WP4g R1 裁决 | ✅ | `765710d` | `llm/stream` 对 loop 请求只读 ⇒ R1-i 否决 |
| WP4h R1-ii spike | ✅ | `e307c74` | `DeepSeekAdapterOptions.resolveAuth` 可用 ⇒ 可行且保住 INV-4 |
| WP5 分享用量 | ✅ | `319f6e4` | 按所有者分区、饱和累加、无 Key |
| WP7 元数据 + 包瘦身 | ✅ | `4377d88` | 修 `dsh.compatibility.dsh`（旧范围只匹配 1 个版本）；`build/` 移出发布包 |
| WP7 文档（三档表格） | ✅ | `2bbe67f` | 新 `docs/DSH-0.2.0-COMPATIBILITY.md`；README 三档表 + legacy 结束声明 |
| **WP4 R1-ii 实现** | ✅ | `fc68679` | 每配置一条 provider 路由 + `resolveAuth` 读我们的加密存储（`x-api-key`），宿主缺包时明确停用该路径 |
| **WP6 客户端半边** | ✅ | `58ce972` `bbd8e69` `9444689` | 模型与密钥页（按用户）、分享管理页（管理员）、账户页对普通用户替换为说明、移除 nth-child hack |
| **WP8 测试** | 🔄 部分 | `7e6939a` | `test:compat:0.2.0` 在真实实例上 **38/38**；**多版本矩阵未跑**（中间版本仍标"待实测"） |
| **WP9 发版准备** | ✅ 准备完成 | 本次 | 版本 `0.7.0` + CHANGELOG 已就绪；**发版待所有者确认**（按既有规范：Release 标题仅版本号） |
| **WP10 其余** | 🔄 部分 | `4377d88` | 发布包瘦身 ✅（`build/` 移出）；`qrcode` 依赖**按所有者要求不改动**；`process.env` 收敛未做 |

**接续约定**：每个增量都必须 `tsc` + `build` + `npm test` 全绿后提交；`main` 只在全部完成且所有者确认发版后才合并。
`npm test` 当前包含：security-suite 126/126、host-smoke、login-page-check、modern-policy 19/19、profile-crypto 7/7、profile-envelope 5/5、profile-service 7/7。
> 目标宿主：**DSH `0.2.0-rc.2`**（npm `latest`，rc 预发布——该仓库一贯以 rc 作为 latest）。
> 破坏性变更：① 完全移除 legacy 传输线；② 模型 / API Key 改为**按用户隔离 + 管理员分享**；③ 兼容声明与页面权限重划。

---

## 一、已冻结的决策

| # | 决策项 | 结论 |
|---|---|---|
| Q1 | 私有配置的密钥托管 | **口令派生加密（E2E）**：`KDF(用户口令) → KEK → AES-256-GCM(API Key)`，KEK 仅该用户会话内存持有；分享配置因需无人值守可用，仍由**服务端托管**（主密钥存宿主 credentials） |
| Q2 | 用户既无私有配置也无分享时 | **阻断使用**，**不继承**部署级配置；界面给出明确引导（自己配置 / 请管理员分享） |
| Q3 | 多配置与默认项 | 用户可有**多个**私有配置并设默认；分享**不自动**设为默认，需用户显式选择 |
| Q4 | 原生账户页的权限 | 普通用户**仅只读余额**；登录 / 登出 / 充值仅部署者 |
| Q5 | 部署级配置的写权限 | **仅部署者（初始管理员）**；其他管理员只改自己的私有配置 |
| Q6 | 撤销分享的语义 | **立即生效**；进行中会话在**下一次模型调用** fail-closed，不静默回退 |
| Q7 | 原生账户页对普通用户 | **整体隐藏入口**（`account/*` 全拒绝）；余额改由本插件的 `balanceQuery` 提供 |
| Q8 | `officeToPdf/*` | **不完全放行**：按 **session 归属 + workspace 归属 + user 归属** 三重校验，杜绝跨权限区域访问 |
| Q9 | 闸门接入方式 | **采纳** 0.2.0 官方 route/upgrade 注册，替代包装 `ctx.webServer.server` 的做法；mux 与 carrier cookie 逻辑保留 |
| Q10 | 已 HOLD 的供应链整改 | **并入本版**：`qrcode` → `@nuintun/qrcode`、`process.env` 读取收敛到单文件、发布包瘦身（`build/` 移出 `files`） |
| Q11 | **无主体会话**（后台 / 定时 / 系统任务，或无法归属到本插件用户的会话）的模型调用 | **待确认**：建议 (c) 子代理继承父会话所属用户；真正无归属时 fail-closed |

## 一之二、WP0 spike 结论（已完成，决定 WP4 形态）

- 一次 LLM 请求携带 `GenerateOptions.sessionId`，且 `dsh-llm` 的流式调用 API **可被 waterfall 拦截**、插件亦可注册 `LlmAdapter` → **R1 可行**（R1-i 拦截注入 / R1-ii 自注册 adapter 委托）。
- 宿主凭证 seam 无用户维度、设置 seam 的 `user` 层是部署操作者 → 按用户的模型/密钥维度必须由本插件实现。
- **Q1 方案 B 相容**：私有 Key 仅存本插件加密存储，宿主明文存储永不出现。
- 仍需 **R2** 做界面/端点面按用户裁剪。详见 `docs/RBAC-MODEL-PROFILES.md` 附录 A。

---

## 二、范围

**包含**：DSH 0.2.0-rc.2 适配（端点面 / 闸门 / 客户端半边 / 元数据）、legacy 移除、RBAC 模型与密钥隔离 + 管理员分享、存储分离、文档与兼容表格、测试与多版本实测、供应链整改。

**不包含**：中间版本（0.1.5-rc.x / 0.1.6-alpha.x / 0.1.7-rc.x）的刻意适配——仅**实测顺带可用者**并在文档中标注；不改 DSH 核心与 `@deepseek-ai/*`；不做 Key 云端托管 / 跨部署同步。

---

## 三、工作包

### WP0 可行性 spike（**先行，决定 WP4 形态**）· 0.5–1 天 · ✅ 已完成
**结论（详见 `docs/RBAC-MODEL-PROFILES.md` 附录 A）**：
- 一次 LLM 请求携带 `GenerateOptions.sessionId`（loop 打上的会话身份），且 `dsh-llm` 提供**可被 waterfall 拦截**的流式调用 API，插件亦可注册自己的 `LlmAdapter` → **R1 可行**：
  - **R1-i（首选）** 拦截 waterfall 调用点，按 `sessionId` → 会话归属 → 用户配置 → 注入该 Key；
  - **R1-ii（备选）** 自注册 adapter，内部解析 Key 后委托 `DeepSeekAdapter`。
- `ctx.credentials.resolve(ref)` 以**环境变量名**为键、**无用户维度**；`dsh-settings` 的 `user` 层是部署操作者而非多主体 → 宿主本身**不提供**按用户的模型/密钥维度，必须由本插件实现。
- **Q1 方案 B 相容**：私有 Key 只存在本插件加密存储中，宿主明文存储永不出现（INV-4 成立）。
- 仍需 **R2** 处理界面/端点面的按用户裁剪。
- 遗留待验证 4 项（含无主体会话策略，待 Q11）。

### WP1 移除 legacy 传输线 · 0.5 天
- 删除：`src/index.ts`（9 处 legacy 分支 / `apiProxy` 事件代理 / 自研 WS 帧编解码）、`src/modern-gateway.ts`（6 处）、`src/modern-policy.ts`（5 处）；`test/live-legacy-check.mjs`；README 与文档中的 legacy 段落。
- 新增：宿主线别硬前置——`connection.authorizeIndex` 缺失即 **fail-closed** 并输出明确错误（提示升级到 0.2.0-rc.2 线）。
- 测试：`unsupported-host` 用例（新）。

### WP2 端点策略重写（0.2.0 面）· 1 天
| 命名空间 / 端点 | 普通用户 |
|---|---|
| `pluginManager/{listPlugins,listBundles,registries,inspect}` | ✅ 只读（修复插件管理器页加载失败） |
| `pluginManager/{installBundle,removeBundle,setPluginEnabled,setBundleEnabled,cancelInstall,waitForInstall}`、`pluginRegistryProbe/*` | ❌ |
| `permissionPresets/catalog` | ✅ 只读 |
| `userQuestions/{answer,attachWait}` | ✅ 按 session 归属 |
| `officeToPdf/{render,generation}` | ✅ 按 **session + workspace + user** 三重归属（Q8） |
| `session/workspacePathApplications` | ✅ 按 session 归属 |
| `session/initializeDefaultModel` | ❌ |
| `account/*`（含 `getBalance`） | ❌（Q7：入口整体隐藏） |
| `settings/mutate`、`credentials/*` 直连、`llm/discoverModels` 直连 | ❌（改由 WP4 的按用户通道提供，白名单键除外） |
| 既有允许面（`settings/describe`、`llm/listProviders|listConfigurableProviders`、`session/modelCatalog|canOpenWorkspacePath`、`agentPresets/list|read|select`、`pluginInventory/list` 等） | 保留，按 WP4 裁剪为按用户视图 |

### WP2b 闸门接入官方 route/upgrade 注册 · 0.5 天 · ✅ 已完成
**核实到的 0.2.0 API**（`@deepseek-ai/dsh-host-webserver`）：`register({kind:'exact'|'prefix', path, handler})`、`registerUpgrade({path, handler})`、`registerFallback(handler)`（**仅一个座位，已被 SPA dist 占用**）、`tapIndex(transform)`、`webserver/index-inject` 事件；**没有全局前置钩子**（路由表按精确 / 最长前缀匹配，重名抛错）。

**结论与落地**：
- **自家 `/auth/*` 改为官方路由注册**（`kind:'prefix'`, `path:'/auth'`），由宿主路由器按 composition 契约分发，重名冲突由 `register()` 抛错拦住。`/auth/*` 在**已认证与未认证两种情况下都优先交给该处理器**——本轮修掉了一个真实缺陷：已认证用户访问 `/auth/*` 曾被当成页面转发，宿主无对应路由时表现为"无响应"（引导页 3 项检查因此失败）。
- **最外层闸门保留在 `server` 监听器上**：0.2.0 没有全局前置钩子、fallback 座位也已被占用，而"未认证请求不得到达宿主"只能在该位置表达。此结论写入本文件与源码注释，供商店边界审查引用。
- 防御性回退：宿主未提供 `register` 时（异常宿主 / 测试 harness），闸门内直接处理 `/auth/*`。
- mux（`/api/remote.mux`）与 carrier cookie 逻辑不变。

### WP3 存储分离层 · 1.5 天
```
dsh-auth/profiles/private/<uid>/<profileId>     # 私有配置（含密文 Key）
dsh-auth/profiles/grants/<ownerUid>/<targetUid> # 所有者侧授权表
dsh-auth/profiles/shares/<targetUid>/<ownerUid> # 接收侧投影（无 Key 材料）
dsh-auth/profiles/deployment/<profileId>        # 部署级配置（部署者）
```
- 引入**稳定 `uid`**（uuid）：用户名可改 / 可回收（已有 tombstone），存储键改用 uid。
- 私有：口令派生 + AES-256-GCM；改密时用当时明文口令**重包裹**；管理员重置口令 → 私有 Key **不可恢复**，标记"需重新录入"。
- 分享：服务端主密钥 AES-GCM 托管，仅供代调用，任何响应 / 日志不回传 Key。
- 迁移：既有 `dsh-auth/*` 记录补 `uid` 字段并兼容旧数据。

### WP4 按用户的模型 / API Key 面 · 1.5–2 天 · 🔄 进行中

**已完成（WP4a–WP4e）**：
- **WP4a** 信封加密：`userKek = PBKDF2(口令, 用户级 salt)` + 每配置随机 DEK；`KekRegistry` 按会话持有 KEK（不持口令）。
- **WP4b** `ProfileService`：自有配置 CRUD、收到的分享、R1 解析（无配置 → `no-profile` 阻断；未解锁 → `locked`；子代理继承父会话）、余额（服务端代查、60s 缓存、限流）。
- **WP4c** RPC：`profileUnlock/Lock/List/Create/Update/Remove/SetDefault`、`shareList/Select/Own/Grant/Revoke`、`balanceQuery`；一切以登录者身份运行，uid 绝不取自请求体。
- **WP4d** 密钥生命周期：本人改密**重包裹**全部私有配置（无配置时 no-op）、登出/删用户/重置口令丢弃 KEK；修掉"服务实例每次 RPC 重建导致解锁后立即 locked"的真实缺陷。
- **WP4e（R2 策略侧）** `createModernPolicy(owners, { entitlement })`：按登录用户裁剪 `session/modelCatalog`（provider 分组 + 模型，字段名容错）与 `llm/listProviders|listConfigurableProviders`，并对 `session/selectModel` 做授权校验；管理员不受限、未配置授权时行为不变。单测 18 → 19 项。

**剩余（下一轮 = R1-ii 实现，spike 已完成）**：
- **R1 裁决**：`llm/stream` waterfall 对 loop 请求**深度冻结、只读**（原文见下），⇒ R1-i 被宿主设计否决。
  > "A LOOP-built request carries the process-local `markAgentLoopRequest` identity and **arrives deep-frozen (mutation throws)**: its content is a pure function of the session log … so listeners **read it, never rewrite it**"
- **spike 结论（决定性）**：`@deepseek-ai/dsh-llm-deepseek` **导出 `DeepSeekAdapter`**，其构造参数 `DeepSeekAdapterOptions` 正是我们需要的注入点：
  - `options: () => Connection` —— "Current validated connection facts; **called once per operation**"；
  - **`resolveAuth: (connection) => Promise<DeepSeekRequestAuth>`** —— "Resolve authentication **from this request's connection snapshot**"，而 `DeepSeekRequestAuth = { headers: Record<string,string> }`（凭据头）；
  - 另有可选 `discoverModels` / `providerName`，必需 `resolveUserId` / `prepareExtensions`（照 `dsh-llm-deepseek-api-key` 的接线方式复制即可）。
  - 官方 `dsh-llm-deepseek-api-key` 的实现就是 `connection.apiKeyEnv`（凭据**引用**）→ `credentials.resolve(ref)` → 头；**我们不走向量引用**，而是在 `resolveAuth` 里用**自己的加密存储**（分享配置用主密钥、私有配置需该用户会话 KEK，未解锁即 fail-closed）。
- **实现形态（下一轮执行）**：
  1. **每条用户配置一个 provider 路由**（`ui-auth-<profileId 短哈希>`）：一个 `DeepSeekAdapter` 实例注册一个路由（`ctx.llm.registerAdapter([provider], adapter)` 返回 disposer，**无需 Loader 行**）；`options()` 返回该路由固定的 Connection，`resolveAuth()` 在读 Key 时按该配置的来源（私有/分享）解密。
  2. 路由生命周期跟随配置：创建配置/解锁时注册，删除配置/撤销分享时释放 disposer。
  3. **INV-4 保持成立**：用户私有 Key **不写入**宿主凭据存储（`.credentials.yaml`），只在我们自己的密文里；`resolveAuth` 在调用瞬间用会话 KEK 解密。
  4. R2（已就绪）把用户可见模型限制在自有+被分享的范围内；由于路由本身按配置隔离，越权连路由都看不见。
  5. 未解锁 / 无配置：`resolveAuth` 直接抛错（fail-closed），与 Q2 一致；绝不回退部署级凭据。
- 若实现中发现 `DeepSeekAdapter` 的私有依赖（files/attachments/extensions）接线成本过高，回退方案是：**只对"分享配置"开放调用路径**（主密钥托管、无需会话 KEK），私有配置暂只做存储与界面隔离，并在文档与界面中明确标注该边界 —— 该回退**需要所有者重新确认**。
- 插件 RPC：`profileList / profileCreate / profileUpdate / profileRemove / profileSetDefault`、`shareList`、`shareSelect`、`balanceQuery`。
- **Key 永不回传**：响应仅含 `label/provider/model/baseUrl/hasKey/keyHint(尾 4 位)`。
- 余额：服务端以该配置（自有或分享）的 Key 调 DeepSeek 余额接口，**只返回数字**，60s 缓存 + 限流。
- 宿主面衔接：按 WP0 结论执行 R1 或 R2。

### WP5 分享与授权（管理员）· 1 天
- `grantAdd / grantRemove / grantList`（所有者视角）+ 分享**用量统计**（token / 次数，所有者可见；看不到对方私有配置）。
- 撤销即时生效；被授权者**不可转发**。

### WP6 客户端半边 · 1–1.5 天
- 0.2.0 由 `settings-shell` 掌管设置导航 → **移除按 nth-child 隐藏"模型"入口的 hack**，改为按 section id 处理。
- **模型页双视图**：普通用户管理自己的配置 + 选用收到的分享 + 看余额 + 设默认；**部署级区块仅部署者可见可改**（Q5）。
- **隐藏原生账户页入口**（Q7）。
- 无配置引导（Q2）：阻断提示 + 「去配置」/「请管理员分享」。
- 新增 **分享管理** section（管理员）；用户管理 section 与**通行密钥卡片**复验。
- 插件管理器页普通用户下只读呈现（隐藏安装 / 卸载 / 启停按钮）。

### WP7 兼容元数据与文档 · 1 天
- 修正 `dsh.compatibility.dsh`（现值 `>=0.1.1-rc.2 <0.2.0` 在 npm 语义下**只匹配 0.1.1-rc.2**）→ 只覆盖新线且满足 prerelease 规则。
- `dshReleases`：填 WP8 实测结论；legacy 标注"已移除"。
- README + 新建 `docs/DSH-0.2.0-COMPATIBILITY.md`（取代 0.1.5 那份）**统一三档表格**：
  | 档位 | 版本 | 结论 |
  |---|---|---|
  | 目标 | 0.2.0-rc.2 | compatible |
  | 中间 | 0.2.0-rc.1 / 0.1.7-rc.2 / 0.1.7-rc.1 / 0.1.6-alpha.2 / 0.1.5-rc.3 / 0.1.5-rc.2 | 实测填 `compatible/degraded/unsupported` |
  | legacy | 0.1.1-rc.2 | **已移除（v0.7.0 起）** |
- README 顶部红色提示改为"**legacy 支持已于 v0.7.0 结束**"。

### WP8 测试与验收 · 1.5–2 天
**新增**：`test/model-profiles.test.mjs`（RBAC 矩阵 + INV-1…INV-7）、`test/profile-crypto.test.mjs`（KDF/AES 向量 + **落盘不可解密**）、`test/live-020-check.mjs`、`test/live-020-mux.mjs`、`test/live-020-pages.mjs`（页面冒烟）、`test/live-compat-matrix.mjs`（多版本）。
**删除**：`test/live-legacy-check.mjs`。
**改造**：`live-015-check.mjs` / `live-015-mux.mjs` → 020 版（0.2.0 端点面为其超集）；中间版本由 compat-matrix 覆盖。
**页面冒烟清单**：模型页（自己配置 / 分享 / 余额 / 无配置阻断）、分享管理、用户管理、插件管理器（只读）、权限预设、Agent 预设、通行密钥卡片。

### WP9 发布准备 · 0.5 天
版本 0.7.0、`CHANGELOG.md`、`SECURITY.md`（新增不变量与数据边界）、`docs/STORE-EVIDENCE.md`、awesome-dsh-plugin 条目与 DSH-Store 条目更新、`npm test` / `store:check` / `verify:clean` 全绿后按既有规范发版（**Release 标题仅版本号**）。

### WP10 供应链整改（并入本版，Q10）· 0.5–1 天
- `qrcode` → **`@nuintun/qrcode`**（Socket 实测：其依赖树 0 条告警；现 `qrcode` 树 40 条）→ SVG 由我们自渲染（约 15 行纯字符串，无密码学）。
- `process.env` 读取收敛到单一模块（Socket 的 `envVars` 按**文件**计数，4 → 1）。
- 发布包瘦身：`files` 移出 `build/`（构建脚本含 `child_process`，运行期不需要）。
- 目标：Socket 告警总数 74 → **约 31**（Supply Chain 79 → 约 86–88）；`downloadCount` 失分不可代码修复，会如实说明。
- 顺带更新 `docs/STORE-EVIDENCE.md` 依赖表与 README 依赖描述。

**合计估时：约 11–13 个工作日**（WP8 多版本实测占大头，多数时间在等环境启动）。

---

## 四、与旧清单的差异（Δ）

| Δ | 变化 | 原因 |
|---|---|---|
| Δ1 | `account/*` 从"只读放行"改为**整体拒绝 + 隐藏入口**，余额改由 `balanceQuery` 提供 | Q4 + Q7：原生账户页是**部署者账号与钱包**，与"每用户独立"冲突 |
| Δ2 | `credentials/*`、`llm/*` 从"直连一刀切拒绝"改为**按用户投影**（直连仍拒绝） | 模型页须对每个用户可用但只作用于自己 |
| Δ3 | 模型页从"隐藏入口"改为**每用户可用 + 部署区块仅部署者** | Q2/Q3/Q5 |
| Δ4 | 测试清单具名化并扩展（见 WP8） | 新增 RBAC / 加密 / 多版本需求 |
| Δ5 | `officeToPdf/*` 采用 **session + workspace + user 三重归属** | Q8 |
| Δ6 | 闸门改官方 route/upgrade 注册 | Q9 |
| Δ7 | 并入供应链整改（qrcode / env / 包瘦身） | Q10 |

---

## 五、验收标准

1. 两用户各配自己的 Key → 会话互不影响且**互不可见**。
2. 管理员（**含其他管理员**）读取他人私有配置的**所有路径** → 403 / 不存在，响应中**无 Key 字段**（不是空串或掩码）。
3. 分享后：可用、**Key 字段不存在**、**余额可见**；撤销后下一次模型调用立即失败。
4. 落盘检查：私有 Key **无法**被插件服务端密钥单独解密。
5. 无私有配置且无分享 → **模型调用被阻断**（不继承部署级），界面给出明确引导。
6. 审计 / 日志抽样无 Key 明文或可逆片段。
7. 0.2.0 新页面在普通用户下**无 403 导致的页面失败**；`officeToPdf` 跨 session/workspace/user 的访问全部被拒。
8. Socket Supply Chain 告警数相较 0.6.5 **下降 ≥ 50%**（记录实测值）。

---

## 六、顺序与依赖

```
WP0 (spike) ──┬─→ WP4 ─→ WP5 ─→ WP6
              │
WP1 ─ WP2 ─ WP2b ─┤
                  └─→ WP3 ─→ WP7 ─→ WP8 ─→ WP9
WP10 可与 WP2/WP3 并行
```

---

## 七、风险与运维影响

| 风险 | 说明 | 缓解 |
|---|---|---|
| WP0 结论不利（宿主不支持按用户凭据） | 可能要改走网关投影 + 受支持注入点 | spike 先行；必要时降级为"按用户凭据仅隔离界面与存储，调用沿用部署凭据"并在文档显著标注（**需所有者重新确认**） |
| 私有 Key 不可恢复 | 管理员重置口令后私有 Key 丢失（Q1 方案的必然代价） | 界面明确提示；建议用户在重置前导出自己的 Key |
| 无配置即阻断（Q2） | 升级后普通用户需先配置或等管理员分享，否则无法使用 | 首启引导 + 管理员批量分享指引 + README 升级说明 |
| 分享 = 服务端托管 | 分享 Key 可被插件服务端解密（分享语义要求） | 明确写入文档；私有配置不受影响 |

---

## 八、发布检查表（WP9）

- [ ] `npm test` 全绿（含新 RBAC / 加密用例）
- [ ] `test:pages` 0.2.0 页面冒烟全绿
- [ ] 多版本矩阵实测结果已填入三档表格
- [ ] `store:check` 20/20、`verify:clean` 通过
- [ ] Socket 告警数实测并记录
- [ ] README / SECURITY / STORE-EVIDENCE / 兼容性文档 / CHANGELOG 全部更新
- [ ] 版本 0.7.0，Release 标题仅 `v0.7.0`

## 验收后追加修复（真实实例实测驱动）

| 问题 | 提交 | 结论 |
|---|---|---|
| 凭据键三段导致宿主启动失败 | `9c50b06` | 键改两段 + 写入前守卫 + 回归测试 |
| R1-ii 三处接线问题（模块解析 / 注入 / 连接配置） | `9c50b06` | 实测路由出现且目录被裁剪 |
| 余额 `unavailable`（fetcher 从未注入） | `95ecb77` | 实测真 Key 返回 CNY 5.78 |
| 设置页一直「重新连接中」 | `f15ee93` | 升级转交宿主，两角色实测通过 |
| 分享页下拉 / 授权列表 / 撤销 / 校验 | `32ce792` | 实测授权与撤销即时生效 |
| 模型页表格化、单组按钮、导航去重 | `829107a` | 导航仅一个「模型」 |
| 掩码 `前4...后4`、按钮字号与间距、12px 标题 | `884e9e2` | 浏览器量测 12px / gap 5px 10px |
| 跨实例 Cookie 冲突 | `f2abbb1` | `dsh_auth_<DSH_HOME 哈希>` |
| 批量余额 + 锁定语义 | `f2abbb1` `c47ed58` | 整批节流一次；锁定显示「需先解锁」 |
| 修改密码 / 注册页引导式流程 | `fe2011f` `93f8e32` | 三档配色与门控实测生效 |
| 口令框独占一排、解锁同排、校验有效性 | `d1ffb05` `8d1e945` | 几何实测同排 |
