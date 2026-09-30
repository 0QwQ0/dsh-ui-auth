// WP4b 单测：ProfileService —— Key 永不回传、Q2 阻断、分享授予/撤销、R1 解析、余额缓存与限流。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProfileStore } from '../lib/model-profiles.js'
import { KekRegistry } from '../lib/profile-kek.js'
import { ProfileService } from '../lib/profile-service.js'

const ALICE_KEY = 'sk-alice-key-1111'
const BOB_KEY = 'sk-bob-key-2222'
const SHARED_KEY = 'sk-shared-key-3333'

const memorySeam = () => {
  const map = new Map()
  return { map, async readRaw(key) { return map.get(key) }, async writeRaw(key, payload) { map.set(key, payload) } }
}

/** 搭一个双用户环境：alice（管理员/分享者）、bob（普通用户）。 */
async function harness({ withBalance = false } = {}) {
  const seam = memorySeam()
  const store = new ProfileStore(seam)
  const registry = new KekRegistry()
  const aliceUid = await store.ensureUid('alice')
  const bobUid = await store.ensureUid('bob')
  const nameByUid = new Map([[aliceUid, 'alice'], [bobUid, 'bob']])
  const uidByName = new Map([['alice', aliceUid], ['bob', bobUid]])
  // sessionOwner 与 index.ts 的 ownerOfSession 一致：返回**用户名**，再由 uidOf 换成 uid
  const owners = new Map([['s-alice', 'alice'], ['s-bob', 'bob']])
  let balanceCalls = 0
  const service = new ProfileService({
    store, seam, registry,
    sessionOwner: (sessionId) => owners.get(sessionId),
    uidOf: async (username) => uidByName.get(username),
    ...(withBalance ? { balanceFetcher: async () => { balanceCalls += 1; return { currency: 'CNY', total: 42.5 } } } : {}),
  })
  await service.bindSession(aliceUid, 't-alice', 'alice-pw')
  await service.bindSession(bobUid, 't-bob', 'bob-pw')
  return { seam, store, registry, service, aliceUid, bobUid, balanceCalls: () => balanceCalls }
}

test('password change re-wraps existing private profiles, and is a no-op without them', async () => {
  const h = await harness()
  await h.service.createProfile(h.aliceUid, { label: 'a', provider: 'deepseek', model: 'deepseek-chat', apiKey: ALICE_KEY })
  assert.equal(await h.service.changePassword(h.aliceUid, 't-alice', 'alice-pw', 'alice-pw2'), 1, '一条配置被重包裹')
  // 新口令下原 Key 仍可解出（重包裹只换了包裹层）
  assert.deepEqual(await h.service.resolveKeyForSession('s-alice'), {
    ok: true, apiKey: ALICE_KEY, provider: 'deepseek', model: 'deepseek-chat', source: 'own',
  })
  // 旧口令已无法解开重包裹后的 DEK
  await assert.rejects(() => h.service.changePassword(h.aliceUid, 't-alice', 'alice-pw', 'alice-pw3'))
  // bob 有 KDF 记录（harness 里 bindSession 过）但没有配置 → 重包裹 0 条，且清单仍为空
  assert.equal(await h.service.changePassword(h.bobUid, 't-bob', 'bob-pw', 'bob-pw2'), 0, '没有配置就没有可重包裹的记录')
  assert.deepEqual(await h.service.listProfiles(h.bobUid), [])
})

