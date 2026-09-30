# 按用户隔离的模型与 API Key（RBAC 设计）

> **面向：**设计与评审（多用户模型 / 密钥隔离）。

> 本文件是 v0.7.0 的核心功能设计，随 `docs/V0.7.0-ROADMAP.md` 一起冻结。
> 一句话目标：**每个用户拥有只属于自己的模型与 API Key；管理员可把自己的模型分享给指定用户使用（对方看不到 Key、能看到余额）；任何管理员在任何情况下都不能读取他人的私有配置。**

---

## 一、术语与角色

| 术语 | 含义 |
|---|---|
| **部署者** | 部署该面板的人，默认 = **初始管理员**（当前 `admin`）。唯一有权修改**部署级配置**的角色 |
| **管理员** | 角色 `admin`。各自拥有**私有配置**，可把自己的配置**分享**给指定用户；**不可**读他人私有配置（含其他管理员） |
| **普通用户** | 角色 `user`。拥有私有配置，可接收并使用分享 |
| **私有配置** | 某用户自己录入的 provider / 模型 / API Key 集合，**仅本人可读可写** |
| **分享配置** | 管理员创建并授予指定用户的配置：被授权者**可选用、可看余额**，**不可见 Key**、不可改、不可转发 |
| **部署级配置** | DSH 原有全局配置，归部署者；**普通用户不继承**（v0.7.0 起） |

---

## 二、功能需求

- **FR-1 私有配置 CRUD**：任一登录用户可创建 / 编辑 / 删除**自己的**多个配置（provider、模型名、baseURL、API Key、备注），并指定其中一个为默认。
- **FR-2 会话使用自己配置**：新建会话 / 切换模型时使用其**自己默认**或被授予的分享配置，与其他用户完全隔离。
- **FR-3 与部署者配置互不影响**：用户配置**不写入**且**不影响**部署级配置。
- **FR-4 管理员分享**：管理员可把自己的配置授予**指定用户**（可逐个、可多选）。
- **FR-5 分享的只读性**：被授权者不可读 Key、不可改、不可转发。
- **FR-6 余额可见**：被授权者能看到该分享配置对应账号的**余额**（仅数值），看不到 Key。
- **FR-7 管理员不可窥视**：不存在任何"查看 / 导出 / 模拟"他人私有配置的接口、UI 入口、日志字段或调试输出；**对其他管理员同样成立**。
- **FR-8 模型目录按人裁剪**：`session/modelCatalog`、`llm/listProviders`、`llm/listConfigurableProviders` 的可见条目按登录用户裁剪为"自己的 + 被分享的"。
- **FR-9 模型发现按人执行**：`llm/discoverModels` 用**请求者自己的**（或分享的）Key 在服务端调用，只返回模型列表。
- **FR-10 页面权限重划**：模型 / API Key 页**每用户可用但只作用于自己**；部署级区块仅部署者可见可改；原生账户页对普通用户隐藏（见第七节）。
- **FR-11 撤销与轮换**：撤销分享**立即生效**；进行中会话**下一次模型调用 fail-closed**；用户改密码 / 轮换 Key 后旧 Key 立即失效。
- **FR-12 用量可审计**：分享配置的**所有者**可看到每个被授权用户的用量（token / 次数）；查询日志 Key 一律脱敏。

---

## 三、权限矩阵（目标态）

