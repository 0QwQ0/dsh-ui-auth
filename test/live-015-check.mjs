/**
 * live-015-check.mjs — 隔离 DSH 0.1.5-rc.1 实例上的适配验收。
 *
 * 用法：
 *   DSH015_URL=http://127.0.0.1:3201 \
 *   DSH015_BOOTSTRAP=<临时工作目录>/dsh-ui-auth-bootstrap.txt \
 *   node test/live-015-check.mjs
 *
 * 覆盖：登录门 / 原生 carrier 桥接（登录后 DSH UI 可用）/ slash Remote 授权 /
 * 普通用户隔离 / 管理员面 deny-by-default。
 */
const base = process.env.DSH015_URL ?? 'http://127.0.0.1:3201'
const bootstrapPath = process.env.DSH015_BOOTSTRAP

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

async function raw(path, options = {}) {
  return fetch(base + path, { redirect: 'manual', ...options })
}

function cookieOf(response) {
  const cookies = response.headers.getSetCookie?.() ?? []
  return (cookies[0] ?? response.headers.get('set-cookie') ?? '').split(';')[0]
}

async function login(username, password, totp) {
  const response = await raw('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(totp === undefined ? { username, password } : { username, password, totp }),
  })
  const body = await response.text()
  return { status: response.status, body, cookie: cookieOf(response) }
}

