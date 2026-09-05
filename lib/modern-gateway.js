/** DSH 0.1.2 transport adapter, using the public Connection and Gateway seams. */
import { WebSocketServer, WebSocket } from 'ws'
import { createModernPolicy, remoteArgs, object, nonempty } from './modern-policy.js'

const MAX_BODY = 16 * 1024 * 1024
const MAX_STREAMS = 64
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
const denial = () => new Error('Access denied')

async function bodyOf(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('Request too large')
    chunks.push(Buffer.from(chunk))
  }
  const body = Buffer.concat(chunks)
  return { body, envelope: JSON.parse(body.toString('utf8')) }
}

/** Replay once, preserving IncomingMessage events used by downstream HTTP bridges. */
function replay(req, body) {
  const proxy = Object.create(req)
  proxy[Symbol.asyncIterator] = async function* () { if (body.length) yield body }
  return proxy
}

/** Delay success until ownership has persisted; never forward an unfiltered prefix. */
async function forwardJson(forward, req, res, transform) {
  const original = { writeHead: res.writeHead, write: res.write, end: res.end }
  let status = 200
  let size = 0
  const chunks = []
  const headers = {}
  await new Promise((resolve, reject) => {
    const restore = () => { Object.assign(res, original) }
    const capture = chunk => {
      if (chunk == null) return
      size += Buffer.byteLength(chunk)
      if (size > MAX_BODY) throw new Error('Response too large')
      chunks.push(Buffer.from(chunk))
    }
    res.writeHead = (code, reason, fields) => {
      status = code
      Object.assign(headers, typeof reason === 'object' ? reason : fields)
      return res
    }
    res.write = (chunk, encoding, callback) => {
      try { capture(chunk) } catch (error) { restore(); reject(error); return false }
      if (typeof encoding === 'function') encoding()
      else callback?.()
      return true
    }
    res.end = (chunk, encoding, callback) => {
      void (async () => {
        try {
          capture(chunk)
          let body = Buffer.concat(chunks)
          if (status >= 200 && status < 300) {
            const envelope = JSON.parse(body.toString('utf8'))
            if (envelope?.result?.ok === true) envelope.result.value = await transform(envelope.result.value)
            body = Buffer.from(JSON.stringify(envelope))
          }
          restore()
          delete headers['content-length']
          delete headers['Content-Length']
          res.removeHeader?.('content-length')
          res.writeHead(status, headers)
          res.end(body)
          if (typeof encoding === 'function') encoding()
          else callback?.()
          resolve()
        } catch (error) { restore(); reject(error) }
      })()
      return res
    }
    try { forward(req, res) } catch (error) { restore(); reject(error) }
    res.once('close', () => { restore(); resolve() })
  })
}

