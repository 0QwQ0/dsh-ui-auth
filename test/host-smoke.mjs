// Host integration smoke test: import lib/index.js (the deployed ESM artifact),
// apply() it against mock cordis services + a fake EventEmitter http server,
// then drive the real gate: bootstrap admin, redirects, 401s, login, RPC,
// and passthrough to the original request listener.
import { EventEmitter } from 'node:events'
import { name, inject, apply, totpCodeAt } from '../lib/index.js'

// 会话 Cookie 名由插件按 DSH_HOME 派生（同一实例内稳定、实例间不同）；测试用同一公式。
const COOKIE_NAME = 'dsh_auth_' + (() => {
  const seed = process.env.DSH_HOME ?? process.cwd()
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return hash.toString(36)
})()

let failures = 0
function check(label, cond, extra) {
  if (cond) { console.log('PASS ' + label) } else { failures++; console.error('FAIL ' + label + (extra !== undefined ? ' :: ' + extra : '')) }
}

// ---- fake http server (EventEmitter has listeners/removeAllListeners/on/removeListener) ----
const server = new EventEmitter()
let originalCalls = 0
server.on('request', () => { originalCalls++ }) // the "internal dispatch" listener the gate wraps

// ---- mock credentials store (mirrors the real API) ----
const records = new Map()
const creds = {
  async listRecords() { return [...records.keys()].map((key) => ({ key, kind: records.get(key).kind })) },
  async readRecord(key) { return records.get(key) },
  async modifyRecord(key, mutate) {
    const current = records.get(key)
    const next = await mutate(current)
    if (next === undefined) return current
    records.set(key, next)
    return next
  },
  async deleteRecord(key) { records.delete(key) },
}

// ---- mock fs (multi-file map; bootstrap file captured for the admin password) ----
const fsFiles = new Map()
const fsMock = {
  async resolve(p) { return { path: p } },
  async writeText(target, content) { fsFiles.set(target.path, content) },
  async readText(target) { const v = fsFiles.get(target.path); if (v === undefined) throw Object.assign(new Error('not found'), { code: 'FS_NOT_FOUND' }); return v },
  async unlink(target) { fsFiles.delete(target.path) },
}

// ---- minimal modern-host connection stub (v0.7.0: the plugin refuses hosts without it) ----
// Mirrors the 0.2.0 contract the gateway depends on:
//   authorizeIndex(req,res) -> writes the native carrier cookie and returns true when the
//                              caller may serve index.html (the gateway captures that cookie)
//   authenticatedUrl(base)  -> the clean application URL
//   requestRejection(req)   -> undefined admits, a number rejects
//   createSharedFetchHandler(prefix) -> shared-channel Fetch handler for Remote dispatch
const sharedDispatch = async (request) => new Response(JSON.stringify({ error: 'not dispatched in smoke' }), {
  status: 404, headers: { 'content-type': 'application/json' },
})
const modernConnection = {
  authorizeIndex(_req, res) {
    res.writeHead(200, { 'set-cookie': 'dsh-auth-smoke=1; Path=/; HttpOnly' })
    return true
  },
  authenticatedUrl(baseUrl) { return baseUrl },
  requestRejection() { return undefined },
  createSharedFetchHandler() { return { fetch: sharedDispatch } },
}

// ---- mock ctx ----
const disposers = []
const ctx = {
  get(name2) {
    if (name2 === 'credentials') return creds
    if (name2 === 'fs') return fsMock
    if (name2 === 'webServer') return { server }
    if (name2 === 'connection') return modernConnection
    return undefined
  },
  effect(cb) { disposers.push(cb) },
  interval() { return () => {} },
}

console.log('exports: name=' + name + ' inject=' + JSON.stringify(inject))
check('exports.name', name === 'dsh-ui-auth')
check('exports.inject', Array.isArray(inject) && inject.includes('webServer'))

// ---- helpers ----
function makeReq(method, url, cookie, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = {}
  // 真实宿主总会带上 Host；现代网关的 prepare() 依赖它铸造原生载体 Cookie
  req.headers.host = 'localhost:3080'
  if (cookie !== undefined) req.headers.cookie = COOKIE_NAME + '=' + cookie
  req.socket = { remoteAddress: '127.0.0.1' }
  req._destroyed = false
  req.destroy = () => { req._destroyed = true }
  // 模拟 IncomingMessage：既有 'data'/'end' 事件（网关读体用），也可 for-await 迭代（/api 桥用）
  const bodyChunks = body !== undefined ? [Buffer.from(body)] : []
  req[Symbol.asyncIterator] = () => {
    let i = 0
    return {
      next() {
        if (i < bodyChunks.length) return Promise.resolve({ value: bodyChunks[i++], done: false })
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  }
  if (body !== undefined) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(body))
      req.emit('end')
    })
  }
  return req
}
function makeRes() {
  const res = { headersSent: false, status: 0, headers: {}, body: '', destroyed: false }
  res.writeHead = (s, h) => { res.status = s; Object.assign(res.headers, h || {}); res.headersSent = true }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.write = (b) => { res.body += (b === undefined ? '' : String(b)); return true }
  res.end = (b) => { if (b !== undefined) res.body += String(b); res.ended = true }
  res.destroy = () => { res.destroyed = true }
  return res
}
function parseJson(res) { try { return JSON.parse(res.body) } catch (e) { return null } }
function cookieOf(res) {
  const sc = res.headers['set-cookie']
  if (!sc) return undefined
  const m = new RegExp(COOKIE_NAME + '=([^;]+)').exec(sc)
  return m ? m[1] : undefined
}
const settle = () => new Promise((r) => setImmediate(r))
async function post(url, cookie, body) {
  const res = makeRes()
  server.emit('request', makeReq('POST', url, cookie, body), res)
  await settle()
  return res
}
async function get(url, cookie) {
  const res = makeRes()
  server.emit('request', makeReq('GET', url, cookie), res)
  return res
}

