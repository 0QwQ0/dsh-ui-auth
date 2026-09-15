# Changelog

## 0.6.4 — 通行密钥（Passkey / WebAuthn）与登录矩阵定稿

两步验证不再只等于 TOTP：现在可以用**通行密钥**（指纹 / 面容 / 设备 PIN）代替密码登录，
一个账号可绑定多个（本机密钥 + 手机密钥），并且**不输入用户名**即可登录。

### 新增：通行密钥

- **多设备、多密钥**：每个账号最多 20 个通行密钥，可分别命名（如「我的笔记本」「iPhone」）；
  添加入口有两个——「本机通行密钥」使用平台认证器（Windows Hello / Touch ID），
  「手机扫码添加」由**浏览器自身**显示跨设备二维码（混合/`hybrid` 传输），手机无需与面板同网、
  也无需手机能访问面板。
- **免用户名登录**：使用可发现凭据（`residentKey: 'required'`），登录页一键「🔑 使用通行密钥登录」，
  不需要用户名或密码；也可以照常输入用户名密码，在第二步提示时用通行密钥完成验证。
- **社区库而非自研协议**：服务端用 `@simplewebauthn/server`，浏览器端用 `@simplewebauthn/browser`
  （登录页与设置面板共用同一份依赖），插件不自行实现 base64url / clientDataJSON / CBOR 等协议细节。
- **管理界面**：设置面板新增「通行密钥（Passkey）」卡片：列出名称、类型（仅此设备 / 可同步）、
  最近使用时间与备份状态，支持重命名与删除；管理员用户表格新增「通行密钥」列与「清除通行密钥」
  （设备丢失时的账号救援）。
- **安全设计**：
  - 用户验证（`userVerification: 'required'`）与证明书策略 `attestation: 'none'`（不索取设备厂商信息）；
  - 挑战一次性、5 分钟过期、内存中限定条数，绑定用途与账号；严格校验来源（origin）、RP ID 与挑战；
  - 签名计数器回退检出并拒绝（认证器被复制）；
  - **改动登录因子前必须二次验证**：添加/重命名/删除通行密钥都要先提交当前密码，
    两步验证开启时还需动态码或一次已有通行密钥的断言；服务端签发**一次性票据**（5 分钟、绑定账号与来源 IP），
    因此仅窃取会话不足以添加或删除登录手段；
  - 私钥永不离开用户设备，服务器只保存公钥与公开元数据（名称、创建/最近使用时间、AAGUID、备份状态）；
  - 登录失败同样计入既有按 IP 失败锁定；通行密钥相关操作全部写入审计日志（凭据 id 前缀、设备类型、备份状态）。

### 变更：登录矩阵定稿（**破坏性**）

- **移除「免密 + 动态码」登录**：只提交动态码、不提交密码的登录请求一律返回 400。
  免密入口统一收敛到通行密钥。同时不再区分「该账号是否启用 TOTP」，避免账号状态枚举。
- 定稿后的合法登录方式：

| 账号状态 | 可用的登录方式 |
|---|---|
| 两步验证关闭 | 用户名 + 密码；通行密钥 |
| 两步验证开启，已绑定 TOTP | 用户名 + 密码 + 动态码；通行密钥 |
| 两步验证开启，只绑定了通行密钥 | 用户名 + 密码 + 通行密钥；通行密钥（可免用户名） |

- **反锁死不变量**：`twoFactor` 只在账号仍保有至少一种因子（已确认的 TOTP 或 ≥1 个通行密钥）时为真；
  开启两步验证前必须已绑定因子；移除最后一个因子时自动关闭两步验证；两步验证开启且只剩一个通行密钥时
  拒绝删除该通行密钥。记录在读写边界（凭据库读取、创建、修改）统一规范化，因此手工编辑过的记录也会被修正。
- 两步验证卡片在账号「只有通行密钥」时也会显示开关（此前只有绑定 TOTP 才显示，会导致无法关闭）。

### 已知限制：通行密钥对访问地址有硬性要求

浏览器不接受 IP 字面量作为通行密钥域（RP ID）：在 `http://127.0.0.1:3080` 上点击通行密钥，
Chrome 会抛 `SecurityError: 127.0.0.1 is an invalid domain`（实测 Chrome 152）。
因此面板会用 `http://localhost:3080` 或**域名 + HTTPS**；在不可用地址上，插件会提前拒绝接口并
在登录页/设置卡片显示「请改用 http://localhost:<端口>」这类可操作提示，而不是给一个按了没反应的按钮。

### 其他

