/**
 * WP4：会话密钥生命周期与私有配置的**信封加密**（见 docs/RBAC-MODEL-PROFILES.md 附录 A.5）。
 *
 * 结构：
 *   userKek = PBKDF2-SHA256(登录口令, 用户级 salt, ≥600k)      ← 只存在于该用户会话内存
 *   dek     = 随机 32 字节                                       ← 每条私有配置一个
 *   记录     = { wrappedDek: seal(userKek, aad, dek), sealed: seal(dek, aad, apiKey) }
 *   aad     = `${uid}/${profileId}`（密文不能在别处重放）
 *
 * 因此：存储里没有明文 Key，也没有能解出它的单一服务端密钥；口令变更只需用旧 KEK 解出 DEK
 * 再用新 KEK 重包裹；会话**不持有口令**，登出即丢弃 userKek。
 */
import {
  DEFAULT_KDF_ITERATIONS, deriveKek, openUnder, profileKey, randomDek, sealUnder,
  type ProfileSeam, type SealedKey,
} from './model-profiles.js'

const keyKdf = (uid: string): string => profileKey(`profile-kdf-${uid}`)

interface KdfDoc {
  readonly v: 1
  readonly salt: string
  readonly iterations: number
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')
const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(value, 'base64'))

function randomSalt(): Uint8Array<ArrayBuffer> {
  const salt = new Uint8Array(16)
  const value = (globalThis as { crypto?: Crypto }).crypto
  if (value?.getRandomValues === undefined) throw new Error('安全随机源不可用')
  value.getRandomValues(salt)
  return salt
}

const aadOf = (uid: string, profileId: string): string => `${uid}/${profileId}`

/** 读取（必要时创建）用户级 KDF 参数。每人一份，改密时沿用同一 salt 亦可重新生成。 */
export async function ensureUserKdf(
  seam: ProfileSeam, uid: string, iterations = DEFAULT_KDF_ITERATIONS,
): Promise<{ salt: string; iterations: number }> {
  const raw = await seam.readRaw(keyKdf(uid))
  if (raw !== undefined) {
    const parsed = JSON.parse(raw) as Partial<KdfDoc>
    if (parsed.v === 1 && typeof parsed.salt === 'string' && typeof parsed.iterations === 'number') {
      return { salt: parsed.salt, iterations: parsed.iterations }
    }
  }
  const salt = toBase64(randomSalt())
  await seam.writeRaw(keyKdf(uid), JSON.stringify({ v: 1, salt, iterations } satisfies KdfDoc))
  return { salt, iterations }
}

/** 读取用户级 KDF 参数（不存在则 undefined，用于判断该用户是否已启用私有配置）。 */
export async function readUserKdf(seam: ProfileSeam, uid: string): Promise<{ salt: string; iterations: number } | undefined> {
  const raw = await seam.readRaw(keyKdf(uid))
  if (raw === undefined) return undefined
  const parsed = JSON.parse(raw) as Partial<KdfDoc>
  return parsed.v === 1 && typeof parsed.salt === 'string' && typeof parsed.iterations === 'number'
    ? { salt: parsed.salt, iterations: parsed.iterations }
    : undefined
}

/** 写入用户级 KDF 参数（改密时换新 salt）。 */
export async function writeUserKdf(
  seam: ProfileSeam, uid: string, value: { salt: string; iterations: number },
): Promise<void> {
  await seam.writeRaw(keyKdf(uid), JSON.stringify({ v: 1, salt: value.salt, iterations: value.iterations } satisfies KdfDoc))
}

/** 生成一组新的用户级 KDF 参数（不落盘）。 */
export function newUserKdf(iterations = DEFAULT_KDF_ITERATIONS): { salt: string; iterations: number } {
  return { salt: toBase64(randomSalt()), iterations }
}

/** 口令 + 用户级 salt → userKek（会话内存中持有；不保存口令）。 */
export async function deriveUserKek(password: string, saltB64: string, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  return await deriveKek(password, fromBase64(saltB64), iterations)
}

/** 用 userKek 封存一条私有配置：随机 DEK 包进 wrappedDek，API Key 用 DEK 加密。 */
export async function sealPrivateWithKek(
  userKek: Uint8Array<ArrayBuffer>, uid: string, profileId: string, apiKey: string,
): Promise<{ wrappedDek: SealedKey; sealed: SealedKey }> {
  const dek = randomDek()
  const aad = aadOf(uid, profileId)
  return { wrappedDek: await sealUnder(userKek, aad, Buffer.from(dek).toString('base64')), sealed: await sealUnder(dek, aad, apiKey) }
}

/** 解开一条私有配置的 API Key；userKek 不对、篡改或 AAD 不匹配都会抛错。 */
export async function openPrivateWithKek(
  userKek: Uint8Array<ArrayBuffer>, uid: string, profileId: string, wrappedDek: SealedKey, sealed: SealedKey,
): Promise<string> {
  const aad = aadOf(uid, profileId)
  const dek = fromBase64(await openUnder(userKek, aad, wrappedDek))
  return await openUnder(dek, aad, sealed)
}

/** 口令变更：用旧 KEK 解出 DEK、再用新 KEK 重包裹（改密流程持有明文口令那一刻完成）。 */
export async function rewrapWithKek(
  oldKek: Uint8Array<ArrayBuffer>, newKek: Uint8Array<ArrayBuffer>, uid: string, profileId: string, wrappedDek: SealedKey,
): Promise<SealedKey> {
  const aad = aadOf(uid, profileId)
  const dek = fromBase64(await openUnder(oldKek, aad, wrappedDek))
  return await sealUnder(newKek, aad, Buffer.from(dek).toString('base64'))
}

/** 登录会话持有的 userKek（token → uid + KEK）。登出/过期/改密即丢弃。 */
export class KekRegistry {
  private readonly byToken = new Map<string, { uid: string; kek: Uint8Array<ArrayBuffer> }>()

  set(token: string, uid: string, kek: Uint8Array<ArrayBuffer>): void {
    this.byToken.set(token, { uid, kek })
  }

  get(token: string): { uid: string; kek: Uint8Array<ArrayBuffer> } | undefined {
    return this.byToken.get(token)
  }

  /** 解锁某条配置所需的 KEK（仅当会话 uid 与配置所有者一致）。 */
  kekFor(token: string, ownerUid: string): Uint8Array<ArrayBuffer> | undefined {
    const entry = this.byToken.get(token)
    if (entry === undefined || entry.uid !== ownerUid) return undefined
    return entry.kek
  }

  /** 丢弃单个会话（登出、会话失效）。 */
  drop(token: string): void {
    this.byToken.delete(token)
  }

  /** 丢弃某个用户的全部会话（用户被删除、口令被重置、角色变更）。 */
  dropByUid(uid: string): number {
    let dropped = 0
    for (const [token, entry] of [...this.byToken.entries()]) {
      if (entry.uid !== uid) continue
      this.byToken.delete(token)
      dropped += 1
    }
    return dropped
  }

  size(): number {
    return this.byToken.size
  }
}