# dsh-ui-auth — DSH Web UI 认证网关插件

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

在 DSH Web UI 前套一层用户名/密码登录校验，未登录用户无法访问任何页面、API
或 WebSocket 通道。

## 功能

- **全接口拦截**：直接包装 DSH 的 `node:http` 服务器，在路由分发之前检查会话，
  因此 `/api/*`（全部 RPC/SSE/下载）、`/plugins/*`（前端模块）、HMR、SPA fallback
  以及 `/api/events.mux`、`/api/events.host` 两个 WebSocket 升级通道全部被覆盖，
  没有旁路。
  - 未登录：页面请求 302 → `/auth/login`；API/静态资源 401；WS 升级直接销毁连接。
  - 登录后：原请求原样透传，功能零影响。
- **登录页**：`/auth/login` 提供自带样式的登录页（中文），登录成功写 `dsh_auth`
  Cookie（HttpOnly + SameSite=Strict，12 小时滑动续期）。
- **注册（0.5.0）**：`/auth/register` 注册页——新用户凭**邮箱 + 用户名 + 密码 +
  有效邀请码**注册（邮箱暂不校验真实性，注册后可在「用户管理」中自行修改；
  邮箱验证将在后续版本提供）。邀请码由管理员在【用户管理】→【邀请码管理】中
  生成，可查看每个码的已用/可注册次数与剩余数，可撤销。
- **TOTP 两步验证（0.5.0）**：每个用户可在【用户管理】→「两步验证（TOTP）」
  中生成密钥并绑定 Google Authenticator / Microsoft Authenticator 等应用
  （RFC 6238，30 秒步进）。生成后显示**二维码**（扫码添加，由 `qrcode` 库生成
  SVG）与密钥/otpauth 链接（手动输入）；注册后未绑定 TOTP 的用户，每次登录
  页面加载会弹出提醒（可"永久忽略"取消，也可在设置中恢复提醒）；当前版本登录
  仍以密码为准，免密 TOTP 登录将在后续版本提供。移除令牌需验证当前动态码；
  管理员可移除任意用户的令牌。
- **用户管理**（设置面板「用户管理」，需登录后可见）：
  - 所有用户：修改自己的昵称、邮箱与密码；管理自己的 TOTP 令牌；
  - 管理员：新增/删除用户、重置他人密码、切换角色、**管理邀请码**（生成/撤销、
    查看使用与剩余数）、移除任意用户的 TOTP；**任何人无法查看他人当前密码**。
  - 保护规则：不能删除/降级最后一个管理员、不能删除自己、改密/删除后其他会话立即失效。
  - 角色列显示为简短徽章（「管理」/「用户」），避免长文本换行。
- **模型配置页仅管理员**（【设置】→【模型】，含模型与 API Key 配置）：
  - 服务端强制（安全边界）：非管理员会话对 `settings.*`（`llm-*` / `settings.models`
    命名空间）、`credentials.set/unset`、`llm.discoverModels` 一律 403，绕过 UI
    直调 API 也无法配置；放行的 `/api` 请求体完整无损转发。
  - 客户端：普通用户「模型」页内容被替换为「仅管理员可访问」提示（`priority:-1`
    成为内容区胜者），并隐藏出厂「模型」导航行（设置导航按原始 entries 不去重，
    按设置面板导航位次隐藏出厂行；若部署新增 `order<10` 的设置页会位移，需调整
    `lib/client.js` 中的 `nth-child(2)` 选择器）。管理员不注入，保留原页面。
- **数据隔离（按登录用户）**：DSH 本身是单用户应用，会话/工作区为机器级数据；
  本插件按登录用户隔离，覆盖 REST/列表接口与 WebSocket 事件流：
  - 会话/工作区在创建时打标归属（`session.create/fork`、`workspace.create`）；
  - 普通用户只见自己的 `session.list` / `session.search` / `workspace.list`
    （响应侧过滤，含工作区内会话与归档会话）；
  - 直连访问非属主会话/工作区（`session.history/prompt/rename/…`、
    `workspace.*`）返回 403；`session.export` 仅限属主；
  - **事件流（0.4.0）**：`/api/events.mux`、`/api/events.host` 的 WebSocket
    升级由网关代理——每用户一条事件流，帧按会话/工作区归属逐帧过滤后转发，
    普通用户在**网络层**就收不到他人会话的事件帧（浏览器控制台同样看不到）；
    无归属维度的 `host/remote-event` 帧仅管理员可见；不再需要反向代理做
    事件流隔离（依赖 DSH 的 `ctx.apiProxy` 服务，缺失时该通道 fail-closed）。
  - 管理员不受限（可见全部数据）；本功能启用前的旧数据默认归管理员。
- **安全细节**：密码 PBKDF2-HMAC-SHA256（每用户随机盐，60000 轮，常量时间比较）；
  令牌/盐使用 Web Crypto 强熵；单 IP 连续 5 次登录失败锁定 30 秒（阈值与时长可用
  环境变量调整，见「配置」）；所有认证响应 `Cache-Control: no-store`。

## 持久化

