# DSH STORE 证据与声明（dsh-ui-auth 0.6.4）

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
- 本声明对应版本：**0.6.4**（manifest `package.json` 与固定 Commit 一致）
- 本机自检：`npm run store:check`（`test/store-contract-check.mjs`，
  复刻 Catalog 固定源门禁的仓库侧可控项：20 项硬门禁全部通过）
- 证据采集版本说明：§2.1–§2.6 的安装/启动/卸载取证采集于 0.6.0（当时版本），
  §2.6 的浏览器级与通行密钥结果、§2.7 的复取证为 **0.6.4**。差异来源均已逐条标注。

---

## 1. 兼容性声明（Node.js 与 DSH）

manifest（`package.json`）声明如下，Catalog 自动化从该文件读取：

```jsonc
{
  "engines": { "node": "^22.19.0 || >=24.0.0" }, // Node.js 兼容范围（与 DSH 一致）
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" },
    "compatibility": {
      "dsh": ">=0.1.1-rc.2 <0.2.0",                       // DSH 兼容范围（作者声明）
      "dshReleases": {                                    // 精确逐版本声明
        "0.1.1-rc.2": "compatible",                       // 开发基线（legacy 传输）
        "0.1.5-rc.1": "compatible"                        // 当前 npm latest（modern 传输）
      },
      "profiles": ["web"]
    }
  }
}
```

- **`dshReleases` 只写我们实际跑过端到端验证的版本**：`0.1.1-rc.2`（真实部署回归，见 §2）与
  `0.1.5-rc.1`（隔离实例，见 §2.6）。其余版本（`rc.7`/`rc.8`/`0.1.1-rc.1`/`0.1.2-*`/`0.1.3-*`）
  未声明 → Catalog 写为 `unknown`，不做范围推断。
- `dsh` 范围 `>=0.1.1-rc.2 <0.2.0` 是作者声明（面向人类展示）；按目录契约，
  范围声明**不能替代**逐版本的安装/启动/卸载/回滚证据，后者见 §2。
- 传输适配按能力探测（`connection.authorizeIndex`）自动选择：0.1.1-rc.2 走 dotted/`apiProxy` 旧路径，
  0.1.2 起走 slash Remote + `/api/remote.mux`；两版都只使用公开宿主服务面
  （`ctx.webServer`、`ctx.connection`、`ctx.typertGateway`、`ctx.credentials`、`ctx.fs`、settings/registry），
  不触碰 `@deepseek-ai/*` 内部；上界 `<0.2.0` 是因为 DSH 0.2.0 的插件宿主契约会演进，需重新验证后再声明。

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
dsh plugin --profile web add <本插件目录的绝对路径>
```

实际输出（节选）：

```text
dsh: initialized profile web at <临时 home>\profiles\web
dependencies:
+ dsh-ui-auth link:<本插件目录的绝对路径>
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

实际输出：pnpm 移除 `dsh-ui-auth link:<本插件目录的绝对路径>`，随后
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

### 2.6 隔离 DSH 0.1.5-rc.1 实例验收（模块 2：modern 传输）

0.6.0 起，在一次性环境里对当前 npm `latest` 复现同一套验收（官方 npm 包，不构建 monorepo）：

```text
npm install --prefix <tmp>/cli @deepseek-ai/dsh@0.1.5-rc.1     # 官方 CLI（0.1.5-rc.1）
DSH_HOME=<tmp>/home dsh plugin --profile web add <本仓库>       # profile web = base + web-app + dsh-ui-auth
cd <tmp>/work && DSH_HOME=<tmp>/home dsh web --port 3201 --no-open   # 冷启动（cwd 即插件状态根）
DSH015_URL=http://127.0.0.1:3201 DSH015_BOOTSTRAP=<tmp>/work/dsh-ui-auth-bootstrap.txt \
  node test/live-015-check.mjs
DSH015_URL=http://127.0.0.1:3201 DSH015_BOOTSTRAP=<tmp>/work/dsh-ui-auth-bootstrap.txt \
  node test/live-015-mux.mjs
```

实测结果（2026-09-14）：**HTTP/unary 28/28 + mux 流 12/12 通过**。

