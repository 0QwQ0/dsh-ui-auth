// WP3 单测：私有配置的加密不可读性（INV-1/INV-4）、AAD 绑定、按 uid 分区与跨用户守卫。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ProfileStore, assertSameUser, deriveKek, keyHint, loadMasterKey, openPrivate, openShared,
  sealPrivate, sealShared, DEFAULT_KDF_ITERATIONS,
} from '../lib/model-profiles.js'

// 测试用低迭代（生产默认是 600k）：只验证流程与认证失败语义
const ITER = 1000
const ALICE = 'uid-alice'
const BOB = 'uid-bob'
const SECRET = 'sk-alice-secret-12345'

const memorySeam = () => {
  const map = new Map()
  return {
    map,
    async readRaw(key) { return map.get(key) },
    async writeRaw(key, payload) { map.set(key, payload) },
  }
}

test('private profiles round-trip under the owner password only', async () => {
  const sealed = await sealPrivate('alice-pw', ALICE, 'p1', SECRET, ITER)
  assert.equal(await openPrivate('alice-pw', ALICE, 'p1', sealed), SECRET)
  await assert.rejects(() => openPrivate('wrong-pw', ALICE, 'p1', sealed), /operation|decrypt|Unwrap|错误|不正|fail/i)
})

test('tampering and AAD swaps are rejected (GCM authentication)', async () => {
  const sealed = await sealPrivate('alice-pw', ALICE, 'p1', SECRET, ITER)
  // 篡改密文
  const flipped = Buffer.from(sealed.ct, 'base64')
  flipped[0] ^= 0x01
  await assert.rejects(() => openPrivate('alice-pw', ALICE, 'p1', { ...sealed, ct: flipped.toString('base64') }))
  // 换 uid（另一个用户）
  await assert.rejects(() => openPrivate('alice-pw', BOB, 'p1', sealed))
  // 换 profileId（同一个用户的另一条配置）
  await assert.rejects(() => openPrivate('alice-pw', ALICE, 'p2', sealed))
})

test('INV-4: the server master key cannot open a private profile, and nothing plaintext lands on disk', async () => {
  const seam = memorySeam()
  const master = await loadMasterKey(seam)
  const store = new ProfileStore(seam)
  const sealed = await sealPrivate('alice-pw', ALICE, 'p1', SECRET, ITER)
  await store.writePrivate(ALICE, {
    profileId: 'p1', label: '我的 Key', provider: 'deepseek', model: 'deepseek-chat',
    hint: keyHint(SECRET), sealed, createdAt: 'now', updatedAt: 'now',
  })
  // 主密钥（服务端可解分享配置）解不开私有配置
  await assert.rejects(() => openShared(master, ALICE, 'p1', sealed))
  // 落盘内容中不得出现明文 Key
  const dump = [...seam.map.values()].join('\n')
  assert.equal(dump.includes(SECRET), false, 'private key must never appear in storage')
  assert.equal(dump.includes('sk-alice'), false)
  // 主密钥本身只落盘为独立记录，且不在私有记录里
  const masterRaw = seam.map.get('dsh-auth/profile-master')
  assert.ok(typeof masterRaw === 'string' && masterRaw.includes('"v":1'))
})

test('shared profiles are server-custodied: master opens them, private does not open them', async () => {
  const master = await loadMasterKey(memorySeam())
  const sealed = await sealShared(master, ALICE, 'shared-1', 'sk-shared-9999')
  assert.equal(await openShared(master, ALICE, 'shared-1', sealed), 'sk-shared-9999')
  await assert.rejects(() => openShared(master, ALICE, 'other', sealed))
  // 另一把主密钥解不开
  const another = await loadMasterKey(memorySeam())
  await assert.rejects(() => openShared(another, ALICE, 'shared-1', sealed))
})

test('storage is partitioned by uid and cross-user reads are refused (INV-2)', async () => {
  const seam = memorySeam()
  const store = new ProfileStore(seam)
  const aliceUid = await store.ensureUid('alice')
  const bobUid = await store.ensureUid('bob')
  assert.notEqual(aliceUid, bobUid)
  assert.equal(await store.ensureUid('alice'), aliceUid, 'uid must be stable')

  const sealed = await sealPrivate('alice-pw', aliceUid, 'p1', SECRET, ITER)
  await store.writePrivate(aliceUid, {
    profileId: 'p1', label: '我的 Key', provider: 'deepseek', model: 'deepseek-chat',
    hint: keyHint(SECRET), sealed, createdAt: 'now', updatedAt: 'now',
  })

  // 本人可见
  assert.deepEqual((await store.listPrivate(aliceUid, aliceUid)).map(p => p.profileId), ['p1'])
  // 他人读取被拒（代码级守卫）
  await assert.rejects(() => store.listPrivate(bobUid, aliceUid), /跨用户/)
  await assert.rejects(() => store.readPrivate(bobUid, aliceUid, 'p1'), /跨用户/)
  assert.throws(() => assertSameUser(bobUid, aliceUid), /跨用户/)
  // 列表不含密文/Key 材料
  const meta = (await store.listPrivate(aliceUid, aliceUid))[0]
  assert.equal('sealed' in meta, false)
  assert.equal(JSON.stringify(meta).includes('ct'), false)
})

test('grants and received shares stay key-free and per-user', async () => {
  const seam = memorySeam()
  const store = new ProfileStore(seam)
  await store.writeGrants(ALICE, { v: 1, grants: { [BOB]: { profileIds: ['shared-1'], updatedAt: 'now' } } })
  const table = await store.readGrants(ALICE)
  assert.deepEqual(table.grants[BOB].profileIds, ['shared-1'])
  assert.deepEqual(await store.readGrants(BOB), { v: 1, grants: {} })

  await store.writeReceived(BOB, [{
    ownerUid: ALICE, ownerName: 'alice', profileId: 'shared-1', label: '管理员分享',
    provider: 'deepseek', model: 'deepseek-chat', selected: false,
  }])
  const received = await store.readReceived(BOB)
  assert.equal(received.length, 1)
  assert.equal(received[0].selected, false, '分享不自动成为默认')
  assert.equal(JSON.stringify(received).includes('sk-'), false)
})

test('key hints are irreversible and KDF parameters are versioned', async () => {
  assert.equal(keyHint('sk-abcdef1234567890'), 'sk-a...7890')
  assert.equal(keyHint('ab'), '…')
  const sealed = await sealPrivate('pw', ALICE, 'p1', SECRET, ITER)
  assert.equal(sealed.v, 1)
  assert.equal(sealed.alg, 'AES-256-GCM')
  assert.equal(sealed.kdf.iterations, ITER)
  assert.ok(DEFAULT_KDF_ITERATIONS >= 600_000, '生产默认迭代次数不得低于 OWASP 量级')
  // 同一口令两次封存产生不同密文（随机 salt/iv）
  const again = await sealPrivate('pw', ALICE, 'p1', SECRET, ITER)
  assert.notEqual(again.ct, sealed.ct)
  assert.notEqual(again.kdf.salt, sealed.kdf.salt)
  // 口令派生的 KEK 也随 salt 变化
  const kekA = await deriveKek('pw', new Uint8Array(16), ITER)
  const kekB = await deriveKek('pw', new Uint8Array(16).fill(1), ITER)
  assert.notDeepEqual(Array.from(kekA), Array.from(kekB))
})