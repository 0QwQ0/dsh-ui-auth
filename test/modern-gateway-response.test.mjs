import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { createModernGateway } from '../lib/modern-gateway.js'

class ResponseSink extends EventEmitter {
  status = 200
  headers = {}
  chunks = []
  headersSent = false
  setHeader(name, value) { this.headers[name.toLowerCase()] = value }
  getHeader(name) { return this.headers[name.toLowerCase()] }
  getHeaders() { return this.headers }
  removeHeader(name) { delete this.headers[name.toLowerCase()] }
  writeHead(code, fields = {}) {
    this.status = code
    for (const [name, value] of Object.entries(fields)) this.setHeader(name, value)
    this.headersSent = true
    return this
  }
  write(chunk) { if (chunk != null) this.chunks.push(Buffer.from(chunk)); return true }
  end(chunk) { this.write(chunk); return this }
  destroy() { this.destroyed = true }
  get body() { return Buffer.concat(this.chunks) }
}

const bytes = Uint8Array.from([0, 255, 13, 10, 128, 80, 78, 71])
const value = { bytes: { $attachment: 'blob' } }
const success = value => ({ type: 'server-response', rpcId: 'fixture', result: { ok: true, value } })
async function multipart(metadata = JSON.stringify(success(value))) {
  const form = new FormData()
  if (metadata !== null) form.set('metadata', metadata)
  form.set('blob', new Blob([bytes], { type: 'application/octet-stream' }), 'fixture.bin')
  const response = new Response(form)
  return { body: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') }
}

async function run({ endpoint = 'workspaceFiles/readBytes', scope = 'mine', upstream,
  headerMode = 'writeHead', configure, revoke = false } = {}) {
  let current = { username: 'alice', role: 'user' }
  const effects = []
  let forwarded = 0
  const auth = {
    ready: Promise.resolve(), principal: () => current, user: () => current,
    loginKey: () => 'fixture-login', session: id => id === 'mine' ? 'alice' : 'bob',
    workspace: () => 'alice', sessionExists: async () => true,
    claimSession: async () => {}, claimWorkspace: async () => {},
  }
  const connection = {
    authenticatedUrl: base => base,
    authorizeIndex(_request, response) { response.writeHead(200, { 'set-cookie': 'dsh-auth-fixture=fixture; Path=/' }); return true },
    requestRejection: () => undefined,
  }
  const gateway = createModernGateway({
    get: name => name === 'connection' ? connection : undefined,
    effect(callback) { effects.push(callback()) },
  }, auth)
  configure?.(gateway.publicApi)
  const request = Readable.from([JSON.stringify({ type: 'client-request', rpcId: 'fixture', method: endpoint,
    payload: { args: { workspaceFileScopeId: scope, path: 'fixture.bin' } } })])
  Object.assign(request, { method: 'POST', url: '/api/' + endpoint, headers: { host: 'localhost', cookie: '' } })
  const response = new ResponseSink()
  const errors = []
  const log = console.error
  console.error = message => errors.push(String(message))
  try {
    await gateway.handleHttp(request, response, (_req, res) => {
      forwarded++
      if (revoke) current = undefined
      const fields = { 'Content-Type': upstream.type, 'Content-Length': String(upstream.body.length), 'Transfer-Encoding': 'chunked' }
      if (headerMode === 'setHeader') { for (const [name, val] of Object.entries(fields)) res.setHeader(name, val); res.writeHead(200) }
      else res.writeHead(200, fields)
      res.end(upstream.body)
    })
    return { response, errors, forwarded }
  } finally { console.error = log; effects.reverse().forEach(dispose => dispose?.()) }
}

const jsonUpstream = obj => ({ body: Buffer.from(JSON.stringify(obj)), type: 'application/json' })

test('JSON Remote successes still preserve their result', async () => {
  const { response } = await run({ upstream: jsonUpstream(success({ text: 'fixture' })) })
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.body).result.value, { text: 'fixture' })
  assert.equal(response.getHeader('content-length'), undefined)
})

for (const headerMode of ['writeHead', 'setHeader']) test('owned readBytes preserves multipart bytes and metadata via ' + headerMode, async () => {
  const upstream = await multipart()
  const { response, errors } = await run({ upstream, headerMode })
  assert.equal(response.status, 200, errors.join('\n'))
  assert.match(response.getHeader('content-type'), /^multipart\/form-data; boundary=/)
  assert.equal(response.getHeader('content-length'), undefined)
  assert.equal(response.getHeader('transfer-encoding'), undefined)
  const decoded = await new Response(response.body, { headers: { 'content-type': response.getHeader('content-type') } }).formData()
  assert.deepEqual(JSON.parse(decoded.get('metadata')).result.value, value)
  assert.deepEqual(new Uint8Array(await decoded.get('blob').arrayBuffer()), bytes)
})

test('another user session is denied before the attachment reaches the upstream', async () => {
  const { response, forwarded } = await run({ scope: 'theirs', upstream: await multipart() })
  assert.equal(response.status, 403)
  assert.equal(forwarded, 0)
})

for (const metadata of [null, '{invalid', JSON.stringify({ result: { ok: true, value: null } }).replace('true', 'false')]) {
  test('missing, malformed or invalid multipart metadata fails closed: ' + metadata, async () => {
    const { response, errors } = await run({ upstream: await multipart(metadata) })
    assert.equal(response.status, 502)
    assert.equal(response.getHeader('content-type'), 'application/json')
    assert.equal(JSON.parse(response.body).error, 'Could not persist or project response')
    assert.equal(response.body.includes(Buffer.from(bytes)), false)
    assert.ok(errors.some(line => line.includes('modern gateway projection failed')))
  })
}

test('unreviewed multipart endpoint stays closed', async () => {
  const { response } = await run({ endpoint: 'workspaceFiles/read', upstream: await multipart() })
  assert.equal(response.status, 502)
  assert.equal(response.body.includes(Buffer.from(bytes)), false)
})

test('unknown successful binary response type stays closed', async () => {
  const { response } = await run({ upstream: { body: Buffer.from(bytes), type: 'application/octet-stream' } })
  assert.equal(response.status, 502)
})

test('revoked login prevents releasing multipart attachments', async () => {
  const { response } = await run({ upstream: await multipart(), revoke: true })
  assert.equal(response.status, 502)
  assert.equal(response.body.includes(Buffer.from(bytes)), false)
})

test('custom JSON projector cannot accidentally expose detached binary attachments', async () => {
  let projected = false
  const { response } = await run({ upstream: await multipart(), configure: api => api.registerPolicy('fixture', {
    rpc: { matches: endpoint => endpoint === 'workspaceFiles/readBytes', authorize: () => true,
      project: () => { projected = true; return { redacted: true } } },
  }) })
  assert.equal(response.status, 502)
  assert.equal(projected, false)
  assert.equal(response.body.includes(Buffer.from(bytes)), false)
})

test('custom RPC projector is still applied to JSON responses', async () => {
  const { response } = await run({ upstream: jsonUpstream(success({ secret: true })), configure: api => api.registerPolicy('fixture', {
    rpc: { matches: endpoint => endpoint === 'workspaceFiles/readBytes', authorize: () => true, project: () => ({ redacted: true }) },
  }) })
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(response.body).result.value, { redacted: true })
})