- 用户数据存于 DSH 的 credentials 服务（`~/.dsh/.credentials.yaml`，每用户一条
  `dsh-auth/<用户名>` 记录），重启后用户、角色、资料、密码、TOTP 绑定全部保留；
  邀请码存于 `dsh-auth/invites` 记录，TOTP 密钥（base32）随用户记录持久化。
- **会话（0.4.0）**：登录会话定期落盘到 fs 服务工作目录的
  `dsh-ui-auth-sessions.json`，**重启面板后未过期会话免登录恢复**（token 明文
  落盘等价于"记住登录态"，文件仅属主可读写；过期/登出/改密后即失效）。
- **审计（0.4.0）**：管理员操作（增删用户、重置密码、改角色、改密）与普通用户
  越权尝试写入 fs 服务工作目录的 `dsh-ui-auth-audit.jsonl`（JSONL，每行含
  `t`/`actor`/`action`/`target` 等字段），便于事后追溯。

## 首次启动

用户表为空时自动创建管理员 `admin`，随机密码写入：
1. 宿主控制台日志（`[dsh-ui-auth]` 前缀）；
2. 进程工作目录下的 `dsh-ui-auth-bootstrap.txt`。

请登录后立即修改该密码并删除引导文件。

## 安装（推荐：`dsh plugin add`，归一化 bundle 机制）

本包声明了 `dsh.bundle.patch`（`cordis.patch.yml`）与 `dsh.client`，是标准的
profile bundle 层。`dsh plugin` 会自动把声明了 `dsh.bundle` 的依赖加入
`dsh.profile.bundles` 名单，卸载时自动移除——安装/卸载零手工残留。

```bash
# 本地 link 安装
dsh plugin --profile web add "link:F:/aura/pluginDev/dsh-ui-auth"

# 或 registry 安装（发布后）
dsh plugin --profile web add dsh-ui-auth
```

运行时依赖：`qrcode`（生成 TOTP 绑定二维码，纯 JS 无原生依赖；`dsh plugin add`
会自动安装；本地 link 安装后如提示缺少依赖，在插件目录执行一次 `npm install`）。

bundle 层在**启动时**应用（挂载 Host 网关 + 发现客户端模块），因此首次安装需
重启一次面板生效。

## 卸载（完全恢复安装前状态）

```bash
dsh plugin --profile web remove dsh-ui-auth
# 重启面板后，网关、设置面板、客户端模块全部消失，profile 配置（dependencies、
# dsh.profile.bundles、lockfile）已还原；若 node_modules 残留悬空链接，可执行
# pnpm install 清理。
```

**完全清空数据（可选）**：卸载不会自动删除用户数据（防误删）。要恢复"安装前的
原样"，手动删除 `~/.dsh/.credentials.yaml` 中 `dsh-auth:` 下的记录（用户 + 归属表），
并删除进程工作目录下的 `dsh-ui-auth-bootstrap.txt`（首次启动生成的引导文件，若存在）。

> 早期版本用手动 `cordis.patch.yml` 补丁行挂载；0.3.1 起统一为 bundle 机制。
> 若你仍在使用补丁行方式，升级后请删除 profile `cordis.patch.yml` 里的
> `dsh-ui-auth` 行，改用上面的 `dsh plugin add`。

## 配置（可选，环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DSH_AUTH_MAX_FAILS` | `5` | 单来源连续登录失败锁定阈值（正整数；非法值回退默认） |
| `DSH_AUTH_LOCK_MS` | `30000` | 锁定持续时间毫秒 |
| `DSH_AUTH_TRUST_PROXY` | 关 | 设为 `1`/`true`/`yes` 时信任 `X-Forwarded-For`（取最左，按真实客户端 IP 计数）。**仅在 HTTPS 反向代理后开启**——默认不信任，防止未配置反代时伪造 XFF 绕过/污染限流 |

面板进程启动时读取，改环境变量后重启面板生效。示例（PowerShell）：

```powershell
$env:DSH_AUTH_MAX_FAILS = '10'; $env:DSH_AUTH_LOCK_MS = '60000'; $env:DSH_AUTH_TRUST_PROXY = '1'
```

## 已知边界 / 建议

- 公网安全验证详见 [SECURITY.md](SECURITY.md)（威胁模型、75 项安全用例矩阵、
  OWASP Top 10 覆盖率、残余风险与部署加固清单）；本地复现：`node test/security-suite.mjs`。
- Cookie 未加 `Secure` 标记：公网部署请放在 HTTPS 反向代理之后，由代理终结 TLS
  并在转发时保留 Host，DSH 自身按 `127.0.0.1` 或内网监听即可。
- 登录限流按来源 IP（默认 `req.socket.remoteAddress`）：反向代理场景下会聚合为代理
  的 IP，可设置 `DSH_AUTH_TRUST_PROXY=1` 改按 `X-Forwarded-For` 真实客户端计数
  （见「配置」）。
- 会话仅存内存：重启后所有用户需重新登录。
- 与 DSH 自带的 `/api` DNS-rebinding 信任栅栏叠加使用：该栅栏“明确不是认证”，
  本插件才是真正的前置认证层。