export function createModernGateway(ctx, auth) {
  const policy = createModernPolicy(auth)
  const policies = new Map()
  const principalByRequest = new WeakMap()
  const correlations = new Set()
  const downstreamSockets = new Set()
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY })
  const principal = req => auth.principal(req)
  const publicApi = Object.freeze({
    ready: auth.ready,
    user: auth.user,
    principal: req => principalByRequest.get(req),
    ownerOfSession: auth.session,
    ownerOfWorkspace: auth.workspace,
    // Trusted Host provisioners own these calls; they are not browser RPCs.
    async claimSession(id, username) { await auth.ready; return auth.claimSession(id, username) },
    async claimWorkspace(id, username) { await auth.ready; return auth.claimWorkspace(id, username) },
    registerPolicy(id, rules) {
      if (!nonempty(id) || policies.has(id)) throw new Error('Duplicate or invalid auth policy')
      policies.set(id, rules)
      return () => policies.delete(id)
    },
  })
  ctx.provide?.('uiAuth', publicApi)

  function extension(kind, target) {
    const matches = [...policies.values()].filter(rule => rule[kind]?.matches(target))
    if (matches.length > 1) throw new Error('Ambiguous authorization policy')
    return matches[0]?.[kind]
  }

  function prepare(req) {
    const who = principal(req)
    if (who === undefined) return { status: 401 }
    const connection = ctx.get('connection')
    if (connection === undefined) return { status: 503 }
    const host = req.headers.host
    if (typeof host !== 'string') return { status: 403 }
    // Mint only an internal carrier cookie. The browser never receives it;
    // every outer request still needs a live dsh-ui-auth session.
    let cookie
    try {
      const url = new URL(connection.authenticatedUrl(`http://${host}`))
      connection.authorizeIndex({ method: 'GET', url: url.pathname + url.search, headers: { host } }, {
        writeHead(_status, headers) { cookie = headers?.['set-cookie']?.split(';')[0] }, end() {},
      })
    } catch { return { status: 403 } }
    if (cookie === undefined) return { status: 503 }
    // Ignore client-supplied native carrier cookies; use only this process's freshly issued one.
    const retained = (req.headers.cookie ?? '').split(';').filter(part => !part.trim().startsWith('dsh-auth-')).join(';')
    req.headers.cookie = `${retained}; ${cookie}`
    const rejected = connection.requestRejection(req)
    if (rejected !== undefined) return { status: rejected }
    principalByRequest.set(req, who)
    return { who }
  }

  async function handleHttp(req, res, forward) {
    const admitted = prepare(req)
    if (admitted.status !== undefined) { json(res, admitted.status, { error: 'Access denied' }); return true }
    const who = admitted.who
    const pathname = new URL(req.url, 'http://local').pathname
    const rule = extension('http', { pathname, method: req.method })
    if (rule !== undefined) {
      if (!(await rule.authorize(who, req))) json(res, 403, { error: 'Access denied' })
      else forward(req, res)
      return true
    }
    if (!pathname.startsWith('/api/')) return false
    const endpoint = pathname.slice('/api/'.length)
    if (req.method !== 'POST') {
      // Host exports and third-party GETs need an explicit policy for ordinary users.
      if (who.role !== 'admin') { json(res, 403, { error: 'Access denied' }); return true }
      return false
    }
    let decoded
    try { decoded = await bodyOf(req) }
    catch { json(res, 400, { error: 'Invalid request' }); return true }
    const { envelope, body } = decoded
    if (envelope?.type !== 'client-request' || envelope.method !== endpoint || !nonempty(envelope.rpcId)) {
      json(res, 400, { error: 'Invalid request' }); return true
    }
    let allowed
    for (const rules of policies.values()) {
      if (rules.remote?.matches(endpoint) && !(await rules.remote.authorize(who, envelope.payload))) {
        json(res, 403, { error: 'Access denied' }); return true
      }
    }
    if (endpoint === '$events/result') {
      const args = remoteArgs(envelope.payload)
      const value = args
      // Bind approval/event responses to this login token, connection generation and delivered event.
      allowed = object(value) && [...correlations].some(correlation =>
        correlation.login === auth.loginKey(req) && correlation.clientId === value.clientId
        && correlation.events.has(value.eventId))
    } else {
      const rule = extension('rpc', endpoint)
      allowed = rule ? await rule.authorize(who, envelope.payload) : await policy.authorize(who, endpoint, envelope.payload)
    }
    if (!allowed) { json(res, 403, { error: 'Access denied' }); return true }
    const request = replay(req, body)
    principalByRequest.set(request, who)
    try {
      await forwardJson(forward, request, res, async value => {
        const rule = endpoint === '$events/result' ? undefined : extension('rpc', endpoint)
        const projected = rule ? await rule.project(who, value) : await policy.result(who, endpoint, value)
        const current = principal(req)
        if (current?.role !== who.role || current.username !== who.username) throw denial()
        return projected
      })
    } catch { if (!res.headersSent) json(res, 502, { error: 'Could not persist or project response' }); else res.destroy() }
    return true
  }

  function handleUpgrade(req, socket, head, forward) {
    const admitted = prepare(req)
    const reject = status => socket.end(`HTTP/1.1 ${status} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    if (admitted.status !== undefined) { reject(admitted.status); return }
    const pathname = new URL(req.url, 'http://local').pathname
    if (pathname !== '/api/remote.mux') {
      const rule = extension('upgrade', { pathname })
      const pass = () => {
        downstreamSockets.add(socket)
        const timer = setInterval(() => {
          const current = principal(req)
          if (current?.username !== admitted.who.username || current.role !== admitted.who.role) socket.destroy()
        }, 1000)
        timer.unref()
        socket.once('close', () => { clearInterval(timer); downstreamSockets.delete(socket) })
        forward(req, socket, head)
      }
      if (rule === undefined) { if (admitted.who.role === 'admin') pass(); else reject(403); return }
      Promise.resolve(rule.authorize(admitted.who, req)).then(allowed => {
        if (allowed && principal(req) !== undefined) pass()
        else reject(403)
      }, () => reject(403))
      return
    }
    const gateway = ctx.get('typertGateway')
    if (gateway?.wireStream?.open === undefined) { reject(503); return }
    sockets.handleUpgrade(req, socket, head, ws => {
      const active = new Map()
      const login = auth.loginKey(req)
      const initialRole = admitted.who.role
      let writes = Promise.resolve()
      const alive = () => {
        const current = principal(req)
        return current?.username === admitted.who.username && current.role === initialRole && auth.loginKey(req) === login ? current : undefined
      }
      const send = value => {
        writes = writes.then(() => new Promise((resolve, rejectSend) => {
          if (alive() === undefined || ws.readyState !== WebSocket.OPEN) { rejectSend(denial()); return }
          const serialized = JSON.stringify(value)
          if (Buffer.byteLength(serialized) > MAX_BODY || ws.bufferedAmount > MAX_BODY) { ws.close(1009, 'Stream limit exceeded'); rejectSend(denial()); return }
          ws.send(serialized, error => error ? rejectSend(error) : resolve())
        }))
        return writes
      }
      const timer = setInterval(() => { if (alive() === undefined) ws.close(1008, 'Login expired') }, 1000)
      timer.unref()
      ws.on('error', () => ws.terminate())
      ws.on('close', () => {
        clearInterval(timer)
        for (const work of active.values()) { work.abort.abort(); correlations.delete(work.correlation) }
      })
      ws.on('message', (bytes, binary) => {
        let message
        try { message = JSON.parse(bytes.toString()) } catch { ws.close(1008, 'Invalid stream request'); return }
        if (binary || alive() === undefined || !nonempty(message?.streamId)) { ws.close(1008, 'Invalid stream request'); return }
        if (message.type === 'cancel' && Object.keys(message).length === 2) { active.get(message.streamId)?.abort.abort(); return }
        if (message.type !== 'open' || Object.keys(message).length !== 4 || typeof message.endpoint !== 'string'
          || active.has(message.streamId) || active.size >= MAX_STREAMS) { ws.close(1008, 'Invalid stream request'); return }
        const work = { abort: new AbortController(), correlation: { login, events: new Set() } }
        active.set(message.streamId, work)
        correlations.add(work.correlation)
        void (async () => {
          try {
            const who = alive()
            const rule = extension('stream', message.endpoint)
            if (who === undefined || !(rule ? await rule.authorize(who, message.payload) : await policy.authorize(who, message.endpoint, message.payload, true))) throw denial()
            const source = await gateway.wireStream.open(message.endpoint, message.payload, work.abort.signal)
            for await (const value of source) {
              if (work.abort.signal.aborted) break
              const current = alive()
              if (current === undefined) throw denial()
              if (rule !== undefined && extension('stream', message.endpoint) !== rule) throw denial()
              // Recheck ownership as well as login state throughout a scoped stream.
              if (!(rule ? await rule.authorize(current, message.payload) : await policy.authorize(current, message.endpoint, message.payload, true))) throw denial()
              const output = rule ? await rule.project(current, value) : policy.frame(current, message.endpoint, value, work.correlation)
              if (message.endpoint === '$events' && value?.type === 'waterfall' && output === null) {
                // A hidden recipient must release its delivery, otherwise an owner's "next"
                // waits forever on users who were correctly not shown the interaction.
                const endpoint = '$events/result'
                const response = await ctx.get('connection').createSharedFetchHandler('/api').fetch(new Request(`http://dsh.internal/api/${endpoint}`, {
                  method: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ type: 'client-request', rpcId: value.eventId, method: endpoint, payload: { args: {
                    clientId: work.correlation.clientId, eventId: value.eventId, outcome: { kind: 'next' },
                  } } }),
                }))
                if (!(await response.json()).result?.ok) throw denial()
              }
              if (output !== null) await send({ type: 'item', streamId: message.streamId, value: output })
            }
            if (!work.abort.signal.aborted) await send({ type: 'end', streamId: message.streamId })
          } catch {
            if (!work.abort.signal.aborted) await send({ type: 'error', streamId: message.streamId, error: { code: 'auth/forbidden', message: 'Stream unavailable or access denied', details: {} } }).catch(() => ws.close(1008))
          } finally { correlations.delete(work.correlation); active.delete(message.streamId) }
        })()
      })
    })
  }

  ctx.effect(() => () => {
    for (const socket of sockets.clients) socket.terminate()
    for (const socket of downstreamSockets) socket.destroy()
    sockets.close()
    policies.clear()
    correlations.clear()
  }, 'dsh-ui-auth: modern gateway')
  return { handleHttp, handleUpgrade, publicApi }
}
