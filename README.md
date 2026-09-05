# dsh-ui-auth — DSH Web UI 认证网关插件

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

在 DSH Web UI 前套一层用户名/密码登录校验，未登录用户无法访问任何页面、API
或 WebSocket 通道。

## DSH 0.1.2 兼容适配（未发布）

新增适配当前斜杠 RPC、`payload.args`、`/api/remote.mux` 和 `$events` 交互回执的网关；旧版 Host 保留原适配。新版普通用户默认拒绝未审查接口，业务插件可通过 `uiAuth` 注册 HTTP/WS/逻辑流访问策略，并在自己的存储与事件中落实对象归属。登录不等于任意业务插件的数据隔离。

新版 Workspace 由维护者或可信部署插件分配；普通用户只能在自己的 Workspace 中创建会话，不能用 `cwd` 覆盖到任意目录。完整约束、扩展接口和真实 DSH 回归命令见 [0.1.2 兼容说明](docs/DSH-0.1.2-COMPATIBILITY.md)。该贡献尚不宣称完整多租户或任意插件兼容。

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
  生成，可查看每个码的已用/可注册次数与剩余数，可撤销。注册成功即**自动登录**
  并进入 **TOTP 引导页**（推荐立即添加两步验证令牌，也可跳过稍后添加）。
- **TOTP 两步验证（0.5.0）**：每个用户可在【用户管理】→「两步验证（TOTP）」
  中生成密钥并绑定 Google Authenticator / Microsoft Authenticator 等应用
  （RFC 6238，30 秒步进）。生成后显示**二维码**（扫码添加，由 `qrcode` 库生成
  SVG）与密钥/otpauth 链接（手动输入）。
  - **登录（0.5.0）**：启用 TOTP 后登录需两步验证——密码正确后要求输入验证器
    动态码；也支持**免密 TOTP 登录**（登录页密码留空、只填动态码）。动态码
    错误计入登录失败锁定（防爆破）。
  - 注册后未绑定 TOTP 的用户，每次登录页面加载会弹出提醒（可"永久忽略"取消，
    也可在设置中恢复提醒）。移除令牌需验证当前动态码；管理员可移除任意用户的令牌。
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
  密码策略：**至少 8 位且包含两种及以上字符类型**（大写/小写字母、数字、符号）；
  令牌/盐使用 Web Crypto 强熵；单 IP 连续 5 次登录失败锁定 30 秒（阈值与时长可用
  环境变量调整，见「配置」）；所有认证响应 `Cache-Control: no-store`。
- **Cookie Secure（0.5.1）**：TLS 直连或（仅当 `DSH_AUTH_TRUST_PROXY=1` 时）
  `X-Forwarded-Proto: https` 的安全通道下，`dsh_auth` Cookie 自动追加 `Secure`
  标志；HTTP 内网调试不受影响。
- **会话哈希落盘（0.5.1）**：`dsh-ui-auth-sessions.json` 只保存会话 Token 的
  SHA-256 哈希（64 位 hex），磁盘不再出现明文 Token；**升级到 0.5.1 后旧版明文
  会话记录不再恢复，所有用户需重新登录一次**。
- **引导文件自毁（0.5.1）**：首次登录后任意用户改密成功即自动删除
  `dsh-ui-auth-bootstrap.txt`（明文初始密码不再长期残留）。

## 界面预览

| 登录页 | 注册页 |
|---|---|
| ![登录页](assets/screenshot-login.png) | ![注册页](assets/screenshot-register.png) |

| 注册成功引导页（TOTP） | 用户管理页 |
|---|---|
| ![注册引导页](assets/screenshot-guide.png) | ![用户管理页](assets/screenshot-users.png) |

## 持久化

- 用户数据存于 DSH 的 credentials 服务（`~/.dsh/.credentials.yaml`，每用户一条
  `dsh-auth/<用户名>` 记录），重启后用户、角色、资料、密码、TOTP 绑定全部保留；
  邀请码存于 `dsh-auth/invites` 记录，TOTP 密钥（base32）随用户记录持久化。
- **会话（0.4.0）**：登录会话定期落盘到 fs 服务工作目录的
  `dsh-ui-auth-sessions.json`，**重启面板后未过期会话免登录恢复**（0.5.1 起磁盘只存
  会话 token 的 SHA-256 哈希，不再有明文 token；过期/登出/改密后即失效）。
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

运行时依赖：`qrcode`（生成 TOTP 绑定二维码）和 `ws`（新版 Remote mux 标准 WebSocket 实现），均无必需原生依赖；`dsh plugin add`
会自动安装；本地 link 安装后如提示缺少依赖，在插件目录执行一次 `npm install`。

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
| `DSH_AUTH_TRUST_PROXY` | 关 | 设为 `1`/`true`/`yes` 时信任 `X-Forwarded-For`（**取最右**——最近受信反代追加的地址，客户端无法伪造；同时信任 `X-Forwarded-Proto` 用于 Secure Cookie）。**仅在 HTTPS 反向代理后开启**——默认不信任，防止未配置反代时伪造 XFF 绕过/污染限流 |

面板进程启动时读取，改环境变量后重启面板生效。示例（PowerShell）：

```powershell
$env:DSH_AUTH_MAX_FAILS = '10'; $env:DSH_AUTH_LOCK_MS = '60000'; $env:DSH_AUTH_TRUST_PROXY = '1'
```

## 已知边界 / 建议

- 公网安全验证详见 [SECURITY.md](SECURITY.md)（威胁模型、75 项安全用例矩阵、
  OWASP Top 10 覆盖率、残余风险与部署加固清单）；本地复现：`node test/security-suite.mjs`。
- Secure Cookie（0.5.1）：TLS 直连或（仅在信任反代时）`X-Forwarded-Proto: https`
  下，`dsh_auth` Cookie 自动追加 `Secure`。公网部署仍建议放在 HTTPS 反向代理之后、
  由代理终结 TLS 并保留 Host，DSH 自身按 `127.0.0.1` 或内网监听。
- 登录限流按来源 IP（默认 `req.socket.remoteAddress`）：反向代理场景下会聚合为代理
  的 IP，可设置 `DSH_AUTH_TRUST_PROXY=1` 改按 `X-Forwarded-For` 真实客户端计数
  （见「配置」）。
- 会话有持久化（见「持久化」）：重启面板后未过期会话自动恢复；升级到 0.5.1+
  时旧版明文会话记录失效一次，所有用户需重新登录。
- 与 DSH 自带的 `/api` DNS-rebinding 信任栅栏叠加使用：该栅栏“明确不是认证”，
  本插件才是真正的前置认证层。

## DSH STORE 上架声明（0.5.2）

- **兼容性声明**：manifest `package.json` 的 `dsh.compatibility` 声明 DSH 范围
  `>=0.1.1-rc.2 <0.2.0` 与逐版本矩阵（精确 `compatible`：`0.1.1-rc.2`，其余未验证
  版本保持 `unknown`）；`engines.node` 声明 `>=22.19.0`。
- **依赖/权限/外部服务/失败边界**：完整作者侧证据与声明见
  [docs/STORE-EVIDENCE.md](docs/STORE-EVIDENCE.md)（一次性 Profile 的
  install/start/uninstall 实录、`qrcode` 依赖说明、权限表、无外部服务、失败边界）。
- 本插件属**凭据/网络能力类**（登录保护必须读写凭据并接管宿主 HTTP/WS 入口），
  自动 `source-verified` 通道按设计不适用，应按 `user-reviewed` 人工审查路径评估；
  本地契约自检：`npm run store:check`。