| 资源 / 操作 | 普通用户 | 管理员（非所有者） | 配置所有者 | 部署者 |
|---|---|---|---|---|
| 自己的私有配置 读 / 写 | ✅ | ✅（自己的） | ✅ | ✅ |
| **他人私有配置 读** | ❌ | **❌（含其他管理员）** | — | **❌** |
| 他人私有配置 写 / 删 | ❌ | ❌ | — | ❌ |
| 分享给自己的配置：选用 / 看余额 | ✅ | ✅ | — | ✅ |
| 分享给自己的配置：看 Key / 改 / 转发 | ❌ | ❌ | — | ❌ |
| 自己创建的分享：授予 / 撤销 / 看用量 | — | ✅（自己的） | ✅ | ✅ |
| 部署级配置 读 | ❌（Q2 不继承） | ✅（只读） | — | ✅ |
| 部署级配置 写 | ❌ | ❌（Q5） | — | ✅ |
| 原生账户页 `account/*` | ❌（Q7 整体隐藏） | ❌ | — | ✅ |
| `officeToPdf/*` | ✅ 仅当 **session + workspace + user** 三重归属同时成立（Q8） | 同左 | 同左 | ✅ |

---

## 四、安全不变量（必须由测试固化）

- **INV-1**：任何请求路径（REST / RPC / mux 帧 / 导出 / 日志）都不返回他人私有配置的 Key 或 provider 明细。
- **INV-2**：管理员身份**不**构成读取他人私有配置的理由；RBAC 判定中"角色 = admin"**不得**成为该资源的捷径。
- **INV-3**：被授权者对分享配置的响应中，Key 字段必须**不存在**（而非空串 / 掩码）。
- **INV-4**：存储中的私有 Key **不可**由插件服务端密钥单独解密（口令派生 KEK 仅在该用户会话内存中）。
- **INV-5**：撤销分享后，被授权者的后续模型调用必须 fail-closed，不得回退旧 Key。
- **INV-6**：审计与错误信息中不得出现 Key 明文或可逆片段（仅所有者本人可见不可逆的尾 4 位提示）。
- **INV-7**：管理员的用户管理接口（如 `listUsers`）永远不含模型 / Key 字段。
- **INV-8**（Q8）：`officeToPdf/*` 的放行必须同时满足 session 归属、workspace 归属、user 归属；任一不成立即拒绝，**不得**因其中一项成立而放行。

---

## 五、存储分离与密钥托管

```
dsh-auth/profiles/private/<uid>/<profileId>      # 私有配置（Key 为密文）
dsh-auth/profiles/private/<uid>/index.json       # 配置清单 + 默认项
dsh-auth/profiles/grants/<ownerUid>/<targetUid>  # 所有者侧授权表
dsh-auth/profiles/shares/<targetUid>/<ownerUid>  # 接收侧投影（无 Key 材料）
dsh-auth/profiles/deployment/<profileId>         # 部署级配置（部署者）
```

**键位**：一律使用**稳定 `uid`**（uuid），不使用用户名——用户名可改、可回收（已有 tombstone 机制），用用户名做键会导致改名 / 回收后的越权。

**私有配置（E2E）**
- `KEK = KDF(用户登录口令, salt, 高迭代)`；`ciphertext = AES-256-GCM(KEK, API Key)`。
- 仅在该用户**已认证的会话**内在内存持有 KEK；进程重启 / 会话过期即丢弃。
- 改密时用**当时明文口令**重新包裹（改密流程本身持有明文口令）。
- 管理员**重置口令** → 私有 Key **不可恢复**：记录标记为"需重新录入"，界面明确提示（Q1 的必然代价）。
- 纯通行密钥用户：需要一个"密钥口令"用于包裹，或选择把该配置降级为服务端托管（界面需显式告知差异）。

**分享配置（服务端托管）**
- 用插件主密钥（存宿主 credentials 的 `dsh-auth/master`）AES-GCM 加密。
- 用途仅限"**代被授权者调用**"；分享是所有者**自己的**配置，所有者查看自己的配置不违反 INV-2。
- **明确写入文档**：分享 Key 在服务端可解密（这是"无人值守可用"的必要条件）；私有配置不受影响。

---

## 六、接口面

### 6.1 本插件 RPC（`/auth/rpc/*`）

