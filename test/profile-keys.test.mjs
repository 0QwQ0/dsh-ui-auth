// 回归测试：写出的凭据键必须符合宿主语法（恰好两段、小写连字符），否则宿主下次启动会解析失败。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProfileStore, profileKey } from '../lib/model-profiles.js'

const HOST_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/

test('credential keys are exactly <scope>/<id> -- a third segment bricks the host', async () => {
  const written = []
  const seam = { async readRaw() { return undefined }, async writeRaw(key) { written.push(key) } }
  const store = new ProfileStore(seam)
  await store.ensureUid('alice')
  await store.writePrivate('uid-alice', {
    profileId: 'p1', label: 'a', provider: 'deepseek', model: 'deepseek-chat', hint: '…1234',
    sealed: { v: 1, alg: 'AES-256-GCM', iv: 'x', ct: 'y' }, createdAt: 'now', updatedAt: 'now',
  })
  await store.writeReceived('uid-alice', [])
  await store.writeGrants('uid-alice', { v: 1, grants: {} })
  assert.ok(written.length >= 3, '至少写了 uid/私有/接收 三类记录')
  for (const key of written) {
    assert.equal(key.split('/').length, 2, `键必须是两段：${key}`)
    assert.match(key, HOST_KEY, `键不符合宿主语法：${key}`)
  }
  assert.equal(profileKey('profile-kdf-411e8257-39f6-48bb-bd42-58e300a24d62'), 'dsh-auth/profile-kdf-411e8257-39f6-48bb-bd42-58e300a24d62')
  assert.throws(() => profileKey('profile-kdf/uid'), /非法/)
  assert.throws(() => profileKey('Bad_Id'), /非法/)
})