// ---- apply the deployed plugin ----
apply(ctx)

// ---- wait for async init + bootstrap ----
await new Promise((r) => setTimeout(r, 300))
const bootstrapFile = fsFiles.get('dsh-ui-auth-bootstrap.txt')
check('bootstrap file written', bootstrapFile !== undefined)
const pwMatch = bootstrapFile ? /密码:\s+(\S+)/.exec(bootstrapFile) : null
const adminPassword = pwMatch ? pwMatch[1] : null
check('admin password captured', adminPassword !== null, 'bootstrap=' + bootstrapFile)
console.log('  bootstrap admin password: ' + adminPassword)

// ---- 1) GET / without cookie -> 302 to /auth/login ----
{
  const res = await get('/')
  check('GET / -> 302', res.status === 302, 'status=' + res.status)
  check('GET / -> /auth/login', res.headers.location === '/auth/login', res.headers.location)
}
// ---- 2) SPA deep route -> 302 with next ----
{
  const res = await get('/some/route')
  check('GET /some/route -> 302 next', res.headers.location === '/auth/login?next=%2Fsome%2Froute', res.headers.location)
}
// ---- 3) GET /auth/login -> 200 page ----
{
  const res = await get('/auth/login')
  check('login page 200', res.status === 200 && res.body.includes('请登录后继续访问'))
}
// ---- 4) API without cookie -> 401 ----
{
  const res = await post('/api/session.list', undefined, '{}')
  check('API 401', res.status === 401, 'status=' + res.status)
}
// ---- 5) wrong password -> 401 ----
{
  const res = await post('/auth/login', undefined, JSON.stringify({ username: 'admin', password: 'nope-nope' }))
  check('wrong pw 401', res.status === 401, 'status=' + res.status + ' body=' + res.body)
}
// ---- 6) correct password -> 200 + cookie ----
let adminCookie
{
  const res = await post('/auth/login', undefined, JSON.stringify({ username: 'admin', password: adminPassword }))
  adminCookie = cookieOf(res)
  check('login 200', res.status === 200 && parseJson(res).ok === true, 'status=' + res.status + ' body=' + res.body)
  check('cookie issued', adminCookie !== undefined, 'set-cookie=' + res.headers['set-cookie'])
}
// ---- 7) GET / with cookie -> original listener called ----
{
  const before = originalCalls
  const res = await get('/', adminCookie)
  check('authorized GET / reaches original listener', originalCalls === before + 1)
}
// ---- 8) RPC me ----
{
  const res = await post('/auth/rpc/me', adminCookie, '{}')
  const j = parseJson(res)
  check('rpc me', j.ok === true && j.me.username === 'admin' && j.me.role === 'admin', JSON.stringify(j))
}
// ---- 9) RPC createUser + listUsers + setRole + resetPassword + deleteUser ----
{
  const res = await post('/auth/rpc/createUser', adminCookie, JSON.stringify({ username: 'bob', password: 'bob-pw-1234', role: 'user' }))
  check('createUser bob', parseJson(res).ok === true, res.body)
}
{
  const res = await post('/auth/rpc/createUser', adminCookie, JSON.stringify({ username: 'bob', password: 'bob-pw-1234' }))
  check('createUser duplicate 409', res.status === 409, res.body)
}
{
  const res = await post('/auth/rpc/listUsers', adminCookie, '{}')
  const j = parseJson(res)
  check('listUsers has admin+bob', j.ok === true && j.users.length === 2, JSON.stringify(j && j.users))
}
{
  const res = await post('/auth/rpc/resetPassword', adminCookie, JSON.stringify({ username: 'bob', newPassword: 'bob-new-9999' }))
  check('resetPassword bob', parseJson(res).ok === true, res.body)
}
// bob logs in with the new password
let bobCookie
{
  const res = await post('/auth/login', undefined, JSON.stringify({ username: 'bob', password: 'bob-new-9999' }))
  bobCookie = cookieOf(res)
  check('bob login with reset pw', res.status === 200, res.body)
}
{
  const res = await post('/auth/rpc/listUsers', bobCookie, '{}')
  check('bob (user) listUsers 403', res.status === 403, res.body)
}
{
  const res = await post('/auth/rpc/deleteUser', adminCookie, JSON.stringify({ username: 'bob' }))
  check('deleteUser bob', parseJson(res).ok === true, res.body)
}
// bob's session is now invalid
{
  const res = await post('/auth/rpc/me', bobCookie, '{}')
  check('bob session invalid after delete', res.status === 401, res.body)
}
// ---- 10) logout ----
{
  const res = await post('/auth/logout', adminCookie)
  check('logout ok', parseJson(res).ok === true)
  const res2 = await get('/', adminCookie)
  check('GET / after logout -> 302', res2.status === 302)
}
// ---- 11) persistence: user store written to mock records ----
check('admin record persisted in store', records.has('dsh-auth/admin'))

