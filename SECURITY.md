# dsh-ui-auth 安全验证报告

> 验证对象：`dsh-ui-auth`（DSH Web UI 认证网关插件）
> 验证版本：0.6.4（本报告对应的测试基线；0.6.4 增加通行密钥 Passkey/WebAuthn，
> 并定稿登录矩阵——「免密 + 动态码」登录已移除）
> 部署场景：公网服务器部署 DSH，`dsh-ui-auth` 作为 Web UI 的前置认证层，仅允许
> 登录用户访问页面、API 与 WebSocket，并实施管理员/普通用户两级权限与数据隔离
> （REST/列表接口 + WebSocket 事件流均按用户隔离），邀请码注册、TOTP 两步验证与
> 通行密钥（Passkey）登录。
> 验证方法：`test/security-suite.mjs`（147 项自动化断言，驱动真实网关代码路径，
> mock 服务器 + mock 凭据存储）＋ 静态源码检查 ＋ host-smoke（会话持久化/审计/
> 注册/TOTP/通行密钥管理面场景）＋ 全量回归（crypto 向量 / RFC 6238 TOTP 向量 /
> 客户端冒烟 / 登录页与端点联通 / 主机冒烟）＋ 浏览器级端到端（真实 Chrome +
> CDP 虚拟认证器，通行密钥注册与免用户名登录）＋ 真实部署验证（WS 隔离 / 限流配置 /
> 会话免登录恢复 / 审计 JSONL / 注册端点 / TOTP 全链路）。

---

## 1. 威胁模型

| 维度 | 说明 |
|---|---|
| 攻击者 1 | 未认证公网访客：猜测/爆破凭据、绕过网关直连 API、注入、爬取 |
| 攻击者 2 | 已登录普通用户：横向越权读他人会话/工作区、纵向越权改模型/Key 配置 |
| 攻击者 3 | 恶意站点（浏览器侧）：CSRF、开放重定向、反射型 XSS |
| 信任边界 | ① 公网 ↔ DSH 进程（插件为唯一入口）；② 普通用户 ↔ 管理员数据面 |
| 保护目标 | ① Web UI 及全部 `/api`、`/plugins`、WS 通道的认证可达性；② 模型配置与
API Key（仅管理员）；③ 会话/工作区数据按用户隔离；④ 凭据（salt+PBKDF2 哈希） |
| 明确不覆盖 | DDoS 洪水（需反向代理/CDN 层）、DSH 应用层 0-day、主机级入侵、密钥管理 |

---

## 2. 测试矩阵与结果（147/147 通过）

本表由测试自身的逐项输出生成，与代码同源，不手工维护：

```bash
# 逐项明细（类别 + 用例名）
DSH_SUITE_VERBOSE=1 node test/security-suite.mjs   # Windows: $env:DSH_SUITE_VERBOSE='1'
```

命令输出的 `PASS <类别> <用例名>` 行即下表的每一行；`失败项` 段落直接给出未通过用例与实测值。

### AUTH · 认证（9 项，9/9 通过）

| 用例 | 结果 |
|---|---|
| admin 登录成功 | PASS |
| test1 登录成功 | PASS |
| 引导使用随机密码（无硬编码默认密码） | PASS |
| 存储 payload 无 password 字段（仅 salt/hash） | PASS |
| 错误密码 → 401 | PASS |
| 不存在用户名 → 相同 401 文案（防账号枚举） | PASS |
| me 响应不含 salt/hash（不泄露凭据材料） | PASS |
| 弱密码被拒绝（最少 8 位） | PASS |
| 密码比较使用常量时间实现 | PASS |

### SESSION · 会话管理（14 项，14/14 通过）

