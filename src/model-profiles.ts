/**
 * WP3：按用户隔离的模型配置存储与密钥托管。
 *
 * 设计要点（见 docs/RBAC-MODEL-PROFILES.md）：
 * - **按稳定 `uid`（uuid）分区**，不用用户名做键（用户名可改、可回收）。
 * - **私有配置**：`KDF(用户登录口令) → KEK → AES-256-GCM(API Key)`，KEK 只在**该用户会话内存**
 *   中存在；落盘的是密文，因此即使拿到存储或声称管理员身份也读不出（INV-1/INV-4）。
 * - **分享配置**：由服务端主密钥（宿主凭据记录 `dsh-auth/profile-master`）托管——分享语义本身
 *   要求"所有者离线时被授权者也能调用"，所以它必须可被服务端解密；这不影响私有配置的不可读性。
 * - **AAD 绑定**：`<uid>/<profileId>`，密文不能在另一个用户或另一个配置下重放。
 * - 所有读取入口都带 `ownerUid`，并用 `assertSameUser` 显式挡住跨用户读取（INV-2 的代码级守卫）。
 */

/** 凭据接缝的最小子集（与宿主 `ctx.credentials` 的 grant 记录一致）。 */
export interface ProfileSeam {
  readRaw(key: string): Promise<string | undefined>
  writeRaw(key: string, payload: string): Promise<void>
}

/**
 * 凭据记录的键：宿主语法是**恰好两段** `<scope>/<id>`，且两段都必须是
 * 小写连字符标识符。早期版本写成三段（`dsh-auth/profile-kdf/<uid>`）会让宿主的
 * 凭据服务在下次启动时解析失败，进而**整个宿主起不来**——所以这里在写入前就校验。
 */
export function profileKey(id: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`非法的凭据记录 id（需小写连字符）：${id}`)
  }
  return `dsh-auth/${id}`
}

const KEY_MASTER = profileKey('profile-master')
const KEY_UIDS = profileKey('profile-uids')
const keyPrivate = (uid: string): string => profileKey(`profile-private-${uid}`)
const keyShared = (uid: string): string => profileKey(`profile-shared-${uid}`)
const keyGrants = (uid: string): string => profileKey(`profile-grants-${uid}`)
const keyReceived = (uid: string): string => profileKey(`profile-received-${uid}`)

/** 私有配置的密文（含 KDF 参数；版本化以便将来换算法）。 */
export interface SealedKey {
  readonly v: 1
  readonly alg: 'AES-256-GCM'
  /** 仅私有配置有：口令派生参数。 */
  readonly kdf?: { readonly salt: string; readonly iterations: number }
  readonly iv: string
  readonly ct: string
}

export interface PrivateProfile {
  readonly profileId: string
  readonly label: string
  readonly provider: string
  readonly model: string
  readonly baseUrl?: string
  /** 不可逆提示（尾 4 位），仅所有者本人可见。 */
  readonly hint: string
  /**
   * 信封结构（WP4）：随机 DEK 被会话 userKek 包裹后的密文。
   * 缺失表示 v1 记录（口令直接派生 KEK 加密 API Key），仍可被 `openPrivate` 打开。
   */
  readonly wrappedDek?: SealedKey
  readonly sealed: SealedKey
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SharedProfile {
  readonly profileId: string
  readonly label: string
  readonly provider: string
  readonly model: string
  readonly baseUrl?: string
  readonly hint: string
  readonly sealed: SealedKey
  readonly createdAt: string
  readonly updatedAt: string
}

export interface GrantTable {
  v: 1
  /** targetUid → 被授予的 profileId 列表。 */
  grants: Record<string, { profileIds: string[]; updatedAt: string }>
}

export interface ReceivedShare {
  readonly ownerUid: string
  readonly ownerName: string
  readonly profileId: string
  readonly label: string
  readonly provider: string
  readonly model: string
  /** 用户是否已选用（分享不自动成为默认）。 */
  selected: boolean
}

/** 默认迭代次数（OWASP 对 PBKDF2-SHA256 的建议量级）；测试可显式传小值。 */
export const DEFAULT_KDF_ITERATIONS = 600_000
const KEY_BYTES = 32
const IV_BYTES = 12
const SALT_BYTES = 16

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')
const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(value, 'base64'))