- 新增运行时依赖 `@simplewebauthn/server`（+ 传递依赖），浏览器端库 `@simplewebauthn/browser` 只在构建期使用。
- 新增登录页脚本端点 `GET /auth/passkey/browser.js`（IIFE bundle，带 ETag，匿名可取，无秘密）。
- 新增可选环境变量 `DSH_AUTH_RP_ID` / `DSH_AUTH_ORIGIN` / `DSH_AUTH_RP_NAME`。
- 新增源码 `src/webauthn.ts`（RP/来源解析、一次性挑战、挑战-响应封装）与 `src/passkey-browser.ts`；
  构建产物 `lib/webauthn.js`、`lib/passkey-browser.js`。
- 文档工具：`npm run docs:matrix` 用安全套件的逐项输出重新生成 SECURITY.md 的测试矩阵
  （套件未全绿时拒绝改写文档）；`npm run assets` 在一次性实例上重拍 README 预览图
  （`test/shot.mjs`，环境变量驱动、不写真实账号数据）。
- 文案：注册成功引导页改为同时介绍**两种第二因子**（TOTP 动态码 / 通行密钥）并说明绑定任一种后
  如何开启两步验证；登录提醒弹窗同样改为「TOTP 或通行密钥」。

### 验证（2026-09-16）

| 验证项 | 结果 |
|---|---|
| `npm test`（构建 + 全链） | 安全套件 **147/147**、modern 策略 **13/13**、host-smoke **21 场景 + 新增通行密钥 16 项**、client-smoke（含通行密钥 9 项）、登录页/端点联通 **24/24**、crypto/TOTP 向量 —— 全绿 |
| 浏览器端到端（隔离 DSH `0.1.5-rc.1` + 真实 Chrome + CDP 虚拟认证器） | **27/27**：注册（residentKey=required + UV）、免用户名登录、计数器推进、2FA 第二步走通行密钥、反锁死拒删、清理复位 |
| 登录页/端点联通（离线，含内联脚本语法解析） | **18/18**：`#pk` 入口、脚本可解析、IP 字面量 409 + `localhost` 提示、伪造断言不下发会话 |
| 地址可用性实测（`test/webauthn-probe.mjs`） | `localhost` 全通；`127.0.0.1` 被 Blink 拒绝（`invalid domain`），已据此提前拦截 |
| 隔离 DSH `0.1.5-rc.1`：浏览器级设置面板 | **8/8**（含通行密钥卡片与按地址给出的状态提示） |
| 隔离 DSH `0.1.5-rc.1`：HTTP/unary 与授权面 / `remote.mux` 逐帧隔离 | **28/28** / **12/12** |
| 真实 DSH `0.1.1-rc.2` 部署：legacy 回归（dotted RPC / `apiProxy` / 授权面） | **14/14** |
| 真实 DSH `0.1.1-rc.2` 部署：浏览器级设置面板（`127.0.0.1` 源 / `localhost` 源） | **7/7** / **7/7**（前者显示 localhost 提示，后者显示添加入口） |
| 线上构建确认 | 真实面板重启后 `/auth/passkey/login/options` → **409 + `ip-literal`**（旧构建为 404） |
| `npm run store:check` | **20/20** 门禁（权限信号集合仍为 files/network/credentials） |
| `npm run verify:clean` | 通过（`lib/` 与 `src/` 一致） |

## 0.6.2 — TypeScript 重写（行为不变）

本插件改为 **TypeScript 源码 + 构建产物**：`src/*.ts` 是唯一源码，`lib/*.js` 由构建生成
（DSH 直接消费仓库，因此产物一并提交）。这是一次**语言层面的重写**：核心流程、UI 文案、
CSS、端点策略与错误文案都保持不变。

- **目录**：`src/index.ts`（宿主：网关/认证/用户管理/审计）、`src/modern-gateway.ts`（0.1.2+ 传输适配）、
  `src/modern-policy.ts`（端点策略表）、`src/client.ts`（设置面板客户端）。
- **构建**：宿主用 `tsc`（ESM 多文件 → 与既有 `lib/*.js` 布局一致）；客户端用 `esbuild`
  （`build/client.mjs`）打成 DSH 要求的**经典脚本 + `__ModuleLoader__` 工厂**形式
  （`require('react')` 取自宿主冻结模块表），构建后自检产物形状；`charset: 'utf8'` 保证中文文案不被转义。
- **类型**：`tsconfig.json`（宿主，`NodeNext` + `strict`）与 `tsconfig.client.json`（客户端，DOM + `strict`）。
  DSH 服务边界用本地最小接口 + 显式 `any`，自有数据结构给出真实类型。
- **脚本**：`build`、`typecheck`、`test`（先构建再跑全链）、`verify:clean`（校验 `lib/` 与 `src/` 同步）；
  `prepack = npm test`，因此 npm 发布与 CI 都会从源码重新构建。
- **devDependencies**：新增 `typescript`、`esbuild`、`@types/node`、`@types/ws`（不进运行产物；
  `lib/*.js` 已提交，安装期不需要构建）。