// ---- 12) disposer restores the original listener ----
if (disposers.length > 0) {
  const before = originalCalls
  await get('/no-auth-check')
  // 释放全部 effect：网关与各服务的 disposer 顺序不是契约，全部释放后宿主监听器必须复原
  for (const register of disposers) {
    const dispose = register()
    if (typeof dispose === 'function') dispose()
  }
  const after = originalCalls
  await get('/')
  check('after dispose, original listener handles requests', originalCalls === after + 1, 'calls=' + originalCalls)
}

// ---- 13) boot-race scenario: credentials appears AFTER apply ----
// Pre-seed a known admin (same salt/hash as the real store => password new-admin-pw-9999),
// make ctx.get('credentials') return undefined for the first 600ms, then the store.
// The plugin must wait for credentials, load the pre-seeded admin, and NOT mint a new one.
{
  const server2 = new EventEmitter()
  let originalCalls2 = 0
  server2.on('request', () => { originalCalls2++ })

  const records2 = new Map()
  records2.set('dsh-auth/admin', {
    kind: 'grant',
    payload: JSON.stringify({
      v: 1, username: 'admin', role: 'admin',
      salt: '92a35561b3c19bd6fffa191822616141',
      hash: '598dee939ea92827781dfed37d8eaafdf51bed5ad91fddba6f98d34580c877fc',
      iterations: 60000, displayName: '预设管理员', email: '', createdAt: 1, updatedAt: 1,
    }),
  })
  const creds2 = {
    async listRecords() { return [...records2.keys()].map((key) => ({ key, kind: records2.get(key).kind })) },
    async readRecord(key) { return records2.get(key) },
    async modifyRecord(key, mutate) {
      const current = records2.get(key)
      const next = await mutate(current)
      if (next === undefined) return current
      records2.set(key, next)
      return next
    },
    async deleteRecord(key) { records2.delete(key) },
  }
  let credsAvailable = false
  const ctx2 = {
    get(n) {
      if (n === 'credentials') return credsAvailable ? creds2 : undefined
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: server2 }
      if (n === 'connection') return modernConnection
      return undefined
    },
    effect(cb) { disposers2.push(cb) },
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  const disposers2 = []

  let bootstrapFile2 = null
  const fsMock2 = {
    async resolve(p) { return { path: p } },
    async writeText(t, c) { bootstrapFile2 = c },
  }
  ctx2.get = (n) => {
    if (n === 'credentials') return credsAvailable ? creds2 : undefined
    if (n === 'fs') return fsMock2
    if (n === 'webServer') return { server: server2 }
    if (n === 'connection') return modernConnection
    return undefined
  }

  apply(ctx2)
  // credentials appears 600ms later (mid boot)
  const unlock = setTimeout(() => { credsAvailable = true }, 600)
  await new Promise((r) => setTimeout(r, 1500))
  clearTimeout(unlock)

  check('race: no bootstrap file minted (store had admin)', bootstrapFile2 === null, 'bootstrap=' + bootstrapFile2)
  check('race: admin record not replaced', JSON.parse(records2.get('dsh-auth/admin').payload).displayName === '预设管理员')

  const resLogin = await new Promise((resolve) => {
    const r = makeRes()
    server2.emit('request', makeReq('POST', '/auth/login', undefined, JSON.stringify({ username: 'admin', password: 'new-admin-pw-9999' })), r)
    setTimeout(() => resolve(r), 300)
  })
  check('race: login with pre-seeded admin password', resLogin.status === 200, 'status=' + resLogin.status + ' body=' + resLogin.body)
}

