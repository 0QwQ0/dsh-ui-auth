/**
 * live-015-mux.mjs — `/api/remote.mux` 流与逐帧隔离验收（隔离 0.1.5 实例）。
 *
 * 用法：DSH015_URL=http://127.0.0.1:3201 DSH015_BOOTSTRAP=<work>/dsh-ui-auth-bootstrap.txt \
 *       node test/live-015-mux.mjs
 */
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'

const base = process.env.DSH015_URL ?? 'http://127.0.0.1:3201'
const bootstrap = readFileSync(process.env.DSH015_BOOTSTRAP, 'utf8')
const adminPassword = (/密码:\s*(\S+)/.exec(bootstrap) ?? /password:\s*(\S+)/i.exec(bootstrap))[1]
const wsUrl = base.replace(/^http/, 'ws') + '/api/remote.mux'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

async function login(username, password) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return (response.headers.getSetCookie?.()[0] ?? '').split(';')[0]
}

function openStream(cookie, { expectUpgrade = true } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers: { cookie, host: new URL(base).host } })
    const frames = []
    let settled = false
    const settle = value => { if (!settled) { settled = true; resolve(value) } }
    ws.on('message', data => frames.push(JSON.parse(data.toString())))
    ws.on('unexpected-response', (_req, res) => { res.resume(); settle({ ws: undefined, status: res.statusCode, frames }) })
    ws.on('error', error => {
      if (expectUpgrade) { if (!settled) { settled = true; reject(error) } }
      else settle({ ws: undefined, error: error.message, frames })
    })
    ws.on('close', () => settle({ ws: undefined, status: 'closed', frames }))
    ws.on('open', () => settle({ ws, status: 101, frames }))
  })
}

const waitFor = async (frames, predicate, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hit = frames.find(predicate)
    if (hit !== undefined) return hit
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return undefined
}

const adminCookie = await login('admin', adminPassword)
check('admin 登录（mux 前置）', adminCookie.startsWith('dsh_auth='))

// ---- 1. unauthenticated upgrade is refused before the mux is reached ----
// The plugin destroys the socket for an unauthenticated upgrade (fail-closed): the
// client observes a hang-up rather than an HTTP status, which is the expected shape.
const anon = await openStream('dsh_auth=none', { expectUpgrade: false })
check('未认证 mux 升级被拒绝（未建立 101）', anon.status !== 101, String(anon.status ?? anon.error))

// ---- 2. admin $events stream: ready frame ----
const adminEvents = await openStream(adminCookie)
check('admin 打开 $events → 101', adminEvents.status === 101)
adminEvents.ws.send(JSON.stringify({ type: 'open', streamId: 'a1', endpoint: '$events', payload: { args: {} } }))
const ready = await waitFor(adminEvents.frames, f => f.type === 'item' && f.streamId === 'a1' && f.value?.type === 'ready')
check('admin $events 首帧 ready {clientId}', ready !== undefined && typeof ready.value.clientId === 'string', JSON.stringify(ready?.value)?.slice(0, 80))
const adminClientId = ready?.value?.clientId

// ---- 3. admin session/control stream: baseline frame ----
adminEvents.ws.send(JSON.stringify({ type: 'open', streamId: 'a2', endpoint: 'session/control', payload: { args: {} } }))
const baseline = await waitFor(adminEvents.frames, f => f.type === 'item' && f.streamId === 'a2' && f.value?.type === 'baseline')
check('admin session/control 首帧 baseline', baseline !== undefined && typeof baseline.value.value === 'object', baseline === undefined ? 'no baseline' : 'ok')

// ---- 4. ordinary user streams ----
const username = `muxprobe${Date.now().toString().slice(-5)}`
await fetch(`${base}/auth/rpc/createUser`, {
  method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' },
  body: JSON.stringify({ username, password: 'Probe-Pass-42!', role: 'user' }),
})
const userCookie = await login(username, 'Probe-Pass-42!')
check('普通用户登录（mux 前置）', userCookie.startsWith('dsh_auth='))

const userEvents = await openStream(userCookie)
userEvents.ws.send(JSON.stringify({ type: 'open', streamId: 'u1', endpoint: '$events', payload: { args: {} } }))
const userReady = await waitFor(userEvents.frames, f => f.type === 'item' && f.streamId === 'u1' && f.value?.type === 'ready')
check('普通用户 $events 首帧 ready', userReady !== undefined && typeof userReady.value.clientId === 'string')

userEvents.ws.send(JSON.stringify({ type: 'open', streamId: 'u2', endpoint: 'workspace/follow', payload: { args: {} } }))
const userWorkspaceBaseline = await waitFor(userEvents.frames, f => f.type === 'item' && f.streamId === 'u2' && f.value?.type === 'baseline')
check('普通用户 workspace/follow baseline 已按属主裁剪',
  userWorkspaceBaseline !== undefined && (userWorkspaceBaseline.value.value?.items ?? []).length === 0,
  JSON.stringify(userWorkspaceBaseline?.value?.value)?.slice(0, 120))

// ---- 5. per-frame isolation: admin creates a session; the ordinary user must not see the emit ----
const workspacePath = (process.env.DSH015_WORKSPACE ?? process.cwd()).replaceAll('\\', '/')
const created = await fetch(`${base}/api/workspace/create`, {
  method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: 'mux-ws', method: 'workspace/create', payload: { args: { request: { path: workspacePath } } } }),
}).then(r => r.json())
const workspaceId = created?.result?.value?.workspace?.workspaceId
const madeSession = await fetch(`${base}/api/session/create`, {
  method: 'POST', headers: { cookie: adminCookie, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: 'mux-ss', method: 'session/create', payload: { args: { request: { workspaceId } } } }),
}).then(r => r.json())
const sessionId = madeSession?.result?.value?.sessionId
check('admin 建 workspace + session（用于帧隔离观察）', typeof sessionId === 'string', `session=${sessionId}`)

const adminSawAdded = await waitFor(adminEvents.frames, f => f.value?.type === 'emit' && f.value.event === 'api-session/added' && f.value.args?.[0]?.sessionId === sessionId)
check('admin $events 收到 api-session/added（自有会话）', adminSawAdded !== undefined)
await new Promise(resolve => setTimeout(resolve, 800))
const userSawAdded = userEvents.frames.find(f => f.value?.type === 'emit' && f.value.event === 'api-session/added' && f.value.args?.[0]?.sessionId === sessionId)
check('普通用户 $events 未收到他人会话的 added 帧（逐帧隔离）', userSawAdded === undefined)

// ---- 6. hidden waterfall is not delivered but never strands the owner ----
const userWaterfall = userEvents.frames.find(f => f.value?.type === 'waterfall')
check('普通用户 $events 未收到任何 waterfall（未审查 owner 的等待）', userWaterfall === undefined, userWaterfall === undefined ? 'none' : JSON.stringify(userWaterfall.value).slice(0, 80))

for (const stream of [adminEvents, userEvents]) stream.ws?.close()
console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
console.log(`admin clientId=${adminClientId}`)
process.exit(fail === 0 ? 0 : 1)
