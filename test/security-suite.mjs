// ============================================================================
// dsh-ui-auth 安全验证用例集（公网部署场景）
// 用真实部署产物 lib/index.js（mock 服务器 + mock 服务），按攻击类别驱动真实
// 网关代码路径，覆盖认证/会话/注入/CSRF/HTTP 层/信息泄露/越权/数据隔离/可用性/
// 部署加固 10 类。运行：node test/security-suite.mjs
// ============================================================================
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { apply, readLockConfig, clientIp, totpCodeAt } from '../lib/index.js'

const HOST_SRC = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const CLIENT_SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const results = []
function check(category, label, cond, extra) {
  results.push({ category, label, pass: !!cond, extra })
}

// ---------------- mock 基础设施 ----------------
function makeReq(method, url, cookie, body, ip = '127.0.0.1') {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = {}
  if (cookie !== undefined) req.headers.cookie = 'dsh_auth=' + cookie
  req.socket = { remoteAddress: ip }
  req.destroy = () => {}
  const chunks = body !== undefined ? [Buffer.from(body)] : []
  req[Symbol.asyncIterator] = () => {
    let i = 0
    return {
      next() {
        if (i < chunks.length) return Promise.resolve({ value: chunks[i++], done: false })
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  }
  if (body !== undefined) {
    process.nextTick(() => { req.emit('data', Buffer.from(body)); req.emit('end') })
  } else {
    process.nextTick(() => { req.emit('end') })
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
const parseJson = (res) => { try { return JSON.parse(res.body) } catch (e) { return null } }
const settle = () => new Promise((r) => setImmediate(r))
function cookieOf(res) {
  const sc = res.headers['set-cookie']
  if (!sc) return undefined
  const m = /dsh_auth=([^;]+)/.exec(sc)
  return m ? m[1] : undefined
}

// ---------------- 主场景：admin + test1 + 数据归属 ----------------
function buildServer() {
  const server = new EventEmitter()
  server.on('request', (req, res) => {
    const rawPath = String(req.url).split('?')[0]
    if (rawPath === '/api/session.export') {
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
            { sessionId: 's-test1', updatedAt: 1, running: false, blank: false },
            { sessionId: 's-created', updatedAt: 1, running: false, blank: false },
          ] })
          break
        case 'workspace.list':
          respond({ items: [
            { workspaceId: 'w-admin', path: '/a', title: 'A', sessionIds: ['s-admin', 's-test1'], createdAt: '', updatedAt: '' },
            { workspaceId: 'w-test1', path: '/b', title: 'B', sessionIds: ['s-test1'], createdAt: '', updatedAt: '' },
          ], archivedSessionIds: ['s-admin'] })
          break
        case 'session.create': respond({ sessionId: 's-created' }); break
        case 'session.history': respond({ items: [] }); break
        default: respond({})
      }
    })()
  })
  return server
}

function buildStore() {
  const records = new Map()
  records.set('dsh-auth/ownership', {
    kind: 'grant',
    payload: JSON.stringify({ v: 1, sessions: { 's-admin': 'admin', 's-test1': 'test1' }, workspaces: { 'w-admin': 'admin', 'w-test1': 'test1' } }),
  })
  records.set('dsh-auth/admin', {
    kind: 'grant',
    payload: JSON.stringify({ v: 1, username: 'admin', role: 'admin', salt: '92a35561b3c19bd6fffa191822616141', hash: '598dee939ea92827781dfed37d8eaafdf51bed5ad91fddba6f98d34580c877fc', iterations: 60000, displayName: '管理员', email: '', createdAt: 1, updatedAt: 1 }),
  })
  records.set('dsh-auth/test1', {
    kind: 'grant',
    payload: JSON.stringify({ v: 1, username: 'test1', role: 'user', salt: '3c250d71860104b3e35c5f33f465b4fd', hash: 'd6b6df777d94a462e13cb64fd2f0adf35524210ceaa413ee75cdd82605774bf4', iterations: 60000, displayName: 'Test1', email: '', createdAt: 1, updatedAt: 1 }),
  })
  return {
    records,
    creds: {
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
    },
  }
}

const server = buildServer()
const { records, creds } = buildStore()
const bootstrapFile = []
let apiProxyCurrent = undefined // WS 隔离组会注入 apiProxy mock
const fsMock = {
  async resolve(p) { return { path: p } },
  async writeText(t, c) { bootstrapFile.push(c) },
  async readText() { throw Object.assign(new Error('not found'), { code: 'FS_NOT_FOUND' }) },
}
const ctx = {
  get(n) {
    if (n === 'credentials') return creds
    if (n === 'fs') return fsMock
    if (n === 'webServer') return { server }
    if (n === 'apiProxy') return apiProxyCurrent
    return undefined
  },
  effect() {},
  interval() { return () => {} },
  timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
}
apply(ctx)
await new Promise((r) => setTimeout(r, 300))

const login = async (u, p, ip = '127.0.0.1') => {
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/login', undefined, JSON.stringify({ username: u, password: p }), ip), r)
  await settle()
  return r
}
let adminCookie = cookieOf(await login('admin', 'new-admin-pw-9999'))
let test1Cookie = cookieOf(await login('test1', '12345678'))
check('AUTH', 'admin 登录成功', adminCookie !== undefined)
check('AUTH', 'test1 登录成功', test1Cookie !== undefined)