// ---- 14/15) legacy 传输线的管理员守卫与数据面隔离场景已随 v0.7.0 删除 ----
// 现代线的等价覆盖：test/modern-policy.test.mjs（策略矩阵）与 test/live-020-*.mjs（端点实测）。
// ---- 16) 会话持久化（0.4.0：重启不掉线） ----
// 主场景 12 已卸载主网关，本场景用独立 server/ctx（共享 credentials 与 fs 存储）
// 完整模拟"登录 -> 落盘 -> 重启 -> 免登录恢复 -> 过期不恢复"。
{
  const serverR = new EventEmitter()
  serverR.on('request', () => {})
  const ctxR = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverR }
      if (n === 'connection') return modernConnection
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxR)
  await new Promise((r) => setTimeout(r, 400)) // 等 init
  const loginRes = await new Promise((resolve) => {
    const r = makeRes()
    serverR.emit('request', makeReq('POST', '/auth/login', undefined, JSON.stringify({ username: 'admin', password: adminPassword })), r)
    setTimeout(() => resolve(r), 80)
  })
  const cookie16 = cookieOf(loginRes)
  check('sess: 登录成功', cookie16 !== undefined, 'status=' + loginRes.status + ' body=' + loginRes.body)
  await new Promise((r) => setTimeout(r, 100)) // 等 persistSessions 落盘
  const file = fsFiles.get('dsh-ui-auth-sessions.json')
  check('sess: 登录后会话文件已落盘', file !== undefined && file.includes('"sessions"'), 'file=' + (file !== undefined ? file.slice(0, 90) : '(missing)'))
  check('sess: 落盘不含明文 token（哈希化，64 位 hex key）', file !== undefined && !file.includes(cookie16) && /[0-9a-f]{64}/.test(file), 'file=' + (file !== undefined ? file.slice(0, 90) : '(missing)'))
  // 模拟"重启"：新 server + 新 ctx（共享同一 credentials 与 fs 存储），再 apply 一次
  const serverR2 = new EventEmitter()
  serverR2.on('request', () => {})
  const ctxR2 = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverR2 }
      if (n === 'connection') return modernConnection
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxR2)
  await new Promise((r) => setTimeout(r, 400)) // 等 init（含 loadSessions）
  const meRes = await new Promise((resolve) => {
    const r = makeRes()
    serverR2.emit('request', makeReq('POST', '/auth/rpc/me', cookie16, '{}'), r)
    setTimeout(() => resolve(r), 80)
  })
  check('sess: 重启后原 cookie 免登录恢复会话（me 200）', meRes.status === 200, 'status=' + meRes.status + ' body=' + meRes.body)
  // 过期会话不恢复：把磁盘上的 expiresAt 改为过去，再"重启"
  const data = JSON.parse(file)
  for (const token of Object.keys(data.sessions)) data.sessions[token].expiresAt = 1
  fsFiles.set('dsh-ui-auth-sessions.json', JSON.stringify(data))
  const serverR3 = new EventEmitter()
  serverR3.on('request', () => {})
  const ctxR3 = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverR3 }
      if (n === 'connection') return modernConnection
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxR3)
  await new Promise((r) => setTimeout(r, 400))
  const meRes2 = await new Promise((resolve) => {
    const r = makeRes()
    serverR3.emit('request', makeReq('POST', '/auth/rpc/me', cookie16, '{}'), r)
    setTimeout(() => resolve(r), 80)
  })
  check('sess: 过期会话不恢复（me 401）', meRes2.status === 401, 'status=' + meRes2.status)
}

// ---- 17) 管理员操作审计（0.4.0：JSONL） ----
{
  const serverA = new EventEmitter()
  serverA.on('request', () => {})
  const ctxA = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverA }
      if (n === 'connection') return modernConnection
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxA)
  await new Promise((r) => setTimeout(r, 400))
  const loginA = await new Promise((resolve) => {
    const r = makeRes()
    serverA.emit('request', makeReq('POST', '/auth/login', undefined, JSON.stringify({ username: 'admin', password: adminPassword })), r)
    setTimeout(() => resolve(r), 80)
  })
  const cookieA = cookieOf(loginA)
  check('audit: admin 登录成功', cookieA !== undefined)
  const createRes = await new Promise((resolve) => {
    const r = makeRes()
    serverA.emit('request', makeReq('POST', '/auth/rpc/createUser', cookieA, JSON.stringify({ username: 'carol', password: 'carol-pw-1234', role: 'user' })), r)
    setTimeout(() => resolve(r), 80)
  })
  await new Promise((r) => setTimeout(r, 120))
  const auditFile = fsFiles.get('dsh-ui-auth-audit.jsonl')
  check('audit: 成功操作已记录（createUser carol）', auditFile !== undefined && auditFile.includes('createUser') && auditFile.includes('carol'), 'audit=' + (auditFile !== undefined ? auditFile.slice(0, 120) : '(missing)'))
  // 普通用户越权尝试
  const carolLogin = await new Promise((resolve) => {
    const r = makeRes()
    serverA.emit('request', makeReq('POST', '/auth/login', undefined, JSON.stringify({ username: 'carol', password: 'carol-pw-1234' })), r)
    setTimeout(() => resolve(r), 80)
  })
  const carolCookie = cookieOf(carolLogin)
  check('audit: carol 登录成功', carolCookie !== undefined)
  const deniedRes = await new Promise((resolve) => {
    const r = makeRes()
    serverA.emit('request', makeReq('POST', '/auth/rpc/createUser', carolCookie, JSON.stringify({ username: 'dave', password: 'dave-pw-1234' })), r)
    setTimeout(() => resolve(r), 80)
  })
  check('audit: 越权尝试 403', deniedRes.status === 403)
  await new Promise((r) => setTimeout(r, 120))
  const auditFile2 = fsFiles.get('dsh-ui-auth-audit.jsonl')
  check('audit: 越权尝试已记录（denied:true）', auditFile2 !== undefined && auditFile2.includes('"denied":true'), 'audit=' + (auditFile2 !== undefined ? auditFile2.slice(0, 160) : '(missing)'))
  const lines = (auditFile2 !== undefined ? auditFile2.trim().split('\n') : [])
  check('audit: 每一行都是合法 JSON（JSONL）', lines.length >= 2 && lines.every((l) => { try { JSON.parse(l); return true } catch (e) { return false } }))
}

