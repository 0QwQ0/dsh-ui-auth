# Changelog

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
- **测试**：0.5.0 新增面安全矩阵补测（security-suite 新增 9 项：普通用户
  inviteList/inviteRevoke 403、撤销不存在码 404、用户名 HTML 字符 400、引导页
  no-store、未绑定 TOTP 开启 2FA 400、普通用户移除他人 TOTP 403、管理员移除
  不存在用户 404），总计 140/140；真实部署注册面 9/9。
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
