// ============================================================================
// live-audit-check.mjs —— 真实部署管理员操作审计验证（0.4.0）
// 需要：面板以 0.4.0（含审计）运行；test1/12345678 登录可用。
// 验证：普通用户越权调用管理员方法 → 403，且审计文件记录 denied:true 的 JSONL 行。
// 运行：node test/live-audit-check.mjs
// ============================================================================
import http from 'node:http'
import fs from 'node:fs'

const AUDIT_FILE = process.argv[2] || 'D:\\deepseekHarness\\recovery\\deepseek-harness\\dsh-ui-auth-audit.jsonl'
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
  // 登录 test1（带启动竞态重试）
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
  // 越权尝试
  const denied = await post('/auth/rpc/createUser', { username: 'attacker-x', password: 'attacker-pw-1' }, cookie)
  check('普通用户越权 createUser → 403', denied.status === 403, 'status=' + denied.status)
  await sleep(1500) // 等审计落盘
  // 读审计文件
  const audit = fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE, 'utf8') : ''
  check('审计文件已创建', audit !== '', 'file=' + AUDIT_FILE)
  check('审计记录越权尝试（denied:true）', audit.includes('"denied":true') && audit.includes('createUser'), audit.slice(-200))
  const lines = audit.trim().split('\n').filter((l) => l !== '')
  check('审计行均为合法 JSON（JSONL）', lines.length >= 1 && lines.every((l) => { try { JSON.parse(l); return true } catch (e) { return false } }))
  const failed = results.filter((r) => !r.ok)
  console.log('\nLIVE AUDIT CHECK: ' + (results.length - failed.length) + '/' + results.length + ' passed')
  process.exit(failed.length === 0 ? 0 : 1)
}
main().catch((e) => { console.error('LIVE AUDIT CHECK ERROR: ' + String(e)); process.exit(1) })
