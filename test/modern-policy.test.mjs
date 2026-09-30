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

test('agent presets: the roster is readable, per-session use is owner-scoped, authoring stays admin-only', async () => {
  // 回归：ordinary 用户的【Agent 预设】设置页在加载时调用 agentPresets/list，
  // 被 deny-by-default 拒绝会让整页显示「无法加载 Agent 预设」。
  assert.equal(await policy.authorize(alice, 'agentPresets/list', { args: {} }), true)
  // read/select 是 agent 作用域：只允许作用在自己拥有的会话上。
  for (const method of ['agentPresets/read', 'agentPresets/select']) {
    assert.equal(await policy.authorize(alice, method, { args: { agentId: 'a', agentPreset: 'p' } }), true)
    assert.equal(await policy.authorize(alice, method, { args: { agentId: 'b', agentPreset: 'p' } }), false)
    assert.equal(await policy.authorize(alice, method, { args: {} }), false)
  }
  // 写出新的预设组合（可挂载插件与提示词）仍限管理员。
  for (const method of ['agentPresets/copy', 'agentPresets/deletePreset']) {
    assert.equal(await policy.authorize(alice, method, { args: { from: 'p', id: 'x', name: 'x' } }), false)
  }
  assert.equal(await policy.authorize({ username: 'root', role: 'admin' }, 'agentPresets/deletePreset', { args: { id: 'p' } }), true)
})

test('plugin inventory: the installed list is readable, mutating plugin endpoints stay closed', async () => {
  // 回归：普通用户的【插件】设置页只读清单（安装/卸载不是本项目的 RPC 面，白名单按端点登记）。
  assert.equal(await policy.authorize(alice, 'pluginInventory/list', { args: {} }), true)
  for (const method of [
    'pluginInventory/install',
    'pluginInventory/uninstall',
    'pluginInventory/enable',
    'pluginInventory/disable',
    'pluginInventory/update',
  ]) {
    assert.equal(await policy.authorize(alice, method, { args: { name: 'x' } }), false)
  }
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
    'llm/discoverModels', 'agentPresets/read', 'agentPresets/deletePreset',
    'dynamicCordisRunner/inventory', 'dynamicCordisRunner/invoke', 'dynamicCordisRunner/runHostHalf',
    'session/openWorkspacePath', 'workspace/create', 'commands/execute', 'subagents/list',
  ]) {
    assert.equal(await policy.authorize(alice, endpoint, payload()), false, `${endpoint} must stay closed`)
  }
  // Redacted read-only metadata stays available so the UI can render.
  // （agentPresets/list 与 pluginInventory/list 自 0.6.5 起属于这一档：只读清单可读，写操作仍拒。）
  assert.equal(await policy.authorize(alice, 'settings/describe', payload()), true)
  assert.equal(await policy.authorize(alice, 'llm/listProviders', payload()), true)
  assert.equal(await policy.authorize(alice, 'session/modelCatalog', payload()), true)
  assert.equal(await policy.authorize(alice, 'agentPresets/list', payload()), true)
  assert.equal(await policy.authorize(alice, 'pluginInventory/list', payload()), true)
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

// ---- v0.7.0 / DSH 0.2.0 新增面（WP2）----

test('0.2.0 plugin manager: the page reads are open, every write verb stays admin-only', async () => {
  // 插件管理器页在加载时调 listPlugins/listBundles/registries/inspect；被拒会让整页失败。
  for (const method of ['listPlugins', 'listBundles', 'registries', 'inspect']) {
    assert.equal(await policy.authorize(alice, `pluginManager/${method}`, { args: {} }), true)
    assert.equal(await policy.authorize(alice, `pluginManager/${method}`, { args: {} }, false), true)
  }
  // 安装/卸载/启停是部署方能力；凭据探测走网络，同样不开放。
  for (const method of ['installBundle', 'removeBundle', 'setPluginEnabled', 'setBundleEnabled', 'cancelInstall', 'waitForInstall']) {
    assert.equal(await policy.authorize(alice, `pluginManager/${method}`, { args: {} }), false)
  }
  assert.equal(await policy.authorize(alice, 'pluginRegistryProbe/fastest', { args: {} }), false)
  assert.equal(await policy.authorize(alice, 'pluginManager/futureWrite', { args: {} }), false)
  assert.equal(await policy.authorize(alice, 'permissionPresets/catalog', { args: {} }), true)
  assert.equal(await policy.authorize(alice, 'permissionPresets/set', { args: {} }), false)
})

