// WP4 单测：信封加密、会话 KEK 注册表、改密重包裹，以及"无单一服务端密钥可解私有配置"。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadMasterKey, openShared } from '../lib/model-profiles.js'
import {
  KekRegistry, deriveUserKek, ensureUserKdf, openPrivateWithKek, rewrapWithKek, sealPrivateWithKek,
} from '../lib/profile-kek.js'

const ITER = 1000
const ALICE = 'uid-alice'
const BOB = 'uid-bob'
const SECRET = 'sk-envelope-secret-9876'

const memorySeam = () => {
  const map = new Map()
  return { map, async readRaw(key) { return map.get(key) }, async writeRaw(key, payload) { map.set(key, payload) } }
}

test('user KDF parameters are per-user and stable', async () => {
  const seam = memorySeam()
  const alice = await ensureUserKdf(seam, ALICE, ITER)
  assert.equal(alice.iterations, ITER)
  assert.equal((await ensureUserKdf(seam, ALICE, ITER)).salt, alice.salt, 'salt must be stable once created')
  const bob = await ensureUserKdf(seam, BOB, ITER)
  assert.notEqual(bob.salt, alice.salt, 'each user gets their own salt')
  // 键必须是宿主语法：恰好两段 <scope>/<id>（三段会让宿主凭据服务在下次启动时解析失败）
  const kdfKey = `dsh-auth/profile-kdf-${ALICE}`
  assert.equal(seam.map.has(kdfKey), true)
  assert.equal(kdfKey.split('/').length, 2, '凭据键只能有两段')
  assert.match(kdfKey, /^[a-z0-9-]+\/[a-z0-9-]+$/)
})

test('envelope round-trips, and every deviation is refused', async () => {
  const seam = memorySeam()
  const { salt, iterations } = await ensureUserKdf(seam, ALICE, ITER)
  const kek = await deriveUserKek('alice-pw', salt, iterations)
  const { wrappedDek, sealed } = await sealPrivateWithKek(kek, ALICE, 'p1', SECRET)
  assert.equal(await openPrivateWithKek(kek, ALICE, 'p1', wrappedDek, sealed), SECRET)

  const other = await deriveUserKek('alice-pw', (await ensureUserKdf(memorySeam(), ALICE, ITER)).salt, ITER)
  await assert.rejects(() => openPrivateWithKek(other, ALICE, 'p1', wrappedDek, sealed), 'another salt means another KEK')
  const wrongPw = await deriveUserKek('wrong-pw', salt, iterations)
  await assert.rejects(() => openPrivateWithKek(wrongPw, ALICE, 'p1', wrappedDek, sealed))
  await assert.rejects(() => openPrivateWithKek(kek, BOB, 'p1', wrappedDek, sealed), 'AAD binds the user')
  await assert.rejects(() => openPrivateWithKek(kek, ALICE, 'p2', wrappedDek, sealed), 'AAD binds the profile')

  const flipped = Buffer.from(sealed.ct, 'base64')
  flipped[0] ^= 0x01
  await assert.rejects(() => openPrivateWithKek(kek, ALICE, 'p1', wrappedDek, { ...sealed, ct: flipped.toString('base64') }))
  const flippedDek = Buffer.from(wrappedDek.ct, 'base64')
  flippedDek[0] ^= 0x01
  await assert.rejects(() => openPrivateWithKek(kek, ALICE, 'p1', { ...wrappedDek, ct: flippedDek.toString('base64') }, sealed))
})

test('no single server-side key opens a private profile, and nothing plaintext is stored', async () => {
  const seam = memorySeam()
  const master = await loadMasterKey(seam)
  const { salt, iterations } = await ensureUserKdf(seam, ALICE, ITER)
  const kek = await deriveUserKek('alice-pw', salt, iterations)
  const { wrappedDek, sealed } = await sealPrivateWithKek(kek, ALICE, 'p1', SECRET)

  // 服务端主密钥解不开 wrappedDek，也解不开 API Key 密文
  await assert.rejects(() => openShared(master, ALICE, 'p1', wrappedDek))
  await assert.rejects(() => openShared(master, ALICE, 'p1', sealed))

  // 落盘内容既无明文 Key，也无明文 DEK
  await seam.writeRaw(`dsh-auth/profile-private/${ALICE}`, JSON.stringify({ v: 1, profiles: [{ profileId: 'p1', wrappedDek, sealed }] }))
  const dump = [...seam.map.values()].join('\n')
  assert.equal(dump.includes(SECRET), false, 'api key must never reach storage')
  assert.equal(dump.includes('sk-envelope'), false)
})

test('password change re-wraps the DEK instead of re-encrypting the key', async () => {
  const seam = memorySeam()
  const before = await ensureUserKdf(seam, ALICE, ITER)
  const userKek = await deriveUserKek('old-pw', before.salt, before.iterations)
  const { wrappedDek, sealed } = await sealPrivateWithKek(userKek, ALICE, 'p1', SECRET)
  // 改密：换 salt 并重新派生，然后重包裹
  const after = await ensureUserKdf(seam, ALICE, ITER)
  const newKek = await deriveUserKek('new-pw', after.salt, after.iterations)
  const sealedBefore = sealed.ct
  const rewrapped = await rewrapWithKek(userKek, newKek, ALICE, 'p1', wrappedDek)
  assert.equal(await openPrivateWithKek(newKek, ALICE, 'p1', rewrapped, sealed), SECRET, '新口令可解')
  assert.notEqual(rewrapped.ct, wrappedDek.ct, '重包裹必须产生新的 wrappedDek')
  assert.notEqual(rewrapped.iv, wrappedDek.iv, '重包裹使用新的 IV')
  assert.equal(sealed.ct, sealedBefore, 'API Key 密文本身不变——只换了包裹层')
  await assert.rejects(() => openPrivateWithKek(userKek, ALICE, 'p1', rewrapped, sealed), '旧 KEK 不能再打开')
})

test('the session registry holds the KEK, never the password, and is uid-scoped', async () => {
  const seam = memorySeam()
  const { salt, iterations } = await ensureUserKdf(seam, ALICE, ITER)
  const kek = await deriveUserKek('alice-pw', salt, iterations)
  const registry = new KekRegistry()
  registry.set('token-alice', ALICE, kek)
  registry.set('token-bob', BOB, await deriveUserKek('bob-pw', (await ensureUserKdf(seam, BOB, ITER)).salt, ITER))

  assert.equal(registry.get('token-alice')?.uid, ALICE)
  assert.deepEqual(Array.from(registry.kekFor('token-alice', ALICE) ?? []), Array.from(kek))
  // 会话 uid 与配置所有者不一致 → 拿不到 KEK（INV-2 的会话级守卫）
  assert.equal(registry.kekFor('token-bob', ALICE), undefined)
  assert.equal(registry.kekFor('token-alice', BOB), undefined)

  assert.equal(registry.dropByUid(ALICE), 1, '删除/重置用户时其全部会话一并丢弃')
  assert.equal(registry.get('token-alice'), undefined)
  assert.equal(registry.kekFor('token-bob', BOB) !== undefined, true)
  registry.drop('token-bob')
  assert.equal(registry.size(), 0)
  // 注册表条目里没有口令字段
  registry.set('t', ALICE, kek)
  assert.equal(JSON.stringify([...Array.from(kek)]).includes('alice-pw'), false)
})