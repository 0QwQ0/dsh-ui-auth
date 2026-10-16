/**
 * 活体验证：mux 跨用户泄漏（Issue #6）。
 *
 * 这是 #6 的**决定性**测试——不是断言源码字符串，而是用两个**真实浏览器面板**
 * （管理员 + 普通用户，各自独立 cookie 上下文）连上正在运行的宿主，然后由管理员
 * 通过 HTTP 创建 workspace/session，用 CDP 抓两端收到的 mux 帧，比较各自看到的
 * 工作区 id 集合：
 *
 *   - 管理员集合为空        → VOID（阳性对照缺失，测试无效，退出 1）
 *   - 普通用户 ∩ 管理员 ≠ ∅ → LEAK（跨用户泄漏，退出 1）
 *   - 普通用户集合为空      → NO-LEAK（退出 0）
 *
 * 用法：
 *   PROBE_URL=http://127.0.0.1:3205 node test/live-mux-leak.mjs
 *   （可选）DSH_AUTH_BOOTSTRAP=<引导文件路径> DSH_LEAK_VERBOSE=1
 *
 * 注意：必须用独立浏览器上下文，否则第二个身份会覆盖第一个的 cookie，
 * 使「管理员」页面实际以普通用户身份连接，A/B 全部失效（本项目踩过这个坑）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer'

const base = process.env.PROBE_URL
if (base === undefined || base === '') {
  console.error('需要 PROBE_URL，例如 PROBE_URL=http://127.0.0.1:3205')
  process.exit(2)
}
const verbose = process.env.DSH_LEAK_VERBOSE === '1'
const bootstrap = process.env.DSH_AUTH_BOOTSTRAP
  ?? path.join(os.tmpdir(), 'dsh020', 'work', 'dsh-ui-auth-bootstrap.txt')
const adminPw = (/密码[:：]\s*(\S+)/.exec(fs.readFileSync(bootstrap, 'utf8')) ?? [])[1] ?? ''
if (adminPw === '') {
  console.error(`无法从 ${bootstrap} 解析管理员密码（可用 DSH_AUTH_BOOTSTRAP 指定）`)
  process.exit(2)
}

const login = async (username, password) => {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }), redirect: 'manual',
  })
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ')
}
const rpc = async (cookie, method, body) => {
  const response = await fetch(`${base}/auth/rpc/${method}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { status: response.status, text: await response.text() }
}
/** 以插件自己的远程调用形态请求宿主端点（与面板走的同一条路）。 */
const remote = async (cookie, endpoint, args) => {
  const response = await fetch(`${base}/api/${endpoint}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: endpoint, payload: { args: args ?? {} } }),
  })
  return { status: response.status, text: await response.text() }
}
const cookiePairs = (header) => header.split(/;\s*/).filter(Boolean).map((pair) => {
  const at = pair.indexOf('=')
  return { name: pair.slice(0, at).trim(), value: pair.slice(at + 1), domain: new URL(base).hostname, path: '/' }
})
const workspaceIds = (frames) => {
  const found = new Set()
  for (const frame of frames) {
    const text = String(frame)
    for (const match of text.matchAll(/"workspaceId":"([^"]+)"/g)) found.add(match[1])
    const list = /"workspaceIds":\[([^\]]*)\]/.exec(text)
    if (list) for (const match of list[1].matchAll(/"([^"]+)"/g)) found.add(match[1])
  }
  return found
}

const admin = await login('admin', adminPw)
if (admin === '') { console.error('管理员登录失败（密码或引导文件不匹配）'); process.exit(2) }
const username = 'leakprobe' + Date.now().toString(36)
const userPassword = 'Leak-Probe-1234!'
const created = await rpc(admin, 'createUser', { username, password: userPassword, role: 'user' })
if (created.status !== 200) { console.error(`创建普通用户失败 ${created.status}: ${created.text.slice(0, 120)}`); process.exit(2) }
const user = await login(username, userPassword)
if (user === '') { console.error('普通用户登录失败'); process.exit(2) }

/** 采集两个身份的帧并裁决；返回退出码（不在此处 exit，保证清理一定执行）。 */
async function probe() {
  const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1400, height: 950 } })
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leakprobe-'))
  try {
    const spy = {}
    const pages = {}
    for (const [label, cookie] of [['admin', admin], ['user', user]]) {
      const context = await browser.createBrowserContext()   // 身份隔离的关键
      const page = await context.newPage()
      const cdp = await page.target().createCDPSession()
      await cdp.send('Network.enable')
      spy[label] = []
      cdp.on('Network.webSocketFrameReceived', (event) => spy[label].push(event.response.payloadData))
      await page.setCookie(...cookiePairs(cookie))
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
      pages[label] = page
    }
    await new Promise((resolve) => setTimeout(resolve, 9000))
    if (spy.admin.length === 0 || spy.user.length === 0) {
      console.error(`VOID：客户端未连上 mux（admin ${spy.admin.length} 帧 / user ${spy.user.length} 帧）`)
      return 1
    }
    if (verbose) {
      for (const label of ['admin', 'user']) {
        console.log(`  [${label}] ${spy[label].length} 帧`)
        for (const frame of spy[label]) console.log(`    <= ${String(frame).slice(0, 150)}`)
      }
    }

    const madeWorkspace = await remote(admin, 'workspace/create', { request: { path: directory } })
    const workspaceId = (madeWorkspace.text.match(/"workspaceId":"([^"]+)"/) ?? [])[1]
      ?? (madeWorkspace.text.match(/[0-9a-f]{8}-[0-9a-f-]{27}/) ?? [''])[0]
    const madeSession = await remote(admin, 'session/create', { request: { workspaceId } })
    const sessionId = (madeSession.text.match(/session-[0-9a-f][0-9a-f-]{6,}/) ?? [''])[0]
    console.log(`  管理员创建 workspace=${workspaceId.slice(0, 12)} session=${sessionId.slice(0, 20)} (session/create=${madeSession.status})`)
    await new Promise((resolve) => setTimeout(resolve, 7000))

    const adminIds = workspaceIds(spy.admin)
    const userIds = workspaceIds(spy.user)
    const leaked = [...userIds].filter((id) => adminIds.has(id))
    console.log(`  [${base}] 管理员可见工作区 ${adminIds.size} 个 | 普通用户可见 ${userIds.size} 个 | 交集 ${leaked.length} 个`)
    if (verbose) {
      for (const label of ['admin', 'user']) console.log(`  [${label}] 采集结束，共 ${spy[label].length} 帧（含创建后）`)
    }
    // 事件通道（`emit` 帧）单独统计：报告者观察到的形态是 api-session/* 实时泄漏。
    // 只有它确实会到达连接时，才需要按事件归属过滤；若压根不投递，则不是可达面。
    const emitFrames = (frames) => frames.filter((frame) => String(frame).includes('"type":"emit"'))
    const adminEmits = emitFrames(spy.admin)
    const userEmits = emitFrames(spy.user)
    const sessionEmits = (frames) => frames.filter((frame) => /api-session|"event":"session/.test(String(frame)))
    console.log(`  emit 帧：管理员 ${adminEmits.length} 个、普通用户 ${userEmits.length} 个（其中会话类：管理员 ${sessionEmits(adminEmits).length}、普通用户 ${sessionEmits(userEmits).length}）`)
    if (userEmits.length > 0) {
      for (const frame of userEmits.slice(0, 3)) console.log(`    [user emit] ${String(frame).slice(0, 200)}`)
    }
    if (adminIds.size === 0) {
      console.error('  VOID：管理员自己都没拿到工作区 id，阳性对照缺失 ⇒ 本次结果无效')
      return 1
    }

    const opened = {
      admin: await openSessionStream(pages.admin, sessionId),
      user: await openSessionStream(pages.user, sessionId),
    }
    const countItems = (result) => result.frames.filter((frame) => frame.includes('"type":"item"')).length
    // 另一半：**打开**他人会话流也必须被拒（宿主按单用户语义会照单服务任何 sessionId，
    // 只过滤下行帧不够）。判定不要求内容流动：本环境里宿主对 remote 建出的会话回
    // `gateway/internal: session not found`，两边都一样，因此"有没有 item"证明不了授权是否生效，
    // 要看**是谁拒绝的**——代理自己拒绝会对该流回 `auth/forbidden`，宿主拒绝则是别的 code。
    const reachedHost = (result) => result.frames.some((frame) => !frame.includes('"code":"auth/forbidden"'))
    const deniedByUs = (result) => result.frames.some((frame) => frame.includes('"code":"auth/forbidden"'))
    console.log(`  打开 session/follow(${sessionId.slice(0, 16)}…)：管理员 ${reachedHost(opened.admin) ? '被放行到宿主' : '未被放行'}`
      + ` / 我方拒绝 ${deniedByUs(opened.admin) ? '是' : '否'}；普通用户 ${reachedHost(opened.user) ? '被放行到宿主' : '未被放行'}`
      + ` / 我方拒绝 ${deniedByUs(opened.user) ? '是' : '否'}`)
    if (!reachedHost(opened.admin)) {
      console.error('  VOID：管理员打开自己的会话流没有到达宿主 ⇒ 阳性对照不成立，本次结果无效')
      for (const frame of [...opened.admin.frames, ...opened.user.frames].slice(0, 4)) {
        console.error(`    frame: ${String(frame).slice(0, 220)}`)
      }
      return 1
    }
    if (reachedHost(opened.user) || countItems(opened.user) > 0) {
      console.error('  LEAK：普通用户对**他人会话**的流打开被放行到了宿主（授权未生效）')
      return 1
    }

    if (leaked.length > 0) {
      console.error(`  LEAK：普通用户看到 ${leaked.length} 个管理员工作区：${leaked.map((id) => id.slice(0, 8)).join(',')}`)
      return 1
    }
    if (sessionEmits(userEmits).length > 0) {
      console.error(`  LEAK：普通用户收到 ${sessionEmits(userEmits).length} 个会话类 emit 帧（api-session/*）`)
      return 1
    }
    console.log('  NO-LEAK：普通用户看不到任何管理员工作区，阳性对照成立 ✓')
    return 0
  } finally {
    await browser.close().catch(() => { /* ignore */ })
    try { fs.rmSync(directory, { recursive: true, force: true }) } catch (error) { /* ignore */ }
  }
}