// ---- 18) 注册 + 邀请码（0.5.0） ----
{
  const serverB = new EventEmitter()
  serverB.on('request', () => {})
  const ctxB = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverB }
      if (n === 'connection') return modernConnection
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxB)
  await new Promise((r) => setTimeout(r, 400))
  const call = (method, path, body, cookie) => new Promise((resolve) => {
    const r = makeRes()
    serverB.emit('request', makeReq(method, path, cookie, body === undefined ? undefined : JSON.stringify(body)), r)
    setTimeout(() => resolve(r), 80)
  })
  const loginB = await call('POST', '/auth/login', { username: 'admin', password: adminPassword })
  const adminB = cookieOf(loginB)
  check('reg: admin 登录成功', adminB !== undefined)
  // 1) 生成邀请码（1 个码，可用 2 次）
  const inv = await call('POST', '/auth/rpc/inviteCreate', { amount: 1, uses: 2 }, adminB)
  const code = (parseJson(inv) || {}).codes !== undefined ? parseJson(inv).codes[0] : undefined
  check('reg: 生成邀请码', inv.status === 200 && typeof code === 'string' && /^[A-Z2-9]{8}$/.test(code), 'status=' + inv.status)
  // 2) inviteList 显示剩余数
  const list1 = await call('POST', '/auth/rpc/inviteList', {}, adminB)
  const inv1 = (parseJson(list1) || {}).invites !== undefined ? parseJson(list1).invites.find((i) => i.code === code) : undefined
  check('reg: inviteList 显示 total=2 used=0 remaining=2', inv1 !== undefined && inv1.total === 2 && inv1.used === 0 && inv1.remaining === 2)
  // 3) 注册页可达
  const page = await call('GET', '/auth/register')
  check('reg: 注册页 200', page.status === 200 && page.body.includes('邀请码'))
  // 4) 有效邀请码注册成功（自动登录并跳转 TOTP 引导页）
  const reg1 = await call('POST', '/auth/register', { username: 'reg1', password: 'reg1-pw-1234', confirmPassword: 'reg1-pw-1234', email: 'reg1@example.com', invite: code })
  const reg1AutoCookie = cookieOf(reg1)
  check('reg: 有效邀请码注册成功（自动登录 + 引导页 redirect）', reg1.status === 200 && parseJson(reg1).ok === true && reg1AutoCookie !== undefined && parseJson(reg1).redirect === '/auth/register/success', 'status=' + reg1.status + ' body=' + reg1.body)
  // 4b) 注册成功引导页：带 cookie 可访问，未登录重定向
  const successPage = await call('GET', '/auth/register/success', undefined, reg1AutoCookie)
  check('reg: 引导页可达（含「立即添加 TOTP」）', successPage.status === 200 && successPage.body.includes('立即添加 TOTP') && successPage.body.includes('两步验证'))
  const successNoCookie = await call('GET', '/auth/register/success')
  check('reg: 未登录访问引导页 → 302 登录页', successNoCookie.status === 302 && (successNoCookie.headers.location || '').startsWith('/auth/login'))
  // 5) 同一码第二次注册成功（uses=2）
  const reg2 = await call('POST', '/auth/register', { username: 'reg2', password: 'reg2-pw-1234', confirmPassword: 'reg2-pw-1234', email: '', invite: code })
  check('reg: 同一码第二次注册成功（可注册 2 次）', reg2.status === 200)
  // 6) 第三次被拒（次数耗尽）
  const reg3 = await call('POST', '/auth/register', { username: 'reg3', password: 'reg3-pw-1234', confirmPassword: 'reg3-pw-1234', email: '', invite: code })
  check('reg: 次数耗尽后 403', reg3.status === 403)
  // 7) 无效邀请码 403
  const regBad = await call('POST', '/auth/register', { username: 'reg4', password: 'reg4-pw-1234', confirmPassword: 'reg4-pw-1234', email: '', invite: 'XXXX9999' })
  check('reg: 无效邀请码 403', regBad.status === 403)
  // 8) 弱密码 400
  const regWeak = await call('POST', '/auth/register', { username: 'reg5', password: 'short', confirmPassword: 'short', email: '', invite: code })
  check('reg: 弱密码（长度不足）400', regWeak.status === 400)
  // 8b) 复杂度不足（8 位纯字母，仅一种字符类型）400
  const regComplex = await call('POST', '/auth/register', { username: 'reg6', password: 'abcdefgh', confirmPassword: 'abcdefgh', email: '', invite: code })
  check('reg: 复杂度不足（纯字母）400', regComplex.status === 400 && parseJson(regComplex).error.includes('字符类型'))
  // 9) 用户名已存在 409
  const regDup = await call('POST', '/auth/register', { username: 'reg1', password: 'reg1-pw-1234', confirmPassword: 'reg1-pw-1234', email: '', invite: code })
  check('reg: 用户名已存在 409', regDup.status === 409)
  // 10) 注册的新用户可登录（role=user）
  const regLogin = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234' })
  const regCookie = cookieOf(regLogin)
  const regMe = await call('POST', '/auth/rpc/me', {}, regCookie)
  check('reg: 新用户登录成功且为普通用户', regCookie !== undefined && parseJson(regMe).me !== undefined && parseJson(regMe).me.role === 'user' && parseJson(regMe).me.email === 'reg1@example.com')
  // 11) 普通用户不能管理邀请码
  const deniedInv = await call('POST', '/auth/rpc/inviteCreate', { amount: 1 }, regCookie)
  check('reg: 普通用户 inviteCreate 403', deniedInv.status === 403)
  // 12) 管理员撤销邀请码
  const rev = await call('POST', '/auth/rpc/inviteRevoke', { code: code }, adminB)
  const list2 = await call('POST', '/auth/rpc/inviteList', {}, adminB)
  const afterRevoke = (parseJson(list2) || {}).invites !== undefined ? parseJson(list2).invites.some((i) => i.code === code) : true
  check('reg: 撤销邀请码成功', rev.status === 200 && !afterRevoke)
}

