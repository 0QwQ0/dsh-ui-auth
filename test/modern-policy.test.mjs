import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModernPolicy } from '../lib/modern-policy.js'

const alice = { username: 'alice', role: 'user' }
const owners = { session: id => id === 'a' ? 'alice' : 'bob', workspace: id => id === 'wa' ? 'alice' : 'bob', sessionExists: async id => id !== 'new', claimSession: async () => {} }
const policy = createModernPolicy(owners)
const request = value => ({ args: { request: value } })

test('current unary and logical-stream session access uses the nested request', async () => {
  for (const method of ['prompt', 'attachment', 'cancel', 'fork']) {
    assert.equal(await policy.authorize(alice, `session/${method}`, request({ sessionId: 'a' })), true)
    assert.equal(await policy.authorize(alice, `session/${method}`, request({ sessionId: 'b' })), false)
  }
  for (const method of ['page', 'follow']) {
    assert.equal(await policy.authorize(alice, `session/${method}`, request({ address: { kind: 'session', sessionId: 'a' } })), true)
    assert.equal(await policy.authorize(alice, `session/${method}`, request({ address: { kind: 'session', sessionId: 'b' } })), false)
    assert.equal(await policy.authorize(alice, `session/${method}`, request({ address: { kind: 'subagent', parentSessionId: 'b', childSessionId: 'a' } })), false)
  }
  assert.equal(await policy.authorize(alice, 'session/page', { sessionId: 'a' }), false)
  // 0.1.5: session/follow is a stream endpoint; the same address check must hold with the stream flag.
  assert.equal(await policy.authorize(alice, 'session/follow', request({ address: { kind: 'session', sessionId: 'a' } }), true), true)
  assert.equal(await policy.authorize(alice, 'session/follow', request({ address: { kind: 'session', sessionId: 'b' } }), true), false)
})

test('unreviewed endpoints, global settings and arbitrary paths are refused', async () => {
  for (const method of ['session/futureRead', 'settings/update', 'credentials/set', 'workspace/create', 'commands/execute', 'reports/runs']) {
    assert.equal(await policy.authorize(alice, method, request({ sessionId: 'a' })), false)
  }
  assert.equal(await policy.authorize(alice, 'session/create', request({ workspaceId: 'wa', cwd: '/bob' })), false)
})

test('creation requires an owned Workspace and checks cold identity adoption', async () => {
  assert.equal(await policy.authorize(alice, 'session/create', request({ workspaceId: 'wa', sessionId: 'new' })), true)
  assert.equal(await policy.authorize(alice, 'session/create', request({ workspaceId: 'wa', sessionId: 'b' })), false)
  assert.equal(await policy.authorize(alice, 'session/create', request({ workspaceId: 'wb' })), false)
})

test('every key in the control baseline is filtered', () => {
  const data = { a: { text: 'mine' }, b: { text: 'private' } }
  assert.deepEqual(policy.frame(alice, 'session/control', { type: 'baseline', value: { queues: data, jobs: data, projections: data } }), {
    type: 'baseline', value: { queues: { a: data.a }, jobs: { a: data.a }, projections: { a: data.a } },
  })
  assert.equal(policy.frame(alice, 'session/control', { type: 'jobs', sessionId: 'b', jobs: ['private'] }), null)
})

test('Workspace baselines, membership, order and archive frames stay scoped', () => {
  const frame = policy.frame(alice, 'workspace/follow', { type: 'baseline', value: { items: [
    { workspaceId: 'wa', sessionIds: ['a', 'b'] }, { workspaceId: 'wb', sessionIds: ['b'] },
  ], archivedSessionIds: ['a', 'b'] } })
  assert.deepEqual(frame.value, { items: [{ workspaceId: 'wa', sessionIds: ['a'] }], archivedSessionIds: ['a'] })
  assert.deepEqual(policy.frame(alice, 'workspace/follow', { type: 'order', workspaceIds: ['wa', 'wb'] }).workspaceIds, ['wa'])
  assert.equal(policy.frame(alice, 'workspace/follow', { type: 'upsert', workspace: { workspaceId: 'wb' } }), null)
})

test('Remote approval delivery retains only owned event correlations', () => {
  const correlation = { events: new Set() }
  const other = { type: 'waterfall', agentId: 'b', eventId: 'other' }
  assert.equal(policy.frame(alice, '$events', other, correlation), null)
  const own = { type: 'waterfall', agentId: 'a', eventId: 'own' }
  assert.deepEqual(policy.frame(alice, '$events', own, correlation), own)
  assert.deepEqual([...correlation.events], ['own'])
  assert.equal(policy.frame(alice, '$events', { type: 'cancel', eventId: 'other' }, correlation), null)
  policy.frame(alice, '$events', { type: 'cancel', eventId: 'own' }, correlation)
  assert.equal(correlation.events.size, 0)
})