/** One Remote call through the plugin gateway: POST /api/<ns>/<method>. */
async function remote(cookie, endpoint, args = {}) {
  const response = await raw(`/api/${endpoint}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `probe-${endpoint}-${Date.now()}`, method: endpoint, payload: { args } }),
  })
  const text = await response.text()
  let envelope
  try { envelope = JSON.parse(text) } catch { envelope = undefined }
  return { status: response.status, envelope, text }
}

const { readFileSync } = await import('node:fs')
const bootstrap = bootstrapPath && readFileSync(bootstrapPath, 'utf8')
const adminPassword = bootstrap ? (/密码:\s*(\S+)/.exec(bootstrap) ?? /password:\s*(\S+)/i.exec(bootstrap))?.[1] : undefined

// ---- 1. unauthenticated gate ----
const root302 = await raw('/')
check('GET / → 302 登录门', root302.status === 302 && (root302.headers.get('location') ?? '').startsWith('/auth/login'),
  `${root302.status} ${root302.headers.get('location')}`)
const loginPage = await raw('/auth/login')
check('GET /auth/login → 200 登录页', loginPage.status === 200)
const apiNoCookie = await remote('dsh_auth=none', 'session/list', { _request: {} })
check('未认证 /api/session/list → 401', apiNoCookie.status === 401, String(apiNoCookie.status))

// ---- 2. admin login + native carrier bridging ----
check('读取一次性 bootstrap 口令', typeof adminPassword === 'string' && adminPassword.length >= 12)
const admin = await login('admin', adminPassword)
check('admin 登录 → 200 + dsh_auth cookie', admin.status === 200 && admin.cookie.startsWith('dsh_auth='), `${admin.status} ${admin.cookie.split('=')[0]}`)

const indexWithCookie = await raw('/', { headers: { cookie: admin.cookie } })
const indexText = await indexWithCookie.text()
check('登录后 GET / → 200 原生 UI（carrier 桥接成功）', indexWithCookie.status === 200 && indexText.includes('<div id="root">'),
  `${indexWithCookie.status} bytes=${indexText.length}`)

const adminList = await remote(admin.cookie, 'session/list', { _request: {} })
check('admin /api/session/list → 200 envelope（slash Remote 可用）',
  adminList.status === 200 && adminList.envelope?.result?.ok === true, `${adminList.status} ${adminList.text.slice(0, 80)}`)

const adminSettings = await remote(admin.cookie, 'settings/describe', {})
check('admin settings/describe → 200', adminSettings.status === 200 && adminSettings.envelope?.result?.ok === true, `${adminSettings.status}`)

// ---- 3. ordinary user: isolation + deny-by-default ----
const username = `probe${Date.now().toString().slice(-6)}`
const created = await raw('/auth/rpc/createUser', {
  method: 'POST',
  headers: { cookie: admin.cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ username, password: 'Probe-Pass-42!', role: 'user' }),
})
check('管理员创建普通用户', created.status === 200, `${created.status} ${(await created.text()).slice(0, 80)}`)
const user = await login(username, 'Probe-Pass-42!')
check('普通用户可登录', user.status === 200 && user.cookie.startsWith('dsh_auth='), `${user.status}`)

// admin provisions a workspace and a session inside it; the ordinary user must not see either.
const workspacePath = (process.env.DSH015_WORKSPACE ?? process.cwd()).replaceAll('\\', '/')
const madeWorkspace = await remote(admin.cookie, 'workspace/create', { request: { path: workspacePath } })
const workspaceId = madeWorkspace.envelope?.result?.value?.workspace?.workspaceId
check('admin workspace/create → 200', madeWorkspace.status === 200 && typeof workspaceId === 'string', `${madeWorkspace.status} ws=${workspaceId}`)

const madeSession = await remote(admin.cookie, 'session/create', { request: { workspaceId } })
const sessionId = madeSession.envelope?.result?.value?.sessionId
check('admin session/create → 200（归属已落盘）', madeSession.status === 200 && typeof sessionId === 'string', `${madeSession.status} session=${sessionId}`)

const adminAfter = await remote(admin.cookie, 'session/list', { _request: {} })
const adminItems = adminAfter.envelope?.result?.value?.items ?? []
check('admin session/list 可见自己的会话', adminItems.some(item => item.sessionId === sessionId), `items=${adminItems.length}`)

const userList = await remote(user.cookie, 'session/list', { _request: {} })
const userItems = userList.envelope?.result?.value?.items ?? []
check('普通用户 session/list → 200 且已按属主过滤（看不到 admin 会话）',
  userList.status === 200 && !userItems.some(item => item.sessionId === sessionId), `items=${userItems.length}`)

const userReadAdminSession = await remote(user.cookie, 'session/page', {
  request: { address: { kind: 'session', sessionId }, throughSeq: 0 },
})
check('普通用户读取他人会话 session/page → 403', userReadAdminSession.status === 403, String(userReadAdminSession.status))

const userInAdminWorkspace = await remote(user.cookie, 'session/create', { request: { workspaceId } })
check('普通用户在他人 workspace 建会话 → 403', userInAdminWorkspace.status === 403, String(userInAdminWorkspace.status))

const userCwdOverride = await remote(user.cookie, 'session/create', { request: { workspaceId, cwd: '/etc' } })
check('普通用户 cwd 覆盖 → 403', userCwdOverride.status === 403, String(userCwdOverride.status))

for (const [endpoint, args] of [
  ['settings/update', { ns: 'llm', patch: {} }],
  ['credentials/describe', { refs: ['OPENAI_API_KEY'] }],
  ['workspace/create', { request: { path: '/tmp/anything' } }],
  ['commands/execute', { agentId: 'x', line: '/help', submittedAttachments: [] }],
  ['dynamicCordisRunner/inventory', {}],
  ['directoryPicker/list', {}],
  ['session/openWorkspacePath', { request: { path: '/etc/passwd' } }],
  ['subagents/list', { parentSessionId: 'x' }],
]) {
  const response = await remote(user.cookie, endpoint, args)
  check(`普通用户 ${endpoint} → 403（deny-by-default）`, response.status === 403, String(response.status))
}

// 0.6.5：只读清单类端点放行（设置页加载依赖），写操作仍然拒绝。
const pluginInventory = await remote(user.cookie, 'pluginInventory/list', {})
check('普通用户 pluginInventory/list → 200（只读插件清单）',
  pluginInventory.status === 200 && pluginInventory.envelope?.result?.ok === true, String(pluginInventory.status))
const pluginInstall = await remote(user.cookie, 'pluginInventory/install', { name: 'probe' })
check('普通用户 pluginInventory/install → 403（安装/卸载不在白名单）', pluginInstall.status === 403, String(pluginInstall.status))

const unknown = await remote(user.cookie, 'future/endpoint', {})
check('普通用户未审查端点 → 403', unknown.status === 403, String(unknown.status))

// ---- 4. logout revokes ----
const logout = await raw('/auth/logout', { method: 'POST', headers: { cookie: user.cookie } })
const afterLogout = await remote(user.cookie, 'session/list', { _request: {} })
check('登出后会话失效 → 401', afterLogout.status === 401, `logout=${logout.status} after=${afterLogout.status}`)

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail === 0 ? 0 : 1)