- **CI**：`typecheck` → `build` + 全链测试 → 校验 `lib/` 与 `src/` 一致；`PUPPETEER_SKIP_DOWNLOAD=true`
  避免在 CI 下载 Chromium。
- **保真核验**：新增 `test/port-fidelity.mjs`，对比重写前后**可观察要素的多重集**（字符串字面量、
  数字字面量、导出名）——逐行 diff 因 tsc 重排格式而无效。结果：`index`/`gateway`/`policy` 三者的
  字符串、数字、导出名**完全一致**；`client` 仅剩注释措辞（esbuild 剥离注释）与 `undefined`→`void 0`
  打印器改写。两处纯结构性改写（早退守卫、局部变量）已按"核心流程不动"改回与重写前实现一致。
- **验证**（2026-09-14）：

| 验证项 | 结果 |
|---|---|
| `npm test`（构建 + 全链） | 安全套件 **147/147**、modern 策略 **13/13**、host-smoke **21 场景**、client-smoke、crypto/TOTP 向量 —— 全绿 |
| 隔离 DSH `0.1.5-rc.1`：HTTP/unary（含登录门、carrier 桥接、跨用户隔离、deny-by-default） | **28/28** |
| 隔离 DSH `0.1.5-rc.1`：`/api/remote.mux` 流（含逐帧隔离、waterfall 不投递） | **12/12** |
| 隔离 DSH `0.1.5-rc.1`：浏览器级（设置面板「用户管理」入口与页面） | **6/6** |
| 真实 DSH `0.1.1-rc.2` 部署：legacy 回归（dotted/`apiProxy` 路径） | **14/14** |
| 真实 DSH `0.1.1-rc.2` 部署：浏览器级 | **5/5** |
| `npm run store:check` | **20/20** 门禁（权限信号集合不变：files/network/credentials） |
| 保真（宿主主体） | 手写版与新构建的 `lib/index.js` 经 esbuild 压缩后 **sha256 完全相同**（token 级一致；仅格式与类型擦除差异） |
| 保真（客户端） | 两份 bundle 经同一 esbuild 规范化重打印后 **逐字节相同**（等价于 AST 相同） |

## 0.6.1 — 修复：DSH 0.1.2+ 上设置面板「用户管理」入口消失

**现象**：0.6.0 在 DSH 0.1.5-rc.1 实例里，设置对话框能打开，但导航中没有「用户管理」，
插件其余功能（登录门、隔离）正常——属于"静默失效"。

**根因**：`slots` 服务的提供方在 0.1.5 从 `@deepseek-ai/dsh-client-runtime` 改到
`@deepseek-ai/dsh-client-ui-renderer`；同时 0.1.5 让客户端模块的到达顺序变成**显式依赖**
（`dsh.client.inject` 从信息性元数据变为工厂到达屏障）。本插件的客户端行没有声明任何依赖
（boot 图里为 `{"id":"dsh-ui-auth", ...}`，无 `inject` 字段），于是它可能在 `slots` 就绪前
`apply`；旧实现此时 `if (slots === undefined) return` **直接静默返回**，设置项因此从未注册。

**修复**：

- 客户端插件显式声明 `exports.inject = ['slots']`，由宿主保证服务就绪后再 `apply`；
- 同时保留**有界重试**（最多 40 次 × 250ms）作为兜底，并在最终取不到服务时
  `console.error('[dsh-ui-auth] slots 服务不可用：设置面板「用户管理」未能注册')`——
  不再静默不渲染，让这类故障在浏览器控制台可见；
- 新增浏览器级验收脚本 `test/live-ui-check.mjs`：真实 Chromium 登录 → 打开设置 →
  断言导航含「用户管理」、该页渲染出「我的账号 / 修改密码 / 两步验证」、管理员额外看到
  「创建用户 / 邀请码管理」、且无插件级错误日志。触发器兼容两种标注
  （0.1.5 为 `aria-label="设置"`，0.1.1-rc.2 为按钮文本「设置」）。

**验证**（2026-09-14）：

| 环境 | 结果 |
|---|---|
| 隔离 DSH `0.1.5-rc.1` 实例（admin） | 设置导航 `[通用设置 \| 模型 \| 插件 \| Agent 预设 \| 用户管理]`，该页渲染正常，管理员额外项正常，无插件级错误 —— **6/6** |
| 真实 DSH `0.1.1-rc.2` 面板（test1） | 「用户管理」导航与页面同样正常 —— **5/5**（确认修复未影响旧宿主） |
| `npm test` | 147/147 + modern 策略 13/13 |

**说明**：该缺陷只在真实浏览器里可见（HTTP 级验收无法发现），因此把浏览器级检查纳入了
验收脚本集；`docs/DSH-0.1.5-COMPATIBILITY.md` 与 `docs/STORE-EVIDENCE.md` 已同步补记。

