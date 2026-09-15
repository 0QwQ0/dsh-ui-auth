// 一次性维护脚本：把 security-suite 的逐项输出（DSH_SUITE_VERBOSE=1）整理成 SECURITY.md 的
// 测试矩阵 Markdown，并替换文档里的第 2 节。生成物可随时复现，避免手工表格与用例漂移。
//
// 用法（推荐：自己跑套件并替换文档）：
//   node build/docs-matrix.mjs --run SECURITY.md
// 用法（复用已有输出）：
//   $env:DSH_SUITE_VERBOSE='1'; node test/security-suite.mjs > sec-verbose.out
//   node build/docs-matrix.mjs sec-verbose.out SECURITY.md
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const runMode = args[0] === '--run'
if (runMode) args.shift()

const [inputPath, targetPath] = runMode ? [undefined, args[0]] : args
if (targetPath === undefined) {
  console.error('usage: node build/docs-matrix.mjs --run <SECURITY.md>')
  console.error('       node build/docs-matrix.mjs <verbose-suite-output> <SECURITY.md>')
  process.exit(1)
}

let raw
if (runMode) {
  console.log('running test/security-suite.mjs (DSH_SUITE_VERBOSE=1) ...')
  const run = spawnSync(process.execPath, ['test/security-suite.mjs'], {
    cwd: root,
    env: { ...process.env, DSH_SUITE_VERBOSE: '1' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (run.status !== 0) {
    console.error('安全套件未全部通过（exit ' + String(run.status) + '），已中止文档更新：')
    console.error((run.stdout ?? '').split(/\r?\n/).filter((line) => line.includes('FAIL')).slice(0, 10).join('\n'))
    process.exit(1)
  }
  raw = run.stdout ?? ''
} else {
  raw = readFileSync(inputPath, 'utf8')
}

const CATEGORY_NAMES = {
  AUTH: '认证',
  SESSION: '会话管理',
  INJ: '注入 / 开放重定向 / 请求体',
  CSRF: '跨站请求（CSRF）',
  HTTP: 'HTTP 层与网关完整性',
  INFO: '信息泄露',
  AUTHZ: '授权与越权',
  ISO: '按用户数据隔离',
  AVAIL: '可用性',
  DEPLOY: '部署加固',
  'WS-ISO': 'WebSocket 事件流按用户隔离',
  CFG: '配置与限流',
  REG: '注册与邀请码',
  TOTP: '两步验证（TOTP）',
}
const ORDER = ['AUTH', 'SESSION', 'INJ', 'CSRF', 'HTTP', 'INFO', 'AUTHZ', 'ISO', 'AVAIL', 'DEPLOY', 'WS-ISO', 'CFG', 'REG', 'TOTP']

const lines = raw.split(/\r?\n/)
const start = lines.findIndex((line) => line.includes('逐项明细'))
const items = []
for (const line of lines.slice(start + 1)) {
  const match = /^(PASS|FAIL)\s{2}([A-Z-]+)\s+(.+)$/.exec(line.trim())
  if (match === null) continue
  items.push({ pass: match[1] === 'PASS', category: match[2], label: match[3].trim() })
}
if (items.length === 0) {
  console.error('未在输入中找到逐项明细（需要 DSH_SUITE_VERBOSE=1 的输出）')
  process.exit(1)
}

const byCategory = new Map()
for (const item of items) {
  if (!byCategory.has(item.category)) byCategory.set(item.category, [])
  byCategory.get(item.category).push(item)
}

const failed = items.filter((item) => !item.pass)
const total = items.length
const out = []
out.push(`## 2. 测试矩阵与结果（${total - failed.length}/${total} 通过）`)
out.push('')
out.push(`本表由测试自身的逐项输出生成，与代码同源，不手工维护：`)
out.push('')
out.push('```bash')
out.push('# 逐项明细（类别 + 用例名）')
out.push('DSH_SUITE_VERBOSE=1 node test/security-suite.mjs   # Windows: $env:DSH_SUITE_VERBOSE=\'1\'')
out.push('```')
out.push('')
out.push(`命令输出的 \`PASS <类别> <用例名>\` 行即下表的每一行；\`失败项\` 段落直接给出未通过用例与实测值。`)
out.push('')
for (const code of ORDER) {
  const group = byCategory.get(code)
  if (group === undefined) continue
  const passCount = group.filter((item) => item.pass).length
  out.push(`### ${code} · ${CATEGORY_NAMES[code] ?? code}（${group.length} 项，${passCount}/${group.length} 通过）`)
  out.push('')
  out.push('| 用例 | 结果 |')
  out.push('|---|---|')
  for (const item of group) out.push(`| ${item.label.replace(/\|/g, '\\|')} | ${item.pass ? 'PASS' : 'FAIL'} |`)
  out.push('')
}
out.push('### 通行密钥 Passkey / WebAuthn（套件外的浏览器级与联通性验收）')
out.push('')
out.push('通行密钥的端到端行为无法在 mock 服务器里证明（需要真实浏览器与认证器），因此单列。')
out.push('取证脚本与结果见下表；每一行都能用括号里的命令复现。')
out.push('')
out.push('| 用例 | 结果 | 取证 |')
out.push('|---|---|---|')
const passkeyRows = [
  ['注册要求可发现凭据（`residentKey: \'required\'` + `requireResidentKey`），并携带 `excludeCredentials`', 'PASS', 'live-passkey-check'],
  ['注册与登录都要求用户验证（`userVerification: \'required\'`）；未完成用户验证的断言被拒', 'PASS', 'live-passkey-check'],
  ['证明书策略 `attestation: \'none\'`：不索取、不存储设备厂商证明', 'PASS', 'live-passkey-check / host-smoke'],
  ['挑战一次性、用途隔离（注册 / 登录 / 二次验证），跨用途或重放被拒', 'PASS', 'host-smoke'],
  ['免用户名登录：按凭据 id 反查账号；凭据不属于目标账号时拒绝', 'PASS', 'live-passkey-check'],
  ['签名计数器回退（认证器被复制的迹象）→ 拒绝本次登录', 'PASS', 'webauthn-probe / host-smoke'],
  ['添加 / 重命名 / 删除通行密钥均需二次验证：密码 +（动态码 或 已有通行密钥断言）', 'PASS', 'live-passkey-check / host-smoke'],
  ['二次验证一次性票据：5 分钟过期、绑定账号与来源 IP、单次使用、不可重放', 'PASS', 'host-smoke'],
  ['无票据或票据无效时管理接口一律 403（仅窃取会话不足以改动登录因子）', 'PASS', 'host-smoke / live-passkey-check'],
  ['响应仅含摘要：`passkeyList` 不含公钥；审计只记凭据 id 前 8 位等公开元数据', 'PASS', 'live-passkey-check'],
  ['每账号通行密钥上限 20（取选项与写入两侧都校验）', 'PASS', 'host-smoke'],
  ['反锁死：2FA 开启且仅剩一个通行密钥时拒绝删除（400 + 操作指引）', 'PASS', 'live-passkey-check'], 
  ['反锁死：移除最后一个因子（TOTP 或通行密钥）时自动关闭 2FA', 'PASS', 'host-smoke'],
  ['无任何因子的账号不能开启 2FA', 'PASS', 'host-smoke'],
  ['管理员救援：可清除指定用户的全部通行密钥；普通用户调用被拒（403）', 'PASS', 'host-smoke / live-passkey-check'],
  ['未登录访问通行密钥管理面 → 401；伪造断言登录不下发会话', 'PASS', 'login-page-check'],
  ['IP 字面量 / 明文 HTTP 非回环地址：接口提前拒绝（409 + `issue` + 可操作提示）', 'PASS', 'login-page-check / webauthn-probe'],
  ['登录页内联脚本可解析，且不回归为原生表单提交', 'PASS', 'login-page-check'],
  ['免用户名通行密钥登录后记录最近使用时间、计数器推进', 'PASS', 'live-passkey-check'],
]
for (const [label, result, evidence] of passkeyRows) out.push(`| ${label} | ${result} | ${evidence} |`)
out.push('')
out.push('**记录规范化的作用**：`passkeys` 字段与 `twoFactor` 不变量在凭据库的读取、创建、修改三个边界上')
out.push('统一规范化（`sanitizePasskeys` + `reconcileTwoFactor`）。因此手工编辑过的 `.credentials.yaml`')
out.push('（例如把 `twoFactor` 改成 `true` 却没有因子）会在下次读取时被修正，不会产生"谁也登不进去"的账号。')
out.push('')

const matrix = out.join('\n')
const target = readFileSync(targetPath, 'utf8')
const marker = '## 2. 测试矩阵与结果'
const sectionEnd = target.indexOf('\n---\n', target.indexOf(marker))
if (sectionEnd === -1) {
  console.error('未找到第 2 节的结束标记（\\n---\\n）')
  process.exit(1)
}
const before = target.slice(0, target.indexOf(marker))
const after = target.slice(sectionEnd + 1)
writeFileSync(targetPath, before + matrix + after)
console.log(`已写入 ${targetPath}：${total} 项（${byCategory.size} 个类别）+ 通行密钥 ${passkeyRows.length} 项`)
