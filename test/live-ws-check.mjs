// ============================================================================
// live-ws-check.mjs —— 真实部署 WS 事件流隔离验证（0.4.0）
// 需要：面板已运行且已安装 dsh-ui-auth（test1/12345678 登录）。
// 验证：1) 登录 test1，取 session.list / workspace.list（网关过滤后）的归属集合；
//       2) 原始 TCP 连 /api/events.mux 与 /api/events.host；
//       3) 断言网络层收到的每一帧（除 stream/error）的 sessionId/workspaceId
//          都属于 test1 自己 —— 他人会话帧必须被网关丢弃。
// 运行：node test/live-ws-check.mjs
// ============================================================================
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'

const HOST = '127.0.0.1'
const PORT = 3080

const reqJson = (path, method, body, cookie) => new Promise((resolve, reject) => {
  const data = body === undefined ? undefined : JSON.stringify(body)
  const r = http.request({
    host: HOST, port: PORT, path, method,
    headers: {
      ...(data !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      ...(cookie !== undefined ? { cookie: 'dsh_auth=' + cookie } : {}),
    },
  }, (res) => {
    let b = ''
    res.on('data', (c) => { b += c })
    res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }))
  })
  r.on('error', reject)
  if (data !== undefined) r.end(data); else r.end()
})

function wsConnect(path, cookie, onFrame, onDone, onError) {
  const key = crypto.randomBytes(16).toString('base64')
  const sock = net.connect(PORT, HOST)
  let buf = Buffer.alloc(0)
  let upgraded = false
  const frames = []
  sock.on('connect', () => {
    sock.write(['GET ' + path + ' HTTP/1.1', 'Host: ' + HOST + ':' + PORT, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: ' + key, 'Cookie: dsh_auth=' + cookie, '', ''].join('\r\n'))
  })
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk])
    if (!upgraded) {
      const i = buf.indexOf('\r\n\r\n')
      if (i === -1) return
      const head = buf.slice(0, i).toString('utf8')
      if (!head.includes(' 101 ')) { onError('握手失败: ' + head.split('\r\n')[0]); sock.destroy(); return }
      buf = buf.slice(i + 4)
      upgraded = true
    }
    for (;;) {
      if (buf.length < 2) break
      const b0 = buf[0], b1 = buf[1]
      const opcode = b0 & 0x0f
      let len = b1 & 0x7f
      let hlen = 2
      if (len === 126) {
        if (buf.length < 4) break
        len = (buf[2] << 8) | buf[3]; hlen = 4
      } else if (len === 127) {
        if (buf.length < 10) break
        hlen = 10; len = Number(buf.readBigUInt64BE(2))
      }
      if (buf.length < hlen + len) break
      const payload = buf.slice(hlen, hlen + len)
      buf = buf.slice(hlen + len)
      if (opcode === 1) {
        const text = payload.toString('utf8')
        frames.push(text)
        try { onFrame(JSON.parse(text)) } catch (e) { /* ignore */ }
      }
    }
  })
  sock.on('close', () => onDone(frames))
  sock.on('error', (err) => { if (onError !== undefined) onError(err) })
  return sock
}

const results = []
const check = (label, ok, extra) => { results.push({ label, ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra !== undefined ? ' :: ' + extra : '')) }

const main = async () => {
  // 1) 登录
  const login = await reqJson('/auth/login', 'POST', { username: 'test1', password: '12345678' })
  const sc = login.headers !== undefined ? login.headers['set-cookie'] || '' : ''
  const m = /dsh_auth=([^;]+)/.exec(sc)
  check('登录 test1 成功', login.status === 200 && m !== null)
  if (m === null) { process.exit(1) }
  const cookie = m[1]
  // 2) 归属集合（网关已过滤）
  const list = JSON.parse((await reqJson('/api/session.list', 'POST', { type: 'client-request', rpcId: 'live-check', method: 'session.list', payload: {} }, cookie)).body)
  const ownSessions = new Set(((list.result || {}).value || {}).items.map((i) => i.sessionId))
  const wlist = JSON.parse((await reqJson('/api/workspace.list', 'POST', { type: 'client-request', rpcId: 'live-check2', method: 'workspace.list', payload: {} }, cookie)).body)
  const ownWorkspaces = new Set((((wlist.result || {}).value || {}).items || []).map((w) => w.workspaceId))
  console.log('test1 会话: ' + JSON.stringify([...ownSessions]))
  console.log('test1 工作区: ' + JSON.stringify([...ownWorkspaces]))
  // 3) mux 流：2.5 秒采样
  const muxLeak = []
  const muxOwn = []
  const muxGlobal = []
  const muxPromise = new Promise((resolve) => {
    const sock = wsConnect('/api/events.mux', cookie, (frame) => {
      const p = frame.payload || {}
      if (p.type === 'stream/error') { muxGlobal.push(p.type); return }
      if (typeof p.sessionId === 'string') {
        if (ownSessions.has(p.sessionId)) muxOwn.push(p.type)
        else muxLeak.push(p.sessionId)
      }
    }, resolve)
    setTimeout(() => sock.destroy(), 2500)
  })
  await muxPromise
  check('mux 网络层无他人会话帧（0.4.0 隔离生效）', muxLeak.length === 0, 'leak=' + JSON.stringify(muxLeak))
  check('mux 收到自己会话的帧（流可用）', muxOwn.length > 0 || ownSessions.size === 0, 'own=' + JSON.stringify(muxOwn) + ' sessions=' + ownSessions.size)
  // 4) host 流：2.5 秒采样
  const hostLeak = []
  const hostOwn = []
  const hostPromise = new Promise((resolve) => {
    const sock = wsConnect('/api/events.host', cookie, (frame) => {
      const p = frame.payload || {}
      if (p.type === 'stream/error') return
      if (p.type === 'host/remote-event') { hostLeak.push('remote-event'); return }
      const sid = typeof p.sessionId === 'string' ? p.sessionId : undefined
      const wid = typeof p.workspaceId === 'string' ? p.workspaceId : (p.workspace && typeof p.workspace.workspaceId === 'string' ? p.workspace.workspaceId : undefined)
      const orderIds = Array.isArray(p.workspaceIds) ? p.workspaceIds : undefined
      const archIds = Array.isArray(p.archivedSessionIds) ? p.archivedSessionIds : undefined
      if (sid !== undefined) { (ownSessions.has(sid) ? hostOwn : hostLeak).push('sid:' + sid); return }
      if (wid !== undefined) { (ownWorkspaces.has(wid) ? hostOwn : hostLeak).push('wid:' + wid); return }
      if (orderIds !== undefined) {
        for (const id of orderIds) { (ownWorkspaces.has(id) ? hostOwn : hostLeak).push('ord:' + id) }
        return
      }
      if (archIds !== undefined) {
        for (const id of archIds) { (ownSessions.has(id) ? hostOwn : hostLeak).push('arch:' + id) }
        return
      }
      hostLeak.push('unknown:' + (p.type || '?'))
    }, resolve)
    setTimeout(() => sock.destroy(), 2500)
  })
  await hostPromise
  check('host 网络层无他人会话/工作区帧', hostLeak.length === 0, 'leak=' + JSON.stringify(hostLeak))
  console.log('info: host 收到的自有帧 ' + JSON.stringify(hostOwn) + '（事件流空闲时可能为空，属正常）')

  const failed = results.filter((r) => !r.ok)
  console.log('\nLIVE WS CHECK: ' + (results.length - failed.length) + '/' + results.length + ' passed')
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('LIVE WS CHECK ERROR: ' + (e instanceof Error ? e.stack : String(e))); process.exit(1) })