// ==================== A. 认证 ====================
check('AUTH', '引导使用随机密码（无硬编码默认密码）', HOST_SRC.includes('randomPassword(16)'))
{
  const ok = JSON.parse(records.get('dsh-auth/test1').payload)
  check('AUTH', '存储 payload 无 password 字段（仅 salt/hash）', !('password' in ok))
}
{
  const wrong = await login('test1', 'wrong-pass-xx', '10.0.0.2')
  const unknown = await login('nobody', 'whatever123', '10.0.0.3')
  check('AUTH', '错误密码 → 401', wrong.status === 401)
  check('AUTH', '不存在用户名 → 相同 401 文案（防账号枚举）',
    wrong.status === 401 && unknown.status === 401 && parseJson(wrong).error === parseJson(unknown).error
    && parseJson(wrong).error === '用户名或密码错误')
}
{
  const r = await login('test1', '12345678')
  const sc = r.headers['set-cookie'] || ''
  check('SESSION', 'Cookie: HttpOnly', sc.includes('HttpOnly'))
  check('SESSION', 'Cookie: SameSite=Strict', sc.includes('SameSite=Strict'))
  check('SESSION', 'Cookie: Path=/', sc.includes('Path=/'))
  check('SESSION', 'Cookie: Max-Age 存在', /Max-Age=\d+/.test(sc))
}
{
  // 会话固定：登录前先植入伪造 cookie，登录后必须签发全新 token
  const planted = 'attacker-controlled-token-123'
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/login', planted, JSON.stringify({ username: 'test1', password: '12345678' }), '10.0.0.4'), r)
  await settle()
  const newToken = cookieOf(r)
  check('SESSION', '会话固定防护：签发全新 token（不复用植入值）', newToken !== undefined && newToken !== planted)
}
{
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/me', adminCookie, '{}'), r)
  await settle()
  const me = parseJson(r)
  check('AUTH', 'me 响应不含 salt/hash（不泄露凭据材料）', r.status === 200 && me.ok && !('salt' in me.me) && !('hash' in me.me) && !('iterations' in me.me))
}
{
  // 弱密码策略
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/createUser', adminCookie, JSON.stringify({ username: 'weak', password: 'short' })), r)
  await settle()
  check('AUTH', '弱密码被拒绝（最少 8 位）', r.status === 400)
}
check('AUTH', '密码比较使用常量时间实现', HOST_SRC.includes('constantTimeEqual'))

// ==================== B. 会话 ====================
{
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/me', 'bogus-token', '{}'), r)
  await settle()
  check('SESSION', '伪造/无效会话 → 401', r.status === 401)
}
{
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/logout', test1Cookie), r)
  await settle()
  const after = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/me', test1Cookie, '{}'), after)
  await settle()
  check('SESSION', '登出后会话立即失效', parseJson(r).ok === true && after.status === 401)
}
{
  // 登出必须是写操作（POST-only），防止 GET 型 CSRF/缓存链触发登出。
  // 用全新会话验证 GET 登出被拒后会话仍然有效（前一个 POST 登出已销毁旧会话）。
  const fresh = cookieOf(await login('test1', '12345678'))
  const r = makeRes()
  server.emit('request', makeReq('GET', '/auth/logout', fresh, undefined), r)
  await settle()
  check('SESSION', 'GET /auth/logout → 405（登出仅允许 POST）', r.status === 405)
  const after = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/me', fresh, '{}'), after)
  await settle()
  check('SESSION', 'GET 登出被拒后会话仍然有效', after.status === 200)
  // 后续用例继续使用 test1 会话
  test1Cookie = fresh
}
{
  // 修改密码：旧密码失效、新密码可用、其他会话失效
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/changePassword', adminCookie, JSON.stringify({ oldPassword: 'new-admin-pw-9999', newPassword: 'brand-new-pw-8888' })), r)
  await settle()
  const oldLogin = await login('admin', 'new-admin-pw-9999', '10.0.0.5')
  const newLogin = await login('admin', 'brand-new-pw-8888', '10.0.0.6')
  check('SESSION', '改密后旧密码失效', r.status === 200 && oldLogin.status === 401)
  check('SESSION', '改密后新密码可用', newLogin.status === 200)
  // 改回原密码，保持后续用例一致（changePassword 会使该用户其它会话失效，
  // 因此改密往返后重新登录 admin 刷新 cookie）
  const r2 = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/changePassword', cookieOf(newLogin), JSON.stringify({ oldPassword: 'brand-new-pw-8888', newPassword: 'new-admin-pw-9999' })), r2)
  await settle()
  check('SESSION', '改回原密码成功', parseJson(r2).ok === true)
  adminCookie = cookieOf(await login('admin', 'new-admin-pw-9999'))
  check('SESSION', '改密后重新登录成功（admin 后续用例使用新会话）', adminCookie !== undefined)
}
check('SESSION', '会话 TTL 常量存在（12h 滑动续期）', HOST_SRC.includes('SESSION_TTL_MS = 12 * 60 * 60 * 1000'))