test('question answering is ownership-scoped; the deployment account page stays closed', async () => {
  for (const method of ['userQuestions/answer', 'userQuestions/attachWait']) {
    assert.equal(await policy.authorize(alice, method, { args: { agentId: 'a' } }), true)
    assert.equal(await policy.authorize(alice, method, { args: { agentId: 'b' } }), false)
    assert.equal(await policy.authorize(alice, method, { args: { sessionId: 'a' } }), true)
    assert.equal(await policy.authorize(alice, method, { args: { sessionId: 'b' } }), false)
    assert.equal(await policy.authorize(alice, method, { args: {} }), false)
  }
  // Q7：原生账户页读写的是部署者的 DeepSeek 账号与钱包，普通用户一律拒绝（余额走 balanceQuery）。
  for (const method of ['account/getProfile', 'account/getBalance', 'account/watch', 'account/signOut', 'account/startSignIn', 'account/ackBonusNotified']) {
    assert.equal(await policy.authorize(alice, method, { args: {} }), false)
  }
  // open-in-app 的应用清单按会话归属；账户页的模型初始化不属于用户能力。
  assert.equal(await policy.authorize(alice, 'session/workspacePathApplications', { args: { sessionId: 'a' } }), true)
  assert.equal(await policy.authorize(alice, 'session/workspacePathApplications', { args: { sessionId: 'b' } }), false)
  assert.equal(await policy.authorize(alice, 'session/initializeDefaultModel', { args: { sessionId: 'a' } }), false)
})

test('officeToPdf requires a provable scope (Q8: user + session + workspace)', async () => {
  // 位置参数形态：(workspaceFileScopeId, path, priority)
  assert.equal(await policy.authorize(alice, 'officeToPdf/render', { args: ['a', 'doc.docx', 'normal'] }), true)
  assert.equal(await policy.authorize(alice, 'officeToPdf/render', { args: ['b', 'doc.docx', 'normal'] }), false)
  assert.equal(await policy.authorize(alice, 'officeToPdf/render', { args: ['doc.docx'] }), false) // scope 缺失 → 拒绝
  assert.equal(await policy.authorize(alice, 'officeToPdf/generation', { args: {} }), false)
  assert.equal(await policy.authorize(alice, 'officeToPdf/generation', { args: [] }), false)
  // 命名参数形态：另给 workspaceId 时必须同属请求者，否则拒绝。
  assert.equal(await policy.authorize(alice, 'officeToPdf/generation', { args: { workspaceFileScopeId: 'a', workspaceId: 'wa' } }), true)
  assert.equal(await policy.authorize(alice, 'officeToPdf/generation', { args: { workspaceFileScopeId: 'a', workspaceId: 'wb' } }), false)
  assert.equal(await policy.authorize(alice, 'officeToPdf/render', { args: { workspaceFileScopeId: 'a' } }), true)
})

test('R2: a per-user entitlement trims the catalog and gates model selection', async () => {
  const aliceScope = { providers: ['deepseek'], models: [{ provider: 'deepseek', model: 'deepseek-chat' }] }
  const restricted = createModernPolicy(owners, { entitlement: principal => principal.username === 'alice' ? aliceScope : undefined })

  // 模型目录：丢掉未授权 provider 分组与未授权模型；未知形状原样返回
  const catalog = {
    // 真实 0.2.0 形状（实测）：default + routableProviders + groups
    default: { provider: 'deepseek', model: 'deepseek-chat' },
    routableProviders: ['deepseek', 'openai'],
    groups: [
      { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] },
      { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4o' }] },
    ],
  }
  const trimmed = await restricted.result(alice, 'session/modelCatalog', catalog)
  assert.deepEqual(trimmed.groups.map(group => group.id), ['deepseek'])
  assert.deepEqual(trimmed.groups[0].models.map(model => model.id), ['deepseek-chat'])
  assert.deepEqual(trimmed.default, catalog.default, '授权内的默认值保留')
  assert.deepEqual(trimmed.routableProviders, ['deepseek'], 'routableProviders 同步裁剪')

  // provider 列表裁剪
  const providers = [{ id: 'deepseek' }, { id: 'openai' }]
  assert.deepEqual(await restricted.result(alice, 'llm/listProviders', providers), [{ id: 'deepseek' }])
  assert.deepEqual(await restricted.result(alice, 'llm/listConfigurableProviders', providers), [{ id: 'deepseek' }])

  // 切换模型：授权范围内放行，越界或非本会话拒绝
  assert.equal(await restricted.authorize(alice, 'session/selectModel', { args: { sessionId: 'a', provider: 'deepseek', model: 'deepseek-chat' } }), true)
  assert.equal(await restricted.authorize(alice, 'session/selectModel', { args: { sessionId: 'a', provider: 'deepseek', model: 'deepseek-reasoner' } }), false)
  assert.equal(await restricted.authorize(alice, 'session/selectModel', { args: { sessionId: 'a', provider: 'openai', model: 'gpt-4o' } }), false)
  assert.equal(await restricted.authorize(alice, 'session/selectModel', { args: { sessionId: 'b', provider: 'deepseek', model: 'deepseek-chat' } }), false)

  // 管理员不受裁剪；未提供 entitlement 时行为与以前一致
  const admin = { username: 'root', role: 'admin' }
  assert.deepEqual((await restricted.result(admin, 'session/modelCatalog', catalog)), catalog)
  assert.deepEqual(await restricted.result(alice, 'session/modelCatalog', { groups: 'unknown-shape' }), { groups: 'unknown-shape' })
  assert.deepEqual(await policy.result(alice, 'session/modelCatalog', catalog), catalog, '未配置授权时不裁剪')
})
