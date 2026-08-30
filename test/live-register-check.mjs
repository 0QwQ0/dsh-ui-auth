// ============================================================================
// live-register-check.mjs —— 真实部署注册功能验证（0.5.0）
// 需要：面板以 0.5.0（含注册/邀请码）运行。
// 验证公开注册端点：注册页可达、无效邀请码 403、弱密码 400、用户名格式 400、
// 畸形 JSON 400、未认证下 GET 注册页 200。
// （有效邀请码完整注册链路由 host-smoke 场景 18 覆盖；真实部署需管理员在
//   【用户管理】→【邀请码管理】生成后配合验证。）
// 运行：node test/live-register-check.mjs
// ============================================================================
import http from 'node:http'

const post = (p, body, raw) => new Promise((done) => {
  const d = raw !== undefined ? raw : JSON.stringify(body)
  const r = http.request({
    host: '127.0.0.1', port: 3080, path: p, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d) },
  }, (res) => {
    let b = ''
    res.on('data', (c) => { b += c })
    res.on('end', () => done({ status: res.statusCode, body: b, headers: res.headers }))
  })
  r.on('error', (e) => done({ status: 0, body: String(e) }))
  r.end(d)
})
const get = (p) => new Promise((done) => {
  const r = http.request({ host: '127.0.0.1', port: 3080, path: p }, (res) => {
    let b = ''
    res.on('data', (c) => { b += c })
    res.on('end', () => done({ status: res.statusCode, body: b, headers: res.headers }))
  })
  r.on('error', (e) => done({ status: 0, body: String(e) }))
  r.end()
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (label, ok, extra) => { results.push({ label, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra !== undefined ? ' :: ' + extra : '')) }

const main = async () => {
  // 等待 init（启动竞态：GET 注册页不检查 ready，POST 会返回 503，故 POST 也重试）
  const retryPost = async (body, raw) => {
    for (let i = 0; i < 15; i++) {
      const r = await post('/auth/register', body, raw)
      if (r.status !== 503) return r
      await sleep(4000)
    }
    return { status: 0, body: 'timeout' }
  }
  let page
  for (let i = 0; i < 15 && (page === undefined || page.status !== 200); i++) {
    page = await get('/auth/register')
    if (page.status !== 200) await sleep(4000)
  }
  check('注册页可达（未认证 200）', page.status === 200 && page.body.includes('邀请码'))
  check('注册页 no-store', (page.headers['cache-control'] || '').includes('no-store'))
  const bad = await retryPost({ username: 'live-reg', password: 'live-reg-pw1', email: '', invite: 'NOPE1234' })
  check('无效邀请码 → 403', bad.status === 403 && JSON.parse(bad.body).error === '邀请码无效或已用完', bad.body.slice(0, 80))
  const weak = await retryPost({ username: 'live-reg2', password: 'short', email: '', invite: 'NOPE1234' })
  check('弱密码 → 400', weak.status === 400)
  const badName = await retryPost({ username: 'x', password: 'live-reg3-pw', email: '', invite: 'NOPE1234' })
  check('用户名格式非法 → 400', badName.status === 400)
  const malformed = await retryPost(undefined, '{oops not json')
  check('畸形 JSON → 400', malformed.status === 400)
  // 注册成功引导页：未登录访问 → 302 登录页
  const guide = await get('/auth/register/success')
  check('引导页未登录 → 302 登录页', guide.status === 302 && (guide.headers.location || '').startsWith('/auth/login'), 'status=' + guide.status)
  const failed = results.filter((r) => !r.ok)
  console.log('\nLIVE REGISTER CHECK: ' + (results.length - failed.length) + '/' + results.length + ' passed')
  console.log('提示：有效邀请码的完整注册链路（注册 → 自动登录 → TOTP 引导页）需管理员在【用户管理】→【邀请码管理】生成后验证。')
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('LIVE REGISTER CHECK ERROR: ' + String(e)); process.exit(1) })