| RPC | 作用 | 权限 |
|---|---|---|
| `profileList` | 列出**自己的**私有配置（无 Key，仅 `hasKey` / `keyHint`） | 本人 |
| `profileCreate` / `profileUpdate` / `profileRemove` | 增 / 改 / 删自己的配置 | 本人 |
| `profileSetDefault` | 指定自己的默认配置 | 本人 |
| `shareList` | 列出**收到的**分享（无 Key，含 `balanceVisible`） | 被授权者 |
| `shareSelect` | 选用某个分享（或切回自己的配置） | 被授权者 |
| `balanceQuery` | 查询指定配置（自有或分享）的余额，仅返回数值 | 本人 / 被授权者 |
| `grantAdd` / `grantRemove` / `grantList` | 分享的授予 / 撤销 / 清单（含用量） | 分享所有者 |
| `grantUsage` | 某分享按被授权用户的用量统计 | 分享所有者 |

### 6.2 宿主端点投影（按登录用户）

| 宿主端点 | 处理 |
|---|---|
| `llm/listProviders`、`llm/listConfigurableProviders` | 按用户裁剪（自己的 + 分享的） |
| `llm/discoverModels` | 用请求者自己的 / 分享的 Key 服务端调用 |
| `session/modelCatalog`、`session/selectModel` | 仅暴露该用户有权的条目；越权即拒 |
| `settings/describe`、`settings/mutate` | 仅放行**模型相关白名单键**；其余拒绝 |
| `credentials/*`（直连） | **拒绝**——用户配置一律走本插件 RPC，避免绕过存储与加密层 |
| `account/*` | **拒绝**（Q7） |
| `officeToPdf/*` | 仅 **session + workspace + user** 三重归属成立时放行（Q8） |

> 具体走 **R1**（宿主按会话 / 用户覆盖凭据）还是 **R2**（网关投影 + 受支持注入点），由 WP0 spike 结论决定，结论将作为附录追加在本文件末尾。

---

## 七、页面行为

| 页面 | 普通用户 | 管理员 | 部署者 |
|---|---|---|---|
| 模型 / API Key 页 | 自己的配置（增删改、设默认）+ 收到的分享（选用、看余额） | 同左 + 自己创建的分享管理 | 同左 + **部署级配置区块** |
| 原生账户页 | **隐藏入口** | 隐藏入口 | ✅ |
| 用户管理 | 只读自己的资料 / 通行密钥 / TOTP | 管理用户 | 管理用户 |
| 分享管理 | —（无入口） | ✅ 自己的分享 | ✅ |
| 插件管理器 | 只读（隐藏安装 / 卸载 / 启停） | 只读 | ✅ |

**无配置阻断（Q2）**：用户既无私有配置也未被分享时，模型页与会话区显示阻断提示与两个动作——「去配置」/「请管理员分享」，模型调用 fail-closed，**不**回退部署级配置。

---

## 八、余额查询

- 在**服务端**用该配置的 Key 调用 DeepSeek 余额接口，**只返回数值 / 额度**，不返回任何能反推 Key 的字段。
- 60 秒缓存 + 每用户限流，避免把上游接口当作可刷新的旁路。
- 分享配置的余额：被授权者可查（Q4 / FR-6）；用量统计仅所有者可见。

---

## 九、审计与脱敏

- 记录：配置创建 / 修改 / 删除、分享授予 / 撤销、余额查询、按用户与分享的用量。
- **不记录**：API Key 明文、可逆片段、完整请求体。
- 允许展示：所有者本人可见 `keyHint`（尾 4 位，不可逆）。

---

## 十、边界与非目标

- **不防 OS 级访问**：能读进程内存或改插件代码的人不在 RBAC 语义内。E2E 方案只保证"**存盘与接口层面**读不出"。
- 不做 Key 云端托管、不做跨部署同步、不代理第三方计费。
- 不改 DSH 核心与 `@deepseek-ai/*`（DSH-Store MKT007 边界）。

---

## 十一、验收映射