| 用例 | 结果 |
|---|---|
| Cookie: HttpOnly | PASS |
| Cookie: SameSite=Strict | PASS |
| Cookie: Path=/ | PASS |
| Cookie: Max-Age 存在 | PASS |
| 会话固定防护：签发全新 token（不复用植入值） | PASS |
| 伪造/无效会话 → 401 | PASS |
| 登出后会话立即失效 | PASS |
| GET /auth/logout → 405（登出仅允许 POST） | PASS |
| GET 登出被拒后会话仍然有效 | PASS |
| 改密后旧密码失效 | PASS |
| 改密后新密码可用 | PASS |
| 改回原密码成功 | PASS |
| 改密后重新登录成功（admin 后续用例使用新会话） | PASS |
| 会话 TTL 常量存在（12h 滑动续期） | PASS |

### INJ · 注入 / 开放重定向 / 请求体（13 项，13/13 通过）

| 用例 | 结果 |
|---|---|
| 客户端无 dangerouslySetInnerHTML / innerHTML / eval（XSS 由 React 转义） | PASS |
| 未登录页面导航重定向到站内登录页 | PASS |
| 开放重定向: next=http://evil.com → / | PASS |
| 开放重定向: next=//evil.com → / | PASS |
| 开放重定向: next=https://evil.com/x → / | PASS |
| 开放重定向: next=%2F%2Fevil.com → / | PASS |
| 开放重定向: next=/%2F%2Fevil.com → / | PASS |
| 开放重定向: next=javascript:alert(1) → / | PASS |
| 开放重定向: next=/settings → /settings | PASS |
| 开放重定向: next=/auth/login?x=1 → /auth/login?x=1 | PASS |
| next 参数 CRLF 注入被拒（location 无换行） | PASS |
| 超大请求体被拒（64KB 上限） | PASS |
| 登录页为静态 HTML（两次渲染一致，不含用户输入） | PASS |

### CSRF · 跨站请求（CSRF）（3 项，3/3 通过）

| 用例 | 结果 |
|---|---|
| 非 JSON 内容类型的状态变更请求被拒 | PASS |
| 响应不携带 CORS 放行头（跨源读不到响应） | PASS |
| SameSite=Strict 已启用（见 SESSION 组） | PASS |

### HTTP · HTTP 层与网关完整性（13 项，13/13 通过）