| 检查 | 结果 |
|---|---|
| `GET /`（未登录） | `302 → /auth/login`（登录门生效） |
| `GET /auth/login` | `200` 登录页 |
| 未认证 `POST /api/session/list` | `401` |
| admin 登录 | `200` + `dsh_auth` cookie |
| **登录后 `GET /`** | `200` 原生 DSH UI（**carrier 桥接成功**：浏览器未持有原生 cookie/启动令牌） |
| admin `POST /api/session/list` | `200`（slash Remote 经插件网关可用） |
| admin `settings/describe` | `200` |
| admin `workspace/create` + `session/create` | `200`，会话归属先落盘再返回 |
| 普通用户 `session/list` | `200` 且 **看不到 admin 的会话**（items=0 vs admin items=1） |
| 普通用户读他人 `session/page` | `403` |
| 普通用户在他人 workspace 建会话 / 带 `cwd` 覆盖 | `403` / `403` |
| 普通用户 `settings/update`、`credentials/describe`、`workspace/create`、`commands/execute`、`dynamicCordisRunner/inventory`、`pluginInventory/list`、`directoryPicker/list`、`session/openWorkspacePath`、`subagents/list` | 逐条 `403`（deny-by-default） |
| 普通用户未审查端点 `future/endpoint` | `403` |
| 登出后同 cookie 再请求 | `401`（会话吊销生效） |
| **mux 流**：未认证升级 / admin `$events` ready / `session/control` baseline / 普通用户 `workspace/follow` baseline 裁剪 / 自有 `api-session/added` 仅投给 admin（逐帧隔离）/ 普通用户不收到 waterfall | 12/12（见 `test/live-015-mux.mjs`） |
| **浏览器级验收**：设置导航含「用户管理」、该页渲染（我的账号/修改密码/两步验证）、管理员额外项、无插件级错误 | 0.6.4 实测：隔离实例 **8/8**、真实 0.1.1-rc.2 面板 **7/7**（见 `test/live-ui-check.mjs`；0.6.1 首采时为 6/6 与 5/5，0.6.4 新增两条通行密钥卡片断言） |
| **通行密钥端到端**（0.6.4 新增）：注册（`residentKey=required` + 用户验证）、免用户名登录、计数器推进、2FA 第二步走通行密钥断言、反锁死拒删、结束复位 | **27/27**（真实 Chrome + CDP 虚拟认证器，见 `test/live-passkey-check.mjs`；须用 `http://localhost:<port>`） |

同期还做了 **0.1.1-rc.2 真实部署回归**（`node test/live-legacy-check.mjs`）：**14/14 通过**——
登录门、dotted `/api/session.list` 仍可用、普通用户 LLM/凭据管理面 403、会话导出属主检查 403、登出吊销生效。
0.6.4 复核时该面板已重启加载新构建，结果同样 **14/14**（浏览器级 **7/7**，`127.0.0.1` 源显示
「改用 localhost」提示、`localhost` 源显示通行密钥添加入口）。

> 证据级别 **partial**：覆盖"一次性/隔离环境 + 指定版本 + HTTP 与浏览器端到端验收"，
> 仍不构成完整交互验收或独立安全审计。浏览器级检查是在 0.6.1 补充的——0.6.0 的
> "客户端菜单静默失效"回归只有真实浏览器能暴露（根因与修复见
> `docs/DSH-0.1.5-COMPATIBILITY.md` 第 5 节）。modern 路径的有意收紧项（普通用户不可创建
> workspace、不可写任何设置命名空间、不可用 commands/execute 与 workspaceFiles 之外的宿主能力）
> 见同文档第 2 节。

### 2.7 0.6.4 复取证：新增运行依赖下的干净安装 / 启动 / 卸载

0.6.4 新增了一个运行依赖（`@simplewebauthn/server`，用于通行密钥校验），因此在一份
**全新的一次性环境**里重做了同一套装机验收（官方 npm CLI + 从零初始化的 profile，
不复用任何既有 profile 目录）：