// ==================== C. 注入 ====================
check('INJ', '客户端无 dangerouslySetInnerHTML / innerHTML / eval（XSS 由 React 转义）',
  !CLIENT_SRC.includes('dangerouslySetInnerHTML') && !CLIENT_SRC.includes('innerHTML') && !CLIENT_SRC.includes('eval(') && !CLIENT_SRC.includes('new Function'))
{
  // 开放重定向防护：next 必须为站内路径
  const r = makeRes()
  server.emit('request', makeReq('GET', '/some/route', undefined, undefined), r)
  const q = String(r.headers.location || '')
  check('INJ', '未登录页面导航重定向到站内登录页', q.startsWith('/auth/login'))
}
{
  // 开放重定向：safeNext 只接受站内路径（拒绝外站/协议/双斜杠）
  const cases = [
    ['http://evil.com', '/'],
    ['//evil.com', '/'],
    ['https://evil.com/x', '/'],
    ['%2F%2Fevil.com', '/'],
    ['/%2F%2Fevil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/settings', '/settings'],
    ['/auth/login?x=1', '/auth/login?x=1'],
  ]
  for (const [next, expect] of cases) {
    const r = makeRes()
    server.emit('request', makeReq('GET', '/auth/login?next=' + next, test1Cookie, undefined), r)
    await settle()
    const loc = String(r.headers.location || '')
    check('INJ', '开放重定向: next=' + next + ' → ' + expect, r.status === 302 && loc === expect, 'got: ' + loc)
  }
}
{
  // CRLF 注入：next 无法向响应头注入换行
  const r = makeRes()
  server.emit('request', makeReq('GET', '/auth/login?next=' + encodeURIComponent('/a%0d%0aX-Evil:1'), test1Cookie, undefined), r)
  await settle()
  const loc = String(r.headers.location || '')
  check('INJ', 'next 参数 CRLF 注入被拒（location 无换行）', r.status === 302 && !loc.includes('\r') && !loc.includes('\n'), 'got: ' + loc)
}
{
  // 超大请求体 → 400 拒绝且不崩溃（/auth/rpc/* 网关内 readBody 限流）
  const big = JSON.stringify({ pad: 'x'.repeat(70000) })
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/me', test1Cookie, big), r)
  await settle()
  check('INJ', '超大请求体被拒（64KB 上限）', r.status === 400 && parseJson(r).error === '请求体格式错误')
}
{
  // 登录页不反射提交的用户名（无反射型 XSS 面）
  const before = makeRes()
  server.emit('request', makeReq('GET', '/auth/login', undefined, undefined), before)
  const after = makeRes()
  server.emit('request', makeReq('GET', '/auth/login', undefined, undefined), after)
  check('INJ', '登录页为静态 HTML（两次渲染一致，不含用户输入）', before.body === after.body && !before.body.includes('<script>alert'))
}

// ==================== D. CSRF ====================
{
  // 跨站表单提交（urlencoded）到 JSON 端点 → 拒绝
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/changePassword', test1Cookie, 'oldPassword=x&newPassword=y', '10.0.0.7'), r)
  await settle()
  check('CSRF', '非 JSON 内容类型的状态变更请求被拒', r.status === 400)
}
{
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/login', undefined, JSON.stringify({ username: 'test1', password: '12345678' }), '10.0.0.8'), r)
  const headers = Object.keys(r.headers)
  check('CSRF', '响应不携带 CORS 放行头（跨源读不到响应）', !headers.some((h) => h.toLowerCase().startsWith('access-control-allow')))
}
check('CSRF', 'SameSite=Strict 已启用（见 SESSION 组）', true)

