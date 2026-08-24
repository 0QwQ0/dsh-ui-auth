// ============================================================================
// live-session-check.mjs —— 真实部署会话持久化验证（0.4.0：重启不掉线）
// 两阶段（跨面板重启）：
//   save   —— 登录 test1，把 cookie 写入 %TEMP%\dsh-session-cookie.txt 并确认当前可用
//   verify —— 读回 cookie，请求 /auth/rpc/me，断言 200（免登录恢复）
// 用法：node test/live-session-check.mjs save | verify
// ============================================================================
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const COOKIE_FILE = path.join(os.tmpdir(), 'dsh-session-cookie.txt')
const post = (p, body, cookie) => new Promise((done) => {
  const d = JSON.stringify(body)
  const r = http.request({
    host: '127.0.0.1', port: 3080, path: p, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d), ...(cookie !== undefined ? { cookie: 'dsh_auth=' + cookie } : {}) },
  }, (res) => {
    let b = ''
    res.on('data', (c) => { b += c })
    res.on('end', () => done({ status: res.statusCode, body: b, headers: res.headers }))
  })
  r.on('error', (e) => done({ status: 0, body: String(e) }))
  r.end(d)
})

const mode = process.argv[2]
// 面板启动早期 init（acquireCredentials 竞态）可能未完成：登录/RPC 会返回 503，
// 因此两个阶段都带重试，直到 init 完成或超时。
const retry = async (fn, tries = 15, gapMs = 4000) => {
  for (let i = 0; i < tries; i++) {
    const out = await fn()
    if (out.ok) return out
    await new Promise((r) => setTimeout(r, gapMs))
  }
  return null
}
const main = async () => {
  if (mode === 'save') {
    const r = await retry(async () => {
      const login = await post('/auth/login', { username: 'test1', password: '12345678' })
      const sc = login.headers !== undefined ? login.headers['set-cookie'] || '' : ''
      const m = /dsh_auth=([^;]+)/.exec(sc)
      if (m === null) return { ok: false, status: login.status }
      const me = await post('/auth/rpc/me', {}, m[1])
      return { ok: me.status === 200, status: login.status, me: me.status, token: m[1] }
    })
    console.log('save: login status=' + (r !== null ? r.status : 'timeout') + ' me=' + (r !== null ? r.me : 'n/a'))
    if (r === null) process.exit(1)
    fs.writeFileSync(COOKIE_FILE, r.token)
    console.log('save: cookie persisted, session verified before restart')
    process.exit(0)
  } else if (mode === 'verify') {
    const r = await retry(async () => {
      if (!fs.existsSync(COOKIE_FILE)) return { ok: false }
      const cookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim()
      const me = await post('/auth/rpc/me', {}, cookie)
      return { ok: me.status === 200, status: me.status, body: me.body }
    })
    console.log('verify: me after restart status=' + (r !== null ? r.status : 'timeout') + ' body=' + (r !== null ? r.body.slice(0, 80) : 'n/a'))
    process.exit(r !== null && r.ok ? 0 : 1)
  } else {
    console.log('usage: node live-session-check.mjs save|verify')
    process.exit(2)
  }
}
main().catch((e) => { console.error('LIVE SESSION CHECK ERROR: ' + String(e)); process.exit(1) })