## 0.6.0 — DSH 0.1.5 适配（双线：保留 0.1.1-rc.2，新增 0.1.2+ 现代传输）

同一份代码按能力探测自动选择传输：`ctx.get('connection')?.authorizeIndex` 存在走 **modern**，
否则走 **legacy**。0.1.1-rc.2 的历史行为完全保留。

- **modern 传输适配（slash Remote + `/api/remote.mux`）**：按 DSH `0.1.5-rc.1` 的真实端点表
  （`packages/api/*` 的 `@Remote` 描述符）重建授权与投影，取代对 dotted 方法名的依赖——
  否则 slash 端点会命中旧的"默认放行"分支，导致**登录门仍在但按用户隔离静默失效**。
- **原生 carrier 桥接**：0.1.2 起浏览器必须持有 `dsh-auth-<hash>` 签名 cookie（由启动令牌换取），
  插件登录本身不足以让 UI 可用。now 由插件在进程内代换该 cookie 并注入转发请求，
  **浏览器既不持有原生 cookie，也不持有进程启动令牌**；每请求仍复核 `connection.requestRejection`。
- **deny-by-default 策略面**：普通用户仅可访问自有 session/workspace/文件范围/agent 范围与共享只读元数据；
  `settings/*` 写、`credentials/*`、`workspace/create`、`directoryPicker/*`、`commands/execute`、
  `subagents/*`、`agentPresets/*`、`llm/discoverModels`、`pluginInventory/list`、
  `dynamicCordisRunner/*`、`session/openWorkspacePath` 与未知端点一律 403。
- **绕过 Remote 的 `/api` 精确路由**：`/api/session.export` 与 `/api/session/uploadFileBinary`
  按 `sessionId` 属主放行；`/api/file`、`/api/present.*`、`/open-in-app/*` 仅管理员。
- **流式隔离**：mux 每次投递前复核登录态与属主；`session/control`、`workspace/follow` 的
  baseline/增量帧按键裁剪；被过滤的 `waterfall` 由插件代答 `$events/result {kind:'next'}` 防止 owner 悬置；
  `$events/result` 仅接受与本登录+本连接+已投递事件匹配的回执；登出/改权 1 秒内关闭长连接。
- **修复投影路径的压缩响应**：需要改写响应体的请求强制上游 `accept-encoding: identity`，
  写回时清除继承的 `content-encoding`/`transfer-encoding`/`content-length`（否则浏览器解压失败）。
- **凭据记录键合规**：不合 `^[a-z][a-z0-9-]*$` 的用户名改用 `user-<sha256>` 记录键，并持久化
  退役用户名防止复用；小写用户名保持原键（无迁移影响）。该语法约束在 0.1.1-rc.2 即存在，
  旧的写路径会让整库在重启时加载失败（fail-closed）。
- **去 `timer` 依赖**：改用 `setInterval` + `ctx.effect` 清理；`inject` 改为 `['webServer','connection']`
  （两版 Host 均提供 `connection` 服务）。注：经核实 `timer` 在 0.1.2/0.1.5 的 base bundle 中**仍存在**，
  去掉它是可移植性改进而非激活阻断。
- **依赖/清单**：新增运行时依赖 `ws@^8.21.0`；`engines.node` 对齐 DSH 的 `^22.19.0 || >=24.0.0`；
  `dsh.compatibility.dshReleases` 增补 `0.1.5-rc.1: compatible`。
- **测试与文档**：新增 `docs/DSH-0.1.5-COMPATIBILITY.md`（端点清单、收紧项、`uiAuth` 接口、实测证据）；
  `test/modern-policy.test.mjs` 扩到 13 项；新增端到端验收脚本
  `test/live-015-check.mjs`（隔离 0.1.5 实例 HTTP/unary 28/28）、
  `test/live-015-mux.mjs`（同实例 mux 流式 12/12，含逐帧隔离与 waterfall 不投递）与
  `test/live-legacy-check.mjs`（0.1.1-rc.2 回归 14/14）。
- **上游草稿复用**：modern 路径复用 StormSeven1 的 PR #1 骨架（carrier 桥接、mux 处理、correlation、
  waterfall 释放、`uiAuth` 接口与策略回归用例），并按 0.1.5 重建端点/事件表、补上其未覆盖的
  gzip 投影与绕过 Remote 的 `/api` 路由；其 0.1.2 专属集成测试与文档已由 0.1.5 版本取代。

## 0.5.2 — DSH STORE 上架整改（catalog-blocked 修复）

回应 DSH STORE 自动检查（issue #327，`catalog-blocked`），全部为声明/文档/证据类
改动，无运行逻辑变化：

