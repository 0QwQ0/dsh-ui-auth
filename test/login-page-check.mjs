// Login-page and passkey-endpoint wiring check: boots the deployed lib/index.js against
// mock cordis services, then asserts the rendered login page and the anonymous passkey
// endpoints behave correctly for each kind of origin.
//
// Why this test exists: the login page's WebAuthn code is an inline classic script, so a
// single brace mistake silently disables the whole form (the page then falls back to a
// native GET submit). Parsing the served script here catches that class of bug offline.
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import { apply } from '../lib/index.js'

let failures = 0
function check(label, cond, extra) {
  if (cond) { console.log('PASS ' + label) } else { failures++; console.error('FAIL ' + label + (extra !== undefined ? ' :: ' + extra : '')) }
}

// ---- fake http server + mock services (same shape as test/host-smoke.mjs) ----
const server = new EventEmitter()
server.on('request', () => {})

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
const fsFiles = new Map()
const fsMock = {
  async resolve(p) { return { path: p } },
  async writeText(target, content) { fsFiles.set(target.path, content) },
  async readText(target) { const v = fsFiles.get(target.path); if (v === undefined) throw Object.assign(new Error('not found'), { code: 'FS_NOT_FOUND' }); return v },
  async unlink(target) { fsFiles.delete(target.path) },
}
const ctx = {
  get(name) {
    if (name === 'credentials') return creds
    if (name === 'fs') return fsMock
    if (name === 'webServer') return { server }
    return undefined
  },
  effect() {},
  interval() { return () => {} },
}

function makeReq(method, url, body, host) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: host ?? 'localhost:3080' }
  req.socket = { remoteAddress: '127.0.0.1' }
  req.destroy = () => {}
  const chunks = body !== undefined ? [Buffer.from(body)] : []
  req[Symbol.asyncIterator] = () => {
    let i = 0
    return { next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }) }
  }
  if (body !== undefined) process.nextTick(() => { req.emit('data', Buffer.from(body)); req.emit('end') })
  return req
}
function makeRes() {
  const res = { headersSent: false, status: 0, headers: {}, body: '' }
  res.writeHead = (s, h) => { res.status = s; Object.assign(res.headers, h || {}); res.headersSent = true }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.write = (b) => { res.body += (b === undefined ? '' : String(b)); return true }
  res.end = (b) => { if (b !== undefined) res.body += String(b); res.ended = true }
  res.destroy = () => {}
  return res
}
const settle = (ms = 0) => ms > 0 ? new Promise((r) => setTimeout(r, ms)) : new Promise((r) => setImmediate(r))
async function call(method, url, body, host, waitMs = 0) {
  const res = makeRes()
  server.emit('request', makeReq(method, url, body, host), res)
  await settle(waitMs)
  return res
}
const json = (res) => { try { return JSON.parse(res.body) } catch (e) { return {} } }

apply(ctx)
await new Promise((r) => setTimeout(r, 300))

// ---- 1) login page on a usable origin (localhost) ----
const page = await call('GET', '/auth/login', undefined, 'localhost:3080')
check('GET /auth/login (localhost) → 200 html', page.status === 200 && (page.headers['content-type'] || '').includes('text/html'), `status=${page.status}`)
check('登录页提供通行密钥按钮与浏览器端脚本', page.body.includes('id="pk"') && page.body.includes('src="/auth/passkey/browser.js"'))
check('登录页不再宣传免密 TOTP 登录', !page.body.includes('免密') && !page.body.includes('密码留空'))

const inline = /<script>([\s\S]*?)<\/script><\/body>/.exec(page.body)
check('登录页存在内联脚本', inline !== null)
if (inline !== null) {
  let parsed = true
  let detail = ''
  try { new vm.Script(inline[1], { filename: 'login-inline.js' }) } catch (e) { parsed = false; detail = String(e && e.message) }
  check('登录页内联脚本可解析（括号/语法正确）', parsed, detail)
  check('内联脚本接入通行密钥与密码两条登录路径',
    inline[1].includes('passkeyLogin') && inline[1].includes('passkeyRequired') && inline[1].includes('totpRequired'))
}