// ---- 19) TOTP 绑定与移除（0.5.0） ----
{
  const serverC = new EventEmitter()
  serverC.on('request', () => {})
  const ctxC = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverC }
      if (n === 'connection') return modernConnection
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxC)
  await new Promise((r) => setTimeout(r, 400))
  const call = (method, path, body, cookie) => new Promise((resolve) => {
    const r = makeRes()
    serverC.emit('request', makeReq(method, path, cookie, body === undefined ? undefined : JSON.stringify(body)), r)
    setTimeout(() => resolve(r), 80)
  })
  const loginC = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234' })
  const regC = cookieOf(loginC)
  check('totp: reg1 登录成功', regC !== undefined)
  const st0 = await call('POST', '/auth/rpc/totpStatus', {}, regC)
  check('totp: 初始状态未启用', parseJson(st0).totp !== undefined && parseJson(st0).totp.enabled === false)
  const gen = await call('POST', '/auth/rpc/totpGenerate', {}, regC)
  const secret = (parseJson(gen) || {}).secret
  const otpauth = (parseJson(gen) || {}).otpauth
  const qrUrl = (parseJson(gen) || {}).qrDataUrl
  check('totp: 生成密钥（base32 + otpauth URL + 二维码 SVG）', gen.status === 200 && /^[A-Z2-7]{20,}$/.test(secret || '') && typeof otpauth === 'string' && otpauth.indexOf('otpauth://totp/') === 0 && typeof qrUrl === 'string' && qrUrl.startsWith('data:image/svg+xml;base64,'))
  const badVerify = await call('POST', '/auth/rpc/totpVerify', { code: '000000' }, regC)
  check('totp: 错误验证码 403', badVerify.status === 403)
  const goodCode = totpCodeAt(secret, Date.now() / 1000)
  const okVerify = await call('POST', '/auth/rpc/totpVerify', { code: goodCode }, regC)
  check('totp: 正确验证码启用成功', okVerify.status === 200)
  const me1 = await call('POST', '/auth/rpc/me', {}, regC)
  check('totp: me 显示已启用且不含 secret', parseJson(me1).me.totpEnabled === true && !JSON.stringify(parseJson(me1).me).includes('totpSecret'))
  const genAgain = await call('POST', '/auth/rpc/totpGenerate', {}, regC)
  check('totp: 已启用后再次生成 400', genAgain.status === 400)
  const rmBad = await call('POST', '/auth/rpc/totpRemove', { code: '000000' }, regC)
  check('totp: 移除需正确验证码（错误码 403）', rmBad.status === 403)
  const rmOk = await call('POST', '/auth/rpc/totpRemove', { code: goodCode }, regC)
  check('totp: 正确验证码移除成功', rmOk.status === 200)
  const me2 = await call('POST', '/auth/rpc/me', {}, regC)
  check('totp: 移除后未启用', parseJson(me2).me.totpEnabled === false)
  const ign = await call('POST', '/auth/rpc/totpIgnore', { ignore: true }, regC)
  const me3 = await call('POST', '/auth/rpc/me', {}, regC)
  check('totp: 永久忽略开关生效', ign.status === 200 && parseJson(me3).me.totpIgnore === true)
  // 管理员移除他人 TOTP（无需该用户验证码）
  await call('POST', '/auth/rpc/totpGenerate', {}, regC)
  const adminC = cookieOf(await call('POST', '/auth/login', { username: 'admin', password: adminPassword }))
  const adminRm = await call('POST', '/auth/rpc/totpRemove', { username: 'reg1' }, adminC)
  const me4 = await call('POST', '/auth/rpc/me', {}, regC)
  check('totp: 管理员可移除他人 TOTP', adminRm.status === 200 && parseJson(me4).me.totpEnabled === false)
}