```text
npm install --prefix <tmp>/cli @deepseek-ai/dsh@0.1.5-rc.1          # 官方 CLI
DSH_HOME=<tmp>/home dsh plugin --profile web add <本仓库>            # 全新 profile：base + web-app + dsh-ui-auth
cd <tmp>/work && DSH_HOME=<tmp>/home dsh web --port 3199 --no-open  # 冷启动（cwd 即插件状态根）
```

| 检查 | 结果 |
|---|---|
| `dsh plugin add` | 成功：`+ dsh-ui-auth link:<仓库>`（profile 首次初始化） |
| 冷启动 | 无模块解析错误；插件正常输出首次管理员引导 |
| `GET /`（未登录） | `302 → /auth/login`（登录门生效） |
| 未认证 `POST /api/session/list` | `401` |
| **`POST /auth/passkey/login/options`** | `409` + `issue:"ip-literal"`——**新依赖加载成功且通行密钥路由可用**；因请求来源是 IP 字面量而按期拒绝 |
| `GET /auth/login` | `200`，渲染出「改用 http://localhost」提示而不是不可用的通行密钥按钮 |
| 插件状态文件 | 只出现在一次性工作目录（`dsh-ui-auth-bootstrap.txt` 214 B）；真实部署目录写入数 **0** |
| `dsh plugin remove` 后再冷启动 | `/auth/login` → `404`、`/auth/passkey/login/options` → `405`、`GET /` 不再 302 到登录页 |

> 与 0.1.1-rc.2 卸载验证的差异：0.1.5 面板自带原生 token 门，卸载后 `GET /` 的响应码由 DSH 自身
> 决定（此处 303，指向 DSH 自己的流程），因此判定"插件门已消失"的依据是**插件路由返回 404/405**
> 且不再 302 到 `/auth/login`。证据级别同为 **partial**：一次性环境 + 单版本 + HTTP 级；
> 浏览器级与通行密钥交互证据见 §2.6 与 §2 的通行密钥行。

## 3. 依赖声明（Dependencies）

| 包 | 类型 | 用途 | 说明 |
|---|---|---|---|
| `qrcode@^1.5.4` | runtime dependency | TOTP 绑定二维码：SVG data URL（Node 端 `toString type:'svg'`，零 canvas 依赖） | MIT；纯 JS |
| `ws@^8.21.0` | runtime dependency | 0.1.2+ 的 `/api/remote.mux` 流 mux（WebSocket 服务端）实现 | MIT；零依赖的纯 JS 实现，与 DSH 自身所用版本同线（DSH `dsh-api-gateway` 亦依赖 `ws@^8.21.0`） |
| `@simplewebauthn/server@^14.0.2` | runtime dependency（0.6.4 起） | 通行密钥（Passkey / WebAuthn）服务端：注册与登录的选项生成、挑战校验、签名与计数器校验 | MIT；社区事实标准实现（SimpleWebAuthn），纯 JS。自带传递依赖：`@hexagon/base64`、`@levischuck/tiny-cbor`、`@peculiar/asn1-android`/`-ecc`/`-rsa`/`-x509`、`@peculiar/asn1-schema`、`@peculiar/asn1-x509`、`@peculiar/utils`、`@simplewebauthn/types`、`pvtsutils`、`tslib`（均为纯 JS，无原生模块、无生命周期脚本） |
| `@deepseek-ai/cordis@^4.0.1` | peerDependency | Cordis 宿主契约 | 官方命名空间 peer，由宿主安装体提供 |
| `typescript`、`esbuild`、`@types/node`、`@types/ws` | devDependency | 0.6.2 起：从 `src/*.ts` 构建 `lib/*.js` 与类型检查 | **不进运行产物**；`lib/*.js` 作为构建产物随仓库与 npm 包分发，安装期不需要它们 |
| `@simplewebauthn/browser@^14.0.0` | devDependency（0.6.4 起） | 浏览器端注册/登录仪式（`src/client.ts` 与 `src/passkey-browser.ts`） | **构建期依赖**：由 esbuild 内联进 `lib/client.js` 与 `lib/passkey-browser.js`，运行时不再从 npm 解析，因此**不是运行依赖**；与 `@simplewebauthn/server` 同版本线，协议行为一致 |
| `puppeteer@^25.9.0` | devDependency | 浏览器级验收（`npm run test:ui`、`npm run test:passkey`）、截图脚本 | 不进运行产物 |

