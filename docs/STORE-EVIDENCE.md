# DSH STORE 证据与声明（dsh-ui-auth 0.5.2）

本文档是 **作者侧整改证据**，回应 DSH STORE Catalog 自动检查（
[issue #327](https://github.com/AI-Scarlett/DSH-Store/issues/327)，`catalog-blocked`）。
它**不是**安全审计，也不代表 DSH STORE 的运行时验收——自动门禁只读固定 Commit 的
manifest / README / 运行时代码，不执行第三方 install/prepare/build/test/运行时代码。
「部分验证」不得被当作完整运行验收。

证据形态与口径遵循 [DSH-Store registry 契约](https://github.com/AI-Scarlett/DSH-Store/blob/main/registry/README.md)
与 [build-dsh-plugin](https://github.com/AI-Scarlett/build-dsh-plugin) 的边界：
只使用一次性 Profile / 临时 `DSH_HOME`，不写真实 `~/.dsh`，不修改 DSH 核心，
不用低层测试冒充运行验收。

- 仓库：https://github.com/0QwQ0/dsh-ui-auth（canonical GitHub，公开）
- 本声明对应版本：**0.5.2**（manifest `package.json` 与本次固定 Commit 一致）
- 本机自检：`npm run store:check`（`scripts/store-contract-check.mjs`，
  复刻 Catalog 固定源门禁的仓库侧可控项：20 项硬门禁全部通过）

---

## 1. 兼容性声明（Node.js 与 DSH）

manifest（`package.json`）声明如下，Catalog 自动化从该文件读取：

```jsonc
{
  "engines": { "node": ">=22.19.0" },          // Node.js 兼容范围
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" },
    "compatibility": {
      "dsh": ">=0.1.1-rc.2 <0.2.0",             // DSH 兼容范围（作者声明）
      "dshReleases": { "0.1.1-rc.2": "compatible" }, // 精确逐版本声明
      "profiles": ["web"]
    }
  }
}
```

- **`dshReleases` 只写我们实际跑过一次性 Profile 验证的版本**：`0.1.1-rc.2`（即
  `dsh-v0.1.1-rc.2`，见 §2）。其余版本（`rc.7`/`rc.8`/`0.1.1-rc.1`/`0.1.2-alpha.*`）
  未声明 → Catalog 写为 `unknown`，不做范围推断。
- `dsh` 范围 `>=0.1.1-rc.2 <0.2.0` 是作者声明（面向人类展示）；按目录契约，
  范围声明**不能替代**逐版本的安装/启动/卸载/回滚证据，后者见 §2。
- 插件只使用跨 0.1.x 稳定的公开宿主服务面（`ctx.webServer`、`ctx.apiProxy` events、
  `ctx.credentials`、`ctx.settings`/registry 与 fs），不触碰 `@deepseek-ai/*` 内部；
  上界 `<0.2.0` 是因为 DSH 0.2.0 的插件宿主契约会演进，需重新验证后再声明。

## 2. 一次性 Profile 安装 / 启动 / 卸载证据

### 2.1 方法与隔离边界

- **临时 `DSH_HOME`**：`$(mktemp)` 等价物（Windows 下 `%TEMP%\dshstore-ev-<ts>\home`），
  全程未触碰真实 `~/.dsh`、真实 profile、真实凭据库。
- **临时工作目录**作为插件 fs 根（`%TEMP%\...\work`）：一次性实例的
  `dsh-ui-auth-sessions.json` / `dsh-ui-auth-bootstrap.txt` / 审计文件只落在此目录；
  已核对真实部署目录在实验期间无新增写入（见 2.5 隔离核对）。
- **临时端口 3199**，实验结束立即释放；真实面板（3080）不受影响。
- 运行期环境：**DSH `dsh-v0.1.1-rc.2`**（git tag，recovery checkout）、**Node v24.15.0**、
  Windows。DSH 官方 engines 为 `^22.19.0 || >=24.0.0`，本机 Node 满足。

### 2.2 安装（Install）

```text
$env:DSH_HOME = <临时 home>
dsh plugin --profile web add F:\aura\pluginDev\dsh-ui-auth
```

实际输出（节选）：

```text
dsh: initialized profile web at <临时 home>\profiles\web
dependencies:
+ dsh-ui-auth link:F:/aura/pluginDev/dsh-ui-auth
Already up to date
Done in 330ms using pnpm v11.22.0
```

`plugin add` 先按 shipped template 初始化 profile（`@deepseek-ai/dsh-base` +
`@deepseek-ai/dsh-web-app`），再把本地仓库作为 link 依赖加入并把 `dsh-ui-auth`
写入 `dsh.profile.bundles`。**无任何生命周期脚本**（manifest 无
preinstall/install/postinstall/prepare）。

### 2.3 配置合成（Config synthesis / 启动前检查）

```text
dsh web --dump-config
```

组合树末尾出现本插件的 patch 层：

```yaml
# == dsh-ui-auth
- id: dsh-ui-auth
  name: dsh-ui-auth
```

### 2.4 启动与功能验收（Cold start）

```text
dsh web --port 3199        # 后台运行，cwd = <临时 work>
```

启动日志（节选；初始管理员密码为一次性随机值，此处脱敏）：

```text
dsh web: http://127.0.0.1:3199
[dsh-ui-auth] 首次启动：已创建管理员账号   用户名: admin   密码: <随机16位，已脱敏>
[dsh-ui-auth] 初始账号已写入文件 dsh-ui-auth-bootstrap.txt（进程工作目录）
```

HTTP 探测（全部真实请求）：

| 请求 | 结果 | 含义 |
|---|---|---|
| `GET /` | `302 Found`，`location: /auth/login` | 认证网关已接管根路径 |
| `GET /`（跟随重定向） | `200`，登录页 | 登录页可访问 |
| `GET /api/<任意受保护路径>` | `401` | 未认证访问 fail-closed |
| `POST /auth/login`（bootstrap 管理员） | `200 {"ok":true,"redirect":"/"}`，`Set-Cookie: dsh_auth` | 端到端登录成功 |
| `GET /auth/me`（带 cookie） | `200 {"authenticated":true,...,"role":"admin",...}` | 会话有效 |
| `GET /`（带 cookie） | `200` | 已认证请求放行 |

### 2.5 卸载与回滚（Uninstall）+ 隔离核对

```text
dsh plugin --profile web remove dsh-ui-auth
```

实际输出：pnpm 移除 `dsh-ui-auth link:F:/aura/pluginDev/dsh-ui-auth`，随后
`dsh web --dump-config` 中 `dsh-ui-auth` 命中数为 **0**，profile manifest bundles
还原为 `@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app`。

卸载后再次冷启动做差异验证：`GET /` 返回 `200 text/html`（普通 dsh Web UI），
**不再** 302 到 `/auth/login`——网关与客户端模块已随卸载完全消失。

隔离核对：一次性实例产生的 `dsh-ui-auth-sessions.json`（134 B）与
`dsh-ui-auth-bootstrap.txt`（214 B）只出现在 `<临时 work>`；真实部署的 fs 根在
实验前后文件时间戳未变化，真实凭据库/Profile 未被读取或写入。

> 证据级别：**partial**（一次性 Profile + 单个 DSH 版本 `0.1.1-rc.2` 的
> install/start/uninstall + 端到端登录；未覆盖其它 DSH 版本、未做独立安全审计）。
> 复现方法如上（步骤可逐条重跑），口令为一次性随机值，不在此保留。

## 3. 依赖声明（Dependencies）

| 包 | 类型 | 用途 | 说明 |
|---|---|---|---|
| `qrcode@^1.5.4` | runtime dependency（唯一） | TOTP 绑定二维码：SVG data URL（Node 端 `toString type:'svg'`，零 canvas 依赖） | MIT；纯 JS；**供应链说明**：固定于 `package-lock.json`，属"需单独供应链审查"项——自动批准通道要求零运行依赖，故本插件不适用 `source-verified`，走 `user-reviewed` 人工审查路径 |
| `@deepseek-ai/cordis@^4.0.1` | peerDependency | Cordis 宿主契约 | 官方命名空间 peer，由宿主安装体提供 |
| `puppeteer@^25.9.0` | devDependency | 浏览器自动化冒烟/截图（仅测试） | 不进运行产物 |

无 `bundledDependencies`、无 install/prepare 等生命周期脚本、无 git submodule、
无符号链接、无原生/可执行制品（`.node/.exe/.dll/.so` 等）。

## 4. 权限声明（Permissions）

按目录契约保守填写（来源：manifest + README + 运行时代码信号；自动化扫描独立复现，
`npm run store:check` 输出与本表一致）：

| 维度 | 声明 | 依据 |
|---|---|---|
| files | `write`（范围明确：插件私有状态） | `dsh-ui-auth-sessions.json`（会话 SHA-256 哈希）、`dsh-ui-auth-audit.jsonl`、`dsh-ui-auth-bootstrap.txt`（首次启动，改密后自毁）经 DSH `fs` 服务写入进程工作目录；不读任意用户路径 |
| network | `specified-services`（仅宿主自身服务器） | 网关包装 DSH Web UI 自己的 HTTP 请求/WS upgrade 监听器并消费 `apiProxy` 事件流；**无任何出站连接**（无 fetch/WebSocket 主动外联、无遥测端点）；浏览器端仅同源 |
| commands | `none` | 运行时代码无 `child_process`/`exec`/`spawn`/shell |
| credentials | `read/write`（自有 realm `dsh-ui-auth/*`，经 DSH `credentials` 服务） | 用户账号/邀请码/2FA 元数据存于 `~/.dsh/.credentials.yaml` 的 `dsh-ui-auth/*` 域；**不存明文口令**（口令仅校验后丢弃或存密码哈希），会话 token 落盘为 SHA-256 |
| 汇总等级 | **high** | 触及凭据类敏感持久状态，且承担登录/会话/用户生命周期管理；按目录"权限等级"定义应标 `high`，不因"代码中暂未搜到"降级 |
| reviewStatus | `automated-scan` + 本文档 `author-verified` 披露 | 本表为作者对固定 Commit 的如实披露；自动化扫描独立给出相同信号 |

对 Catalog 的影响：`source-verified`（零运行依赖 + 无凭据/网络信号）对本插件**按设计不可达**；
凭据/网络能力是插件的功能本体（登录保护 = 必须读写凭据、必须接管网络入口）。
因此本条目应保持 `user-reviewed` 护栏：商城展示固定 Commit 差异、安装前由使用者
逐次本机风险审查。任何"自动批准"式结论都不应适用于此类插件。

## 5. 外部服务（External services）

**无。** 自包含：认证、会话、邀请码、TOTP（RFC 6238，纯 JS HMAC-SHA1）全部本地实现；
二维码本地生成；不发匿名统计、不调用第三方登录/风控/邮件服务。唯一外部交互是
DSH 宿主自身服务（webServer / apiProxy / credentials / fs），全部随宿主进程运行。

## 6. 失败边界（Failure bounds）

- **credentials 服务不可用** → 登录/用户管理不可用（fail-closed：`state.ready` 为 false
  时网关拒绝放行，不降级为匿名访问）。
- **首次启动竞态**：面板重启后首个请求可能短暂 503（初始化未完成），随后自动恢复；
  live 测试脚本对此有重试逻辑，属文档化行为。
- **登录锁定**：同一来源（IP，默认不信 XFF；启用 trustProxy 时取最右地址）连续失败
  进入按 IP 冷却，防在线爆破。
- **会话**：服务端 TTL 过期即失效；退出登录/改密/管理员踢人即时失效全部会话；
  0.5.1 起落盘仅存 SHA-256 哈希（磁盘无明文 token）；**升级 0.5.1+ 后旧明文会话
  一次性全部失效，所有用户需重新登录一次**。
- **bootstrap 自毁**：任意用户首次改密成功后删除 `dsh-ui-auth-bootstrap.txt`
  （fs 服务 unlink 优先，回退 processPath + node:fs unlink）；删除失败仅记录，
  不阻断改密（下次启动仍可再删）。
- **审计**：管理员操作与越权尝试追加写 JSONL；写失败捕获后 console 报错、不中断业务。
- **WS 帧**：未知帧类型一律丢弃（fail-closed 固化）；事件流按会话/工作区归属过滤，
  普通用户网络层不收到他人会话帧。
- **密码复杂度**：全局策略 ≥8 位且至少两种字符类（注册/建号/改密/重置统一校验）。
- **卸载**：`dsh plugin remove` 还原 profile 依赖、`dsh.profile.bundles` 与 lockfile；
  重启后网关、设置面板、客户端模块全部消失（§2.5 差异验证）。

## 7. 已知边界 / 建议（面向使用者）

- 网关按 DSH 会话归属隔离 WS 事件流与工作区可见性；**多租户隔离强度以 DSH 自身的
  会话/权限模型为上限**，公网部署前请按 §4 与 SECURITY.md 评估信任边界。
- 邮箱注册暂不校验真实性（可在用户管理中修改），2FA 为建议项（登录页可提示但可忽略）。
- 高权限插件安装前，请在本仓库查看固定 Commit、manifest、README 与本文档。