- **manifest 兼容声明**：`package.json` 新增 `dsh.compatibility`——DSH 范围
  `>=0.1.1-rc.2 <0.2.0`、精确逐版本矩阵 `{"0.1.1-rc.2":"compatible"}`、profile
  `["web"]`；`engines.node` 保持 `>=22.19.0`。源码改动必须伴随版本提升，目录自动化
  才会重新固定 Commit（0.5.1 → 0.5.2）。
- **一次性 Profile 证据**：新增 [docs/STORE-EVIDENCE.md](docs/STORE-EVIDENCE.md)——
  在临时 `DSH_HOME` + 临时工作目录 + 临时端口上对 `dsh-v0.1.1-rc.2` 实跑
  install → `--dump-config`（entry 注入）→ 冷启动（`/` 302 到 `/auth/login`、
  未认证 API 401、bootstrap 管理员端到端登录 200 + `dsh_auth` cookie）→
  remove（组合 0 命中、bundles 还原）→ 卸载后冷启动差异验证（`/` 200，网关消失）；
  并核对真实部署目录零写入。
- **依赖/权限/外部服务/失败边界文档化**：`qrcode`（唯一运行依赖，MIT，供应链说明）、
  权限表（files=私有状态 write / network=仅宿主自身服务器、无出站 / commands=none /
  credentials=自有 realm 经 DSH credentials 服务、无明文口令 → 汇总 high）、
  无外部服务、失败边界清单。
- **自检脚本**：新增 `test/store-contract-check.mjs`（`npm run store:check`）复刻
  Catalog 固定源门禁的仓库侧可控项（20 项硬门禁），权限信号仅来自 `lib/` 运行时代码。
- **README 纠偏**：修正 0.5.1 加固后过时表述（会话落盘已为 SHA-256 哈希、Secure
  Cookie 动态启用、会话持久化），并新增「DSH STORE 上架声明」小节。

说明：凭据/网络能力是认证类插件的功能本体，`source-verified` 自动通道按设计不适用；
本插件按 `user-reviewed` 人工审查路径评估，条目状态由 DSH STORE 自动化维护。

## 0.5.1 — 安全加固（依据外部安全审计核验实施）

依据安全工程师审计报告核验后实施的 5 项加固：

- **Secure Cookie 动态启用**：TLS 直连或（仅信任反代时）`X-Forwarded-Proto: https`
  的安全通道下，`dsh_auth` Cookie 自动追加 `Secure` 标志；HTTP 内网调试不受影响；
  未信任反代时 X-Forwarded-Proto 不生效（防伪造）。
- **trustProxy 解析加固**：`X-Forwarded-For` 改为取**最右**（最近受信反代追加的
  地址，客户端无法伪造），修复开启 trustProxy 时伪造 XFF 可绕过登录锁定的问题；
  尾部空段自动跳过。默认仍不信任 XFF。
- **bootstrap 自毁**：任意用户改密成功后自动删除 `dsh-ui-auth-bootstrap.txt`
  （明文初始密码不再长期残留）；优先 `fsSvc.unlink`，回退 `processPath`+`node:fs`。
- **WS 未知帧 fail-closed 纪律固化**：新增断言——无归属的未知帧类型一律丢弃
  （过滤逻辑本就默认拒绝，此条以测试固化，防未来新增帧类型时漏桶）。
- **会话 Token 哈希落盘**：`dsh-ui-auth-sessions.json` 只存 Token 的 SHA-256 哈希
  （64 位 hex），磁盘无明文 Token；**升级到 0.5.1 后旧版明文会话记录不再恢复，
  所有用户需重新登录一次**。
- **测试**：security-suite 新增 Secure Cookie（3 项）、clientIp 取最右/伪造 XFF/
  空段（3 项）；host-smoke 新增场景 21 bootstrap 自毁（3 项）、场景 16 会话哈希
  断言；WS-ISO 未知帧断言。总计 **147/147**；真实部署验证：会话哈希 save/verify
  （重启恢复 ✓）、注册面 10/10、sessions 文件精确校验（全部 64-hex 哈希）。

## 0.5.0 — 用户注册（邀请码）与 TOTP 两步验证

- **修复**：设置面板「用户管理」输入框宽度超出上级 UI 右边界——补 `box-sizing:
  border-box`（`width:100%` + padding + border 全部计入宽度），输入框左右边距
  对称、不越界。
- **修复**：用户管理表格「角色」列由「管理员/普通用户」简化为「管理/用户」徽章，
  并加 `white-space:nowrap` 禁止换行。
- **新增**：注册成功引导页——注册成功即自动登录并跳转 `/auth/register/success`，
  页面推荐立即添加 TOTP 两步验证令牌（内置生成/扫码/启用流程），也可跳过返回首页。
- **新增**：注册页/登录页密码输入框——**确认密码**（注册必填，前后端双重校验
  "两次输入的密码不一致"）与**眼睛图标**（点击显示/隐藏密码，登录页与注册页
  新密码/确认密码均支持）。