/** 在页面里另开一条 mux 连接，请求订阅某个会话的流，回报收到的帧。 */
async function openSessionStream(page, sessionId) {
  return page.evaluate(async (sid) => {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${scheme}://${location.host}/api/remote.mux`)
    const streamId = 'leakprobe' + Math.random().toString(36).slice(2)
    const frames = []
    let status = 'pending'
    await new Promise((resolve) => {
      socket.onopen = () => resolve('open')
      socket.onerror = () => resolve('error')
      socket.onclose = () => resolve('closed')
      setTimeout(() => resolve('timeout'), 6000)
    })
    const settled = new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 6000)
      socket.onmessage = (event) => {
        const text = String(event.data)
        if (text.includes(streamId)) frames.push(text)
        if (frames.some((frame) => frame.includes('"type":"error"'))) { clearTimeout(timer); resolve('denied') }
        if (frames.length >= 3) { clearTimeout(timer); resolve('streaming') }
      }
      socket.onclose = () => { clearTimeout(timer); resolve('closed') }
    })
    try {
      socket.send(JSON.stringify({
        type: 'open', streamId, endpoint: 'session/follow',
        payload: { args: { request: { address: { kind: 'session', sessionId: sid } } } },
      }))
    } catch (error) { status = 'send-failed' }
    status = await settled
    try { socket.close() } catch (error) { /* ignore */ }
    return { frames, status }
  }, sessionId)
}

let code = 2
try {
  code = await probe()
} catch (error) {
  console.error('探针异常: ' + (error instanceof Error ? error.stack ?? error.message : String(error)))
  code = 1
} finally {
  await rpc(admin, 'deleteUser', { username }).catch(() => { /* ignore */ })
}
process.exit(code)
