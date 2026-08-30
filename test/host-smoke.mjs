// Host integration smoke test: import lib/index.js (the deployed ESM artifact),
// apply() it against mock cordis services + a fake EventEmitter http server,
// then drive the real gate: bootstrap admin, redirects, 401s, login, RPC,
// and passthrough to the original request listener.
import { EventEmitter } from 'node:events'
import { name, inject, apply, totpCodeAt } from '../lib/index.js'

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
}

// ---- mock ctx ----
const disposers = []
const ctx = {
  get(name2) {
    if (name2 === 'credentials') return creds
    if (name2 === 'fs') return fsMock
    if (name2 === 'webServer') return { server }
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
  if (cookie !== undefined) req.headers.cookie = 'dsh_auth=' + cookie
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
  const m = /dsh_auth=([^;]+)/.exec(sc)
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
  const cleanup = disposers[0]() // effect callback returns the restore disposer
  cleanup()
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

// ---- 14) 管理员专属 API 守卫（模型配置 / Key 配置仅管理员） ----
{
  const server3 = new EventEmitter()
  let originalCalls3 = 0
  const recorded = []
  server3.on('request', async (req, res) => {
    originalCalls3++
    let body = ''
    const dec = new TextDecoder()
    for await (const chunk of req) body += dec.decode(chunk, { stream: true })
    body += dec.decode()
    recorded.push({ url: req.url, method: req.method, body })
    res.writeHead(200)
    res.end('ok')
  })

  const records3 = new Map()
  const creds3 = {
    async listRecords() { return [...records3.keys()].map((key) => ({ key, kind: records3.get(key).kind })) },
    async readRecord(key) { return records3.get(key) },
    async modifyRecord(key, mutate) {
      const current = records3.get(key)
      const next = await mutate(current)
      if (next === undefined) return current
      records3.set(key, next)
      return next
    },
    async deleteRecord(key) { records3.delete(key) },
  }
  let bootstrapFile3 = null
  const fsMock3 = {
    async resolve(p) { return { path: p } },
    async writeText(t, c) { bootstrapFile3 = c },
  }
  const disposers3 = []
  const ctx3 = {
    get(n) {
      if (n === 'credentials') return creds3
      if (n === 'fs') return fsMock3
      if (n === 'webServer') return { server: server3 }
      return undefined
    },
    effect(cb) { disposers3.push(cb) },
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }

  apply(ctx3)
  await new Promise((r) => setTimeout(r, 400))
  const pwMatch3 = bootstrapFile3 ? /密码:\s+(\S+)/.exec(bootstrapFile3) : null
  const adminPw3 = pwMatch3 ? pwMatch3[1] : null
  check('guard: bootstrap admin created', adminPw3 !== null)

  const login3 = async (u, p) => {
    const r = makeRes()
    server3.emit('request', makeReq('POST', '/auth/login', undefined, JSON.stringify({ username: u, password: p })), r)
    await settle()
    return cookieOf(r)
  }
  const adminCookie3 = await login3('admin', adminPw3)
  check('guard: admin login', adminCookie3 !== undefined)
  {
    const r = makeRes()
    server3.emit('request', makeReq('POST', '/auth/rpc/createUser', adminCookie3, JSON.stringify({ username: 'bob', password: 'bob-pw-1234', role: 'user' })), r)
    await settle()
    check('guard: createUser bob', parseJson(r).ok === true, r.body)
  }
  const bobCookie3 = await login3('bob', 'bob-pw-1234')
  check('guard: bob login', bobCookie3 !== undefined)

  const api3 = async (cookie, path, body) => {
    const r = makeRes()
    server3.emit('request', makeReq('POST', path, cookie, body), r)
    await settle()
    return r
  }
  const callsBefore = () => originalCalls3
  const lastBody = () => (recorded[recorded.length - 1] ? recorded[recorded.length - 1].body : '')

  // 管理员：settings.mutate(llm) 放行
  {
    const before = callsBefore()
    const r = await api3(adminCookie3, '/api/settings.mutate', JSON.stringify({ type: 'client-request', rpcId: 'r1', method: 'settings.mutate', payload: { ns: 'llm-deepseek', ops: [] } }))
    check('guard: admin settings.mutate(llm) passes', r.status === 200 && callsBefore() === before + 1, 'status=' + r.status)
    check('guard: admin body intact', lastBody().includes('llm-deepseek'), lastBody())
  }
  // bob：settings.mutate(llm) 拒绝
  {
    const before = callsBefore()
    const r = await api3(bobCookie3, '/api/settings.mutate', JSON.stringify({ type: 'client-request', rpcId: 'r2', method: 'settings.mutate', payload: { ns: 'llm-pi-ai', ops: [] } }))
    check('guard: bob settings.mutate(llm) 403', r.status === 403 && callsBefore() === before, 'status=' + r.status)
  }
  // bob：settings.mutate(settings.models 镜像) 拒绝
  {
    const before = callsBefore()
    const r = await api3(bobCookie3, '/api/settings.mutate', JSON.stringify({ type: 'client-request', rpcId: 'r3', method: 'settings.mutate', payload: { ns: 'settings.models', ops: [] } }))
    check('guard: bob settings.mutate(settings.models) 403', r.status === 403 && callsBefore() === before, 'status=' + r.status)
  }
  // bob：settings.mutate(非 llm 命名空间) 放行，且请求体完整回放
  {
    const before = callsBefore()
    const body = JSON.stringify({ type: 'client-request', rpcId: 'r4', method: 'settings.mutate', payload: { ns: 'general', ops: [{ op: 'set', path: ['lang'], value: 'en' }] } })
    const r = await api3(bobCookie3, '/api/settings.mutate', body)
    check('guard: bob settings.mutate(general) passes', r.status === 200 && callsBefore() === before + 1, 'status=' + r.status)
    check('guard: bob body replayed intact', lastBody() === body, 'got=' + lastBody())
  }
  // bob：credentials.set / credentials.unset / llm.discoverModels 拒绝
  {
    const before = callsBefore()
    const r = await api3(bobCookie3, '/api/credentials.set', JSON.stringify({ type: 'client-request', rpcId: 'r5', method: 'credentials.set', payload: { ref: 'DEEPSEEK_API_KEY', value: 'sk-test' } }))
    check('guard: bob credentials.set 403', r.status === 403 && callsBefore() === before, 'status=' + r.status)
  }
  {
    const before = callsBefore()
    const r = await api3(bobCookie3, '/api/credentials.unset', JSON.stringify({ type: 'client-request', rpcId: 'r6', method: 'credentials.unset', payload: { ref: 'DEEPSEEK_API_KEY' } }))
    check('guard: bob credentials.unset 403', r.status === 403 && callsBefore() === before, 'status=' + r.status)
  }
  {
    const before = callsBefore()
    const r = await api3(bobCookie3, '/api/llm.discoverModels', JSON.stringify({ type: 'client-request', rpcId: 'r7', method: 'llm.discoverModels', payload: { settingsNs: 'llm-pi-ai', baseURL: 'https://x' } }))
    check('guard: bob llm.discoverModels 403', r.status === 403 && callsBefore() === before, 'status=' + r.status)
  }
  // 管理员：credentials.set 放行
  {
    const before = callsBefore()
    const body = JSON.stringify({ type: 'client-request', rpcId: 'r8', method: 'credentials.set', payload: { ref: 'DEEPSEEK_API_KEY', value: 'sk-admin' } })
    const r = await api3(adminCookie3, '/api/credentials.set', body)
    check('guard: admin credentials.set passes', r.status === 200 && callsBefore() === before + 1, 'status=' + r.status)
    check('guard: admin body intact', lastBody() === body, lastBody())
  }
  // bob：非受限方法 session.list 放行且 body 完整
  {
    const before = callsBefore()
    const body = JSON.stringify({ type: 'client-request', rpcId: 'r9', method: 'session.list', payload: {} })
    const r = await api3(bobCookie3, '/api/session.list', body)
    check('guard: bob session.list passes', r.status === 200 && callsBefore() === before + 1, 'status=' + r.status)
    check('guard: bob session.list body intact', lastBody() === body, lastBody())
  }
}

// ---- 15) 数据面隔离：按登录用户过滤会话/工作区 + 直连拦截 + 创建打标 ----
{
  const server4 = new EventEmitter()
  let originalCalls4 = 0
  // 智能原始监听器：按方法返回罐头响应（session.list 固定含 s-admin/s-bob/s-created）
  server4.on('request', (req, res) => {
    originalCalls4++
    const rawPath = String(req.url).split('?')[0]
    const isExport = rawPath === '/api/session.export'
    if (isExport) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    const method = rawPath.slice('/api/'.length)
    ;(async () => {
      let body = ''
      const dec = new TextDecoder()
      for await (const chunk of req) body += dec.decode(chunk, { stream: true })
      body += dec.decode()
      let rpcId = 'x'
      try { rpcId = JSON.parse(body).rpcId || 'x' } catch (e) { /* keep */ }
      const respond = (value) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
      }
      switch (method) {
        case 'session.list':
          respond({ items: [
            { sessionId: 's-admin', updatedAt: 1, running: false, blank: false },
            { sessionId: 's-bob', updatedAt: 1, running: false, blank: false },
            { sessionId: 's-created', updatedAt: 1, running: false, blank: false },
          ] })
          break
        case 'workspace.list':
          respond({ items: [
            { workspaceId: 'w-admin', path: '/a', title: 'A', sessionIds: ['s-admin', 's-bob'], createdAt: '', updatedAt: '' },
            { workspaceId: 'w-bob', path: '/b', title: 'B', sessionIds: ['s-bob'], createdAt: '', updatedAt: '' },
            { workspaceId: 'w-created', path: '/c', title: 'C', sessionIds: [], createdAt: '', updatedAt: '' },
          ], archivedSessionIds: ['s-admin'] })
          break
        case 'session.search':
          respond({ items: [{ sessionId: 's-admin', snippet: 'hi' }, { sessionId: 's-bob', snippet: 'yo' }], hasMore: true })
          break
        case 'session.create':
          respond({ sessionId: 's-created' })
          break
        case 'workspace.create':
          respond({ workspace: { workspaceId: 'w-created', path: '/c', title: 'C', sessionIds: [], createdAt: '', updatedAt: '' }, created: true })
          break
        case 'session.history':
          respond({ items: [] })
          break
        default:
          respond({})
      }
    })()
  })

  const records4 = new Map()
  // 预置归属：s-admin/w-admin 归 admin，s-bob/w-bob 归 test1（登录的普通用户）
  records4.set('dsh-auth/ownership', {
    kind: 'grant',
    payload: JSON.stringify({
      v: 1,
      sessions: { 's-admin': 'admin', 's-bob': 'test1' },
      workspaces: { 'w-admin': 'admin', 'w-bob': 'test1' },
    }),
  })
  // 预置用户（admin 密码 new-admin-pw-9999；test1 密码 12345678）——必须在 apply 前，
  // 否则 init 时用户表为空会引导新 admin
  records4.set('dsh-auth/admin', {
    kind: 'grant',
    payload: JSON.stringify({ v: 1, username: 'admin', role: 'admin', salt: '92a35561b3c19bd6fffa191822616141', hash: '598dee939ea92827781dfed37d8eaafdf51bed5ad91fddba6f98d34580c877fc', iterations: 60000, displayName: '管理员', email: '', createdAt: 1, updatedAt: 1 }),
  })
  records4.set('dsh-auth/test1', {
    kind: 'grant',
    payload: JSON.stringify({ v: 1, username: 'test1', role: 'user', salt: '3c250d71860104b3e35c5f33f465b4fd', hash: 'd6b6df777d94a462e13cb64fd2f0adf35524210ceaa413ee75cdd82605774bf4', iterations: 60000, displayName: 'Test1', email: '', createdAt: 1, updatedAt: 1 }),
  })
  const creds4 = {
    async listRecords() { return [...records4.keys()].map((key) => ({ key, kind: records4.get(key).kind })) },
    async readRecord(key) { return records4.get(key) },
    async modifyRecord(key, mutate) {
      const current = records4.get(key)
      const next = await mutate(current)
      if (next === undefined) return current
      records4.set(key, next)
      return next
    },
    async deleteRecord(key) { records4.delete(key) },
  }
  const fsMock4 = { async resolve(p) { return { path: p } }, async writeText() {} }
  const ctx4 = {
    get(n) {
      if (n === 'credentials') return creds4
      if (n === 'fs') return fsMock4
      if (n === 'webServer') return { server: server4 }
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctx4)
  await new Promise((r) => setTimeout(r, 300))

  const login4 = async (u, p) => {
    const r = makeRes()
    server4.emit('request', makeReq('POST', '/auth/login', undefined, JSON.stringify({ username: u, password: p })), r)
    await settle()
    return cookieOf(r)
  }
  // 预置用户（admin 密码 new-admin-pw-9999；test1 密码 12345678）——必须在 apply 前，
  // 否则 init 时用户表为空会引导新 admin
  const adminCookie4 = await login4('admin', 'new-admin-pw-9999')
  const bobCookie4 = await login4('test1', '12345678')
  check('iso: admin login', adminCookie4 !== undefined)
  check('iso: test1 login', bobCookie4 !== undefined)

  const post4 = async (cookie, path, body) => {
    const r = makeRes()
    server4.emit('request', makeReq('POST', path, cookie, body), r)
    await settle()
    return r
  }
  const get4 = async (cookie, url) => {
    const r = makeRes()
    server4.emit('request', makeReq('GET', url, cookie), r)
    return r
  }
  const itemsOf = (res) => {
    const j = parseJson(res)
    return j && j.result && j.result.ok ? j.result.value.items : null
  }
  const ids = (res) => (itemsOf(res) || []).map((it) => it.sessionId)

  // 1) test1 的 session.list 只含自己的
  {
    const r = await post4(bobCookie4, '/api/session.list', JSON.stringify({ type: 'client-request', rpcId: 'i1', method: 'session.list', payload: {} }))
    const got = ids(r)
    check('iso: test1 session.list filtered to own', r.status === 200 && JSON.stringify(got) === JSON.stringify(['s-bob']), JSON.stringify(got))
  }
  // 2) admin 的 session.list 全量
  {
    const r = await post4(adminCookie4, '/api/session.list', JSON.stringify({ type: 'client-request', rpcId: 'i2', method: 'session.list', payload: {} }))
    const got = ids(r)
    check('iso: admin session.list unfiltered', r.status === 200 && JSON.stringify(got) === JSON.stringify(['s-admin', 's-bob', 's-created']), JSON.stringify(got))
  }
  // 3) test1 的 workspace.list 只含自己的工作区与自己的会话
  {
    const r = await post4(bobCookie4, '/api/workspace.list', JSON.stringify({ type: 'client-request', rpcId: 'i3', method: 'workspace.list', payload: {} }))
    const j = parseJson(r)
    const v = j && j.result && j.result.ok ? j.result.value : null
    const wsIds = (v ? v.items : []).map((w) => w.workspaceId)
    const wsSessions = (v ? v.items : []).map((w) => w.sessionIds)
    check('iso: test1 workspace.list filtered', JSON.stringify(wsIds) === JSON.stringify(['w-bob']), JSON.stringify(wsIds))
    check('iso: test1 workspace sessions filtered', JSON.stringify(wsSessions) === JSON.stringify([['s-bob']]), JSON.stringify(wsSessions))
    check('iso: archivedSessionIds filtered', JSON.stringify(v.archivedSessionIds) === JSON.stringify([]), JSON.stringify(v.archivedSessionIds))
  }
  // 4) test1 的 session.search 过滤 + hasMore 归 false
  {
    const r = await post4(bobCookie4, '/api/session.search', JSON.stringify({ type: 'client-request', rpcId: 'i4', method: 'session.search', payload: { query: 'x' } }))
    const j = parseJson(r)
    const v = j && j.result && j.result.ok ? j.result.value : null
    check('iso: test1 session.search filtered', v && JSON.stringify(v.items.map((i) => i.sessionId)) === JSON.stringify(['s-bob']), JSON.stringify(v && v.items))
    check('iso: test1 session.search hasMore false', v && v.hasMore === false, JSON.stringify(v && v.hasMore))
  }
  // 5) test1 直连 admin 会话 → 403；自己的会话 → 放行
  {
    const before = originalCalls4
    const r = await post4(bobCookie4, '/api/session.history', JSON.stringify({ type: 'client-request', rpcId: 'i5', method: 'session.history', payload: { sessionId: 's-admin' } }))
    check('iso: test1 session.history(admin) 403', r.status === 403 && originalCalls4 === before, 'status=' + r.status)
  }
  {
    const before = originalCalls4
    const r = await post4(bobCookie4, '/api/session.history', JSON.stringify({ type: 'client-request', rpcId: 'i6', method: 'session.history', payload: { sessionId: 's-bob' } }))
    check('iso: test1 session.history(own) passes', r.status === 200 && originalCalls4 === before + 1, 'status=' + r.status)
  }
  {
    const before = originalCalls4
    const r = await post4(bobCookie4, '/api/workspace.delete', JSON.stringify({ type: 'client-request', rpcId: 'i7', method: 'workspace.delete', payload: { workspaceId: 'w-admin' } }))
    check('iso: test1 workspace.delete(admin) 403', r.status === 403 && originalCalls4 === before, 'status=' + r.status)
  }
  // 6) test1 创建会话 → 打标 → 之后 session.list 能看到新会话
  {
    const r = await post4(bobCookie4, '/api/session.create', JSON.stringify({ type: 'client-request', rpcId: 'i8', method: 'session.create', payload: {} }))
    check('iso: test1 session.create ok', r.status === 200, 'status=' + r.status)
    await settle()
    const r2 = await post4(bobCookie4, '/api/session.list', JSON.stringify({ type: 'client-request', rpcId: 'i9', method: 'session.list', payload: {} }))
    const got = ids(r2)
    check('iso: created session tagged to test1', JSON.stringify(got) === JSON.stringify(['s-bob', 's-created']), JSON.stringify(got))
  }
  // 7) test1 创建工作区 → 打标 → workspace.list 可见
  {
    const r = await post4(bobCookie4, '/api/workspace.create', JSON.stringify({ type: 'client-request', rpcId: 'i10', method: 'workspace.create', payload: { path: '/c' } }))
    check('iso: test1 workspace.create ok', r.status === 200, 'status=' + r.status)
    await settle()
    const r2 = await post4(bobCookie4, '/api/workspace.list', JSON.stringify({ type: 'client-request', rpcId: 'i11', method: 'workspace.list', payload: {} }))
    const j = parseJson(r2)
    const wsIds = (j && j.result && j.result.ok ? j.result.value.items : []).map((w) => w.workspaceId)
    check('iso: created workspace tagged to test1', JSON.stringify(wsIds) === JSON.stringify(['w-bob', 'w-created']), JSON.stringify(wsIds))
  }
  // 8) 会话导出：test1 导出 admin 会话 → 403；导出自己 → 放行；admin 任意
  {
    const before = originalCalls4
    const r = await get4(bobCookie4, '/api/session.export?sessionId=s-admin')
    check('iso: test1 session.export(admin) 403', r.status === 403 && originalCalls4 === before, 'status=' + r.status)
  }
  {
    const before = originalCalls4
    const r = await get4(bobCookie4, '/api/session.export?sessionId=s-bob')
    check('iso: test1 session.export(own) passes', r.status === 200 && originalCalls4 === before + 1, 'status=' + r.status)
  }
  {
    const before = originalCalls4
    const r = await get4(adminCookie4, '/api/session.export?sessionId=s-admin')
    check('iso: admin session.export passes', r.status === 200 && originalCalls4 === before + 1, 'status=' + r.status)
  }
}

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
  check('sess: 登录后会话文件已落盘', file !== undefined && file.includes('"sessions"') && file.includes(cookie16), 'file=' + (file !== undefined ? file.slice(0, 90) : '(missing)'))
  // 模拟"重启"：新 server + 新 ctx（共享同一 credentials 与 fs 存储），再 apply 一次
  const serverR2 = new EventEmitter()
  serverR2.on('request', () => {})
  const ctxR2 = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverR2 }
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
  const reg1 = await call('POST', '/auth/register', { username: 'reg1', password: 'reg1-pw-1234', email: 'reg1@example.com', invite: code })
  const reg1AutoCookie = cookieOf(reg1)
  check('reg: 有效邀请码注册成功（自动登录 + 引导页 redirect）', reg1.status === 200 && parseJson(reg1).ok === true && reg1AutoCookie !== undefined && parseJson(reg1).redirect === '/auth/register/success', 'status=' + reg1.status + ' body=' + reg1.body)
  // 4b) 注册成功引导页：带 cookie 可访问，未登录重定向
  const successPage = await call('GET', '/auth/register/success', undefined, reg1AutoCookie)
  check('reg: 引导页可达（含「立即添加 TOTP」）', successPage.status === 200 && successPage.body.includes('立即添加 TOTP') && successPage.body.includes('两步验证'))
  const successNoCookie = await call('GET', '/auth/register/success')
  check('reg: 未登录访问引导页 → 302 登录页', successNoCookie.status === 302 && (successNoCookie.headers.location || '').startsWith('/auth/login'))
  // 5) 同一码第二次注册成功（uses=2）
  const reg2 = await call('POST', '/auth/register', { username: 'reg2', password: 'reg2-pw-1234', email: '', invite: code })
  check('reg: 同一码第二次注册成功（可注册 2 次）', reg2.status === 200)
  // 6) 第三次被拒（次数耗尽）
  const reg3 = await call('POST', '/auth/register', { username: 'reg3', password: 'reg3-pw-1234', email: '', invite: code })
  check('reg: 次数耗尽后 403', reg3.status === 403)
  // 7) 无效邀请码 403
  const regBad = await call('POST', '/auth/register', { username: 'reg4', password: 'reg4-pw-1234', email: '', invite: 'XXXX9999' })
  check('reg: 无效邀请码 403', regBad.status === 403)
  // 8) 弱密码 400
  const regWeak = await call('POST', '/auth/register', { username: 'reg5', password: 'short', email: '', invite: code })
  check('reg: 弱密码 400', regWeak.status === 400)
  // 9) 用户名已存在 409
  const regDup = await call('POST', '/auth/register', { username: 'reg1', password: 'reg1-pw-1234', email: '', invite: code })
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

// ---- 20) 2FA 登录流程（密码 + TOTP 两步 / 免密 TOTP，0.5.0） ----
{
  const serverD = new EventEmitter()
  serverD.on('request', () => {})
  const ctxD = {
    get(n) {
      if (n === 'credentials') return creds
      if (n === 'fs') return fsMock
      if (n === 'webServer') return { server: serverD }
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
  check('2fa: 2FA 关闭时密码直接登录成功', s0.status === 200 && parseJson(s0).totpRequired !== true && /dsh_auth=/.test(s0.headers['set-cookie'] || ''))
  // 2) 2FA 关闭：免密 TOTP 登录成功（密码或动态码二选一）
  const s1 = await call('POST', '/auth/login', { username: 'reg1', totp: good })
  check('2fa: 2FA 关闭时免密 TOTP 登录成功', s1.status === 200 && /dsh_auth=/.test(s1.headers['set-cookie'] || ''))
  // 3) 开启两步验证开关
  const on = await call('POST', '/auth/rpc/totpSet2fa', { enabled: true }, reg1c)
  const st1 = await call('POST', '/auth/rpc/totpStatus', {}, reg1c)
  check('2fa: 开启两步验证开关生效', on.status === 200 && parseJson(st1).totp.twoFactor === true)
  // 4) 2FA 开启：密码正确但要求动态码（不签发会话）
  const s2 = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234' })
  check('2fa: 开启后密码登录要求动态码（不签发会话）', s2.status === 200 && parseJson(s2).totpRequired === true && !(s2.headers['set-cookie'] || '').includes('dsh_auth='))
  // 5) 2FA 开启：密码 + TOTP → 登录成功
  const s3 = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234', totp: good })
  check('2fa: 开启后密码 + 动态码两步登录成功', s3.status === 200 && /dsh_auth=/.test(s3.headers['set-cookie'] || ''))
  // 6) 2FA 开启：免密 TOTP 被拒（强制两者）
  const s4 = await call('POST', '/auth/login', { username: 'reg1', totp: good })
  check('2fa: 开启后免密 TOTP 被拒（403）', s4.status === 403)
  // 7) 2FA 开启：密码 + 错误动态码 → 403
  const s5 = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234', totp: '000000' })
  check('2fa: 开启后动态码错误 → 403', s5.status === 403)
  // 8) 未启用 TOTP 的账号免密 → 400
  const s6 = await call('POST', '/auth/login', { username: 'admin', totp: '000000' })
  check('2fa: 未启用 TOTP 的账号免密登录 → 400', s6.status === 400)
  // 9) 关闭两步验证 → 密码直接登录恢复
  await call('POST', '/auth/rpc/totpSet2fa', { enabled: false }, reg1c)
  const s7 = await call('POST', '/auth/login', { username: 'reg1', password: 'reg1-pw-1234' })
  check('2fa: 关闭后密码直接登录恢复', s7.status === 200 && parseJson(s7).totpRequired !== true && /dsh_auth=/.test(s7.headers['set-cookie'] || ''))
  // 清理：移除 reg1 的 TOTP
  await call('POST', '/auth/rpc/totpRemove', { code: good }, reg1c)
}

console.log(failures === 0 ? '\nALL HOST SMOKE TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