审核建议：`lib/*.js` 是构建产物，审阅时以 `src/*.ts` 为准（构建命令见
`docs/DSH-0.1.5-COMPATIBILITY.md` 第 5 节；CI 会校验 `lib/` 与 `src/` 同步）。

**供应链说明**：三个运行依赖都固定于 `package-lock.json`；自动批准通道要求零运行依赖，
故本插件不适用 `source-verified`，走 `user-reviewed` 人工审查路径。0.6.4 新增的
`@simplewebauthn/server` 是本插件唯一"非零依赖"的运行依赖，选择它的理由：**协议实现
不由本项目自研**——WebAuthn 的 base64url/CBOR/ASN.1/签名校验细节任何一处自研都容易
产生静默的安全缺陷；SimpleWebAuthn 由社区长期维护、被广泛部署，且其服务端包不引入
原生模块或网络能力。

无 `bundledDependencies`、无 install/prepare 等生命周期脚本、无 git submodule、
无符号链接、无原生/可执行制品（`.node/.exe/.dll/.so` 等）。

## 4. 权限声明（Permissions）

按目录契约保守填写（来源：manifest + README + 运行时代码信号；自动化扫描独立复现，
`npm run store:check` 输出与本表一致）：

| 维度 | 声明 | 依据 |
|---|---|---|
| files | `write`（范围明确：插件私有状态） | `dsh-ui-auth-sessions.json`（会话 SHA-256 哈希）、`dsh-ui-auth-audit.jsonl`、`dsh-ui-auth-bootstrap.txt`（首次启动，改密后自毁）经 DSH `fs` 服务写入进程工作目录；不读任意用户路径 |
| network | `specified-services`（仅宿主自身服务器） | 网关包装 DSH Web UI 自己的 HTTP 请求/WS upgrade 监听器：0.1.1-rc.2 上消费 `apiProxy` 事件流；0.1.2+ 上服务 `/api/remote.mux` 流 mux 并在**进程内**向宿主 `connection` 换取 carrier cookie（`createSharedFetchHandler('/api').fetch(...)` 仅用于事件回执，目标始终是 `http://dsh.internal` 本进程）。**无任何公网出站连接**（无第三方端点、无遥测）；浏览器端仅同源 |
| commands | `none` | 运行时代码无 `child_process`/`exec`/`spawn`/shell |
| credentials | `read/write`（自有 realm `dsh-ui-auth/*`，经 DSH `credentials` 服务） | 用户账号/邀请码/2FA 元数据存于 `~/.dsh/.credentials.yaml` 的 `dsh-ui-auth/*` 域；**不存明文口令**（口令仅校验后丢弃或存密码哈希），会话 token 落盘为 SHA-256 |
| 汇总等级 | **high** | 触及凭据类敏感持久状态，且承担登录/会话/用户生命周期管理；按目录"权限等级"定义应标 `high`，不因"代码中暂未搜到"降级 |
| reviewStatus | `automated-scan` + 本文档 `author-verified` 披露 | 本表为作者对固定 Commit 的如实披露；自动化扫描独立给出相同信号 |

对 Catalog 的影响：`source-verified`（零运行依赖 + 无凭据/网络信号）对本插件**按设计不可达**；
凭据/网络能力是插件的功能本体（登录保护 = 必须读写凭据、必须接管网络入口）。
因此本条目应保持 `user-reviewed` 护栏：商城展示固定 Commit 差异、安装前由使用者
逐次本机风险审查。任何"自动批准"式结论都不应适用于此类插件。

## 5. 外部服务（External services）

**无。** 自包含：认证、会话、邀请码、TOTP（RFC 6238，纯 JS HMAC-SHA1）与通行密钥
（WebAuthn：挑战生成、签名与计数器校验，由随包安装的 `@simplewebauthn/server` 在本地完成）
全部本地实现；二维码本地生成（TOTP 由 `qrcode` 生成 SVG，通行密钥的手机扫码由**浏览器自身**的
跨设备流程显示，插件不产生也不上传任何二维码内容）；不发匿名统计、不调用第三方登录/风控/邮件服务。
唯一外部交互是 DSH 宿主自身服务（webServer / apiProxy / credentials / fs），全部随宿主进程运行。