- **新增**：密码复杂度策略——**至少 8 位且包含两种及以上字符类型**（大写/小写
  字母、数字、符号），统一应用于注册、创建用户、修改/重置密码（`passwordError`
  全局校验）；前端提示文案同步更新。
- **测试**：0.5.0 新增面安全矩阵补测（security-suite 新增 9 项：普通用户
  inviteList/inviteRevoke 403、撤销不存在码 404、用户名 HTML 字符 400、引导页
  no-store、未绑定 TOTP 开启 2FA 400、普通用户移除他人 TOTP 403、管理员移除
  不存在用户 404），总计 141/141；真实部署注册面 10/10。
- **新增**：TOTP 绑定二维码——生成密钥时同时返回二维码图片（`qrcode` 库生成
  SVG data URL，host 侧零 canvas 依赖），用户可用 Google/Microsoft Authenticator
  扫码添加（无法扫码时仍可手动输入密钥/otpauth 链接）；注册场景共用同一卡片。
- **新增**：用户注册（`/auth/register`）——邮箱 + 用户名 + 密码 + **有效邀请码**
  注册；邮箱暂不校验真实性（可在「用户管理」中自行修改，邮箱验证后续版本提供）。
- **新增**：邀请码管理（管理员）——`inviteCreate`（生成数量/每码可注册次数）、
  `inviteList`（每个码的已用/剩余/创建者）、`inviteRevoke`；持久化于 credentials
  的 `dsh-auth/invites` 记录；登录页增加「注册账号」入口。
- **新增**：TOTP 两步验证（RFC 6238，纯 JS HMAC-SHA1 实现，零依赖）——
  `totpGenerate`（base32 密钥 + otpauth URL + 二维码）、`totpVerify`（启用）、
  `totpRemove`（本人移除需当前动态码；管理员可移除任意用户）、`totpIgnore`
  （永久忽略提醒）；未绑定且未忽略的用户每次登录弹窗提醒；用户管理页提供
  TOTP 卡片（生成/启用/移除/忽略）。
- **新增**：**2FA 登录**（0.5.0）——启用 TOTP 的用户登录需两步验证：密码正确后
  返回 `totpRequired`，须再提交验证器动态码才能登录；登录页新增动态码输入框，
  同时支持**免密 TOTP 登录**（密码留空 + 动态码）；动态码错误计入登录失败锁定
  （防爆破，与密码共用同一按 IP 计数）。
- **测试**：新增 `test/totp-vectors.mjs`（RFC 6238 官方向量 6 组 + 往返一致性 6 项）；
  host-smoke 新增场景 18（注册/邀请码 13 项）、19（TOTP 12 项）、20（2FA 登录 7 项）；
  security-suite 新增 REG（11 项）与 TOTP（含 2FA 登录，共 16 项）组，总计 125/125；
  全量回归通过；真实部署验证：注册公开端点 6/6、TOTP 全链路 6/6、2FA 登录流程 4/4。

## 0.4.0 — WebSocket 事件流按用户隔离（网络层，无需反向代理）

- **新增**：`/api/events.mux`、`/api/events.host` 两个 WebSocket 升级通道由网关
  代理（此前只做认证放行，普通用户在网络层会收到全部会话的事件帧）。现在：
  - 每用户一条事件流（进程内消费 DSH `ctx.apiProxy` 的事件迭代器，等价于浏览器
    直连，上游连接数不变）；
  - 帧按会话/工作区归属**逐帧过滤**后编码为 WS text 帧转发：普通用户在网络层
    就收不到他人会话的事件帧（浏览器控制台同样看不到）；无归属维度的
    `host/remote-event` 仅管理员可见；`workspace-order-changed`、
    `archived-sessions-changed` 数组帧逐元素过滤；
  - 零依赖实现 RFC 6455 握手与帧编解码（`node:crypto` SHA-1 + 纯 JS 兜底）；
  - `ctx.apiProxy` 缺失时该通道 fail-closed（销毁连接，绝不透传全量帧）；
  - 不再需要反向代理做按用户的事件流隔离（README「已知边界」同步移除该条）。
- **新增**：限流配置化（环境变量，进程启动时读取）：
  - `DSH_AUTH_MAX_FAILS`（默认 5）/ `DSH_AUTH_LOCK_MS`（默认 30000）；
  - `DSH_AUTH_TRUST_PROXY`（默认关）：仅在 HTTPS 反向代理后开启时信任
    `X-Forwarded-For`（取最左）按真实客户端 IP 计数，默认不信任以防伪造 XFF
    绕过/污染限流。
- **新增**：会话持久化（重启不掉线）——登录会话定期落盘
  `dsh-ui-auth-sessions.json`（fs 服务工作目录），重启后恢复未过期会话；
  登出/改密/过期即时失效，用户已删除的会话不恢复。
