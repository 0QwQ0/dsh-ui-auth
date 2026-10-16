/**
 * 活体验证：Issue #3 —— 自带 HTTP 载体的第三方插件（非标准 `{method, payload}` 信封）。
 *
 * 这是**报告者复现环境**里的端到端检查：真实 DSH `0.2.0-rc.2` + 真实
 * `@xmanrui/dsh-im@4.38.2`（他用的版本），对**本插件**做 A/B。
 *
 * 判定：管理员发他的原始复现请求后
 *   - 403  → FAIL（复现了他的 bug：形状检查先于 admin 放行）
 *   - 200 且响应来自 dsh-im 自己的处理器（`schemaVersion`/`bot`/`health` 等字段）→ PASS
 *   - 其他 → INCONCLUSIVE（例如 dsh-im 未安装：路径 404 或响应不含其字段）
 * 同时要求：普通用户对同一请求仍 403（默认拒绝不被放宽）。
 *
 * 用法：
 *   PROBE_URL=http://127.0.0.1:3207 node test/live-im-envelope-check.mjs
 *   （可选）DSH_AUTH_BOOTSTRAP=<引导文件路径>；目标实例需已安装 @xmanrui/dsh-im@4.38.x
 *
 * 实测记录（2026-10-16，本机）：
 *   0.7.0（报告时版本）→ admin 403、普通用户 403、连不存在的 dsh-im 路径也 403（形状检查前置的直接证据）
 *   main（修复版）    → admin 200（返回飞书机器人 connection.status 真实响应）、普通用户 403、不存在的路径 404
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.env.PROBE_URL
if (base === undefined || base === '') {
  console.error('需要 PROBE_URL，例如 PROBE_URL=http://127.0.0.1:3207')
  process.exit(2)
}
const bootstrap = process.env.DSH_AUTH_BOOTSTRAP
  ?? path.join(os.tmpdir(), 'dsh020', 'work', 'dsh-ui-auth-bootstrap.txt')
const adminPw = (/密码[:：]\s*(\S+)/.exec(fs.readFileSync(bootstrap, 'utf8')) ?? [])[1] ?? ''
if (adminPw === '') { console.error(`无法从 ${bootstrap} 解析管理员密码`); process.exit(2) }

const login = async (username, password) => {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }), redirect: 'manual',
  })
  const cookies = (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0])
  return { status: response.status, cookie: cookies.join('; ') }
}
const rpc = async (cookie, method, body) => {
  const response = await fetch(`${base}/auth/rpc/${method}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })
  return { status: response.status, text: await response.text() }
}
/** 报告者给出的原始复现请求体（原样保留） */
const REPRO = JSON.stringify({
  type: 'client-request', rpcId: 't1', method: 'dsh-im/feishu',
  payload: { method: 'connection.status', payload: {} },
})
const call = async (cookie, endpointPath, body) => {
  const response = await fetch(`${base}${endpointPath}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body,
  })
  return { status: response.status, text: await response.text() }
}
/** dsh-im 自己的响应特征（非本插件/宿主通用形状） */
const looksLikeImPayload = (text) =>
  text.includes('server-response') && (/schemaVersion|"bot"|"health"|"channels"/.test(text))

const admin = await login('admin', adminPw)
if (admin.status !== 200) { console.error(`管理员登录失败（${admin.status}）`); process.exit(2) }
const username = 'imcheck' + Date.now().toString(36)
const created = await rpc(admin.cookie, 'createUser', { username, password: 'Im-Check-1234!', role: 'user' })
if (created.status !== 200) { console.error(`创建普通用户失败（${created.status}）`); process.exit(2) }
const user = await login(username, 'Im-Check-1234!')

const adminCall = await call(admin.cookie, '/api/dsh-im/feishu', REPRO)
const userCall = await call(user.cookie, '/api/dsh-im/feishu', REPRO)
const ghost = await call(admin.cookie, '/api/dsh-im/__probe__/nothing', JSON.stringify({
  type: 'client-request', rpcId: 'p', method: 'dsh-im/__probe__/nothing', payload: { method: 'x', payload: {} },
}))
await rpc(admin.cookie, 'deleteUser', { username }).catch(() => { /* ignore */ })

console.log(`  管理员 + 报告者的复现请求 → HTTP ${adminCall.status}：${adminCall.text.slice(0, 220)}`)
console.log(`  普通用户 + 同一请求       → HTTP ${userCall.status}：${userCall.text.slice(0, 120)}`)
console.log(`  管理员 + 不存在的 dsh-im 路径 → HTTP ${ghost.status}（差分对照，应为 404/403 而非 200）`)

if (adminCall.status === 403) {
  console.error('  FAIL：管理员仍被 403 —— Issue #3 未修复（形状检查先于 admin 放行）')
  process.exit(1)
}
if (adminCall.status === 404 || !looksLikeImPayload(adminCall.text)) {
  console.error('  INCONCLUSIVE：响应不像来自 dsh-im 的处理器（该实例可能未安装 @xmanrui/dsh-im）⇒ 本次不判定')
  process.exit(1)
}
if (userCall.status !== 403) {
  console.error(`  FAIL：普通用户未被拒绝（HTTP ${userCall.status}）——默认拒绝被放宽了`)
  process.exit(1)
}
if (ghost.status === 200) {
  console.error('  FAIL：不存在的 dsh-im 路径返回 200 —— 放行范围过宽')
  process.exit(1)
}
console.log('  PASS：管理员的管理 RPC 已到达 dsh-im 处理器（非 403），普通用户仍被拒，且不存在路径未被放行 ✓')
process.exit(0)