test('Host events without reviewed scope do not leak plugin or credential activity', () => {
  assert.equal(policy.frame(alice, '$events', { type: 'emit', event: 'credentials/reference-updated', args: ['private-key'] }, {}), null)
  assert.equal(policy.frame(alice, '$events', { type: 'emit', event: 'api-session/status', args: ['b', true] }, {}), null)
  const own = { type: 'emit', event: 'api-session/added', args: [{ sessionId: 'a' }] }
  assert.deepEqual(policy.frame(alice, '$events', own, {}), own)
})

test('creation does not return before ownership persistence', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const guarded = createModernPolicy({ ...owners, claimSession: () => pending })
  let returned = false
  const result = guarded.result(alice, 'session/create', { sessionId: 'new' }).then(() => { returned = true })
  await Promise.resolve()
  assert.equal(returned, false)
  finish()
  await result
  assert.equal(returned, true)
})

// ---- 0.1.5 surface additions -------------------------------------------------

test('workspaceFiles is scoped by the owning Session', async () => {
  const scope = id => ({ args: { workspaceFileScopeId: id, path: 'a.txt' } })
  for (const method of ['read', 'readBytes', 'readAll', 'readRelated', 'stat', 'list']) {
    assert.equal(await policy.authorize(alice, `workspaceFiles/${method}`, scope('a')), true)
    assert.equal(await policy.authorize(alice, `workspaceFiles/${method}`, scope('b')), false)
  }
  assert.equal(await policy.authorize(alice, 'workspaceFiles/changes', scope('a'), true), true)
  assert.equal(await policy.authorize(alice, 'workspaceFiles/changes', scope('b'), true), false)
})

test('agent-scoped verbs follow the owning Session', async () => {
  const agent = id => ({ args: { agentId: id } })
  assert.equal(await policy.authorize(alice, 'commands/list', agent('a')), true)
  assert.equal(await policy.authorize(alice, 'commands/list', agent('b')), false)
  assert.equal(await policy.authorize(alice, 'goals/get', agent('a')), true)
  assert.equal(await policy.authorize(alice, 'goals/create', agent('b')), false)
  assert.equal(await policy.authorize(alice, 'fileUploads/upload', agent('a')), true)
  assert.equal(await policy.authorize(alice, 'fileReferences/list', agent('a')), true)
  assert.equal(await policy.authorize(alice, 'sessionReferenceResolver/candidates', agent('a')), true)
  assert.equal(await policy.authorize(alice, 'skills/list', request({ sessionId: 'a' })), true)
  assert.equal(await policy.authorize(alice, 'skills/list', request({ sessionId: 'b' })), false)
})

test('host-wide administration stays unreachable for ordinary users', async () => {
  const payload = () => ({ args: {} })
  for (const endpoint of [
    'credentials/describe', 'credentials/set', 'credentials/unset',
    'settings/update', 'settings/replace', 'settings/mutate', 'settings/openSettingsDocument',
    'directoryPicker/pick', 'directoryPicker/list', 'directoryPicker/createDirectory',
    'llm/discoverModels', 'pluginInventory/list', 'agentPresets/read', 'agentPresets/deletePreset',
    'dynamicCordisRunner/inventory', 'dynamicCordisRunner/invoke', 'dynamicCordisRunner/runHostHalf',
    'session/openWorkspacePath', 'workspace/create', 'commands/execute', 'subagents/list',
  ]) {
    assert.equal(await policy.authorize(alice, endpoint, payload()), false, `${endpoint} must stay closed`)
  }
  // Redacted read-only metadata stays available so the UI can render.
  assert.equal(await policy.authorize(alice, 'settings/describe', payload()), true)
  assert.equal(await policy.authorize(alice, 'llm/listProviders', payload()), true)
  assert.equal(await policy.authorize(alice, 'session/modelCatalog', payload()), true)
})

test('session/list reads the flat _request wire name and is owner-filtered', async () => {
  assert.equal(await policy.authorize(alice, 'session/list', { args: { _request: {} } }), true)
  const value = await policy.result(alice, 'session/list', { items: [{ sessionId: 'a' }, { sessionId: 'b' }] })
  assert.deepEqual(value.items, [{ sessionId: 'a' }])
})

test('unattributable forwarded events are not delivered to ordinary users', () => {
  for (const event of [
    'commands/change', 'credentials/reference-updated', 'llm/adapters-updated',
    'settings/document-updated', 'cordis/dynamic-package', 'cordis/dynamic-retract',
    'cordis/request-run-resolved', 'cordis/inspect-query-resolved',
  ]) {
    assert.equal(policy.frame(alice, '$events', { type: 'emit', event, args: [] }, {}), null, `${event} must not leak`)
  }
  const ready = { type: 'ready', clientId: 'c1' }
  const correlation = {}
  assert.deepEqual(policy.frame(alice, '$events', ready, correlation), ready)
  assert.equal(correlation.clientId, 'c1')
})