- **新增**：管理员操作审计——增删用户、重置密码、改角色、改密与普通用户越权
  尝试追加写入 `dsh-ui-auth-audit.jsonl`（JSONL，串行队列防竞态，写失败不中断
  业务）。
- **修复**：启动竞态——面板初始化（credentials 就绪等待）完成前登录/RPC 返回
  明确的 503「服务初始化中」，而非误导性的 401（此前重启后 8 秒内登录会失败）。
- **测试**：安全套件新增 WS-ISO（13 项）、CFG（6 项）、初始化 503（2 项），总计
  98/98；host-smoke 新增会话持久化（4 项）与审计（6 项）场景；全量回归通过。
  真实部署验证（逐项）：① 旧代码 mux 泄漏他人会话帧 → 0.4.0 网络层无泄漏（4/4）；
  ② 限流配置真实生效（3 次锁定 / 5s 恢复 / XFF 隔离，5/5）；③ 重启后同一 cookie
  免登录恢复（save/verify 均 0）；④ 越权尝试写入审计 JSONL（5/5）。
- **已知限制**：普通用户事件流只含自己会话的帧，但 DSH 上游事件流协议（帧级
  压缩/深协议攻击面）仍依赖上游；`apiProxy` 服务未就绪时事件流通道暂不可用
  （刷新重连即可）。

## 0.3.4 — 安全验证套件与两项网关加固

- **新增**：`test/security-suite.mjs` 公网部署安全验证套件（10 类、75 项断言，
  覆盖认证/会话/注入/CSRF/HTTP 网关/信息泄露/越权/数据隔离/可用性/部署加固），
  配套 `SECURITY.md` 安全验证报告（威胁模型、测试矩阵、OWASP Top 10 覆盖率、
  残余风险与部署加固清单）；已并入 `npm test` / `prepack`。
- **修复**：`/auth/logout` 缺少 HTTP 方法检查——任意方法（含 GET）都会销毁会话
  并清 Cookie，浏览器预取/缓存链可能滥用触发登出。现仅允许 POST，其余返回 405
  （客户端本就以 POST 调用，无兼容性影响）。
- **修复**：`safeNext` 正则 `[?&]next=` 漏匹配查询串首参（`?next=/settings` 经
  `split('?')` 后无前导 `?`），合法站内跳转被丢弃、登录后总是回到首页。改为
  `(?:^|[?&])next=`，首参与多参数均正确解析，外站/协议/双斜杠拒绝逻辑不变。
- **测试**：安全套件 75/75、host-smoke、client-smoke、crypto 向量全量通过。

## 0.3.3 — 恢复模型页锁（单一 tab + 锁内容）

- **修复**：普通用户再次可见模型配置内容。方案升级：恢复 `priority:-1` 锁页
  （成为「模型」单元格内容胜者），并注入 CSS 隐藏出厂「模型」导航行——设置导航
  用原始 entries 不去重，同 id 锁页必然产生第二行；导航行无 id 选择器，按设置
  面板导航位次（`[role="dialog"] nav > div > button:nth-child(2)`）隐藏出厂行，
  仅普通用户注入。管理员不注入、保留原页面。
- **已知限制**：位次选择器依赖出厂设置页顺序（general→models）；若部署新增
  `order<10` 的设置页会位移，需调整 `lib/client.js` 的 `nth-child(2)`。
- **测试**：Client 冒烟恢复双角色场景（管理员不锁、普通用户锁页 priority -1 +
  导航隐藏规则）。

## 0.3.2 — 修复双「模型」tab 与按钮对比度

- **修复**：普通用户设置页出现两个「模型」tab——设置导航用 `slots.entries`
  （原始条目，不去重），同 id 的客户端替换页必然产生重复 tab。移除客户端
  模型页锁（模型配置权限仍由服务端网关强制：非管理员写操作一律 403），
  导航恢复单一「模型」tab。
- **修复**：用户管理面板按钮文字色改用官方 on-primary token
  `--dsw-alias-label-primary-foreground`（此前误用 `button-contrast-fill`，
  与背景对比度差），主按钮与危险按钮明暗主题一并修复。
- **测试**：Client 冒烟新增"无重复 models 注册"与"按钮 token"回归护栏。

## 0.3.1 — 安装/卸载归一化（bundle 机制）

- **归一化**：包恢复 `dsh.bundle.patch`（自带 `cordis.patch.yml`），安装改为标准
  `dsh plugin --profile web add dsh-ui-auth`（自动维护 `dsh.profile.bundles` 名单），
  移除早期手工 `cordis.patch.yml` 补丁行方案。