// ---- 20) 2FA 登录流程（0.6.4：密码 + TOTP；免密 TOTP 已移除） ----
{
  const serverD = new EventEmitter()
  serverD.on('request', () => {})
  const ctxD = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverD }
      if (n === 'connection') return modernConnection
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxD)
  await new Promise((r) => setTimeout(r, 400))
  const call = (method, path, body, cookie) => new Promise((resolve) => {
    const r = makeRes()
    serverD.emit('request', makeReq(method, path, cookie, body === undefined ? undefined : JSON.stringify(body)), r)
    setTimeout(() => resolve(r), 80)
  })
  // 用 reg1（场景 18 创建，密码 reg1-pw-1234），先启用 TOTP（默认 2FA 关闭）
  const reg1c = cookieOf(await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234' }))
  const gen = await call('POST', '/auth/rpc/totpGenerate', {}, reg1c)
  const secret = (parseJson(gen) || {}).secret
  const good = totpCodeAt(secret, Date.now() / 1000)
  await call('POST', '/auth/rpc/totpVerify', { code: good }, reg1c)
  const st0 = await call('POST', '/auth/rpc/totpStatus', {}, reg1c)
  check('2fa: 绑定后默认不开启两步验证', parseJson(st0).totp.twoFactor === false)
  // 1) 绑定 TOTP 但 2FA 关闭：密码直接登录（无需动态码）
  const s0 = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234' })
  check('2fa: 2FA 关闭时密码直接登录成功', s0.status === 200 && parseJson(s0).totpRequired !== true && new RegExp(COOKIE_NAME + '=').test(s0.headers['set-cookie'] || ''))
  // 2) 0.6.4：免密 TOTP 登录路径已移除，只给动态码 → 400
  const s1 = await call('POST', '/auth/login', { username: 'reg1', totp: good })
  check('2fa: 免密 TOTP 已移除（缺密码 → 400）', s1.status === 400 && !new RegExp(COOKIE_NAME + '=').test(s1.headers['set-cookie'] || ''))
  // 3) 开启两步验证开关
  const on = await call('POST', '/auth/rpc/totpSet2fa', { enabled: true }, reg1c)
  const st1 = await call('POST', '/auth/rpc/totpStatus', {}, reg1c)
  check('2fa: 开启两步验证开关生效', on.status === 200 && parseJson(st1).totp.twoFactor === true)
  // 4) 2FA 开启：密码正确但要求动态码（不签发会话）
  const s2 = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234' })
  check('2fa: 开启后密码登录要求动态码（不签发会话）', s2.status === 200 && parseJson(s2).totpRequired === true && !(s2.headers['set-cookie'] || '').includes('dsh_auth='))
  // 5) 2FA 开启：密码 + TOTP → 登录成功
  const s3 = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234', totp: good })
  check('2fa: 开启后密码 + 动态码两步登录成功', s3.status === 200 && new RegExp(COOKIE_NAME + '=').test(s3.headers['set-cookie'] || ''))
  // 6) 2FA 开启：只给动态码 → 400（免密路径不存在）
  const s4 = await call('POST', '/auth/login', { username: 'reg1', totp: good })
  check('2fa: 开启后只给动态码 → 400', s4.status === 400)
  // 7) 2FA 开启：密码 + 错误动态码 → 403
  const s5 = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234', totp: '000000' })
  check('2fa: 开启后动态码错误 → 403', s5.status === 403)
  // 8) 未启用 TOTP 的账号只给动态码 → 400（不区分账号状态，避免枚举）
  const s6 = await call('POST', '/auth/login', { username: 'admin', totp: '000000' })
  check('2fa: 未启用 TOTP 的账号只给动态码 → 400', s6.status === 400)
  // 9) 关闭两步验证 → 密码直接登录恢复
  await call('POST', '/auth/rpc/totpSet2fa', { enabled: false }, reg1c)
  const s7 = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234' })
  check('2fa: 关闭后密码直接登录恢复', s7.status === 200 && parseJson(s7).totpRequired !== true && new RegExp(COOKIE_NAME + '=').test(s7.headers['set-cookie'] || ''))
  // 10) 清理：移除 reg1 的 TOTP
  await call('POST', '/auth/rpc/totpRemove', { code: good }, reg1c)
}

