/**
 * live-legacy-check.mjs — 开发基线（DSH 0.1.1-rc.2）回归验收。
 *
 * 用法：
 *   DSH_LEGACY_URL=http://127.0.0.1:3080 \
 *   DSH_LEGACY_USER=test1 DSH_LEGACY_PASSWORD=12345678 \
 *   node test/live-legacy-check.mjs
 *
 * 覆盖：登录门 / dotted RPC 授权（管理员面 403）/ 会话导出属主检查 /
 * 用户管理 RPC / 登出吊销 —— 即 0.1.1-rc.2 上必须保持不变的旧路径行为。
 */
const base = process.env.DSH_LEGACY_URL ?? 'http://127.0.0.1:3080'
const username = process.env.DSH_LEGACY_USER ?? 'test1'
const password = process.env.DSH_LEGACY_PASSWORD ?? '12345678'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const raw = (path, options = {}) => fetch(base + path, { redirect: 'manual', ...options })
const cookieOf = response => (response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? '').split(';')[0]

async function dotted(cookie, method, payload = {}) {
  const response = await raw(`/api/${method}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `probe-${method}-${Date.now()}`, method, payload }),
  })
  const text = await response.text()
  let envelope
  try { envelope = JSON.parse(text) } catch { envelope = undefined }
  return { status: response.status, envelope, text }
}

// ---- gate ----
const root = await raw('/')
check('GET / → 302 登录门', root.status === 302 && (root.headers.get('location') ?? '').includes('/auth/login'),
  `${root.status} ${root.headers.get('location')}`)
check('GET /auth/login → 200', (await raw('/auth/login')).status === 200)
check('未认证 dotted /api/session.list → 401', (await dotted('dsh_auth=none', 'session.list')).status === 401)

// ---- login ----
const login = await raw('/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
})
const cookie = cookieOf(login)
check(`${username} 登录 → 200 + cookie`, login.status === 200 && cookie.startsWith('dsh_auth='), `${login.status}`)
if (!cookie.startsWith('dsh_auth=')) { console.log('\n无法登录取证，终止'); process.exit(1) }

const me = await raw('/auth/me', { headers: { cookie } })
const meBody = await me.json().catch(() => ({}))
check('GET /auth/me → 200 且含用户名', me.status === 200 && meBody?.me?.username === username, `${me.status} ${JSON.stringify(meBody?.me?.username)}`)

// ---- legacy dotted Remote still works and stays authorized ----
const list = await dotted(cookie, 'session.list', { request: {} })
check('dotted /api/session.list → 200 envelope（旧传输仍可用）',
  list.status === 200 && list.envelope?.result?.ok === true, `${list.status} ${list.text.slice(0, 70)}`)
const items = list.envelope?.result?.value?.items ?? []
check('普通用户 session.list 返回数组且已过滤', Array.isArray(items), `items=${items.length}`)

for (const [method, payload] of [
  ['settings.mutate', { ns: 'llm-pi-ai', ops: [] }],
  ['settings.mutate', { ns: 'settings.models', ops: [] }],
  ['credentials.set', { ref: 'OPENAI_API_KEY', value: 'x' }],
  ['llm.discoverModels', { settingsNs: 'llm-pi-ai', request: {} }],
]) {
  const response = await dotted(cookie, method, payload)
  check(`普通用户 dotted ${method}(${payload.ns ?? payload.settingsNs}) → 403`, response.status === 403, String(response.status))
}

const exported = await raw('/api/session.export?sessionId=does-not-exist-probe', { headers: { cookie } })
check('普通用户导出他人/不存在会话 → 403/404（属主检查生效）', [403, 404].includes(exported.status), String(exported.status))

// ---- 设置页加载依赖的端点不得被插件层拒绝（0.6.5 同类缺陷的 legacy 侧防护）----
// 这两页在 legacy 线上分别是 agentPreset.* 与 pluginInventory.*；本插件在 legacy 路径只拦
// 管理员面，所以它们要么被宿主正常处理（200/400/404），要么在宿主未挂载时 404——
// 唯一不允许的是**插件层 403**（那会让整页加载失败，正是 modern 线修过的那种缺陷）。
const presetList = await dotted(cookie, 'agentPreset.list', {})
check('普通用户 agentPreset.list 未被插件层拒绝（预设页可加载）',
  presetList.status !== 403 && presetList.envelope?.result?.ok === true,
  `${presetList.status} ok=${presetList.envelope?.result?.ok}`)
const inventory = await dotted(cookie, 'pluginInventory.list', {})
check('普通用户 pluginInventory.list 未被插件层拒绝（插件页可加载）',
  inventory.status !== 403, `${inventory.status}`)

const logout = await raw('/auth/logout', { method: 'POST', headers: { cookie } })
check('登出 → 200', logout.status === 200, String(logout.status))
check('登出后 dotted /api/session.list → 401', (await dotted(cookie, 'session.list', { request: {} })).status === 401)

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail === 0 ? 0 : 1)
