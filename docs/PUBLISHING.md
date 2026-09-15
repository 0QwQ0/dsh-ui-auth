# 发布与维护（维护者文档）

面向本仓库维护者。普通使用者请看 [README.md](../README.md)。

## 自动发布到 npm

[`.github/workflows/npm-publish.yml`](../.github/workflows/npm-publish.yml) 以 GitHub 官方
"Publish Node.js Package" 模板为骨架，并加了**定时同步**与幂等保护：

| 触发 | 行为 |
|---|---|
| `release: published` | 发布该 Release（模板行为） |
| `schedule`（每天 03:17 UTC） | 取**最新 Release**，若其版本尚未在 npm 则补发布 |
| `workflow_dispatch` | 手动补发布 |

流程要点：

1. `Test` job：`npm ci`（含开发依赖，用于构建）→ `npm run typecheck` → `npm test`
   （从 `src/*.ts` 重新构建并跑全链测试）→ 校验 `lib/` 与 `src/` 一致；CI 以
   `PUPPETEER_SKIP_DOWNLOAD=true` 跳过 Chromium 下载；
2. `Publish to npm` job：解析最新 Release tag → **校验 tag 与 `package.json` 版本一致**
   （不一致直接失败，避免发布与 Release 不符的代码）→ 用 `npm view` 判断该版本是否已在
   npm（已存在则幂等跳过）→ 校验 Secret → `npm publish --provenance --access public`；
   `npm publish` 会触发 `prepack`（= `npm test`），因此**在目标 tag 上再跑一遍完整测试**；
3. `concurrency: npm-publish` 串行化，避免并发重复发布。

### 前置配置（一次性）

仓库 **Settings → Secrets and variables → Actions → New repository secret**：

- 名称：`NPM_TOKEN`
- 值：npmjs.com 生成的 **Granular Access Token** —— Packages: **Read and write**、
  Scope 限定 `dsh-ui-auth`，并**打开 "Bypass 2FA when using this token"**
  （否则发布会被 2FA 拦下）

未配置该 Secret 时，需要发布的运行会**明确失败并提示**，不会静默跳过。

> 也可改用 npm **Trusted Publishing（OIDC）**：在 npmjs.com 为本仓库 + 本 workflow 配置
> Trusted Publisher 后，删除 `Publish` 步骤的 `NODE_AUTH_TOKEN` 环境变量即可无需任何 secret
> （workflow 已声明 `id-token: write`）。

### 手动补发布

```bash
gh workflow run npm-publish.yml          # 或在 Actions 页面点 Run workflow
gh run list --workflow=npm-publish.yml   # 查看运行结果
```

## 发版步骤

1. 修改 `package.json` 的 `version`（并同步 `package-lock.json`），在 `CHANGELOG.md` 顶部
   新增该版本条目（含验证结果表）；行为或界面有变化时同步更新 `README.md`；
2. `npm test`、`npm run typecheck`、`npm run store:check`、`npm run verify:clean` 均通过后提交并推送 `main`；
3. 打 tag 并创建 Release（**标题只写版本号**，不要附加说明——说明写在 Release 正文里）：
   ```bash
   git tag -a vX.Y.Z -m "dsh-ui-auth X.Y.Z"
   git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <release-notes.md> --verify-tag
   ```
4. CI 会据此自动发布到 npm（幂等：已发布的版本会跳过）。

### 文档维护

- **SECURITY.md 第 2 节的测试矩阵不要手工改**：它由安全套件的逐项输出生成——
  ```bash
  # Windows PowerShell
  $env:DSH_SUITE_VERBOSE='1'; cmd /c "node test/security-suite.mjs > sec-verbose.out 2>&1"
  node build/docs-matrix.mjs sec-verbose.out SECURITY.md
  ```
  这样就地替换文档里的矩阵小节（含类别计数与通行密钥的套件外证据表），
  用例改名或增删后重跑即可，文档与用例不会漂移。
- 每条发布说明都应能在文档中找到对应的可复现命令；「结论表」里的数字必须来自实际执行
  （本次执行的时间/环境写进表格上方的行，例如「验收（YYYY-MM-DD，两条宿主线均以 X.Y.Z 构建实测）」）。
- **界面预览图**用 `npm run assets` 重拍（`test/shot.mjs`）：对一个**一次性实例**跑，
  用 `DSH_SHOT_DEMO_USERS=1` 让「用户管理」表格有像样的行（脚本会挑当前仍可用的用户名，
  因为已删除的用户名会进入永久墓碑、无法重建），并在结束时删除它自己创建的账号；
  截图前会打印它刚拍下的表格表头与行，便于核对成图内容。通行密钥相关界面必须在
  `localhost` 或域名 + HTTPS 下访问才会完整渲染。

## 上架合规声明（DSH STORE）

- **兼容性声明**：`package.json` 的 `dsh.compatibility` 声明 DSH 范围 `>=0.1.1-rc.2 <0.2.0`
  与逐版本矩阵（精确 `compatible` 的版本以实际端到端验证为准，未验证版本保持 `unknown`）；
  `engines.node` 与 DSH 一致。
- **依赖 / 权限 / 外部服务 / 失败边界**：完整作者侧证据见
  [STORE-EVIDENCE.md](STORE-EVIDENCE.md)。
- 本插件属**凭据/网络能力类**（认证网关必须读写凭据并接管宿主 HTTP/WS 入口），
  自动 `source-verified` 通道按设计不适用，应按 `user-reviewed` 人工审查路径评估。
- 本地契约自检：`npm run store:check`（复刻固定源门禁的仓库侧可控项）。

## 保真核验（重写/重构时使用）

`node test/port-fidelity.mjs <git-ref>` 对比工作区构建产物与指定 ref 中旧实现的
**可观察要素多重集**（字符串字面量、数字字面量、导出名）。逐行 diff 没有意义——
`tsc` 会重排格式、`esbuild` 会重打印；该工具关注的是行为载荷（HTML/CSS/错误文案/键名）。

重写或大改时的推荐证据组合：

1. 上述要素多重集对比（无缺失/新增）；
2. `npm test` 全链（安全套件 + 策略回归 + 冒烟 + 向量 + 登录页/端点联通）；
3. 端到端：隔离的一次性 DSH 实例（0.1.5+）与真实部署（0.1.1-rc.2）回归脚本，
   见 [DSH-0.1.5-COMPATIBILITY.md](DSH-0.1.5-COMPATIBILITY.md) 第 4 节；
4. 涉及界面或浏览器能力时，必须补真实浏览器验收（`npm run test:ui`、`npm run test:passkey`）——
   客户端注册类问题与浏览器规则（例如 IP 字面量不能作为通行密钥域）只在真实浏览器里暴露；
5. 必要时用 esbuild 压缩两份产物比对 sha256（token 级一致）。