test('profiles are created, listed and updated without ever returning key material', async () => {
  const { service, aliceUid } = await harness()
  const created = await service.createProfile(aliceUid, { label: '我的 Key', provider: 'deepseek', model: 'deepseek-chat', apiKey: ALICE_KEY })
  assert.equal(created.hasKey, true)
  assert.equal(created.hint, '…1111')
  assert.equal(created.isDefault, true, '第一条配置自动成为默认')
  assert.equal(JSON.stringify(created).includes(ALICE_KEY), false)
  assert.equal('sealed' in created, false)
  assert.equal('wrappedDek' in created, false)

  const listed = await service.listProfiles(aliceUid)
  assert.equal(listed.length, 1)
  assert.equal(JSON.stringify(listed).includes('ct'), false, '列表不含任何密文字段')
  assert.equal(JSON.stringify(listed).includes(ALICE_KEY), false)

  const updated = await service.updateProfile(aliceUid, created.profileId, { label: '改名', apiKey: BOB_KEY })
  assert.equal(updated.label, '改名')
  assert.equal(updated.hint, '…2222')
  // 新 Key 生效、旧 Key 不再可解析
  const resolved = await service.resolveKeyForSession('s-alice')
  assert.deepEqual(resolved.ok && resolved.apiKey, BOB_KEY)

  assert.equal(await service.removeProfile(aliceUid, created.profileId), true)
  assert.equal((await service.listProfiles(aliceUid)).length, 0)
  assert.deepEqual(await service.resolveKeyForSession('s-alice'), { ok: false, reason: 'no-profile' })
})

test('R1 resolution: own profile, blocked without one (Q2), locked without a session KEK, parent fallback (Q11c)', async () => {
  const { service, registry, aliceUid, bobUid } = await harness()
  await service.createProfile(aliceUid, { label: 'alice', provider: 'deepseek', model: 'deepseek-chat', apiKey: ALICE_KEY })

  const own = await service.resolveKeyForSession('s-alice')
  assert.deepEqual(own, { ok: true, apiKey: ALICE_KEY, provider: 'deepseek', model: 'deepseek-chat', source: 'own' })

  // Q2：bob 没有任何配置也不继承部署级配置 → 明确阻断
  assert.deepEqual(await service.resolveKeyForSession('s-bob'), { ok: false, reason: 'no-profile' })
  // 无归属的会话
  assert.deepEqual(await service.resolveKeyForSession('s-unknown'), { ok: false, reason: 'no-session' })
  assert.deepEqual(await service.resolveKeyForSession(undefined), { ok: false, reason: 'no-session' })
  // Q11(c)：子代理会话没有直接归属，用父会话继承
  const inherited = await service.resolveKeyForSession('s-child', 's-alice')
  assert.equal(inherited.ok, true)
  assert.equal(inherited.ok && inherited.apiKey, ALICE_KEY)

  // 未解锁（KEK 不在内存）→ locked，绝不回退
  registry.drop('t-alice')
  assert.deepEqual(await service.resolveKeyForSession('s-alice'), { ok: false, reason: 'locked' })
  assert.equal(service.isUnlocked(aliceUid), false)
  assert.equal(service.isUnlocked(bobUid), true, '解锁状态按用户隔离，互不影响')
  await service.unbindSession(bobUid, 't-bob')
  assert.equal(service.isUnlocked(bobUid), false, '登出后 KEK 立即丢弃')
})

test('admin sharing: grantee can use the key without seeing it, and revocation is fail-closed (Q6)', async () => {
  const { service, aliceUid, bobUid } = await harness()
  const { profileId } = await service.createShared(aliceUid, { label: '管理员分享', provider: 'deepseek', model: 'deepseek-reasoner', apiKey: SHARED_KEY })
  assert.equal(await service.grantShare(aliceUid, 'alice', bobUid, profileId), true)

  const shares = await service.listShares(bobUid)
  assert.equal(shares.length, 1)
  assert.equal(shares[0].selected, false, '分享不自动成为默认（Q3）')
  assert.equal(JSON.stringify(shares).includes(SHARED_KEY), false, '分享清单不含 Key')

  // 未选用时仍走自己的配置 → 没有配置即阻断
  assert.deepEqual(await service.resolveKeyForSession('s-bob'), { ok: false, reason: 'no-profile' })
  assert.equal(await service.selectShare(bobUid, aliceUid, profileId), true)
  const viaShare = await service.resolveKeyForSession('s-bob')
  assert.deepEqual(viaShare, { ok: true, apiKey: SHARED_KEY, provider: 'deepseek', model: 'deepseek-reasoner', source: 'shared' })
  assert.equal((await service.listShares(bobUid))[0].selected, true)

  // 选一个不存在的分享被拒
  assert.equal(await service.selectShare(bobUid, aliceUid, 'nope'), false)

  // 撤销 → 立即 fail-closed，不再持有该分享
  await service.revokeShare(aliceUid, bobUid, profileId)
  assert.deepEqual(await service.resolveKeyForSession('s-bob'), { ok: false, reason: 'no-profile' })
  assert.equal((await service.listShares(bobUid)).length, 0)
})