// ---- 2) login page on an impossible origin (loopback IP literal) ----
const ipPage = await call('GET', '/auth/login', undefined, '127.0.0.1:3080')
check('GET /auth/login (127.0.0.1) 不注入通行密钥按钮与脚本',
  !ipPage.body.includes('id="pk"') && !ipPage.body.includes('passkey/browser.js'))
check('IP 字面量地址给出可操作提示', ipPage.body.includes('localhost') && ipPage.body.includes('IP 地址'))

// ---- 3) passkey browser script endpoint ----
const script = await call('GET', '/auth/passkey/browser.js', undefined, undefined, 150)
check('GET /auth/passkey/browser.js → 200 + etag',
  script.status === 200 && (script.headers['content-type'] || '').includes('javascript') && (script.headers.etag || '').length > 0,
  `status=${script.status}`)
check('浏览器端脚本含注册/登录入口', script.body.includes('startRegistration') || script.body.includes('startAuthentication'))
const notModified = await call('GET', '/auth/passkey/browser.js', undefined, undefined, 150)
check('重复请求返回同一产物（可缓存）', notModified.body.length === script.body.length, `${script.body.length} vs ${notModified.body.length}`)

// ---- 4) anonymous login options: rejected on an impossible origin, issued on a usable one ----
const ipOptions = await call('POST', '/auth/passkey/login/options', '{}', '127.0.0.1:3080')
const ipOptionsJson = json(ipOptions)
check('IP 字面量地址取登录选项 → 409 + issue/suggestedHost',
  ipOptions.status === 409 && ipOptionsJson.issue === 'ip-literal' && ipOptionsJson.suggestedHost === 'localhost',
  `status=${ipOptions.status} body=${ipOptions.body.slice(0, 100)}`)

const lanOptions = await call('POST', '/auth/passkey/login/options', '{}', '192.168.1.20:3080')
check('局域网 IP 地址取登录选项 → 409（IP 不能作为 RP ID，提示改用域名 + HTTPS）',
  lanOptions.status === 409 && json(lanOptions).issue === 'ip-literal' && /HTTPS/.test(json(lanOptions).error || ''),
  `issue=${json(lanOptions).issue} error=${json(lanOptions).error}`)

const options = await call('POST', '/auth/passkey/login/options', '{}', 'localhost:3080')
const optionsJson = json(options)
check('localhost 取登录选项 → 200 + 挑战句柄',
  options.status === 200 && optionsJson.ok === true && typeof optionsJson.handle === 'string' && typeof optionsJson.options.challenge === 'string',
  `status=${options.status}`)
check('登录选项要求用户验证且绑定 rpId', optionsJson.options !== undefined
  && optionsJson.options.userVerification === 'required' && optionsJson.options.rpId === 'localhost',
  JSON.stringify(optionsJson.options && { rpId: optionsJson.options.rpId, uv: optionsJson.options.userVerification }))

// ---- 5) login with a bogus assertion: generic failure, no crash, no session ----
const bogus = await call('POST', '/auth/passkey/login', JSON.stringify({ handle: optionsJson.handle, response: { id: 'nope', rawId: 'nope', type: 'public-key', response: {} } }), 'localhost:3080')
check('伪造断言登录 → 401/403 且不下发会话',
  (bogus.status === 401 || bogus.status === 403) && bogus.headers['set-cookie'] === undefined,
  `status=${bogus.status} body=${bogus.body.slice(0, 80)}`)

// ---- 6) management surface requires a session ----
const list = await call('POST', '/auth/rpc/passkeyList', '{}', 'localhost:3080')
check('未登录 passkeyList → 401', list.status === 401, `status=${list.status}`)
const scriptMethod = await call('POST', '/auth/passkey/browser.js', '{}')
check('通行密钥脚本仅允许 GET/HEAD → 405', scriptMethod.status === 405, `status=${scriptMethod.status}`)

console.log(failures === 0 ? '\nLOGIN PAGE + PASSKEY ENDPOINT CHECK PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
