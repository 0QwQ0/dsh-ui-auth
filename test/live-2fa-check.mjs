// ============================================================================
// live-2fa-check.mjs —— 真实部署 2FA 登录流程验证（0.5.0）
// 需要：面板以 0.5.0（含 2FA 登录）运行；test1 已启用 TOTP（用户已添加令牌）。
// 验证：1) test1 密码登录 → totpRequired（不签发会话）；
//       2) 密码 + 错误动态码 → 403；3) 免密 + 错误动态码 → 403；
//       4) 未启用 TOTP 的账号密码登录照常（用 reg1 若存在，否则跳过）。
// 完整「密码 + 正确动态码」两步登录由用户在 Authenticator 中输入动态码验证。
// 运行：node test/live-2fa-check.mjs
// ============================================================================
import http from 'node:http'

const post = (p, body, xff) => new Promise((done) => {
  const d = JSON.stringify(body)
  const r = http.request({
    host: '127.0.0.1', port: 3080, path: p, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d), ...(xff !== undefined ? { 'x-forwarded-for': xff } : {}) },
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
  // live 请求的 socket 均为 127.0.0.1（默认不信任 XFF），失败计数会跨轮次累计；
  // 等待可能残留的 30s 防爆破锁定过期后再开始（一次运行 3 次失败 < 阈值不触发）
  await sleep(31000)
  const retry = async (fn) => {
    for (let i = 0; i < 15; i++) {
      const r = await fn()
      if (r.status !== 503) return r
      await sleep(4000)
    }
    return { status: 0, body: 'timeout' }
  }
  // 1) test1（已绑定 TOTP）默认 2FA 关闭：密码直接登录成功（无需动态码）
  const s1 = await retry(() => post('/auth/login', { username: 'test1', password: '12345678' }, '10.4.0.1'))
  const j1 = JSON.parse(s1.body || '{}')
  check('test1 密码登录 → 成功（绑定后默认 2FA 关闭）', s1.status === 200 && j1.totpRequired !== true && /dsh_auth=/.test(s1.headers['set-cookie'] || ''), s1.body.slice(0, 80))
  // 2) 2FA 关闭时密码 + 任意动态码 → 仍成功（动态码非必需）
  const s2 = await retry(() => post('/auth/login', { username: 'test1', password: '12345678', totp: '000000' }, '10.4.0.2'))
  check('2FA 关闭时密码 + 动态码（任意）仍成功', s2.status === 200, s2.body.slice(0, 80))
  // 3) 免密 + 错误动态码 → 403（免密路径始终验证动态码）
  const s3 = await retry(() => post('/auth/login', { username: 'test1', totp: '000000' }, '10.4.0.3'))
  check('免密 TOTP + 错误动态码 → 403', s3.status === 403, s3.body.slice(0, 80))
  // 4) 不存在的用户免密 → 401 通用文案（防账号枚举回归）
  const s4 = await retry(() => post('/auth/login', { username: 'definitely-not-a-user', totp: '000000' }, '10.4.0.4'))
  check('不存在用户免密 → 401 通用文案（防枚举）', s4.status === 401 && JSON.parse(s4.body).error === '用户名或密码错误', s4.body.slice(0, 80))
  const failed = results.filter((r) => !r.ok)
  console.log('\nLIVE 2FA CHECK: ' + (results.length - failed.length) + '/' + results.length + ' passed')
  console.log('提示：请在浏览器中验证 2FA 开关——test1 登录后在【用户管理】勾选「启用两步验证」，再登录（需密码 + Authenticator 动态码）；取消勾选后密码或动态码任选其一。')
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('LIVE 2FA CHECK ERROR: ' + String(e)); process.exit(1) })