function subtle(): SubtleCrypto {
  const value = (globalThis as { crypto?: Crypto }).crypto
  if (value?.subtle === undefined) throw new Error('WebCrypto 不可用：无法进行配置密钥的加解密')
  return value.subtle
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  const value = (globalThis as { crypto?: Crypto }).crypto
  if (value?.getRandomValues === undefined) throw new Error('安全随机源不可用')
  value.getRandomValues(bytes)
  return bytes
}

/** 跨用户读取的代码级守卫：调用者 uid 必须等于记录所有者 uid。 */
export function assertSameUser(callerUid: string, ownerUid: string): void {
  if (callerUid !== ownerUid) throw new Error('拒绝跨用户读取模型配置（仅本人可读）')
}

/** 口令 → KEK（PBKDF2-SHA256）。 */
export async function deriveKek(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const material = await subtle().importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle().deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, KEY_BYTES * 8)
  return new Uint8Array(bits)
}

async function encrypt(keyBytes: Uint8Array<ArrayBuffer>, aad: string, plaintext: string): Promise<{ iv: string; ct: string }> {
  const key = await subtle().importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = randomBytes(IV_BYTES)
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, encoder.encode(plaintext))
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) }
}

async function decrypt(keyBytes: Uint8Array<ArrayBuffer>, aad: string, iv: string, ct: string): Promise<string> {
  const key = await subtle().importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(aad) },
    key,
    fromBase64(ct),
  )
  return decoder.decode(plain)
}

const aadOf = (uid: string, profileId: string): string => `${uid}/${profileId}`

/** 仅暴露不可逆提示：尾 4 位（长度为 0 时不显示）。 */
export function keyHint(apiKey: string): string {
  // 只回「前 4 + … + 后 4」的掩码，完整 Key 永不离开加密存储。
  if (apiKey.length >= 12) return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
  return apiKey.length >= 4 ? `…${apiKey.slice(-4)}` : '…'
}

/** 用用户口令封存私有 API Key。 */
export async function sealPrivate(
  password: string, uid: string, profileId: string, apiKey: string, iterations = DEFAULT_KDF_ITERATIONS,
): Promise<SealedKey> {
  const salt = randomBytes(SALT_BYTES)
  const kek = await deriveKek(password, salt, iterations)
  const { iv, ct } = await encrypt(kek, aadOf(uid, profileId), apiKey)
  return { v: 1, alg: 'AES-256-GCM', kdf: { salt: toBase64(salt), iterations }, iv, ct }
}

/** 用给定密钥封存任意明文（AAD 由调用方决定）——供 WP4 的信封结构复用。 */
export async function sealUnder(keyBytes: Uint8Array<ArrayBuffer>, aad: string, plaintext: string): Promise<SealedKey> {
  const { iv, ct } = await encrypt(keyBytes, aad, plaintext)
  return { v: 1, alg: 'AES-256-GCM', iv, ct }
}

/** 用给定密钥解封（口令派生的 KEK、服务端主密钥或每配置 DEK 皆可）。 */
export async function openUnder(keyBytes: Uint8Array<ArrayBuffer>, aad: string, sealed: SealedKey): Promise<string> {
  return await decrypt(keyBytes, aad, sealed.iv, sealed.ct)
}

/** 信封结构所需的随机数据密钥（DEK）。 */
export function randomDek(): Uint8Array<ArrayBuffer> {
  return randomBytes(KEY_BYTES)
}

/** 解开私有 API Key；口令错误或密文被篡改都会抛错（GCM 认证失败）。 */
export async function openPrivate(password: string, uid: string, profileId: string, sealed: SealedKey): Promise<string> {
  if (sealed.kdf === undefined) throw new Error('私有配置缺少 KDF 参数')
  const kek = await deriveKek(password, fromBase64(sealed.kdf.salt), sealed.kdf.iterations)
  return await decrypt(kek, aadOf(uid, profileId), sealed.iv, sealed.ct)
}

