// ============================================================================
// live-totp-check.mjs —— 真实部署 TOTP 验证（0.5.0）
// 需要：面板以 0.5.0（含 TOTP）运行；test1/12345678 可登录。
// 验证：totpStatus → totpGenerate（secret）→ 用 RFC 6238 实现生成动态码 →
//       totpVerify 启用 → me.totpEnabled → totpRemove 移除（清理状态）。
// 运行：node test/live-totp-check.mjs
// ============================================================================
import http from 'node:http'
import { totpCodeAt } from '../lib/index.js'

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (label, ok, extra) => { results.push({ label, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra !== undefined ? ' :: ' + extra : '')) }

const main = async () => {
  // 登录 test1（带 init 重试）
  let cookie
  for (let i = 0; i < 15 && cookie === undefined; i++) {
    const login = await post('/auth/login', { username: 'test1', password: '12345678' })
    const sc = login.headers !== undefined ? login.headers['set-cookie'] || '' : ''
    const m = /dsh_auth=([^;]+)/.exec(sc)
    if (login.status === 200 && m !== null) cookie = m[1]
    if (cookie === undefined) await sleep(4000)
  }
  check('登录 test1 成功', cookie !== undefined)
  if (cookie === undefined) process.exit(1)
  const rpc = (method, body) => post('/auth/rpc/' + method, body || {}, cookie)
  const st0 = JSON.parse((await rpc('totpStatus')).body)
  check('初始状态未启用', st0.totp !== undefined && st0.totp.enabled === false, JSON.stringify(st0.totp))
  const gen = JSON.parse((await rpc('totpGenerate')).body)
  check('生成密钥（base32 + 二维码 SVG）', /^[A-Z2-7]{20,}$/.test(gen.secret || '') && typeof gen.otpauth === 'string' && gen.otpauth.indexOf('otpauth://totp/') === 0 && typeof gen.qrDataUrl === 'string' && gen.qrDataUrl.startsWith('data:image/svg+xml;base64,'))
  const code = totpCodeAt(gen.secret, Date.now() / 1000)
  const v = await rpc('totpVerify', { code: code })
  check('正确动态码启用成功', v.status === 200, 'status=' + v.status)
  const me = JSON.parse((await rpc('me')).body)
  check('me.totpEnabled=true 且不泄露 secret', me.me.totpEnabled === true && !JSON.stringify(me).includes('totpSecret'))
  // 清理：移除 TOTP（不留绑定状态）
  const rm = await rpc('totpRemove', { code: code })
  const me2 = JSON.parse((await rpc('me')).body)
  check('移除后恢复未启用（清理完成）', rm.status === 200 && me2.me.totpEnabled === false)
  const failed = results.filter((r) => !r.ok)
  console.log('\nLIVE TOTP CHECK: ' + (results.length - failed.length) + '/' + results.length + ' passed')
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('LIVE TOTP CHECK ERROR: ' + String(e)); process.exit(1) })