// ---- 20b) 通行密钥管理面（0.6.4）：鉴权、票据、反锁死 ----
{
  const serverP = new EventEmitter()
  serverP.on('request', () => {})
  const ctxP = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverP }
      if (n === 'connection') return modernConnection
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxP)
  await new Promise((r) => setTimeout(r, 400))
  const call = (method, path, body, cookie, host) => new Promise((resolve) => {
    const r = makeRes()
    const req = makeReq(method, path, cookie, body === undefined ? undefined : JSON.stringify(body))
    req.headers.host = host ?? 'localhost:3080'
    serverP.emit('request', req, r)
    setTimeout(() => resolve(r), 120)
  })
  const adminPk = cookieOf(await call('POST', '/auth/login', { username: 'admin', password: adminPassword }))

  const list = await call('POST', '/auth/rpc/passkeyList', {}, adminPk)
  const listJson = parseJson(list)
  check('passkey: 管理面列出通行密钥与环境', list.status === 200 && listJson.ok === true && Array.isArray(listJson.passkeys)
    && listJson.rp.supported === true && listJson.rp.rpId === 'localhost')
  check('passkey: 未登录不可访问管理面', (await call('POST', '/auth/rpc/passkeyList', {})).status === 401)

  // 无票据的写操作一律 403（会话被窃取也无法添加/删除因子）
  check('passkey: 无票据 passkeyAddOptions → 403', (await call('POST', '/auth/rpc/passkeyAddOptions', { preferred: 'localDevice' }, adminPk)).status === 403)
  check('passkey: 无票据 passkeyRemove → 403', (await call('POST', '/auth/rpc/passkeyRemove', { id: 'x' }, adminPk)).status === 403)
  check('passkey: 无票据 passkeyRename → 403', (await call('POST', '/auth/rpc/passkeyRename', { id: 'x', label: 'y' }, adminPk)).status === 403)
  check('passkey: 无票据 passkeyAddVerify → 403', (await call('POST', '/auth/rpc/passkeyAddVerify', { handle: 'x' }, adminPk)).status === 403)

  // 二次验证：密码错误 → 403；密码正确 → 一次性票据
  check('passkey: 二次验证密码错误 → 403', (await call('POST', '/auth/rpc/passkeyStepUp', { password: 'wrong-pass' }, adminPk)).status === 403)
  const stepUp = await call('POST', '/auth/rpc/passkeyStepUp', { password: adminPassword }, adminPk)
  const ticket = parseJson(stepUp).ticket
  check('passkey: 二次验证（密码）签发一次性票据', stepUp.status === 200 && typeof ticket === 'string' && parseJson(stepUp).mode === 'password')

  // 票据可用（取注册选项），且 IP 变化后失效
  const options = await call('POST', '/auth/rpc/passkeyAddOptions', { ticket, preferred: 'localDevice' }, adminPk)
  const optionsJson = parseJson(options)
  check('passkey: 持票可取注册选项（residentKey=required + UV）', options.status === 200 && optionsJson.ok === true
    && optionsJson.options.authenticatorSelection.residentKey === 'required'
    && optionsJson.options.authenticatorSelection.userVerification === 'required', `status=${options.status}`)
  check('passkey: 注册选项带 excludeCredentials 与 rp', Array.isArray(optionsJson.options.excludeCredentials) && optionsJson.options.rp.id === 'localhost')

  const verified = await call('POST', '/auth/rpc/passkeyAddVerify', { ticket, handle: optionsJson.handle, response: { id: 'x', rawId: 'x', type: 'public-key', response: {} }, label: 'smoke' }, adminPk)
  check('passkey: 伪造注册响应 → 400 且票据被消费（不可重放）', verified.status === 400)
  const replay = await call('POST', '/auth/rpc/passkeyAddOptions', { ticket }, adminPk)
  check('passkey: 已消费的票据不可重放 → 403', replay.status === 403)

  // 反锁死：管理员清空因子时同步关闭 2FA，且不会让账号失去全部因子
  const enable = await call('POST', '/auth/rpc/totpSet2fa', { enabled: true }, adminPk)
  check('passkey: 无任何因子的账号不能开启 2FA（先绑定因子）', enable.status === 400)
  const genB = await call('POST', '/auth/rpc/totpGenerate', {}, adminPk)
  const secretB = parseJson(genB).secret
  const codeB = totpCodeAt(secretB, Date.now() / 1000)
  await call('POST', '/auth/rpc/totpVerify', { code: codeB }, adminPk)
  const enable2 = await call('POST', '/auth/rpc/totpSet2fa', { enabled: true }, adminPk)
  check('passkey: 绑定 TOTP 后可开启 2FA', enable2.status === 200 && parseJson(enable2).twoFactor === true)
  const removeTotp = await call('POST', '/auth/rpc/totpRemove', { code: totpCodeAt(secretB, Date.now() / 1000) }, adminPk)
  check('passkey: 移除唯一因子时自动关闭 2FA（避免锁死）', removeTotp.status === 200 && parseJson(removeTotp).twoFactor === false)
  const reset = await call('POST', '/auth/rpc/passkeyReset', { username: 'admin' }, adminPk)
  check('passkey: 管理员清除指定用户通行密钥（救援路径）', reset.status === 200 && parseJson(reset).removed === 0)
  // 普通用户（reg1，场景 18 创建）不得使用管理员救援接口
  const reg1Pk = cookieOf(await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234' }))
  check('passkey: 普通用户不可用管理员救援接口',
    (await call('POST', '/auth/rpc/passkeyReset', { username: 'admin' }, reg1Pk)).status === 403)
}

// ---- 21) bootstrap 自毁（0.5.1）：改密成功后删除明文引导文件 ----
{
  const serverE = new EventEmitter()
  serverE.on('request', () => {})
  const ctxE = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverE }
      if (n === 'connection') return modernConnection
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxE)
  await new Promise((r) => setTimeout(r, 400))
  const callE = (method, path, body, cookie) => new Promise((resolve) => {
    const r = makeRes()
    serverE.emit('request', makeReq(method, path, cookie, body === undefined ? undefined : JSON.stringify(body)), r)
    setTimeout(() => resolve(r), 80)
  })
  const before = fsFiles.get('dsh-ui-auth-bootstrap.txt')
  check('boot: 引导文件存在（自毁前置）', before !== undefined)
  const adminE = cookieOf(await callE('POST', '/auth/login', { username: 'admin', password: adminPassword }))
  const change = await callE('POST', '/auth/rpc/changePassword', { oldPassword: adminPassword, newPassword: 'boot-pw-1234' }, adminE)
  check('boot: 改密成功', change.status === 200)
  await new Promise((r) => setTimeout(r, 120))
  const after = fsFiles.get('dsh-ui-auth-bootstrap.txt')
  check('boot: 改密后引导文件自毁（auto-unlink）', after === undefined)
  // 还原 admin 密码（场景 21 为最后一个场景，仍保持状态整洁）
  const adminE2 = cookieOf(await callE('POST', '/auth/login', { username: 'admin', password: 'boot-pw-1234' }))
  await callE('POST', '/auth/rpc/changePassword', { oldPassword: 'boot-pw-1234', newPassword: adminPassword }, adminE2)
}

console.log(failures === 0 ? '\nALL HOST SMOKE TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
