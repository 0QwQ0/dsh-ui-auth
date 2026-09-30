# 架构与代码地图（dsh-ui-auth）

> **面向：**开发者 / 贡献者。本文回答"改哪里、为什么这样分层、怎么加新能力"。
> 设计取舍与不变量见 [SECURITY](SECURITY.md) 与 [RBAC 设计](RBAC-MODEL-PROFILES.md)；测试与提交规范见 [CONTRIBUTING](../CONTRIBUTING.md)。

## 1. 两个半边

本插件是一个 **Cordis 插件**，由宿主的插件加载器挂载，分两个半边：

| 半边 | 运行位置 | 入口 | 职责 |
|---|---|---|---|
| **Host** | DSH Node 进程 | `src/index.ts` | 认证闸门、`/auth/*` 页面与 RPC、用户/会话/邀请码/审计、TOTP 与通行密钥校验、按用户模型的 provider 路由、服务端渲染页与错误消息的本地化 |
| **Client** | 浏览器页面 | `src/client.ts` | 设置面板三块 UI（用户管理 / 模型 / 分享管理）、通行密钥浏览器流程、i18n DOM 替换、导航去重、插件管理器只读 |

两者通过宿主的 `slots`（UI）与 `remote`（RPC）机制协作；本插件自己的 RPC 走 `/auth/rpc/<method>`（Cookie 认证）。

## 2. 模块地图（`src/`）

| 文件 | 角色 | 关键内容 |
|---|---|---|
| `index.ts` | 宿主主模块（最大） | 闸门与路由分发、`/auth/rpc/*` 全部方法、存储读写（宿主凭据文档）、会话文件、TOTP/通行密钥、邀请码、审计、页面 HTML、i18n 出口 |
| `modern-gateway.ts` | 现代传输网关 | 拦截 `request`/`upgrade`；`prepare()` **现铸载体 Cookie** 并注入；Remote 分发与结果投影；扩展规则 |
| `modern-policy.ts` | 授权策略 | 每端点 allow/deny、`result()` 投影（R2 按用户裁剪模型目录）、`officeToPdf` 三重归属、会话/工作区属主校验 |
| `model-profiles.ts` | 配置存储 | 私有/分享记录的封装与解封、掩码 `keyHint`、`profileKey` **键语法守卫**、主密钥加载 |
| `profile-kek.ts` | 口令派生密钥 | `PBKDF2 → userKek`、`KekRegistry`（token → uid）、信封加解密与改密重包裹 |
| `profile-service.ts` | 配置领域服务 | 配置 CRUD、分享/授权表、按会话解析 Key（R1）、用量、**批量余额**与节流、`verifyPassword` 节流 |
| `user-routes.ts` | 按用户 provider 路由（R1-ii） | 每条配置注册一条宿主路由；`resolveAuth` 调用瞬间解密；**宿主管包以宿主进程入口为锚点解析** |
| `i18n.ts` | i18n 核心 | 语义键词典、`translatePhrase/translateHtml`（长键优先）、`normalizeLocale`、`localeFromAcceptLanguage` |
| `i18n-phrases.ts` | 短语表 | 「中文原文 → 英文」约 320 条，驱动客户端 DOM 与宿主页面/消息替换 |
| `webauthn.ts` | WebAuthn 服务端 | 注册/认证校验（挑战、origin/RP ID、签名） |
| `passkey-browser.ts` | 浏览器端胶水 | 与社区库 `@simplewebauthn/browser` 的对接 |

> 新增 `src/*.ts` **必须**同时加入 `tsconfig.json` 的 `include`（构建产物按文件逐个编译）。

## 3. 请求流（一次普通用户的 Remote 调用）

```
浏览器 ──Cookie(本插件会话)──▶ gate
   gate: 路由判定 ├─ /auth/*        → 自行处理（页面或 /auth/rpc）
                  └─ 其它           → modern.handleHttp
                        prepare(): 校验会话 → 现铸宿主载体 Cookie → 注入请求头
                        policy.authorize(principal, endpoint)
                           ├─ 拒绝 → 403
                           └─ 放行 → 转发宿主；policy.result() 按用户投影返回值
```

**升级（WebSocket）**：`gateUp` 校验会话后**把升级请求转交宿主**（不再自建 mux——见 [SECURITY](SECURITY.md) §6 的残余风险）。

## 4. 数据模型与存储键

记录写在**宿主的凭据文档**里，键必须是 `<scope>/<id>`（**恰好两段**，由 `profileKey()` 强制）：

| 键 | 内容 |
|---|---|
| `dsh-auth/admin` 等用户记录 | 用户名、角色、口令哈希与盐、TOTP、通行密钥公钥 |
| `dsh-auth/profile-uids` | 用户名 → 稳定 uid 映射 |
| `dsh-auth/profile-kdf-<uid>` | 每用户 KDF 参数（盐、迭代数、版本） |
| `dsh-auth/profile-private-<uid>` | 私有配置（DEK 包裹体 + AES-GCM 密文 + 掩码） |
| `dsh-auth/profile-shared-<uid>` / `-grants-<uid>` / `-received-<uid>` | 分享配置、授权表、收到的分享 |
| `dsh-auth/profile-default-<uid>` / `-usage-<uid>` | 默认选择、用量 |
| `dsh-auth/profile-master` | 服务端主密钥（托管分享用） |

## 5. 扩展点

- **下游插件接口**：`ctx.get('uiAuth')`（仅现代路径），详见 [0.1.5 兼容文档 §3](DSH-0.1.5-COMPATIBILITY.md)；
- **UI**：通过 `slots.inject('settings.section', …)` 注册设置区（本插件的三块 UI 即示例）；
- **按用户模型**：`registerDeepSeekProvider(ctx, routeId, { options, providerName, resolveAuth, discoverModels })`——
  `resolveAuth` 是唯一注入点，官方实现读凭据引用，我们读自己的加密存储；
- **策略**：在 `modern-policy.ts` 的规则表里增加端点级 allow/deny 与投影，**默认拒绝**是基线。

## 6. 构建与测试

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | `tsc --noEmit`（类型与 `include` 完整性） |
| `npm run build` | 编译 `src → lib`，并构建客户端 bundle（构建内含**客户端契约自检**） |
| `npm test` | 全量回归：策略/加密/信封/服务/路由/i18n 单测 + 安全套件 + 主机冒烟 + 登录页检查 + 客户端冒烟 |
| `npm run store:check` | 商城契约门禁（依赖声明、权限信号、打包内容） |
| `node test/live-020-check.mjs` | 真实 DSH 0.2.0 实例端到端（38 项） |
| `npm run test:compat:matrix` | 多版本兼容矩阵（逐版本起一次性实例） |
| `npm run test:i18n:live` | 语言切换端到端（en ↔ zh） |

**测试分层原则**：能用进程内桩（mock）覆盖的逻辑写单测；**涉及宿主真实行为**的（路由注册、cookie 桥接、
按用户授权、缓存与节流）必须进 live 检查——本仓库多次出现"单测全绿但真实宿主上失效"的缺陷（见 [SECURITY](SECURITY.md) §7）。