// ============================================================================
// live-lock-check.mjs —— 真实部署限流配置验证（0.4.0 可配置化）
// 需要：面板以 DSH_AUTH_MAX_FAILS=3 / DSH_AUTH_LOCK_MS=5000 / DSH_AUTH_TRUST_PROXY=1
//       启动（本脚本只验证行为，不负责配置）。
// 验证：1) 真实 IP 3 次失败 → 第 4 次 429 → 5s 后恢复；
//       2) XFF 隔离：客户端 A 3 次失败锁定，客户端 B 独立计数；
//       3) 真实 IP 计数不被 XFF 污染。
// 运行：node test/live-lock-check.mjs
// ============================================================================
import http from 'node:http'

const post = (path, body, xff) => new Promise((done) => {
  const d = JSON.stringify(body)
  const r = http.request({
    host: '127.0.0.1', port: 3080, path, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d), ...(xff !== undefined ? { 'x-forwarded-for': xff } : {}) },
  }, (res) => {
    let b = ''
    res.on('data', (c) => { b += c })
    res.on('end', () => done({ status: res.statusCode, body: b }))
  })
  r.on('error', (e) => done({ status: 0, body: String(e) }))
  r.end(d)
})
const fail = (xff) => post('/auth/login', { username: 'test1', password: 'wrong-pass-xx' }, xff)
const good = (xff) => post('/auth/login', { username: 'test1', password: '12345678' }, xff)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (label, ok, extra) => { results.push({ label, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra !== undefined ? ' :: ' + extra : '')) }

const main = async () => {
  // 阶段 1：真实 IP（无 XFF）——阈值应被环境变量覆盖为 3
  const s1 = []
  for (let i = 0; i < 3; i++) s1.push((await fail()).status)
  const locked = (await good()).status
  check('配置阈值 3 次后锁定（第 4 次尝试 429）', s1.every((s) => s === 401) && locked === 429, JSON.stringify(s1) + ' -> ' + locked)
  await sleep(6000)
  const recovered = (await good()).status
  check('锁定 5s 后自动恢复（正确密码 200）', recovered === 200, 'after lock -> ' + recovered)
  // 阶段 2：XFF 隔离（trustProxy=1）
  const a = []
  for (let i = 0; i < 3; i++) a.push((await fail('203.0.113.9')).status)
  const aLocked = (await good('203.0.113.9')).status
  check('XFF 客户端 A 3 次失败后锁定（429）', a.every((s) => s === 401) && aLocked === 429, JSON.stringify(a) + ' -> ' + aLocked)
  const bFirst = (await fail('203.0.113.10')).status
  check('XFF 客户端 B 独立计数（不被 A 的锁定影响，401 而非 429）', bFirst === 401, 'B first fail -> ' + bFirst)
  const realIpFree = (await good()).status
  check('真实 IP 锁已过期且计数未被 XFF 污染（200）', realIpFree === 200, 'real ip -> ' + realIpFree)
  const failed = results.filter((r) => !r.ok)
  console.log('\nLIVE LOCK CHECK: ' + (results.length - failed.length) + '/' + results.length + ' passed')
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('LIVE LOCK CHECK ERROR: ' + (e instanceof Error ? e.stack : String(e))); process.exit(1) })