/** 用服务端主密钥封存分享配置的 API Key（服务端托管，供被授权者无人值守调用）。 */
export async function sealShared(master: Uint8Array<ArrayBuffer>, ownerUid: string, profileId: string, apiKey: string): Promise<SealedKey> {
  const { iv, ct } = await encrypt(master, aadOf(ownerUid, profileId), apiKey)
  return { v: 1, alg: 'AES-256-GCM', iv, ct }
}

export async function openShared(master: Uint8Array<ArrayBuffer>, ownerUid: string, profileId: string, sealed: SealedKey): Promise<string> {
  return await decrypt(master, aadOf(ownerUid, profileId), sealed.iv, sealed.ct)
}

/** 读取（必要时创建）服务端主密钥。 */
export async function loadMasterKey(seam: ProfileSeam): Promise<Uint8Array<ArrayBuffer>> {
  const existing = await seam.readRaw(KEY_MASTER)
  if (existing !== undefined) {
    const parsed = JSON.parse(existing) as { v?: number; key?: string }
    if (parsed.v === 1 && typeof parsed.key === 'string' && parsed.key.length > 0) return fromBase64(parsed.key)
  }
  const created = randomBytes(KEY_BYTES)
  await seam.writeRaw(KEY_MASTER, JSON.stringify({ v: 1, key: toBase64(created) }))
  return created
}

/** 按 uid 分区的模型配置存储。 */
export class ProfileStore {
  constructor(private readonly seam: ProfileSeam) {}

  /** 用户名 → uid 的稳定映射（首次访问时分配）。 */
  async ensureUid(username: string): Promise<string> {
    const table = await this.readUids()
    const known = table.byName[username]
    if (known !== undefined) return known
    const uid = crypto.randomUUID()
    table.byName[username] = uid
    await this.write(KEY_UIDS, table)
    return uid
  }

  async uidOf(username: string): Promise<string | undefined> {
    return (await this.readUids()).byName[username]
  }

  /** 读取某用户自己的私有配置列表（不返回 Key 材料）。 */
  async listPrivate(callerUid: string, ownerUid: string): Promise<Omit<PrivateProfile, 'sealed'>[]> {
    assertSameUser(callerUid, ownerUid)
    return (await this.readPrivateDoc(ownerUid)).profiles.map(({ sealed: _sealed, ...meta }) => meta)
  }

  /** 读取一条私有配置（含密文；仅所有者本人）。 */
  async readPrivate(callerUid: string, ownerUid: string, profileId: string): Promise<PrivateProfile | undefined> {
    assertSameUser(callerUid, ownerUid)
    return (await this.readPrivateDoc(ownerUid)).profiles.find(profile => profile.profileId === profileId)
  }

  /**
   * 读取**本人**全部私有配置（含密文）——仅供改密时的批量重包裹使用。
   * 与 `readPrivate` 一样要求调用者 uid 等于所有者 uid。
   */
  async readAllPrivate(callerUid: string, ownerUid: string): Promise<PrivateProfile[]> {
    assertSameUser(callerUid, ownerUid)
    return (await this.readPrivateDoc(ownerUid)).profiles
  }

  /** 批量写回（改密重包裹后使用；覆盖同名 profileId）。 */
  async replaceAllPrivate(ownerUid: string, profiles: PrivateProfile[]): Promise<void> {
    await this.write(keyPrivate(ownerUid), { v: 1, profiles })
  }

  /** 写入/覆盖一条私有配置。 */
  async writePrivate(ownerUid: string, profile: PrivateProfile): Promise<void> {
    const doc = await this.readPrivateDoc(ownerUid)
    const profiles = doc.profiles.filter(item => item.profileId !== profile.profileId)
    profiles.push(profile)
    await this.write(keyPrivate(ownerUid), { v: 1, profiles })
  }