- **可完全卸载**：`dsh plugin --profile web remove dsh-ui-auth` 自动移除依赖、
  bundles 名单与 lockfile，profile 补丁层无残留；重启后网关/面板/客户端模块全部
  消失。用户数据（`dsh-auth` 记录）按防误删原则不自动清除，README 提供完整清空步骤。
- **打包**：`cordis.patch.yml` 重新纳入 `files`，随 tarball 发布。

## 0.3.0 — 按登录用户的数据隔离

- **新增**：会话/工作区按登录用户隔离（DSH 本身为单用户应用，数据为机器级）：
  - 归属打标：`session.create` / `session.fork` / `workspace.create` 响应侧记录
    创建者（持久化于 `dsh-auth/ownership`）；
  - 读取过滤：普通用户的 `session.list` / `session.search` / `workspace.list`
    仅返回自己的数据（响应体改写；含工作区内会话与归档会话；search 过滤后
    `hasMore` 归 false）；
  - 直连拦截：非属主访问 `session.*` / `workspace.*` 目标返回 403，
    `session.export` 仅限属主；
  - 管理员不受限；启用前的旧数据默认归管理员。
- **已知边界**：`events.mux` / `events.host` WebSocket 事件流无法在网关层逐帧
  过滤（浏览器下行通道），UI 不渲染非属主会话；强隔离部署建议反向代理层隔离。
- **测试**：Host 冒烟新增 24 项数据隔离场景（过滤/打标/直连拦截/导出/管理员放行）。

## 0.2.1 — 修复模型页锁不生效

- **修复**：客户端「模型」页屏蔽因 slot 单元格语义而失效——同 `id` + 同
  `priority`（默认 0）的二次注册会抛错且不渲染。改为 `priority: -1` 遮蔽出厂
  模型页（最低 priority 者渲染），普通用户现可见「仅管理员可访问」提示页；
  管理员仍保留 DSH 自带页面。
- **加固验证**：Client 冒烟的 slot mock 现模拟真实的同 id 同 priority 冲突规则，
  防止回归；服务端全部受限方法（`settings.update/replace/mutate`（`llm-*` /
  `settings.models`）、`credentials.set/unset`、`llm.discoverModels`）对普通
  用户实测均返回 403。

## 0.2.0 — 模型配置页管理员专属

- **新增**：【设置】→【模型】页面（模型配置与 API Key 配置）仅管理员可访问：
  - 客户端：普通用户的「模型」设置页被替换为无权限提示页，管理员保留 DSH 自带页面；
  - 服务端（网关内强制，防绕过 UI 直调 API）：非管理员会话下拒绝
    `settings.update / settings.replace / settings.mutate`（目标为 `llm-*` 或
    `settings.models` 命名空间）、`credentials.set / credentials.unset`、
    `llm.discoverModels`，返回 403「仅管理员可执行此操作」；
  - 放行的 `/api` 请求用原始请求体完整回放（body 经网关读取后无损转发）。
- **测试**：Host 冒烟新增 17 项管理员守卫场景（含请求体回放完整性校验）；
  Client 冒烟新增管理员/普通用户两态的模型页锁定校验。

## 0.1.0 — 首个发布候选

- **认证网关**：在 DSH Web UI 的 `node:http` 服务器层拦截全部 HTTP 请求与
  WebSocket 升级，未登录一律拒绝（页面 302 到登录页、API/静态资源 401、
  WS 升级销毁连接），覆盖 `/api/*`、`/plugins/*`、HMR、SPA fallback 无旁路。
- **登录**：`/auth/login` 自带样式登录页（跟随系统明暗）；会话 Cookie
  `dsh_auth`（HttpOnly + SameSite=Strict，12 小时滑动续期）。
- **用户管理**（设置面板「用户管理」，跟随 设置→外观 明暗主题）：
  - 所有用户：修改自己的昵称/邮箱与密码；
  - 管理员：新增/删除用户、重置他人密码、切换角色；无法查看他人当前密码；
  - 保护规则：不能删除/降级最后一个管理员、不能删除自己、改密/删号后其他会话失效。
- **安全**：PBKDF2-HMAC-SHA256（随机盐，60000 轮，常量时间比较）；令牌/盐使用
  Web Crypto 强熵；单 IP 5 次失败锁定 30 秒；认证响应 `Cache-Control: no-store`。
- **持久化**：credentials 服务（`.credentials.yaml`，每用户一条 grant 记录）；
  首次启动引导管理员 `admin`（随机密码写入控制台与 `dsh-ui-auth-bootstrap.txt`）。
- **健壮性**：启动时等待 credentials 服务就绪（有界 10s），避免误走内存兜底
  导致每次重启生成新管理员；插件停止时精确还原原始服务器监听器。
- **测试**：SHA-256/HMAC/PBKDF2 RFC 标准向量、客户端 bundle 冒烟、Host 集成
  冒烟（含启动竞态场景）。