| 验收条目 | 对应测试 |
|---|---|
| 互不可见、Key 字段不存在 | `test/model-profiles.test.mjs`（INV-1/2/3） |
| 落盘不可解密 | `test/profile-crypto.test.mjs`（INV-4） |
| 撤销 fail-closed | `test/model-profiles.test.mjs`（INV-5）+ `test/live-020-check.mjs` |
| 日志脱敏 | `test/model-profiles.test.mjs`（INV-6） |
| 用户管理无 Key 字段 | `test/model-profiles.test.mjs`（INV-7） |
| officeToPdf 三重归属 | `test/model-profiles.test.mjs`（INV-8）+ `test/live-020-check.mjs` |
| 无配置阻断（Q2） | `test/live-020-pages.mjs` |
| 按用户模型目录裁剪 | `test/live-020-check.mjs` |

---

## 附录 A：WP0 spike 结论

**调查对象**：DSH `0.2.0-rc.2` 实际安装树（`@deepseek-ai/*` 288 个包，含 `dsh-llm` / `dsh-credentials` / `dsh-credentials-local` / `dsh-settings` / `dsh-session` / `dsh-llm-deepseek*`）。
**结论**：**R1 可行**（调用路径可按用户解析凭据，且不需要影子替换宿主服务）；**R2 仍需保留**，用于界面与端点面的按用户裁剪。

### A.1 取证

| 事实 | 出处 |
|---|---|
| 一次 LLM 请求**携带会话身份** | `dsh-llm` 的 `GenerateOptions.sessionId?: Branded<'SessionId'>` —— 注释原文 "Session identity stamped by the loop for request routing" |
| LLM 服务提供**可被 waterfall 拦截**的流式调用 API | `dsh-llm` 服务自述："LLM service: adapter registry with a **waterfall-interceptable** streaming call API" |
| 插件可注册自己的适配器 | `dsh-llm` 导出 abstract `LlmAdapter`；`dsh-llm-deepseek` 导出 `DeepSeekAdapter`（可复用/委托） |
| 每条路由的 API Key 引用**可配置、按请求解析** | `dsh-llm-deepseek-api-key` 的 `Config.apiKeyEnv: Volatile<string>`，注释 "Credential reference resolved per request; defaults to `DEEPSEEK_API_KEY`" |
| 凭证 seam **没有用户维度** | `ctx.credentials.resolve(ref)` 以**环境变量名**为键；`CredentialKey = <插件名>/<id>`，scope 是"拥有该记录的插件" |
| 设置 seam 的 `user` 层指**部署操作者** | `dsh-settings` 的 `SettingsDescriptor { base?, user? }`（base+user 两层，非多主体） |
| 存在按请求的异步上下文 | `dsh-agent` 使用 `AsyncLocalStorage`（用于 initiator/父子代理追踪）——我们不需要依赖它 |

### A.2 选定路线

- **R1-i（首选）**：拦截 `dsh-llm` 的 **waterfall 调用点**，按 `GenerateOptions.sessionId` → 本插件会话归属表（已有 `state.owners`）→ 该用户的私有配置或被分享配置 → 以该 Key 注入 / 委托给既有 DeepSeek 适配器。
- **R1-ii（备选）**：本插件注册一个 `LlmAdapter`（provider id 形如 `ui-auth`），内部按 `sessionId` 解析 Key 后**委托** `dsh-llm-deepseek` 的 `DeepSeekAdapter`。
- **R2（保留）**：`llm/listProviders|listConfigurableProviders`、`session/modelCatalog|selectModel`、`settings/describe|mutate`（模型相关白名单键）、`credentials/*`、账户页 —— 按登录用户裁剪或拒绝。

### A.3 与 Q1（方案 B，E2E）的相容性

私有 Key 只存在于**本插件的加密存储**中；宿主明文存储（`$DSH_HOME/.credentials.yaml`）**始终不含**用户私有 Key —— 调用瞬间由我们的拦截器/适配器用该用户会话内存中的 KEK 解密。**INV-4 成立**：管理员即使拿到数据库/文件也无法解出私有 Key，且没有任何插件路径可读。