  async removePrivate(ownerUid: string, profileId: string): Promise<void> {
    const doc = await this.readPrivateDoc(ownerUid)
    await this.write(keyPrivate(ownerUid), { v: 1, profiles: doc.profiles.filter(item => item.profileId !== profileId) })
  }

  async listShared(ownerUid: string): Promise<SharedProfile[]> {
    return (await this.readSharedDoc(ownerUid)).profiles
  }

  async writeShared(ownerUid: string, profile: SharedProfile): Promise<void> {
    const doc = await this.readSharedDoc(ownerUid)
    const profiles = doc.profiles.filter(item => item.profileId !== profile.profileId)
    profiles.push(profile)
    await this.write(keyShared(ownerUid), { v: 1, profiles })
  }

  async removeShared(ownerUid: string, profileId: string): Promise<void> {
    const doc = await this.readSharedDoc(ownerUid)
    await this.write(keyShared(ownerUid), { v: 1, profiles: doc.profiles.filter(item => item.profileId !== profileId) })
  }

  async readGrants(ownerUid: string): Promise<GrantTable> {
    const raw = await this.seam.readRaw(keyGrants(ownerUid))
    if (raw === undefined) return { v: 1, grants: {} }
    const parsed = JSON.parse(raw) as GrantTable
    return parsed.v === 1 && typeof parsed.grants === 'object' && parsed.grants !== null ? parsed : { v: 1, grants: {} }
  }

  async writeGrants(ownerUid: string, table: GrantTable): Promise<void> {
    await this.write(keyGrants(ownerUid), table)
  }

  /** 被授权者侧收到的分享清单（不含 Key 材料）。 */
  async readReceived(targetUid: string): Promise<ReceivedShare[]> {
    const raw = await this.seam.readRaw(keyReceived(targetUid))
    if (raw === undefined) return []
    const parsed = JSON.parse(raw) as { v?: number; shares?: ReceivedShare[] }
    return parsed.v === 1 && Array.isArray(parsed.shares) ? parsed.shares : []
  }

  async writeReceived(targetUid: string, shares: ReceivedShare[]): Promise<void> {
    await this.write(keyReceived(targetUid), { v: 1, shares })
  }

  private async readUids(): Promise<{ v: 1; byName: Record<string, string> }> {
    const raw = await this.seam.readRaw(KEY_UIDS)
    if (raw === undefined) return { v: 1, byName: {} }
    const parsed = JSON.parse(raw) as { v?: number; byName?: Record<string, string> }
    return parsed.v === 1 && typeof parsed.byName === 'object' && parsed.byName !== null ? { v: 1, byName: parsed.byName } : { v: 1, byName: {} }
  }

  private async readPrivateDoc(uid: string): Promise<{ v: 1; profiles: PrivateProfile[] }> {
    const raw = await this.seam.readRaw(keyPrivate(uid))
    if (raw === undefined) return { v: 1, profiles: [] }
    const parsed = JSON.parse(raw) as { v?: number; profiles?: PrivateProfile[] }
    return parsed.v === 1 && Array.isArray(parsed.profiles) ? { v: 1, profiles: parsed.profiles } : { v: 1, profiles: [] }
  }

  private async readSharedDoc(uid: string): Promise<{ v: 1; profiles: SharedProfile[] }> {
    const raw = await this.seam.readRaw(keyShared(uid))
    if (raw === undefined) return { v: 1, profiles: [] }
    const parsed = JSON.parse(raw) as { v?: number; profiles?: SharedProfile[] }
    return parsed.v === 1 && Array.isArray(parsed.profiles) ? { v: 1, profiles: parsed.profiles } : { v: 1, profiles: [] }
  }

  private async write(key: string, value: unknown): Promise<void> {
    const segments = key.split('/')
    if (segments.length !== 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segments[1] ?? '')) {
      throw new Error(`拒绝写入非法凭据键（宿主要求 <scope>/<id>）：${key}`)
    }
    await this.seam.writeRaw(key, JSON.stringify(value))
  }
}