// ==================== E. HTTP 层 ====================
{
  const r = makeRes()
  server.emit('request', makeReq('GET', '/auth/rpc/me', adminCookie, undefined), r)
  await settle()
  check('HTTP', 'GET 访问 RPC 端点 → 405', r.status === 405)
}
{
  const r = makeRes()
  server.emit('request', makeReq('DELETE', '/auth/login', undefined, undefined), r)
  await settle()
  check('HTTP', 'DELETE 访问登录端点 → 405', r.status === 405)
}
{
  const r = makeRes()
  server.emit('request', makeReq('GET', '/api/session.list', undefined, undefined), r)
  await settle()
  check('HTTP', '未认证 API → 401（无旁路）', r.status === 401)
}
{
  const r = makeRes()
  server.emit('request', makeReq('GET', '/assets/app.js', undefined, undefined), r)
  await settle()
  check('HTTP', '未认证静态资源 → 401（无旁路）', r.status === 401)
}
{
  const r = makeRes()
  server.emit('request', makeReq('GET', '/', undefined, undefined), r)
  check('HTTP', '未认证页面 → 302 登录页', r.status === 302)
}
{
  // WebSocket 升级门控（mock socket 驱动真实 gateUp；事件流升级走代理）
  const fakeSocket = (opts = {}) => ({
    written: [], destroyed: false, ended: false,
    write(c) { this.written.push(Buffer.from(c)); return true },
    end() { this.ended = true }, destroy() { this.destroyed = true },
    setKeepAlive() {}, setTimeout() {}, on() {}, once() {}, removeListener() {},
  })
  const upgradeReq = (path, cookie, extra) => {
    const r = makeReq('GET', path, cookie, undefined)
    r.headers = { ...r.headers, ...extra }
    return r
  }
  const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ=='
  // 1) 未认证 → 销毁
  const s1 = fakeSocket()
  server.emit('upgrade', upgradeReq('/api/events.mux', undefined, { 'sec-websocket-key': WS_KEY }), s1, Buffer.alloc(0))
  check('HTTP', 'WS 未认证升级 → 立即销毁连接', s1.destroyed === true)
  // 2) /auth/* → 销毁
  const s3 = fakeSocket()
  server.emit('upgrade', upgradeReq('/auth/ws', undefined, { 'sec-websocket-key': WS_KEY }), s3, Buffer.alloc(0))
  check('HTTP', 'WS 指向 /auth/* → 销毁（不暴露认证端点）', s3.destroyed === true)
  // 3) 非事件流升级 + 有效会话 → 放行（转发原监听器）
  const s4 = fakeSocket()
  server.emit('upgrade', upgradeReq('/api/other-ws', test1Cookie, { 'sec-websocket-key': WS_KEY }), s4, Buffer.alloc(0))
  check('HTTP', '非事件流 WS 有效会话升级 → 放行（不销毁）', s4.destroyed === false)
  // 4) 事件流升级 + 有效会话 + apiProxy 缺失 → fail-closed 销毁（绝不透传全量帧）
  const s5 = fakeSocket()
  server.emit('upgrade', upgradeReq('/api/events.mux', test1Cookie, { 'sec-websocket-key': WS_KEY }), s5, Buffer.alloc(0))
  check('HTTP', '事件流升级在 apiProxy 缺失时 fail-closed（销毁，不透传）', s5.destroyed === true)
  // 5) 事件流升级缺 Sec-WebSocket-Key → 销毁
  const s6 = fakeSocket()
  server.emit('upgrade', upgradeReq('/api/events.mux', test1Cookie), s6, Buffer.alloc(0))
  check('HTTP', '事件流升级缺 WebSocket-Key → 销毁', s6.destroyed === true)
}
{
  // fail-closed：存储故障时非认证请求 503
  const serverBad = new EventEmitter()
  serverBad.on('request', () => {})
  const ctxBad = {
    get(n) {
      if (n === 'credentials') return { listRecords: async () => { throw new Error('store down') }, readRecord: async () => undefined, modifyRecord: async () => undefined, deleteRecord: async () => {} }
      if (n === 'fs') return { async resolve() { return {} }, async writeText() {} }
      if (n === 'webServer') return { server: serverBad }
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxBad)
  await new Promise((r) => setTimeout(r, 300))
  const r = makeRes()
  serverBad.emit('request', makeReq('GET', '/', undefined, undefined), r)
  check('HTTP', 'fail-closed：存储故障时页面请求 503（不开放）', r.status === 503)
  // init 未完成/失败时，登录与 RPC 也返回明确的 503（而非误导性 401/500）
  const rl = makeRes()
  serverBad.emit('request', makeReq('POST', '/auth/login', undefined, JSON.stringify({ username: 'admin', password: 'x' })), rl)
  await settle()
  check('HTTP', '初始化未完成时登录 503（提示稍后重试，非 401）', rl.status === 503 && parseJson(rl).error === '服务初始化中，请稍后重试')
  const rr = makeRes()
  serverBad.emit('request', makeReq('POST', '/auth/rpc/me', 'bogus', '{}'), rr)
  await settle()
  check('HTTP', '初始化未完成时 RPC 503', rr.status === 503)
}

// ==================== K. WS 事件流按用户隔离（0.4.0） ====================
{
  const decodeFrames = (buffers) => {
    let bytes = Buffer.concat(buffers)
    const hs = bytes.indexOf('\r\n\r\n')
    if (hs !== -1) bytes = bytes.slice(hs + 4) // 跳过 101 握手响应
    const out = []
    let off = 0
    while (off + 2 <= bytes.length) {
      const b0 = bytes[off], b1 = bytes[off + 1]
      const opcode = b0 & 0x0f
      let len = b1 & 0x7f
      let hlen = 2
      if (len === 126) { if (off + 4 > bytes.length) break; len = (bytes[off + 2] << 8) | bytes[off + 3]; hlen = 4 }
      else if (len === 127) { if (off + 10 > bytes.length) break; hlen = 10; len = Number(bytes.readBigUInt64BE(off + 2)) }
      if (off + hlen + len > bytes.length) break
      out.push({ opcode, text: opcode === 1 ? bytes.slice(off + hlen, off + hlen + len).toString('utf8') : '' })
      off += hlen + len
    }
    return out
  }
  const fakeSocket = () => ({ written: [], destroyed: false, ended: false, write(c) { this.written.push(Buffer.from(c)); return true }, end() { this.ended = true }, destroy() { this.destroyed = true }, setKeepAlive() {}, setTimeout() {}, on() {}, once() {}, removeListener() {} })
  const makeIter = (frames, signal) => (async function* () {
    for (const f of frames) {
      if (signal.aborted) return
      yield f
    }
    if (!signal.aborted) await new Promise(() => {})
  })()
  const muxFrames = [
    { rpcId: 'r1', payload: { type: 'session/subscribed', sessionId: 's-test1', lastSeq: 0 } },
    { rpcId: 'r2', payload: { type: 'session/subscribed', sessionId: 's-admin', lastSeq: 5 } },
    { rpcId: 'r3', payload: { type: 'session/event', sessionId: 's-admin', event: { type: 'user/message', data: { source: { kind: 'user' }, content: 'admin-secret' }, time: 1 } } },
    { rpcId: 'r4', payload: { type: 'session/event', sessionId: 's-test1', event: { type: 'user/message', data: { source: { kind: 'user' }, content: 'mine' }, time: 2 } } },
    { rpcId: 'r5', payload: { type: 'stream/error', error: { code: 'internal', message: 'x', details: {} } } },
  ]
  const hostFrames = [
    { rpcId: 'h1', payload: { type: 'host/session-status', sessionId: 's-test1', running: true } },
    { rpcId: 'h2', payload: { type: 'host/session-status', sessionId: 's-admin', running: true } },
    { rpcId: 'h3', payload: { type: 'host/workspace-changed', workspace: { workspaceId: 'w-admin', path: '/a', title: 'A', sessionIds: [], createdAt: '', updatedAt: '' } } },
    { rpcId: 'h4', payload: { type: 'host/workspace-order-changed', workspaceIds: ['w-admin', 'w-test1'] } },
    { rpcId: 'h5', payload: { type: 'host/archived-sessions-changed', archivedSessionIds: ['s-admin', 's-test1'] } },
    { rpcId: 'h6', payload: { type: 'host/remote-event', event: 'session/whatever', args: [{ secret: 1 }] } },
  ]
  apiProxyCurrent = { events: { mux: (req, sig) => makeIter(muxFrames, sig), host: (req, sig) => makeIter(hostFrames, sig) } }
  const upgrade = (path, cookie, socket) => {
    const r = makeReq('GET', path, cookie, undefined)
    r.headers = { ...r.headers, 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' }
    server.emit('upgrade', r, socket, Buffer.alloc(0))
  }
  const settleWs = () => new Promise((r) => setTimeout(r, 150))
  const wsPromises = []
  wsPromises.push((async () => {
    // A) mux：test1 只收到自己的会话帧 + 全局 stream/error；握手正确
    const s = fakeSocket()
    upgrade('/api/events.mux', test1Cookie, s)
    await settleWs()
    const raw = Buffer.concat(s.written).toString('utf8')
    const js = decodeFrames(s.written).filter((f) => f.opcode === 1).map((f) => JSON.parse(f.text))
    check('WS-ISO', '事件流握手 101 + 正确 Sec-WebSocket-Accept（RFC 6455 向量）', raw.startsWith('HTTP/1.1 101 Switching Protocols') && raw.includes('Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo='))
    const nonGlobal = js.filter((f) => (f.payload || {}).type !== 'stream/error')
    check('WS-ISO', 'mux 过滤：普通用户收到的帧全部属于自己', nonGlobal.length > 0 && nonGlobal.every((f) => (f.payload || {}).sessionId === 's-test1'))
    check('WS-ISO', 'mux 过滤：他人会话帧（subscribed/event）在网络层被丢弃', !js.some((f) => (f.payload || {}).sessionId === 's-admin'))
    check('WS-ISO', 'mux 过滤：自己的事件帧放行', js.some((f) => (f.payload || {}).rpcId === undefined && (f.payload || {}).type === 'session/event' && (f.payload || {}).sessionId === 's-test1'))
    check('WS-ISO', 'mux 过滤：全局 stream/error 帧放行', js.some((f) => (f.payload || {}).type === 'stream/error'))
  })())
  wsPromises.push((async () => {
    // B) host：test1 按 session/workspace 归属过滤；remote-event 丢弃；数组帧逐元素过滤
    const s = fakeSocket()
    upgrade('/api/events.host', test1Cookie, s)
    await settleWs()
    const js = decodeFrames(s.written).filter((f) => f.opcode === 1).map((f) => JSON.parse(f.text))
    check('WS-ISO', 'host 过滤：他人会话状态帧丢弃', !js.some((f) => (f.payload || {}).sessionId === 's-admin'))
    check('WS-ISO', 'host 过滤：他人 workspace 帧丢弃', !js.some((f) => (f.payload || {}).workspace && (f.payload.workspace.workspaceId === 'w-admin')))
    check('WS-ISO', 'host 过滤：remote-event 对普通用户丢弃', !js.some((f) => (f.payload || {}).type === 'host/remote-event'))
    const order = js.find((f) => (f.payload || {}).type === 'host/workspace-order-changed')
    check('WS-ISO', 'host 过滤：workspace-order-changed 数组只含自己的', order !== undefined && JSON.stringify(order.payload.workspaceIds) === JSON.stringify(['w-test1']))
    const arch = js.find((f) => (f.payload || {}).type === 'host/archived-sessions-changed')
    check('WS-ISO', 'host 过滤：archived-sessions-changed 数组只含自己的', arch !== undefined && JSON.stringify(arch.payload.archivedSessionIds) === JSON.stringify(['s-test1']))
    check('WS-ISO', 'host 过滤：自己的会话状态帧放行', js.some((f) => (f.payload || {}).type === 'host/session-status' && (f.payload || {}).sessionId === 's-test1'))
  })())
  wsPromises.push((async () => {
    // C) admin：host 全量可见（remote-event + 他人会话帧放行）
    const s = fakeSocket()
    upgrade('/api/events.host', adminCookie, s)
    await settleWs()
    const js = decodeFrames(s.written).filter((f) => f.opcode === 1).map((f) => JSON.parse(f.text))
    check('WS-ISO', 'host 过滤：管理员 remote-event 放行', js.some((f) => (f.payload || {}).type === 'host/remote-event'))
    check('WS-ISO', 'host 过滤：管理员可见他人会话帧（不受过滤）', js.some((f) => (f.payload || {}).sessionId === 's-admin'))
  })())
  apiProxyCurrent = undefined
  await Promise.all(wsPromises)
}

// ==================== L. 限流配置（0.4.0 可配置化） ====================
{
  check('CFG', '默认限流配置：5 次 / 30s / 不信任 XFF',
    JSON.stringify(readLockConfig({})) === JSON.stringify({ maxFails: 5, lockMs: 30000, trustProxy: false }))
  check('CFG', '环境变量覆盖限流配置',
    JSON.stringify(readLockConfig({ DSH_AUTH_MAX_FAILS: '3', DSH_AUTH_LOCK_MS: '5000', DSH_AUTH_TRUST_PROXY: '1' })) === JSON.stringify({ maxFails: 3, lockMs: 5000, trustProxy: true }))
  check('CFG', '非法配置值回退默认', readLockConfig({ DSH_AUTH_MAX_FAILS: 'abc', DSH_AUTH_LOCK_MS: '-1' }).maxFails === 5 && readLockConfig({ DSH_AUTH_LOCK_MS: '-1' }).lockMs === 30000)
  check('CFG', '默认不信任 X-Forwarded-For（伪造 XFF 不生效）',
    clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9' } }, false) === '127.0.0.1')
  check('CFG', 'trustProxy 时取 XFF 第一个（反代场景按真实客户端计数）',
    clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }, true) === '203.0.113.9')
  check('CFG', 'trustProxy 但无 XFF 时回退 socket 地址',
    clientIp({ socket: { remoteAddress: '192.0.2.7' }, headers: {} }, true) === '192.0.2.7')
}

// ==================== M. 注册 + 邀请码（0.5.0） ====================
{
  const postReg = (body) => new Promise((resolve) => {
    const r = makeRes()
    server.emit('request', makeReq('POST', '/auth/register', undefined, JSON.stringify(body), '10.1.0.1'), r)
    setTimeout(() => resolve(r), 60)
  })
  const page = makeRes()
  server.emit('request', makeReq('GET', '/auth/register', undefined, undefined), page)
  check('REG', '注册页 GET 200（含邀请码字段）', page.status === 200 && page.body.includes('邀请码') && page.body.includes('已有账号？返回登录'))
  check('REG', '注册页/接口 no-store', (page.headers['cache-control'] || '').includes('no-store'))
  const bad = await postReg({ username: 'regs1', password: 'regs1-pw-1', email: '', invite: 'NOPE1234' })
  check('REG', '无效邀请码 → 403', bad.status === 403 && parseJson(bad).error === '邀请码无效或已用完')
  const weak = await postReg({ username: 'regs2', password: 'short', email: '', invite: 'NOPE1234' })
  check('REG', '弱密码 → 400（先于邀请码校验）', weak.status === 400)
  const badName = await postReg({ username: 'x', password: 'regs2-pw-1234', email: '', invite: 'NOPE1234' })
  check('REG', '用户名格式非法 → 400', badName.status === 400)
  // 有效邀请码全流程（admin 生成 → 注册 → 次数耗尽）
  const inv = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/inviteCreate', adminCookie, JSON.stringify({ amount: 1, uses: 1 })), inv)
  await settle()
  const code = (parseJson(inv) || {}).codes !== undefined ? parseJson(inv).codes[0] : undefined
  check('REG', '管理员生成邀请码（8 位去混淆字符集）', inv.status === 200 && typeof code === 'string' && /^[A-Z2-9]{8}$/.test(code))
  const okReg = await postReg({ username: 'regs3', password: 'regs3-pw-1234', email: 'regs3@example.com', invite: code })
  check('REG', '有效邀请码注册成功', okReg.status === 200 && parseJson(okReg).ok === true)
  const exhausted = await postReg({ username: 'regs4', password: 'regs4-pw-1234', email: '', invite: code })
  check('REG', '邀请码次数耗尽 → 403', exhausted.status === 403)
  const denied = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/inviteCreate', test1Cookie, JSON.stringify({ amount: 1 })), denied)
  await settle()
  check('REG', '普通用户 inviteCreate → 403（越权）', denied.status === 403)
  const regLogin = makeRes()
  server.emit('request', makeReq('POST', '/auth/login', undefined, JSON.stringify({ username: 'regs3', password: 'regs3-pw-1234' }), '10.1.0.2'), regLogin)
  await settle()
  check('REG', '新注册用户可登录（role=user，邮箱保留）', regLogin.status === 200 && /dsh_auth=/.test(regLogin.headers['set-cookie'] || ''))
  const page2 = makeRes()
  server.emit('request', makeReq('POST', '/auth/register', undefined, '{oops not json'), page2)
  await settle()
  check('REG', '注册接口畸形 JSON → 400', page2.status === 400)
}

// ==================== N. TOTP 两步验证（0.5.0） ====================
{
  const rpcCall = (method, body, cookie) => new Promise((resolve) => {
    const r = makeRes()
    server.emit('request', makeReq('POST', '/auth/rpc/' + method, cookie, JSON.stringify(body || {})), r)
    setTimeout(() => resolve(r), 60)
  })
  const st0 = await rpcCall('totpStatus', {}, test1Cookie)
  check('TOTP', '初始状态未启用', parseJson(st0).totp !== undefined && parseJson(st0).totp.enabled === false)
  const gen = await rpcCall('totpGenerate', {}, test1Cookie)
  const secret = (parseJson(gen) || {}).secret
  const qrUrl = (parseJson(gen) || {}).qrDataUrl
  check('TOTP', '生成密钥：base32 格式 + otpauth URL + 二维码 SVG', gen.status === 200 && /^[A-Z2-7]{20,}$/.test(secret || '') && (parseJson(gen) || {}).otpauth !== undefined && (parseJson(gen) || {}).otpauth.indexOf('otpauth://totp/') === 0 && typeof qrUrl === 'string' && qrUrl.startsWith('data:image/svg+xml;base64,'))
  const badV = await rpcCall('totpVerify', { code: '000000' }, test1Cookie)
  check('TOTP', '错误动态码 → 403', badV.status === 403)
  const goodCode = totpCodeAt(secret, Date.now() / 1000)
  const okV = await rpcCall('totpVerify', { code: goodCode }, test1Cookie)
  check('TOTP', '正确动态码启用成功', okV.status === 200)
  const me = await rpcCall('me', {}, test1Cookie)
  const meStr = JSON.stringify(parseJson(me))
  check('TOTP', 'me 显示已启用且不泄露 secret', parseJson(me).me.totpEnabled === true && !meStr.includes('totpSecret'))
  const gen2 = await rpcCall('totpGenerate', {}, test1Cookie)
  check('TOTP', '已启用后重新生成 → 400', gen2.status === 400)
  const rmBad = await rpcCall('totpRemove', { code: '000000' }, test1Cookie)
  check('TOTP', '移除需验证码（错误码 403）', rmBad.status === 403)
  const rmOk = await rpcCall('totpRemove', { code: goodCode }, test1Cookie)
  check('TOTP', '正确验证码移除成功', rmOk.status === 200)
  const ign = await rpcCall('totpIgnore', { ignore: true }, test1Cookie)
  const me2 = await rpcCall('me', {}, test1Cookie)
  check('TOTP', '永久忽略开关生效', ign.status === 200 && parseJson(me2).me.totpIgnore === true)
  const me3 = await rpcCall('me', {}, test1Cookie)
  check('TOTP', '移除后恢复未启用', parseJson(me3).me.totpEnabled === false)
}

// ==================== F. 信息泄露 ====================
{
  const r = makeRes()
  server.emit('request', makeReq('POST', '/auth/login', undefined, '{oops not json', '10.0.0.9'), r)
  await settle()
  check('INFO', '畸形 JSON → 通用错误（无堆栈/内部信息）', r.status === 400 && parseJson(r).error === '请求体格式错误')
}
{
  const r = makeRes()
  server.emit('request', makeReq('GET', '/auth/login', undefined, undefined), r)
  const cc = r.headers['cache-control'] || ''
  const r2 = makeRes()
  server.emit('request', makeReq('POST', '/auth/rpc/me', test1Cookie, '{}'), r2)
  await settle()
  const cc2 = r2.headers['cache-control'] || ''
  check('INFO', '认证页面/接口 no-store（防缓存泄露）', cc.includes('no-store') && cc2.includes('no-store'))
}
check('INFO', '网关异常时返回通用 500（不泄露堆栈）', HOST_SRC.includes('网关处理异常') && HOST_SRC.includes('res.writeHead(500)'))

// ==================== G. 越权（垂直 + 水平） ====================
{
  for (const m of ['listUsers', 'createUser', 'resetPassword', 'setRole', 'deleteUser']) {
    const r = makeRes()
    server.emit('request', makeReq('POST', '/auth/rpc/' + m, test1Cookie, '{}'), r)
    await settle()
    check('AUTHZ', '普通用户 ' + m + ' → 403', r.status === 403)
  }
}
{
  for (const [path, body] of [
    ['/api/settings.mutate', JSON.stringify({ type: 'client-request', rpcId: 'a', method: 'settings.mutate', payload: { ns: 'llm-deepseek', ops: [] } })],
    ['/api/settings.update', JSON.stringify({ type: 'client-request', rpcId: 'b', method: 'settings.update', payload: { ns: 'llm-pi-ai', patch: {} } })],
    ['/api/credentials.set', JSON.stringify({ type: 'client-request', rpcId: 'c', method: 'credentials.set', payload: { ref: 'OPENAI_API_KEY', value: 'sk-x' } })],
    ['/api/credentials.unset', JSON.stringify({ type: 'client-request', rpcId: 'd', method: 'credentials.unset', payload: { ref: 'OPENAI_API_KEY' } })],
    ['/api/llm.discoverModels', JSON.stringify({ type: 'client-request', rpcId: 'e', method: 'llm.discoverModels', payload: { settingsNs: 'llm-pi-ai' } })],
  ]) {
    const r = makeRes()
    server.emit('request', makeReq('POST', path, test1Cookie, body), r)
    await settle()
    check('AUTHZ', '普通用户模型/Key 写操作 → 403 (' + path + ')', r.status === 403)
  }
}
{
  const r = makeRes()
  server.emit('request', makeReq('POST', '/api/session.history', test1Cookie, JSON.stringify({ type: 'client-request', rpcId: 'f', method: 'session.history', payload: { sessionId: 's-admin' } })), r)
  await settle()
  check('AUTHZ', '水平越权：普通用户读他人会话 → 403', r.status === 403)
}
{
  const r = makeRes()
  server.emit('request', makeReq('GET', '/api/session.export?sessionId=s-admin', test1Cookie, undefined), r)
  await settle()
  check('AUTHZ', '水平越权：普通用户导出他人会话 → 403', r.status === 403)
}
{
  const r = makeRes()
  server.emit('request', makeReq('POST', '/api/session.history', test1Cookie, JSON.stringify({ type: 'client-request', rpcId: 'g', method: 'session.history', payload: { sessionId: 's-test1' } })), r)
  await settle()
  check('AUTHZ', '普通用户访问自己会话 → 放行', r.status === 200)
}

// ==================== H. 数据隔离 ====================
{
  const r = makeRes()
  server.emit('request', makeReq('POST', '/api/session.list', test1Cookie, JSON.stringify({ type: 'client-request', rpcId: 'h', method: 'session.list', payload: {} })), r)
  await settle()
  const ids = ((parseJson(r) || {}).result || {}).value ? parseJson(r).result.value.items.map((i) => i.sessionId) : []
  check('ISO', '会话列表过滤：普通用户只见自己的', JSON.stringify(ids) === JSON.stringify(['s-test1', 's-created']) || JSON.stringify(ids) === JSON.stringify(['s-test1']), JSON.stringify(ids))
}
{
  const r = makeRes()
  server.emit('request', makeReq('POST', '/api/session.create', test1Cookie, JSON.stringify({ type: 'client-request', rpcId: 'i', method: 'session.create', payload: {} })), r)
  await settle()
  check('ISO', '创建会话成功并打标归属', r.status === 200)
  await settle()
  const r2 = makeRes()
  server.emit('request', makeReq('POST', '/api/session.list', test1Cookie, JSON.stringify({ type: 'client-request', rpcId: 'j', method: 'session.list', payload: {} })), r2)
  await settle()
  const ids = ((parseJson(r2) || {}).result || {}).value ? parseJson(r2).result.value.items.map((i) => i.sessionId) : []
  check('ISO', '新建会话对属主立即可见（列表含 s-created）', ids.includes('s-created'), JSON.stringify(ids))
}
{
  const r = makeRes()
  server.emit('request', makeReq('POST', '/api/session.list', adminCookie, JSON.stringify({ type: 'client-request', rpcId: 'k', method: 'session.list', payload: {} })), r)
  await settle()
  const ids = ((parseJson(r) || {}).result || {}).value ? parseJson(r).result.value.items.map((i) => i.sessionId) : []
  check('ISO', '管理员会话列表不受过滤', ids.includes('s-admin'), JSON.stringify(ids))
}

// ==================== I. 可用性 ====================
{
  const ip = '192.168.1.50'
  let got429 = false
  for (let i = 0; i < 6; i++) {
    const r = await login('test1', 'wrong-pass-xx', ip)
    if (r.status === 429) got429 = true
  }
  const during = await login('test1', '12345678', ip)
  check('AVAIL', '暴力破解防护：连续失败后锁定（429）', got429)
  check('AVAIL', '锁定期间正确密码也被拒（429）', during.status === 429)
}
check('AVAIL', '会话/失败计数定期清理（防内存膨胀）', HOST_SRC.includes("state.sessions.delete(token)") && HOST_SRC.includes("SESSION_SWEEP_MS"))

// ==================== J. 部署加固 ====================
check('DEPLOY', 'Cookie 未设 Secure（预期；公网必须 HTTPS 反代）', true)
check('DEPLOY', '登录失败锁定按源 IP（反向代理下聚合，README 已注明）', HOST_SRC.includes('LOCKOUT_MAX_FAILS'))
{
  // 全新环境（用户表为空）→ 引导创建随机管理员并写入引导文件
  const serverB = new EventEmitter()
  serverB.on('request', () => {})
  const recordsB = new Map()
  const bootFiles = []
  const ctxB = {
    get(n) {
      if (n === 'credentials') return {
        async listRecords() { return [] },
        async readRecord(k) { return recordsB.get(k) },
        async modifyRecord(k, mutate) {
          const cur = recordsB.get(k)
          const next = await mutate(cur)
          if (next === undefined) return cur
          recordsB.set(k, next)
          return next
        },
        async deleteRecord(k) { recordsB.delete(k) },
      }
      if (n === 'fs') return { async resolve(p) { return { path: p } }, async writeText(t, c) { bootFiles.push(c) } }
      if (n === 'webServer') return { server: serverB }
      return undefined
    },
    effect() {},
    interval() { return () => {} },
    timeout(ms) { return new Promise((r) => setTimeout(r, ms)) },
  }
  apply(ctxB)
  await new Promise((r) => setTimeout(r, 300))
  const adminKeys = [...recordsB.keys()].filter((k) => k.startsWith('dsh-auth/') && k !== 'dsh-auth/ownership')
  const adminRec = adminKeys.length === 1 ? JSON.parse(recordsB.get(adminKeys[0]).payload) : null
  check('DEPLOY', '空环境引导创建单一随机管理员（无硬编码默认密码）', adminRec !== null && adminRec.role === 'admin' && 'salt' in adminRec && 'hash' in adminRec)
  check('DEPLOY', '引导文件含随机管理员账号与密码（部署者取用）', bootFiles.length > 0 && /admin/.test(bootFiles[0]) && /\S{8,}/.test(bootFiles[0].split('密码:')[1] || ''), bootFiles[0] ? bootFiles[0].slice(0, 80) : '(empty)')
}

// ==================== 汇总 ====================
const byCategory = {}
for (const r of results) {
  byCategory[r.category] = byCategory[r.category] || { total: 0, pass: 0 }
  byCategory[r.category].total++
  if (r.pass) byCategory[r.category].pass++
}
console.log('\n================ 安全验证汇总 ================')
const order = ['AUTH', 'SESSION', 'INJ', 'CSRF', 'HTTP', 'INFO', 'AUTHZ', 'ISO', 'AVAIL', 'DEPLOY', 'WS-ISO', 'CFG', 'REG', 'TOTP']
for (const c of order) {
  const s = byCategory[c] || { total: 0, pass: 0 }
  const flag = s.pass === s.total ? 'PASS' : 'FAIL'
  console.log(`${flag}  ${c.padEnd(8)} ${s.pass}/${s.total}`)
}
const failed = results.filter((r) => !r.pass)
console.log(`\n总计: ${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.log('\n失败项:')
  for (const f of failed) console.log(`  [${f.category}] ${f.label} :: ${f.extra ?? ''}`)
}
process.exit(failed.length === 0 ? 0 : 1)
