// 真机验证（可选 live 检查，不进 npm test）：验证 mux 代理修好 #6 的跨用户泄漏，且未回归"重新连接中"。
// 自给自足：管理员口令取自引导文件；自建两个普通用户用于观察；结束即删。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import puppeteer from 'puppeteer'

const base = process.env.DSH020_URL ?? 'http://127.0.0.1:3202'
const wsBase = base.replace(/^http/, 'ws')
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }

const login = async (username, password) => {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }), redirect: 'manual',
  })
  return (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ')
}
const cookiePairs = (cookieHeader) => cookieHeader.split(/;\s*/).filter(Boolean).map((pair) => {
  const index = pair.indexOf('=')
  return { name: pair.slice(0, index).trim(), value: pair.slice(index + 1), domain: new URL(base).hostname, path: '/' }
})
const remote = async (cookie, endpoint, args) => {
  const response = await fetch(`${base}/api/${endpoint}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload: { args: args ?? {} } }),
  })
  const text = await response.text()
  try { return { status: response.status, value: JSON.parse(text)?.result?.value, raw: text } } catch { return { status: response.status, raw: text } }
}
/** 不依赖字段路径：从响应里直接找会话 id（形如 session-xxxxxxxx-…）。 */
const sessionIdOf = (result) => (String(result.raw ?? '').match(/session-[0-9a-f][0-9a-f-]{6,}/) ?? [''])[0]
const rpc = async (cookie, method, body) => {
  const response = await fetch(`${base}/auth/rpc/${method}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })
  return response.status
}

let browser
try {
  // 准备：管理员（口令取自引导文件）+ 两个普通用户
  const bootstrap = process.env.DSH020_BOOTSTRAP ?? path.join(os.tmpdir(), 'dsh020', 'work', 'dsh-ui-auth-bootstrap.txt')
  const adminPassword = /密码[:：]\s*(\S+)/.exec(fs.readFileSync(bootstrap, 'utf8'))?.[1] ?? ''
  const admin = await login('admin', adminPassword)
  check('准备：管理员登录（口令取自引导文件）', admin !== '')
  // 唯一用户名：插件对被删除的用户名写永久墓碑，固定名字第二次运行无法重建
  const u1 = 'muxprobe' + Date.now().toString(36)
  const u2 = u1 + 'b'
  await rpc(admin, 'createUser', { username: u1, password: 'Mux-Probe-1234!', role: 'user' })
  await rpc(admin, 'createUser', { username: u2, password: 'Mux-Probe-2345!', role: 'user' })
  const probe = await login(u1, 'Mux-Probe-1234!')
  const other = await login(u2, 'Mux-Probe-2345!')
  check('准备：两个普通用户登录', probe !== '' && other !== '')

  // 两条 mux 连接，观察帧
  const frames = { probe: [], other: [] }
  const open = (cookie, bucket) => new Promise((resolve) => {
    const socket = new WebSocket(`${wsBase}/api/remote.mux`, { headers: { cookie } })
    socket.on('message', (data, isBinary) => { if (!isBinary) bucket.push(String(data)) })
    socket.on('open', () => resolve(socket))
    socket.on('error', () => resolve(socket))
  })
  const probeSocket = await open(probe, frames.probe)
  const otherSocket = await open(other, frames.other)
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // ① 另一个用户建会话 → probe 不应收到它的任何帧
  const created = await remote(other, 'session/create', { request: {} })
  const otherSession = sessionIdOf(created) + ''
  await new Promise((resolve) => setTimeout(resolve, 4000))
  const leaked = otherSession !== '' && frames.probe.some(text => text.includes(otherSession))
  check('不跨用户泄漏（Issue #6）：未收到他人会话的帧', otherSession !== '' && !leaked,
    `他人会话=${String(otherSession).slice(0, 12)} probe帧数=${frames.probe.length} 泄漏=${leaked}`)

  // ② 自己建会话 → 自己的帧应能收到（证明过滤没有一律丢弃）
  const mine = await remote(probe, 'session/create', { request: {} })
  const mineSession = sessionIdOf(mine) + ''
  await new Promise((resolve) => setTimeout(resolve, 4000))
  const sawOwn = mineSession !== '' && frames.probe.some(text => text.includes(mineSession))
  check('自己的会话帧仍可收到（过滤未过度）', sawOwn, `自己的会话=${String(mineSession).slice(0, 12)} probe帧数=${frames.probe.length}`)
  probeSocket.close()
  otherSocket.close()

  // ③ 面板不再"重新连接中"（node 侧登录 + 注入 Cookie）
  browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 900 } })
  const page = await browser.newPage()
  const logs = []
  const api = new Set()
  page.on('console', (message) => { if (/connection lost|reconnect/i.test(message.text())) logs.push(message.text().slice(0, 80)) })
  page.on('response', (response) => { if (response.url().includes('/api/')) api.add(response.url().replace(base, '').split('?')[0]) })
  await page.setCookie(...cookiePairs(probe))
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await new Promise((resolve) => setTimeout(resolve, 12000))
  const reconnectText = await page.evaluate(() => (document.body.innerText.match(/重新连接[^\n]*/) ?? ['(无)'])[0])
  check('面板无"重新连接中"（未回归）', reconnectText === '(无)', `文案=${reconnectText} 连接日志=${logs.length}`)
  check('面板初始化继续', [...api].some(url => url.includes('session/list') || url.includes('session/create')), `api=${api.size} 个`)

  await rpc(admin, 'deleteUser', { username: u1 })
  await rpc(admin, 'deleteUser', { username: u2 })
} catch (error) {
  check('执行过程未抛异常', false, String((error && error.message) || error).slice(0, 140))
} finally {
  try { if (browser !== undefined) await browser.close() } catch (error) { /* ignore */ }
  const failed = results.filter(item => !item.ok).length
  console.log(`\n  结果: ${results.length - failed}/${results.length} 通过`)
  process.exit(failed === 0 ? 0 : 1)
}