## 6. 失败边界（Failure bounds）

- **credentials 服务不可用** → 登录/用户管理不可用（fail-closed：`state.ready` 为 false
  时网关拒绝放行，不降级为匿名访问）。
- **首次启动竞态**：面板重启后首个请求可能短暂 503（初始化未完成），随后自动恢复；
  live 测试脚本对此有重试逻辑，属文档化行为。
- **登录锁定**：同一来源（IP，默认不信 XFF；启用 trustProxy 时取最右地址）连续失败
  进入按 IP 冷却，防在线爆破。通行密钥校验失败同样计入。
- **会话**：服务端 TTL 过期即失效；退出登录/改密/管理员踢人即时失效全部会话；
  0.5.1 起落盘仅存 SHA-256 哈希（磁盘无明文 token）；**升级 0.5.1+ 后旧明文会话
  一次性全部失效，所有用户需重新登录一次**。
- **通行密钥**：挑战一次性、5 分钟过期、内存中限定条数（防资源耗尽）；来源/RP ID 校验失败
  或地址不可用一律拒绝（`/auth/passkey/*` 返回 409 + 可操作提示，不影响密码/TOTP 登录）；
  签名计数器回退视为认证器被复制并拒绝本次登录；每账号上限 20 个。
- **账号锁死防护**：`twoFactor` 只在账号仍有因子（已确认的 TOTP 或 ≥1 个通行密钥）时为真；
  开启 2FA 前必须先绑定因子；移除最后一个因子自动关闭 2FA；2FA 开启且仅剩一个通行密钥时
  拒绝删除，并在凭据库读写边界统一规范化，因此手工改坏的记录也会被修正。
- **通行密钥设备丢失**：服务器不持有私钥，无法代为恢复；可用其它已绑定通行密钥/TOTP 登录后，
  由管理员在【用户管理】执行「清除通行密钥」（管理员自身无其它因子时按 README 重置 `admin` 记录）。
- **bootstrap 自毁**：任意用户首次改密成功后删除 `dsh-ui-auth-bootstrap.txt`
  （fs 服务 unlink 优先，回退 processPath + node:fs unlink）；删除失败仅记录，
  不阻断改密（下次启动仍可再删）。
- **审计**：管理员操作、越权尝试与通行密钥增删（凭据 id 前缀、设备类型、备份状态）追加写 JSONL；
  写失败捕获后 console 报错、不中断业务。
- **WS 帧**：未知帧类型一律丢弃（fail-closed 固化）；事件流按会话/工作区归属过滤，
  普通用户网络层不收到他人会话帧。
- **密码复杂度**：全局策略 ≥8 位且至少两种字符类（注册/建号/改密/重置统一校验）。
- **卸载**：`dsh plugin remove` 还原 profile 依赖、`dsh.profile.bundles` 与 lockfile；
  重启后网关、设置面板、客户端模块全部消失（§2.5 差异验证）。

## 7. 已知边界 / 建议（面向使用者）

- 网关按 DSH 会话归属隔离 WS 事件流与工作区可见性；**多租户隔离强度以 DSH 自身的
  会话/权限模型为上限**，公网部署前请按 §4 与 SECURITY.md 评估信任边界。
- **通行密钥要求可用来源**：浏览器不接受 IP 字面量作为通行密钥域，因此
  `http://127.0.0.1:3080` 上通行密钥无法工作（实测 Chrome 152 报 `invalid domain`）。
  本机使用请访问 `http://localhost:3080`，生产请用域名 + HTTPS；插件会在不可用地址上
  提前拒绝并给出应改用的地址。密码与 TOTP 登录不受影响。
- 邮箱注册暂不校验真实性（可在用户管理中修改）；两步验证为可选加固项，可忽略提醒。
- 高权限插件安装前，请在本仓库查看固定 Commit、manifest、README 与本文档。