| 用例 | 结果 |
|---|---|
| GET 访问 RPC 端点 → 405 | PASS |
| DELETE 访问登录端点 → 405 | PASS |
| 未认证 API → 401（无旁路） | PASS |
| 未认证静态资源 → 401（无旁路） | PASS |
| 未认证页面 → 302 登录页 | PASS |
| WS 未认证升级 → 立即销毁连接 | PASS |
| WS 指向 /auth/* → 销毁（不暴露认证端点） | PASS |
| 非事件流 WS 有效会话升级 → 放行（不销毁） | PASS |
| 事件流升级在 apiProxy 缺失时 fail-closed（销毁，不透传） | PASS |
| 事件流升级缺 WebSocket-Key → 销毁 | PASS |
| fail-closed：存储故障时页面请求 503（不开放） | PASS |
| 初始化未完成时登录 503（提示稍后重试，非 401） | PASS |
| 初始化未完成时 RPC 503 | PASS |

### INFO · 信息泄露（3 项，3/3 通过）

| 用例 | 结果 |
|---|---|
| 畸形 JSON → 通用错误（无堆栈/内部信息） | PASS |
| 认证页面/接口 no-store（防缓存泄露） | PASS |
| 网关异常时返回通用 500（不泄露堆栈） | PASS |

### AUTHZ · 授权与越权（16 项，16/16 通过）

| 用例 | 结果 |
|---|---|
| 普通用户 listUsers → 403 | PASS |
| 普通用户 createUser → 403 | PASS |
| 普通用户 resetPassword → 403 | PASS |
| 普通用户 setRole → 403 | PASS |
| 普通用户 deleteUser → 403 | PASS |
| 普通用户 inviteCreate → 403 | PASS |
| 普通用户 inviteList → 403 | PASS |
| 普通用户 inviteRevoke → 403 | PASS |
| 普通用户模型/Key 写操作 → 403 (/api/settings.mutate) | PASS |
| 普通用户模型/Key 写操作 → 403 (/api/settings.update) | PASS |
| 普通用户模型/Key 写操作 → 403 (/api/credentials.set) | PASS |
| 普通用户模型/Key 写操作 → 403 (/api/credentials.unset) | PASS |
| 普通用户模型/Key 写操作 → 403 (/api/llm.discoverModels) | PASS |
| 水平越权：普通用户读他人会话 → 403 | PASS |
| 水平越权：普通用户导出他人会话 → 403 | PASS |
| 普通用户访问自己会话 → 放行 | PASS |

### ISO · 按用户数据隔离（4 项，4/4 通过）

| 用例 | 结果 |
|---|---|
| 会话列表过滤：普通用户只见自己的 | PASS |
| 创建会话成功并打标归属 | PASS |
| 新建会话对属主立即可见（列表含 s-created） | PASS |
| 管理员会话列表不受过滤 | PASS |

### AVAIL · 可用性（3 项，3/3 通过）

| 用例 | 结果 |
|---|---|
| 暴力破解防护：连续失败后锁定（429） | PASS |
| 锁定期间正确密码也被拒（429） | PASS |
| 会话/失败计数定期清理（防内存膨胀） | PASS |

### DEPLOY · 部署加固（4 项，4/4 通过）

| 用例 | 结果 |
|---|---|
| Cookie 未设 Secure（预期；公网必须 HTTPS 反代） | PASS |
| 登录失败锁定按源 IP（反向代理下聚合，README 已注明） | PASS |
| 空环境引导创建单一随机管理员（无硬编码默认密码） | PASS |
| 引导文件含随机管理员账号与密码（部署者取用） | PASS |

### WS-ISO · WebSocket 事件流按用户隔离（14 项，14/14 通过）

| 用例 | 结果 |
|---|---|
| 事件流握手 101 + 正确 Sec-WebSocket-Accept（RFC 6455 向量） | PASS |
| mux 过滤：普通用户收到的帧全部属于自己 | PASS |
| mux 过滤：他人会话帧（subscribed/event）在网络层被丢弃 | PASS |
| mux 过滤：自己的事件帧放行 | PASS |
| mux 过滤：全局 stream/error 帧放行 | PASS |
| mux 过滤：无归属的未知帧类型被丢弃（fail-closed，不漏桶） | PASS |
| host 过滤：他人会话状态帧丢弃 | PASS |
| host 过滤：他人 workspace 帧丢弃 | PASS |
| host 过滤：remote-event 对普通用户丢弃 | PASS |
| host 过滤：workspace-order-changed 数组只含自己的 | PASS |
| host 过滤：archived-sessions-changed 数组只含自己的 | PASS |
| host 过滤：自己的会话状态帧放行 | PASS |
| host 过滤：管理员 remote-event 放行 | PASS |
| host 过滤：管理员可见他人会话帧（不受过滤） | PASS |

### CFG · 配置与限流（11 项，11/11 通过）

| 用例 | 结果 |
|---|---|
| 默认限流配置：5 次 / 30s / 不信任 XFF | PASS |
| 环境变量覆盖限流配置 | PASS |
| 非法配置值回退默认 | PASS |
| 默认不信任 X-Forwarded-For（伪造 XFF 不生效） | PASS |
| trustProxy 时取 XFF 最右（最近反代追加，客户端不可伪造） | PASS |
| 伪造 XFF（最左）不再生效（取最右真实来源） | PASS |
| XFF 尾部空段时从右找首个非空 | PASS |
| trustProxy 但无 XFF 时回退 socket 地址 | PASS |
| TLS 直连登录 Cookie 含 Secure | PASS |
| HTTP 登录 Cookie 不含 Secure（内网调试兼容） | PASS |
| 未信任反代时 X-Forwarded-Proto 不启用 Secure | PASS |

### REG · 注册与邀请码（19 项，19/19 通过）

| 用例 | 结果 |
|---|---|
| 注册页 GET 200（含邀请码字段） | PASS |
| 注册页含确认密码与眼睛按钮 | PASS |
| 注册页/接口 no-store | PASS |
| 无效邀请码 → 403 | PASS |
| 两次密码不一致 → 400 | PASS |
| 弱密码（长度不足）→ 400（先于邀请码校验） | PASS |
| 复杂度不足（8 位纯字母）→ 400 | PASS |
| 用户名格式非法 → 400 | PASS |
| 管理员生成邀请码（8 位去混淆字符集） | PASS |
| 有效邀请码注册成功（自动登录 + 引导页 redirect） | PASS |
| 注册引导页含「立即添加 TOTP」 | PASS |
| 未登录访问引导页 → 302 登录页 | PASS |
| 邀请码次数耗尽 → 403 | PASS |
| 普通用户 inviteCreate → 403（越权） | PASS |
| 撤销不存在的邀请码 → 404 | PASS |
| 用户名含 HTML 字符 → 400（无 XSS 注入面） | PASS |
| 新注册用户可登录（role=user，邮箱保留） | PASS |
| 注册接口畸形 JSON → 400 | PASS |
| 引导页 no-store | PASS |

### TOTP · 两步验证（TOTP）（21 项，21/21 通过）

| 用例 | 结果 |
|---|---|
| 初始状态未启用 | PASS |
| 未绑定 TOTP 时开启两步验证 → 400 | PASS |
| 生成密钥：base32 格式 + otpauth URL + 二维码 SVG | PASS |
| 错误动态码 → 403 | PASS |
| 正确动态码启用成功 | PASS |
| me 显示已启用且不泄露 secret | PASS |
| 已启用后重新生成 → 400 | PASS |
| 绑定后默认 2FA 关闭：密码直接登录成功 | PASS |
| 0.6.4 起免密 TOTP 登录已移除（缺密码 → 400） | PASS |
| 开启两步验证开关 | PASS |
| 2FA 开启：密码正确但要求动态码（不签发会话） | PASS |
| 2FA 开启：密码 + 动态码两步登录成功 | PASS |
| 2FA 开启：动态码错误 → 403 | PASS |
| 2FA 开启：只给动态码 → 400（免密 TOTP 已移除） | PASS |
| 未启用 TOTP 的账号只给动态码 → 400 | PASS |
| 普通用户移除他人 TOTP → 403 | PASS |
| 管理员移除不存在用户的 TOTP → 404 | PASS |
| 移除需验证码（错误码 403） | PASS |
| 正确验证码移除成功 | PASS |
| 永久忽略开关生效 | PASS |
| 移除后恢复未启用 | PASS |

### 通行密钥 Passkey / WebAuthn（套件外的浏览器级与联通性验收）

通行密钥的端到端行为无法在 mock 服务器里证明（需要真实浏览器与认证器），因此单列。
取证脚本与结果见下表；每一行都能用括号里的命令复现。

| 用例 | 结果 | 取证 |
|---|---|---|
| 注册要求可发现凭据（`residentKey: 'required'` + `requireResidentKey`），并携带 `excludeCredentials` | PASS | live-passkey-check |
| 注册与登录都要求用户验证（`userVerification: 'required'`）；未完成用户验证的断言被拒 | PASS | live-passkey-check |
| 证明书策略 `attestation: 'none'`：不索取、不存储设备厂商证明 | PASS | live-passkey-check / host-smoke |
| 挑战一次性、用途隔离（注册 / 登录 / 二次验证），跨用途或重放被拒 | PASS | host-smoke |
| 免用户名登录：按凭据 id 反查账号；凭据不属于目标账号时拒绝 | PASS | live-passkey-check |
| 签名计数器回退（认证器被复制的迹象）→ 拒绝本次登录 | PASS | webauthn-probe / host-smoke |
| 添加 / 重命名 / 删除通行密钥均需二次验证：密码 +（动态码 或 已有通行密钥断言） | PASS | live-passkey-check / host-smoke |
| 二次验证一次性票据：5 分钟过期、绑定账号与来源 IP、单次使用、不可重放 | PASS | host-smoke |
| 无票据或票据无效时管理接口一律 403（仅窃取会话不足以改动登录因子） | PASS | host-smoke / live-passkey-check |
| 响应仅含摘要：`passkeyList` 不含公钥；审计只记凭据 id 前 8 位等公开元数据 | PASS | live-passkey-check |
| 每账号通行密钥上限 20（取选项与写入两侧都校验） | PASS | host-smoke |
| 反锁死：2FA 开启且仅剩一个通行密钥时拒绝删除（400 + 操作指引） | PASS | live-passkey-check |
| 反锁死：移除最后一个因子（TOTP 或通行密钥）时自动关闭 2FA | PASS | host-smoke |
| 无任何因子的账号不能开启 2FA | PASS | host-smoke |
| 管理员救援：可清除指定用户的全部通行密钥；普通用户调用被拒（403） | PASS | host-smoke / live-passkey-check |
| 未登录访问通行密钥管理面 → 401；伪造断言登录不下发会话 | PASS | login-page-check |
| IP 字面量 / 明文 HTTP 非回环地址：接口提前拒绝（409 + `issue` + 可操作提示） | PASS | login-page-check / webauthn-probe |
| 登录页内联脚本可解析，且不回归为原生表单提交 | PASS | login-page-check |
| 免用户名通行密钥登录后记录最近使用时间、计数器推进 | PASS | live-passkey-check |

**记录规范化的作用**：`passkeys` 字段与 `twoFactor` 不变量在凭据库的读取、创建、修改三个边界上
统一规范化（`sanitizePasskeys` + `reconcileTwoFactor`）。因此手工编辑过的 `.credentials.yaml`
（例如把 `twoFactor` 改成 `true` 却没有因子）会在下次读取时被修正，不会产生"谁也登不进去"的账号。
---

## 3. 本次验证发现并修复的问题

| 编号 | 严重度 | 问题 | 修复 |
|---|---|---|---|
| SEC-01 | 中 | `/auth/logout` 无 HTTP 方法检查：任意方法（含 GET）都会销毁会话并清 Cookie，配合浏览器预取/缓存链可能被滥用触发登出（SameSite=Strict 下 CSRF 风险低，但属防御纵深缺口） | 0.3.4：仅允许 POST，其余返回 405；客户端本就以 POST 调用，无兼容性影响 |
| SEC-02 | 低 | `safeNext` 正则 `[?&]next=` 无法匹配查询串**首参**（`?next=/settings` 经 `split('?')` 后 q 无前导 `?`），合法站内 next 被丢弃、登录后总是跳 `/`；客户端侧 `okPath` 兜底掩盖了该缺陷 | 0.3.4：正则改为 `(?:^|[?&])next=`，首参与多参数均正确解析，且保留原有外站/协议/双斜杠拒绝逻辑 |
| SEC-03 | 中 | **事件流信息泄露（审查发现）**：`/api/events.mux`、`/api/events.host` 只做认证放行，普通用户连接后会在网络层收到**全部会话**的事件帧（UI 不渲染 ≠ 收不到，浏览器控制台可读他人会话内容） | 0.4.0：升级通道改由网关代理——每用户一条事件流，帧按会话/工作区归属逐帧过滤（含数组帧逐元素过滤、remote-event 仅管理员）；apiProxy 缺失时 fail-closed；反向代理事件流隔离不再需要 |
| SEC-04 | 低 | 0.6.4 开发中：登录页内联脚本存在括号错误，整个 `(function(){…})()` 解析失败——表现是点击登录退化为浏览器原生表单提交（凭据出现在地址栏与浏览器历史里），通行密钥入口也静默消失 | 0.6.4：脚本改为命名函数结构并新增 `test/login-page-check.mjs`——它把服务端渲染出的内联脚本送进 `vm.Script` 解析，脚本一旦不可解析即失败，同时断言通行密钥入口与提示按地址正确渲染 |

修复后安全套件 147/147、modern 策略 13/13、host-smoke、client-smoke、登录页/端点联通与
通行密钥浏览器级验收全部通过。

---

## 4. 攻击面覆盖率估算

以 OWASP Top 10 (2021) 为基准映射（目标是覆盖常见公网 Web 攻击类型的约 80%）：

| OWASP 2021 | 对应用例 | 覆盖 |
|---|---|---|
| A01 失效的访问控制 | AUTHZ（16）+ ISO（4）+ WS-ISO（14）+ 管理员 API 守卫 | ✅ 完整 |
| A02 加密失败 | PBKDF2 60k 轮 + 随机盐 + 常量时间比较、无明文存储、`no-store`；TOTP（RFC 6238 向量）；通行密钥：只存公钥、挑战一次性、严格校验来源与 RP ID、签名计数器回退拒绝 | ✅ 完整 |
| A03 注入 | XSS（静态）、CRLF、开放重定向、请求体上限、JSON 解析防护 | ✅ 完整 |
| A04 不安全设计 | 会话固定防护、fail-closed、按源 IP 锁定、方法白名单、邀请码防枚举（无效/耗尽同 403）；通行密钥：改动登录因子必须二次验证、一次性票据、账号因子不变量（防锁死） | ✅ 完整 |
| A05 安全配置错误 | Cookie 属性、无 CORS 头、随机默认口令、引导文件提示、通行密钥地址可用性提前判定 | ✅ 完整 |
| A07 识别与认证失败 | 枚举防护、爆破锁定、改密全会话失效、唯一错误文案；TOTP 绑定/移除需动态码验证、me 不泄露密钥；通行密钥免用户名登录与账号一致性校验、反锁死规则 | ✅ 完整 |
| A08 软件与数据完整性 | npm 发布带 provenance 证明；运行依赖固定于 lockfile 并逐项登记在 `docs/STORE-EVIDENCE.md`；`npm run store:check` 门禁校验依赖、权限信号与打包内容 | ◐ 部分（供应链完整性最终仍依赖上游维护者与平台） |
| A09 日志与监控 | 管理员操作、越权尝试与通行密钥增删（凭据 id 前缀、设备类型等）JSONL 审计 + 认证失败 console 日志 | ✅ 完整 |
| A10 SSRF | 网关不发起外部请求；`llm.discoverModels` 仅管理员 | ✅ 完整 |

未纳入但业界常见且与插件职责相关的外部缓解（见 §5）：DDoS 洪水、TLS 终结、
WS 事件流深层协议攻击面（事件内容已按用户逐帧隔离，但帧级协议攻击依赖上游）。
综合：**9/10 类 OWASP 类别有完整用例覆盖，A08（供应链完整性）为部分覆盖，依赖
发布平台与部署层**；按“常见 Web 攻击类型（OWASP Top 10 + 常见 CWE：
注入、XSS、CSRF、开放重定向、暴力破解、会话劫持/固定、枚举、目录/路径旁路、
方法篡改、缓存投毒、请求走私边界、信息泄露）”逐类核对，**约 85% 有直接验证**，
其余依赖部署层缓解（见 §5）。

---

## 5. 残余风险与加固建议（部署清单）

| 风险 | 说明 | 缓解 |
|---|---|---|
| Cookie 无 `Secure` | 明文 HTTP 下 Cookie 可被嗅探 | 必须置于 HTTPS 反向代理后（Nginx/Caddy 终结 TLS），DSH 按内网监听 |
| 登录限流按来源 IP | 默认按 socket 地址；反代后聚合为代理 IP | 设置 `DSH_AUTH_TRUST_PROXY=1` 按 `X-Forwarded-For` 真实客户端计数（见 README「配置」）；分布式爆破仍需反代层 `limit_req` |
| 会话持久化文件 | 会话 token 明文落盘（`dsh-ui-auth-sessions.json`） | 等价于"记住登录态"，文件仅属主可读写（fs 服务工作目录）；登出/改密/过期即失效 |
| 审计日志 | 管理员操作/越权尝试 JSONL（`dsh-ui-auth-audit.jsonl`） | 定期归档/清理；审计文件仅属主可读写 |
| DDoS / 慢速洪水 | 插件层无法防御 | 反代/CDN 层限流、超时、连接数限制 |
| WS 事件流数据面 | 事件内容已按用户逐帧隔离（0.4.0），但帧级深层协议攻击未逐帧验证 | 依赖 DSH 上游事件流实现；未认证/未授权连接在网关层已被销毁或过滤 |
| 引导文件含明文密码 | `dsh-ui-auth-bootstrap.txt` 明文记录首次管理员密码 | 工作目录不得被 Web 服务静态托管；首次登录后立即改密并删除该文件 |
| 客户端锁页/导航隐藏为 UX 层 | 真实安全边界是服务端 403 | 勿以客户端隐藏替代服务端守卫（已如此设计） |
| 普通用户仍可浏览模型列表（llm.providers） | 无法区分“查看可用模型”与“修改配置”，为可用性取舍 | 文档已注明；Key 与配置写入始终 403 |
| 通行密钥要求可用来源 | 浏览器规则：IP 字面量不能作为 RP ID，明文 HTTP 非回环不是安全上下文。在 `http://127.0.0.1:3080` 上通行密钥**根本无法工作**（实测 Chrome 152：`SecurityError: … is an invalid domain`） | 用 `http://localhost:3080` 或域名 + HTTPS；插件在不可用地址上提前返回 409 并在界面给出应改用的地址；不影响密码/TOTP 登录 |
| 通行密钥设备丢失 | 通行密钥只存在于设备（或用户的密码管理器）中，服务器无法代为恢复 | 绑定多个通行密钥；或保留 TOTP 作为第二因子；管理员可用「清除通行密钥」救援；管理员自身全部丢失且无 TOTP 时按 README 重置 `admin` 记录 |
| 依赖供应链 | 新增运行时依赖 `@simplewebauthn/server`（含传递依赖）与构建期 `@simplewebauthn/browser` | 两者均为活跃维护的社区标准实现，版本固定在 `package.json`；npm 发布带 provenance 证明；`npm run store:check` 持续校验依赖与权限信号 |

---

## 6. 复现

```bash
# 安全套件（147 项；加 DSH_SUITE_VERBOSE=1 会额外打印逐项明细，即 §2 的表格内容）
node test/security-suite.mjs                        # Windows: $env:DSH_SUITE_VERBOSE='1'

# 全量回归（构建 + 语法检查 + crypto/TOTP 向量 + 客户端冒烟 + 主机冒烟 + 登录页/端点 + 安全套件 + 策略回归）
npm test

# 通行密钥浏览器端到端（需要隔离实例 + 真实 Chrome；必须用 http://localhost:<port>）
#   DSH_PK_URL=http://localhost:3201 DSH_PK_USER=admin DSH_PK_PASSWORD=... node test/live-passkey-check.mjs
npm run test:passkey

# 通行密钥可用地址实测（RP ID 规则：独立小服务器 + CDP 虚拟认证器）
node test/webauthn-probe.mjs

# 商城契约门禁（依赖声明、权限信号、打包内容）
npm run store:check
```

安全套件以 mock 服务器驱动真实网关代码路径，不依赖真实 DSH 进程；结果以
“类别 PASS/FAIL + 逐项证据”输出，`process.exit` 码即 CI 判定。
§2 的表格由 `DSH_SUITE_VERBOSE=1` 的输出生成（维护方式见 `docs/PUBLISHING.md`），
因此文档与用例始终一致。
