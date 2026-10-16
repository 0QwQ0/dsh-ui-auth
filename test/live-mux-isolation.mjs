// 真机验证（不入库）：① 代理后不再跨用户泄漏他人会话帧 ② 自己会话的帧仍能收到 ③ 客户端不再"重新连接中"
import WebSocket from 'ws'
import puppeteer from 'puppeteer'

const base = 'http://127.0.0.1:3202'
const wsBase = 'ws://127.0.0.1:3202'
const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`) }

const login = async (username, password) => {
  const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
  return (response.headers.getSetCookie?.() ?? []).map(value => value.split(';')[0]).join('; ')
}
const remote = async (cookie, endpoint, args) => {
  const response = await fetch(`${base}/api/${endpoint}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload: { args: args ?? {} } }),
  })
  const text = await response.text()
  try { return { status: response.status, value: JSON.parse(text)?.result?.value } } catch { return { status: response.status } }
}
const rpc = async (cookie, method, body) => {
  const response = await fetch(`${base}/auth/rpc/${method}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return response.status
}

// 准备：管理员建一个专用普通用户
const admin = await login('admin', 'QkMP4wzk&n#R@hbi')
await rpc(admin, 'createUser', { username: 'muxprobe', password: 'Mux-Probe-1234!', role: 'user' })
const probe = await login('muxprobe', 'Mux-Probe-1234!')
const other = await login('checkuser', 'Check-0.7.0-pass!')

// ①+② 两条连接观察帧
const frames = { probe: [], other: [] }
const open = (cookie, bucket) => new Promise((resolve) => {
  const socket = new WebSocket(`${wsBase}/api/remote.mux`, { headers: { cookie } })
  socket.on('message', (data, isBinary) => { if (!isBinary) bucket.push(String(data)) })
  socket.on('open', () => resolve(socket))
  socket.on('error', () => resolve(socket))
})
const probeSocket = await open(probe, frames.probe)
const otherSocket = await open(other, frames.other)
await new Promise((resolve) => setTimeout(resolve, 1500))

// 让 checkuser 新建一个会话（普通用户可建自己的会话），随后看 probe 是否收到它的帧
const created = await remote(other, 'session/create', { request: {} })
const otherSession = created.value?.sessionId ?? created.value?.session?.sessionId ?? ''
await new Promise((resolve) => setTimeout(resolve, 3000))
const leaked = frames.probe.some(text => otherSession !== '' && text.includes(otherSession))
check('不跨用户泄漏：probe 未收到 checkuser 会话的帧', !leaked, `checkuser session=${String(otherSession).slice(0, 12)} probeFrames=${frames.probe.length} leaked=${leaked}`)

// 自己的会话帧仍应到达（证明过滤不是"一律丢弃"）
const mine = await remote(probe, 'session/create', { request: {} })
const mineSession = mine.value?.sessionId ?? mine.value?.session?.sessionId ?? ''
await new Promise((resolve) => setTimeout(resolve, 3000))
const sawOwn = frames.probe.some(text => mineSession !== '' && text.includes(mineSession))
check('自己的会话帧仍可收到（过滤未过度）', sawOwn, `probe session=${String(mineSession).slice(0, 12)} frames=${frames.probe.length}`)

probeSocket.close(); otherSocket.close()

// ③ 客户端不再"重新连接中"
const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 900 } })
const page = await browser.newPage()
const logs = []
const api = new Set()
page.on('console', (message) => { if (/connection lost|reconnect/i.test(message.text())) logs.push(message.text().slice(0, 80)) })
page.on('response', (response) => { if (response.url().includes('/api/')) api.add(response.url().replace(base, '').split('?')[0]) })
await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
await page.evaluate(async () => {
  await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'muxprobe', password: 'Mux-Probe-1234!' }) })
})
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
await new Promise((resolve) => setTimeout(resolve, 12000))
const reconnectText = await page.evaluate(() => (document.body.innerText.match(/重新连接[^\n]*/) ?? ['(无)'])[0])
check('客户端无"重新连接中"（未回归）', reconnectText === '(无)', `文案=${reconnectText} 连接日志=${logs.length}`)
check('客户端初始化继续（发出 session/list 等）', [...api].some(url => url.includes('session/list') || url.includes('session/create')), `api=${api.size} 个`)
await browser.close()

// 清理
await rpc(admin, 'deleteUser', { username: 'muxprobe' })
const failed = results.filter(item => !item.ok).length
console.log(`\n  结果: ${results.length - failed}/${results.length} 通过`)
process.exit(failed === 0 ? 0 : 1)