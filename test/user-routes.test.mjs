// WP4 / R1-ii 单测：按用户配置的 provider 路由登记表（注册/更新/释放/失败处理）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UserRouteRegistry, routeIdOf } from '../lib/user-routes.js'

const spec = (over = {}) => ({
  profileId: 'p-1',
  routeId: 'ui-auth-p1',
  label: '我的配置',
  model: 'deepseek-chat',
  resolveKey: async () => 'sk-never-called-at-registration',
  ...over,
})

test('route ids are host-legal and derived from the profile id', () => {
  assert.equal(routeIdOf('a1b2c3d4-1111-2222-3333-444455556666'), 'ui-auth-a1b2c3d41111')
  assert.equal(routeIdOf('UPPER_case-id'), 'ui-auth-uppercaseid')
  assert.equal(routeIdOf('x', 'other'), 'other-x')
  assert.match(routeIdOf('AbC-123'), /^[a-z0-9-]+$/)
})

test('a route is registered once and released when the profile disappears', () => {
  const registered = []
  const disposed = []
  const registry = new UserRouteRegistry({
    register: (route) => { registered.push(route.routeId); return () => disposed.push(route.routeId) },
  })

  assert.equal(registry.ensure(spec()), true)
  assert.deepEqual(registered, ['ui-auth-p1'])
  assert.equal(registry.ensure(spec()), false, '同一签名不重复注册')
  assert.equal(registry.size(), 1)
  assert.equal(registry.has('p-1'), true)

  assert.equal(registry.dispose('p-1'), true)
  assert.deepEqual(disposed, ['ui-auth-p1'])
  assert.equal(registry.dispose('p-1'), false, '重复释放在报告上为 false')
  assert.equal(registry.size(), 0)
})

test('changing the model re-registers the route, and disposeAll clears everything', () => {
  const events = []
  const registry = new UserRouteRegistry({
    register: (route) => { events.push(`+${route.routeId}:${route.model}`); return () => events.push(`-${route.routeId}`) },
  })
  registry.ensure(spec())
  registry.ensure(spec({ model: 'deepseek-reasoner' }))
  assert.deepEqual(events, ['+ui-auth-p1:deepseek-chat', '-ui-auth-p1', '+ui-auth-p1:deepseek-reasoner'])
  registry.ensure(spec({ profileId: 'p-2', routeId: 'ui-auth-p2' }))
  assert.equal(registry.size(), 2)
  assert.equal(registry.disposeAll(), 2)
  assert.equal(registry.size(), 0)
})

test('key material is resolved lazily, and a failing registration never leaves a route behind', async () => {
  let resolved = 0
  const failing = new UserRouteRegistry({
    register: () => { throw new Error('宿主拒绝注册') },
    onError: (message) => { assert.match(message, /注册 provider 路由失败/) },
  })
  assert.equal(failing.ensure(spec({ resolveKey: async () => { resolved += 1; return 'k' } })), false)
  assert.equal(resolved, 0, '注册阶段绝不触碰 Key')
  assert.equal(failing.size(), 0)
  assert.equal(failing.has('p-1'), false)

  const registry = new UserRouteRegistry({ register: () => () => {} })
  const route = spec({ resolveKey: async () => { resolved += 1; return 'sk' } })
  registry.ensure(route)
  assert.equal(resolved, 0, '登记时不解析 Key（只在调用瞬间解析）')
  assert.equal(await route.resolveKey(), 'sk')
  assert.equal(resolved, 1)
})