// 现象盘查探针（不入库）：让管理员创建 workspace+session，同时观察①普通用户 ②管理员 两条 mux 连接收到的帧。
// 目的：拿到 api-session/* 事件的真实 JSON 形状（决定过滤器该怎么写），并复现/证伪跨用户泄漏。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

const base = process.env.PROBE_URL ?? 'http://127.0.0.1:3202'
const wsBase = base.replace(/^http/, 'ws')

const carrierOf = async (sessionCookie) => {
  // 鉴权后的任意 /api 调用都会镜像下发宿主载体 Cookie；mux 升级必须带上它（否则宿主 401）
  const r = await fetch(`${base}/api/session/list`, {
    method: 'POST', headers: { cookie: sessionCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/list', payload: { args: {} } }),
  })
  const names = sessionCookie.split('; ').map(v => v.split('=')[0])
  return (r.headers.getSetCookie?.() ?? []).map(v => v.split(';')[0]).filter(v => v !== '' && !names.includes(v.split('=')[0])).join('; ')
}
const login = async (u, p) => {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }), redirect: 'manual' })
  const session = (r.headers.getSetCookie?.() ?? []).map(v => v.split(';')[0]).join('; ')
  if (session === '') return ''
  const carrier = await carrierOf(session)
  console.log(`    [cookie] 会话=${session.split('=')[0]} 载体=${carrier === '' ? '(无)' : carrier.split('=')[0]}`)
  return carrier === '' ? session : session + '; ' + carrier
}
const rpc = async (cookie, method, body) => {
  const r = await fetch(`${base}/auth/rpc/${method}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return r.status
}
const remote = async (cookie, endpoint, args) => {
  const r = await fetch(`${base}/api/${endpoint}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload: { args: args ?? {} } }),
  })
  const text = await r.text()
  return { status: r.status, text }
}
const bootstrap = path.join(os.tmpdir(), 'dsh020', 'work', 'dsh-ui-auth-bootstrap.txt')
const adminPw = (/密码[:：]\s*(\S+)/.exec(fs.readFileSync(bootstrap, 'utf8')) ?? [])[1] ?? ''
const admin = await login('admin', adminPw)
console.log('  admin 登录:', admin !== '' ? 'OK' : 'FAIL')

const uname = 'frameprobe' + Date.now().toString(36)
await rpc(admin, 'createUser', { username: uname, password: 'Frame-Probe-1234!', role: 'user' })
const user = await login(uname, 'Frame-Probe-1234!')
console.log('  普通用户登录:', user !== '' ? 'OK' : 'FAIL')

const collect = (label) => {
  const frames = []
  const ws = new WebSocket(`${wsBase}/api/remote.mux`, { headers: { cookie: label === 'admin' ? admin : user } })
  ws.on('open', () => {
    // mux 是**多路复用流**：不订阅 $events 就什么都收不到（这正是此前判定空洞的原因）
    ws.send(JSON.stringify({ type: 'open', streamId: 'probe-events', endpoint: '$events', payload: { args: {} } }))
  })
  ws.on('message', (data, isBinary) => { if (!isBinary) frames.push(String(data)) })
  ws.on('error', (e) => console.log(`  [${label}] ws error:`, String(e.message).slice(0, 60)))
  ws.on('close', (code) => console.log(`  [${label}] ws closed:`, code))
  return { ws, frames }
}
const adminSide = collect('admin')
const userSide = collect('user')
await new Promise(r => setTimeout(r, 2500))
console.log('  两条 mux 连接已建立; admin帧=', adminSide.frames.length, ' user帧=', userSide.frames.length)

// 管理员创建 workspace + session（普通用户无此权限，故由管理员制造"可泄漏的事件"）
const dir = path.join(os.tmpdir(), 'muxprobe-' + Date.now().toString(36))
fs.mkdirSync(dir, { recursive: true })
const madeWs = await remote(admin, 'workspace/create', { request: { path: dir } })
const workspaceId = (madeWs.text.match(/"workspaceId":"([^"]+)"/) ?? [])[1] ?? ''
console.log('  workspace/create:', madeWs.status, workspaceId.slice(0, 12))
const madeSession = await remote(admin, 'session/create', { request: { workspaceId } })
const sessionId = (madeSession.text.match(/session-[0-9a-f][0-9a-f-]{6,}/) ?? [''])[0]
console.log('  session/create:', madeSession.status, sessionId.slice(0, 20))
await new Promise(r => setTimeout(r, 4000))

const show = (label, frames) => {
  console.log(`  --- ${label} 收到 ${frames.length} 帧`)
  for (const frame of frames.slice(0, 4)) console.log(`      ${frame.slice(0, 220).replace(/\s+/g, ' ')}`)
}
show('admin', adminSide.frames)
show('user', userSide.frames)

const userSawSession = sessionId !== '' && userSide.frames.some(f => f.includes(sessionId))
console.log('  === 普通用户是否收到该会话的帧（泄漏判定）:', userSawSession, '===')
console.log('  === 帧里是否出现 sessionId 字段名:', [...new Set([...adminSide.frames, ...userSide.frames].flatMap(f => [...f.matchAll(/"(sessionId|id|session)"/g)].map(m => m[1])))].join(', ') || '(无)', '===')

adminSide.ws.close(); userSide.ws.close()
await rpc(admin, 'deleteUser', { username: uname })
try { fs.rmSync(dir, { recursive: true, force: true }) } catch (error) { /* ignore */ }
process.exit(0)