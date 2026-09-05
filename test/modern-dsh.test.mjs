/** Opt-in real 0.1.2 WebServer + Connection + Credentials + Typert Gateway integration. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pbkdf2Sync, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import WebSocket from 'ws'
import * as Auth from '../lib/index.js'

const source = process.env.DSH_COMPAT_SOURCE
assert.ok(source, 'DSH_COMPAT_SOURCE must point to a built, unmodified DSH 0.1.2-rc.1 checkout')
const fixturePassword = 'Fixture-only-42!'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

test('current DSH authentication, RPC, streams and downstream policies', { timeout: 20000 }, async () => {
  const load = path => import(pathToFileURL(join(source, path, 'lib/index.js')).href)
  const { Context, Service } = await load('vendor/cordis')
  const { default: WebServer } = await load('packages/host/webserver')
  const { default: Credentials } = await load('packages/credentials/credentials-local')
  const Connection = await load('packages/client/connection')
  const { default: Registry } = await load('packages/typert/registry')
  const { default: Gateway } = await load('packages/api/gateway')
  const { Remote, bindTypertRemote } = await load('packages/typert/protocol')
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ui-auth-real-'))
  const ctx = new Context()
  const sockets = []
  const calls = []
  const initializers = []
  class SessionFixture extends Service {
    constructor(ctx) {
      super(ctx, 'sessionFixture')
      this.typertRemote = bindTypertRemote(this, 'sessionFixture', { namespace: 'session' })
      for (const init of initializers) init.call(this)
    }
    async page(request) { calls.push(request.address.sessionId); return { text: request.address.sessionId + ':private' } }
    async list(_request) { return { items: [{ sessionId: 'a' }, { sessionId: 'b' }] } }
    async create(request) { return { sessionId: request.sessionId ?? randomUUID() } }
    async *follow(request, signal) {
      calls.push('follow:' + request.address.sessionId)
      yield { text: request.address.sessionId + ':private' }
      await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }) })
    }
    async *control(signal) {
      yield { type: 'baseline', value: { queues: { a: [], b: ['private'] }, jobs: { a: [], b: [] }, projections: { a: {}, b: {} } } }
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    }
  }
  for (const method of ['page', 'list', 'create', 'follow', 'control']) {
    Remote(['follow', 'control'].includes(method) ? { mode: 'stream' } : method)(SessionFixture.prototype[method], {
      kind: 'method', name: method, private: false, static: false, addInitializer: init => initializers.push(init),
    })
  }
  try {
    await ctx.plugin(Credentials, { path: join(directory, '.credentials.yaml'), dshHome: directory, watch: false })
    for (const [username, role] of [['admin', 'admin'], ['alice', 'user'], ['bob', 'user']]) {
      await ctx.credentials.modifyRecord(`dsh-auth/${username}`, async () => ({ kind: 'grant', payload: JSON.stringify({
        v: 1, username, role, salt: '01020304', hash: pbkdf2Sync(fixturePassword, Buffer.from('01020304', 'hex'), 60000, 32, 'sha256').toString('hex'), iterations: 60000,
      }) }))
    }
    await ctx.credentials.modifyRecord('dsh-auth/ownership', async () => ({ kind: 'grant', payload: JSON.stringify({
      v: 1, sessions: { a: 'alice', b: 'bob' }, workspaces: { wa: 'alice', wb: 'bob' },
    }) }))
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(Connection)
    await ctx.plugin(Registry)
    await ctx.plugin(Gateway, { websocketHeartbeatIntervalMs: 2000 })
    await ctx.plugin(SessionFixture)
    const agentContext = ctx.extend()
    ctx.typert.contexts.registerHost('agent', {
      wire: 'agentId', wireTypeSymbol: '@fixture#AgentId',
      identity: candidate => candidate === agentContext ? 'a' : undefined,
      resolve: id => id === 'a' ? agentContext : undefined,
    })
    ctx.provide('sessions', { get: () => undefined })
    ctx.provide('sessionPersistence', { inspect: async () => { const error = new Error('fixture absent'); error.name = 'SessionPersistenceNotFoundError'; throw error } })
    ctx.webServer.registerFallback((req, res) => {
      if (ctx.connection.authorizeIndex(req, res)) res.end('native shell')
    })
    const eventQueue = []
    let wake
    const releaseEvents = ctx.typertGateway.registerRemoteEvents(async function* (signal) {
      signal.addEventListener('abort', () => wake?.(), { once: true })
      while (!signal.aborted) {
        while (eventQueue.length) yield eventQueue.shift()
        if (!signal.aborted) await new Promise(resolve => { wake = resolve })
      }
    }, { home: '/fixture' })
    await ctx.plugin(Auth)
    const origin = `http://127.0.0.1:${ctx.webServer.port}`
    async function login(username) {
      let response
      for (let i = 0; i < 30; i++) {
        response = await fetch(origin + '/auth/login', { method: 'POST', body: JSON.stringify({ username, password: fixturePassword }) })
        if (response.status !== 503) break
        await pause(20)
      }
      assert.equal(response.status, 200)
      return response.headers.get('set-cookie').split(';')[0]
    }
    const alice = await login('alice')
    const bob = await login('bob')
    const admin = await login('admin')
    const rpc = (cookie, endpoint, args) => fetch(origin + '/api/' + endpoint, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } }),
    })
    assert.equal((await fetch(origin, { redirect: 'manual' })).status, 302)
    const native = await fetch(origin, { headers: { cookie: alice } })
    assert.equal(native.status, 200)
    assert.equal(await native.text(), 'native shell')
    assert.equal(native.headers.has('set-cookie'), false, 'internal native cookie must not escape')
    assert.equal((await fetch(origin, { headers: { cookie: alice, origin: 'https://other.example' } })).status, 403)
    const own = await rpc(alice, 'session/page', { request: { address: { kind: 'session', sessionId: 'a' }, throughSeq: -1 } })
    assert.equal(own.status, 200)
    assert.equal((await own.json()).result.value.text, 'a:private')
    assert.equal((await rpc(alice, 'session/page', { request: { address: { kind: 'session', sessionId: 'b' }, throughSeq: -1 } })).status, 403)
    assert.equal((await rpc(alice, 'credentials/set', { ref: 'SECRET', value: 'bad' })).status, 403)
    assert.deepEqual((await (await rpc(alice, 'session/list', { _request: {} })).json()).result.value.items, [{ sessionId: 'a' }])
    const created = await (await rpc(alice, 'session/create', { request: { workspaceId: 'wa', sessionId: 'new-explicit-session' } })).json()
    assert.equal(created.result.ok, true)
    const persisted = JSON.parse((await ctx.credentials.readRecord('dsh-auth/ownership')).payload)
    assert.equal(persisted.sessions[created.result.value.sessionId], 'alice')
    assert.equal((await rpc(bob, 'session/page', { request: { address: { kind: 'session', sessionId: created.result.value.sessionId }, throughSeq: -1 } })).status, 403)

    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/remote.mux', { headers: { cookie: alice } })
    sockets.push(ws)
    const frames = []
    ws.on('message', bytes => frames.push(JSON.parse(bytes)))
    await once(ws, 'open')
    const open = (streamId, endpoint, args) => ws.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }))
    async function frame(id, predicate = () => true) {
      for (let i = 0; i < 200; i++) {
        const found = frames.find(item => item.streamId === id && predicate(item))
        if (found) return found
        await pause(5)
      }
      throw new Error('Missing frame: ' + id + ' ' + JSON.stringify(frames))
    }
    open('own', 'session/follow', { request: { address: { kind: 'session', sessionId: 'a' } } })
    assert.equal((await frame('own')).value.text, 'a:private')
    open('other', 'session/follow', { request: { address: { kind: 'session', sessionId: 'b' } } })
    assert.equal((await frame('other')).type, 'error')
    assert.equal(calls.includes('follow:b'), false)
    open('control', 'session/control', {})
    const baseline = (await frame('control')).value.value
    assert.deepEqual(Object.keys(baseline.queues), ['a'])
    assert.deepEqual(Object.keys(baseline.jobs), ['a'])
    assert.deepEqual(Object.keys(baseline.projections), ['a'])
    open('events', '$events', {})
    const ready = await frame('events')
    assert.equal(ready.value.type, 'ready')
    eventQueue.push({ event: 'api-session/status', args: ['b', true] }, { event: 'api-session/status', args: ['a', true] })
    wake?.()
    const event = await frame('events', item => item.value.type === 'emit')
    assert.deepEqual(event.value.args, ['a', true])
    assert.equal(frames.some(item => item.value?.args?.[0] === 'b'), false)
    assert.equal((await rpc(bob, '$events/result', { clientId: ready.value.clientId, eventId: 'forged', outcome: { kind: 'next' } })).status, 403)

    const bobWs = new WebSocket(origin.replace('http:', 'ws:') + '/api/remote.mux', { headers: { cookie: bob } })
    sockets.push(bobWs)
    const bobFrames = []
    bobWs.on('message', bytes => bobFrames.push(JSON.parse(bytes)))
    await once(bobWs, 'open')
    bobWs.send(JSON.stringify({ type: 'open', streamId: 'bob-events', endpoint: '$events', payload: { args: {} } }))
    for (let i = 0; i < 100 && !bobFrames.some(item => item.value?.type === 'ready'); i++) await pause(5)
    assert.equal(bobFrames.some(item => item.value?.type === 'ready'), true)
    const settled = Promise.withResolvers()
    const subject = { ctx: agentContext }
    eventQueue.push({
      event: 'approval/request', request: { agent: subject, prompt: 'fixture approval' },
      context: { value: agentContext, subject }, resolve: settled.resolve, reject: settled.reject,
    })
    wake?.()
    const delivered = (await frame('events', item => item.value.type === 'waterfall')).value
    assert.equal(delivered.agentId, 'a')
    const answer = { clientId: ready.value.clientId, eventId: delivered.eventId, outcome: { kind: 'next' } }
    assert.equal((await rpc(bob, '$events/result', answer)).status, 403)
    const accepted = await rpc(alice, '$events/result', answer)
    assert.equal((await accepted.json()).result.ok, true)
    assert.deepEqual(await settled.promise, { kind: 'next' })
    assert.equal(bobFrames.some(item => item.value?.type === 'waterfall'), false)

    const customUser = await fetch(origin + '/auth/rpc/createUser', {
      method: 'POST', headers: { cookie: admin },
      body: JSON.stringify({ username: 'Alice.Team_2', password: fixturePassword }),
    })
    assert.equal(customUser.status, 200, 'valid usernames must survive current CredentialKey validation')
    assert.ok(await login('Alice.Team_2'))
    const removed = await fetch(origin + '/auth/rpc/deleteUser', { method: 'POST', headers: { cookie: admin }, body: JSON.stringify({ username: 'Alice.Team_2' }) })
    assert.equal(removed.status, 200)
    assert.equal(ctx.uiAuth.user('Alice.Team_2'), undefined)
    const reused = await fetch(origin + '/auth/rpc/createUser', { method: 'POST', headers: { cookie: admin }, body: JSON.stringify({ username: 'Alice.Team_2', password: fixturePassword }) })
    assert.equal(reused.status, 409, 'retired identities cannot inherit earlier ownership')
    const releaseGuard = ctx.uiAuth.registerPolicy('preset-guard', { remote: {
      matches: endpoint => endpoint === 'session/create',
      authorize: (_who, payload) => payload.args.request.agentPreset !== 'unreviewed',
    } })
    assert.equal((await rpc(alice, 'session/create', { request: { workspaceId: 'wa', agentPreset: 'unreviewed' } })).status, 403)
    releaseGuard()
    const releaseRpc = ctx.uiAuth.registerPolicy('rpc-restriction', { rpc: {
      matches: endpoint => endpoint === 'session/page',
      authorize: () => false, project: (_principal, value) => value,
    } })
    assert.equal((await rpc(alice, 'session/page', { request: { address: { kind: 'session', sessionId: 'a' }, throughSeq: -1 } })).status, 403)
    releaseRpc()



    // Unreviewed downstream business routes are closed until their owner registers a policy.
    ctx.webServer.register({ kind: 'exact', path: '/api/example/private', handler(req, res) {
      res.end(ctx.uiAuth.principal(req).username)
    } })
    assert.equal((await fetch(origin + '/api/example/private', { headers: { cookie: alice } })).status, 403)
    const unregister = ctx.uiAuth.registerPolicy('example', { http: {
      matches: ({ pathname }) => pathname === '/api/example/private',
      authorize: user => user.username === 'alice',
    } })
    assert.equal(await (await fetch(origin + '/api/example/private', { headers: { cookie: alice } })).text(), 'alice')
    assert.equal((await fetch(origin + '/api/example/private', { headers: { cookie: bob } })).status, 403)
    unregister()
    const closed = once(ws, 'close')
    await fetch(origin + '/auth/logout', { method: 'POST', headers: { cookie: alice } })
    await closed
    assert.equal((await rpc(alice, 'session/page', { request: { address: { kind: 'session', sessionId: 'a' }, throughSeq: -1 } })).status, 401)
    assert.equal((await rpc(admin, 'session/page', { request: { address: { kind: 'session', sessionId: 'b' }, throughSeq: -1 } })).status, 200)
    await releaseEvents()
  } finally {
    for (const ws of sockets) ws.terminate()
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