### A.5 实施决定（WP3 已落地 / WP4 据此实现）

WP3 已实现 `src/model-profiles.ts`（PBKDF2-SHA256 → AES-256-GCM、AAD 绑定 `uid/profileId`、按 uid 分区、`assertSameUser` 守卫、服务端主密钥托管分享配置），并由 `test/profile-crypto.test.mjs`（7 项）固化两条关键主张：主密钥解不开私有配置、存储中不出现明文 Key。

WP4 的会话密钥生命周期**据此确定**（避免在内存中长期持有口令）：

1. **用户级包装密钥**：`userKek = PBKDF2(登录口令, 用户级 salt, ≥600k)`；用户的 salt/iterations 存在 uid 映射记录里（每人一份，改密时重包裹）。
2. **每条私有配置用随机 DEK** 加密 API Key，DEK 自身用 `userKek` 包成 `wrappedDek`（AAD 仍为 `uid/profileId`）。
3. **会话只持有 `userKek`**（32 字节），**不持有口令**；登录时派生、登出/会话过期即丢弃（`KekRegistry`：token → `{ uid, userKek }`）。
4. **口令变更**：用旧 KEK 解出各 DEK → 用新 KEK 重包裹（改密流程持有明文口令那一刻完成）。
5. **管理员重置口令**：私有配置不可恢复 → 标记"需重新录入"（Q1 的必然代价，界面明示）。
6. **纯通行密钥用户**：登录时没有口令 → 需要"密钥口令"解锁私有配置；未设置时私有配置不可用（只可用分享配置），界面引导设置。
7. **无主体会话（Q11(c)）**：子代理继承父会话所属用户；真正无归属时 fail-closed，绝不回退部署级配置。

> 注：WP3 当前的 `sealPrivate/openPrivate` 直接以口令派生 KEK（每条配置各自 salt）。WP4 将引入上面的"用户级 KEK + 每配置 DEK"信封结构；两者的密文格式都带 `v: 1` 与 KDF 参数，因此旧记录可平滑迁移（首次解锁时重包裹）。

### A.4 开发首日待验证清单

1. waterfall 拦截点的确切形态（事件名 / 服务方法签名、能否改写凭据、失败语义）。
2. 委托 `DeepSeekAdapter` 的构造与注册方式（是否支持运行时注册、是否需要 Loader 行）。
3. `GenerateOptions.sessionId` 在 `purpose: 'compaction' | 'session-title'` 调用与**子代理**调用中是否同样携带。
4. **无主体会话**（后台 / 定时 / 系统任务）的处理策略 —— 见 Q11（待所有者确认）。

## 实现状态（v0.7.0，实测）

| 能力 | 状态 | 说明 |
|---|---|---|
| 私有配置 E2E（口令派生 KEK） | ✅ | 密钥不落宿主明文存储；会话只持 32 字节 userKek，不持口令 |
| 管理员不可读他人私有配置 | ✅ | 跨用户读取代码级拒绝 |
| 分享（可用 / 可看余额 / 看不到 Key） | ✅ | 撤销立即 fail-closed；授权表映射回用户名供界面显示与撤销 |
| 未配置即阻断（Q2） | ✅ | 目录为空 + 切换模型 403，不回退部署级 |
| R1-ii 按用户模型调用 | ✅ | 每配置一条 provider 路由；`resolveAuth` 在调用瞬间解密（私有→会话 KEK、分享→主密钥） |
| 余额 | ✅ | 批量接口 `balanceQueryAll`（请求内顺序查询、整批节流一次）；**未解锁提示「需先解锁」** |
| 免解锁查余额 / 调用 | ❌ 有意不做 | 需服务端托管 Key（放弃 E2E）；所有者选择保持现状 |
| mux 逐帧按用户过滤 | ❌ 未实现 | 0.2.0 客户端以 mux 为主通道且普通用户也需要；升级已转交宿主，见 README 已知边界 |