test('share usage is aggregated for the owner only, and carries no key material', async () => {
  const h = await harness()
  const { profileId } = await h.service.createShared(h.aliceUid, { label: '分享', provider: 'deepseek', model: 'deepseek-chat', apiKey: SHARED_KEY })
  await h.service.grantShare(h.aliceUid, 'alice', h.bobUid, profileId)
  await h.service.recordUsage(h.aliceUid, h.bobUid, profileId, 120)
  await h.service.recordUsage(h.aliceUid, h.bobUid, profileId, 80)
  const usage = await h.service.usageFor(h.aliceUid)
  assert.equal(usage.length, 1)
  assert.equal(usage[0].targetUid, h.bobUid)
  assert.equal(usage[0].profileId, profileId)
  assert.deepEqual({ calls: usage[0].calls, tokens: usage[0].tokens }, { calls: 2, tokens: 200 })
  assert.equal(JSON.stringify(usage).includes(SHARED_KEY), false, '用量视图不含 Key')
  // 用量按所有者分区：被授权者看不到所有者的统计
  assert.deepEqual(await h.service.usageFor(h.bobUid), [])
})

test('balance: numbers only, cached for 60s and rate-limited per user', async () => {
  const h = await harness({ withBalance: true })
  await h.service.createProfile(h.aliceUid, { label: 'a', provider: 'deepseek', model: 'deepseek-chat', apiKey: ALICE_KEY })
  const first = await h.service.balanceOf(h.aliceUid)
  assert.equal(first.error, undefined)
  assert.equal(first.currency, 'CNY')
  assert.equal(first.total, 42.5)
  assert.equal(JSON.stringify(first).includes(ALICE_KEY), false)
  assert.equal(h.balanceCalls(), 1)

  // 60s 内命中缓存（不再请求）
  const cached = await h.service.balanceOf(h.aliceUid)
  assert.equal(cached.total, 42.5)
  assert.equal(h.balanceCalls(), 1, 'TTL 内必须走缓存')

  // 另一个用户立即查询 → 该用户自己的最小间隔未到（首次）→ 允许；再查同一用户 → 限流
  const again = await h.service.balanceOf(h.aliceUid, 'unknown-profile')
  assert.equal(again.error, 'rate-limited')

  // 没有 fetcher 时明确 unavailable；无配置时 no-profile
  const bare = await harness()
  assert.deepEqual(await bare.service.balanceOf(bare.aliceUid), { error: 'unavailable' })
  const noProfile = await harness({ withBalance: true })
  assert.deepEqual(await noProfile.service.balanceOf(noProfile.bobUid), { error: 'no-profile' })
})

test('unauthorized identities cannot reach another user profile or key', async () => {
  const { service, aliceUid, bobUid } = await harness()
  await service.createProfile(aliceUid, { label: 'alice', provider: 'deepseek', model: 'deepseek-chat', apiKey: ALICE_KEY })
  // bob 修改/删除 alice 的配置：找不到 → 拒绝（store 层 assertSameUser 同样会拦）
  assert.equal(await service.updateProfile(bobUid, (await service.listProfiles(aliceUid))[0].profileId, { label: 'x' }), undefined)
  assert.equal(await service.removeProfile(bobUid, (await service.listProfiles(aliceUid))[0].profileId), false)
  assert.deepEqual(await service.listProfiles(bobUid), [])
  // bob 建**自己**的配置是合法的，且不影响 alice 的清单
  const bobOwn = await service.createProfile(bobUid, { label: 'bob 自己', provider: 'deepseek', model: 'deepseek-chat', apiKey: BOB_KEY })
  assert.equal(bobOwn.isDefault, true)
  assert.equal(bobOwn.source, 'own')
  assert.equal((await service.listProfiles(aliceUid)).length, 1)
})