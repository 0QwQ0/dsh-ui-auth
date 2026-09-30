/**
 * WP4：按用户的模型配置服务（RPC 层逻辑 + R1 调用链解析 + 余额查询）。
 *
 * 不变量（见 docs/RBAC-MODEL-PROFILES.md）：
 * - **Key 永不回传**：读接口只返回元数据（`hasKey` / `hint`），密文字段一律剥离（INV-1/INV-3）。
 * - **跨用户读取拒绝**：私有读取经 `assertSameUser`；R1 解析只认"会话属主 == 配置所有者"。
 * - **无配置即阻断**（Q2）：既无自有配置也无选中的分享时返回明确阻断原因，**不**回退部署级配置。
 * - **无主体会话**（Q11(c)）：解析器接受父会话 id 回退（子代理继承父会话所属用户）。
 * - **余额只返回数字**：服务端代查 + 60s 缓存 + 每用户最小间隔限流。
 */
import {
  ProfileStore, keyHint, loadMasterKey, openShared, sealShared,
  type PrivateProfile, type ProfileSeam, type ReceivedShare, type SharedProfile,
} from './model-profiles.js'
import {
  deriveUserKek, ensureUserKdf, newUserKdf, openPrivateWithKek, readUserKdf, rewrapWithKek,
  sealPrivateWithKek, writeUserKdf, type KekRegistry,
} from './profile-kek.js'

const keyDefault = (uid: string): string => `dsh-auth/profile-default/${uid}`
const BALANCE_TTL_MS = 60_000
const BALANCE_MIN_INTERVAL_MS = 5_000

export interface ProfileMeta {
  readonly profileId: string
  readonly label: string
  readonly provider: string
  readonly model: string
  readonly baseUrl?: string
  readonly hint: string
  readonly hasKey: boolean
  readonly isDefault: boolean
  readonly source: 'own' | 'shared'
  readonly ownerName?: string
}

export interface BalanceResult {
  readonly currency: string
  readonly total: number
  readonly granted?: number
  readonly toppedUp?: number
  readonly fetchedAt: number
}

export type KeyResolution =
  | { readonly ok: true; readonly apiKey: string; readonly provider: string; readonly model: string; readonly source: 'own' | 'shared' }
  | { readonly ok: false; readonly reason: 'no-session' | 'no-profile' | 'locked' }

export interface ProfileServiceDeps {
  readonly store: ProfileStore
  readonly seam: ProfileSeam
  readonly registry: KekRegistry
  readonly sessionOwner: (sessionId: string) => string | undefined
  readonly uidOf: (username: string) => Promise<string | undefined>
  readonly balanceFetcher?: (apiKey: string) => Promise<Omit<BalanceResult, 'fetchedAt'> | null>
  readonly now?: () => number
}

interface DefaultDoc {
  readonly v: 1
  readonly profileId?: string
  readonly share?: { readonly ownerUid: string; readonly profileId: string }
}

const ownMeta = (profile: PrivateProfile | Omit<PrivateProfile, 'sealed' | 'wrappedDek'>, isDefault: boolean): ProfileMeta => ({
  profileId: profile.profileId,
  label: profile.label,
  provider: profile.provider,
  model: profile.model,
  ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
  hint: profile.hint,
  hasKey: true,
  isDefault,
  source: 'own',
})

export class ProfileService {
  private readonly balanceCache = new Map<string, BalanceResult>()
  private readonly lastBalanceAt = new Map<string, number>()
  private readonly tokenByUid = new Map<string, string>()
  private master?: Uint8Array<ArrayBuffer>

  constructor(private readonly deps: ProfileServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private async masterKey(): Promise<Uint8Array<ArrayBuffer>> {
    if (this.master === undefined) this.master = await loadMasterKey(this.deps.seam)
    return this.master
  }

  private tokenOf(uid: string): string {
    return this.tokenByUid.get(uid) ?? `uid:${uid}`
  }

  private kekOf(uid: string): Uint8Array<ArrayBuffer> | undefined {
    return this.deps.registry.kekFor(this.tokenOf(uid), uid)
  }

  /** 登录成功后绑定会话并解锁（派生 userKek；会话不持有口令）。 */
  async bindSession(uid: string, token: string, password: string): Promise<void> {
    const { salt, iterations } = await ensureUserKdf(this.deps.seam, uid)
    this.deps.registry.set(token, uid, await deriveUserKek(password, salt, iterations))
    this.tokenByUid.set(uid, token)
  }

  /** 登出/失效：丢弃 KEK 与会话绑定。 */
  unbindSession(uid: string, token: string): void {
    this.deps.registry.drop(token)
    this.tokenByUid.delete(uid)
  }

  isUnlocked(uid: string): boolean {
    return this.kekOf(uid) !== undefined
  }

  /**
   * 改密：用旧口令解出各配置的 DEK，再用新口令（**新的 salt**）重包裹，并立即用新 KEK 重新解锁本会话。
   * 返回重包裹的配置条数。没有 KDF 记录（从未启用私有配置）时只切换会话 KEK。
   */
  async changePassword(uid: string, token: string, oldPassword: string, newPassword: string): Promise<number> {
    const before = await readUserKdf(this.deps.seam, uid)
    if (before === undefined) {
      // 该用户从未启用私有配置：无需派生新 KEK，也没有要重包裹的记录。
      // 只需丢弃可能残留的旧 KEK（改密后旧口令不应再能解锁），等下次显式解锁再建 KDF 记录。
      this.dropUser(uid)
      return 0
    }
    const oldKek = await deriveUserKek(oldPassword, before.salt, before.iterations)
    const fresh = newUserKdf(before.iterations)
    const newKek = await deriveUserKek(newPassword, fresh.salt, fresh.iterations)
    const profiles = await this.deps.store.readAllPrivate(uid, uid)
    let rewrapped = 0
    const next: typeof profiles = []
    for (const profile of profiles) {
      if (profile.wrappedDek === undefined) { next.push(profile); continue }
      next.push({
        ...profile,
        wrappedDek: await rewrapWithKek(oldKek, newKek, uid, profile.profileId, profile.wrappedDek),
        updatedAt: new Date(this.now()).toISOString(),
      })
      rewrapped += 1
    }
    await this.deps.store.replaceAllPrivate(uid, next)
    await writeUserKdf(this.deps.seam, uid, fresh)
    this.deps.registry.set(token, uid, newKek)
    this.tokenByUid.set(uid, token)
    return rewrapped
  }

  /** 丢弃某用户的全部会话密钥（登出某设备、删除用户、管理员重置口令）。 */
  dropUser(uid: string): number {
    this.tokenByUid.delete(uid)
    return this.deps.registry.dropByUid(uid)
  }

  private async readDefault(uid: string): Promise<DefaultDoc> {
    const raw = await this.deps.seam.readRaw(keyDefault(uid))
    if (raw === undefined) return { v: 1 }
    const parsed = JSON.parse(raw) as DefaultDoc
    return parsed.v === 1 ? parsed : { v: 1 }
  }

  private async writeDefault(uid: string, doc: DefaultDoc): Promise<void> {
    await this.deps.seam.writeRaw(keyDefault(uid), JSON.stringify(doc))
  }

  // ---- 自有配置（RPC） ----

  async createProfile(
    uid: string,
    input: { label: string; provider: string; model: string; baseUrl?: string; apiKey: string },
  ): Promise<ProfileMeta> {
    const kek = this.requireKek(uid)
    const profileId = crypto.randomUUID()
    const { wrappedDek, sealed } = await sealPrivateWithKek(kek, uid, profileId, input.apiKey)
    const now = new Date(this.now()).toISOString()
    const record: PrivateProfile = {
      profileId, label: input.label, provider: input.provider, model: input.model,
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
      hint: keyHint(input.apiKey), wrappedDek, sealed, createdAt: now, updatedAt: now,
    }
    await this.deps.store.writePrivate(uid, record)
    const doc = await this.readDefault(uid)
    const isDefault = doc.profileId === undefined && doc.share === undefined
    if (isDefault) await this.writeDefault(uid, { v: 1, profileId })
    return ownMeta(record, isDefault)
  }

  async updateProfile(
    uid: string,
    profileId: string,
    patch: { label?: string; provider?: string; model?: string; baseUrl?: string; apiKey?: string },
  ): Promise<ProfileMeta | undefined> {
    const current = await this.deps.store.readPrivate(uid, uid, profileId)
    if (current === undefined) return undefined
    let { wrappedDek, sealed, hint } = current
    if (patch.apiKey !== undefined) {
      const refreshed = await sealPrivateWithKek(this.requireKek(uid), uid, profileId, patch.apiKey)
      wrappedDek = refreshed.wrappedDek
      sealed = refreshed.sealed
      hint = keyHint(patch.apiKey)
    }
    const next: PrivateProfile = {
      ...current,
      label: patch.label ?? current.label,
      provider: patch.provider ?? current.provider,
      model: patch.model ?? current.model,
      ...(patch.baseUrl === undefined ? {} : { baseUrl: patch.baseUrl }),
      hint, wrappedDek, sealed, updatedAt: new Date(this.now()).toISOString(),
    }
    await this.deps.store.writePrivate(uid, next)
    const doc = await this.readDefault(uid)
    return ownMeta(next, doc.share === undefined && doc.profileId === profileId)
  }

  async removeProfile(uid: string, profileId: string): Promise<boolean> {
    if (await this.deps.store.readPrivate(uid, uid, profileId) === undefined) return false
    await this.deps.store.removePrivate(uid, profileId)
    const doc = await this.readDefault(uid)
    if (doc.profileId === profileId) await this.writeDefault(uid, doc.share === undefined ? { v: 1 } : { v: 1, share: doc.share })
    return true
  }

  async setDefaultOwn(uid: string, profileId: string): Promise<boolean> {
    if (await this.deps.store.readPrivate(uid, uid, profileId) === undefined) return false
    await this.writeDefault(uid, { v: 1, profileId })
    return true
  }

  /** 自有配置 + 收到的分享（全部为元数据，无任何密文字段）。 */
  async listProfiles(uid: string): Promise<ProfileMeta[]> {
    const doc = await this.readDefault(uid)
    const own = await this.deps.store.listPrivate(uid, uid)
    const metas = own.map(profile => ownMeta(profile, doc.share === undefined && doc.profileId === profile.profileId))
    for (const share of await this.deps.store.readReceived(uid)) {
      metas.push({
        profileId: `${share.ownerUid}/${share.profileId}`,
        label: share.label, provider: share.provider, model: share.model,
        hint: '—', hasKey: true,
        isDefault: doc.share !== undefined && doc.share.ownerUid === share.ownerUid && doc.share.profileId === share.profileId,
        source: 'shared', ownerName: share.ownerName,
      })
    }
    return metas
  }

  // ---- 收到的分享 ----

  async listShares(uid: string): Promise<ReceivedShare[]> {
    return await this.deps.store.readReceived(uid)
  }

  async selectShare(uid: string, ownerUid: string, profileId: string): Promise<boolean> {
    const shares = await this.deps.store.readReceived(uid)
    if (!shares.some(share => share.ownerUid === ownerUid && share.profileId === profileId)) return false
    await this.writeDefault(uid, { v: 1, share: { ownerUid, profileId } })
    await this.deps.store.writeReceived(uid, shares.map(share => ({
      ...share, selected: share.ownerUid === ownerUid && share.profileId === profileId,
    })))
    return true
  }

  // ---- R1：按会话解析 Key ----

  async resolveKeyForSession(sessionId: string | undefined, parentSessionId?: string): Promise<KeyResolution> {
    const owner = (sessionId === undefined ? undefined : this.deps.sessionOwner(sessionId))
      ?? (parentSessionId === undefined ? undefined : this.deps.sessionOwner(parentSessionId))
    if (owner === undefined) return { ok: false, reason: 'no-session' }
    const uid = await this.deps.uidOf(owner)
    if (uid === undefined) return { ok: false, reason: 'no-profile' }
    const doc = await this.readDefault(uid)

    if (doc.share !== undefined) {
      const shared = (await this.deps.store.listShared(doc.share.ownerUid))
        .find(profile => profile.profileId === doc.share?.profileId)
      if (shared === undefined) return { ok: false, reason: 'no-profile' }
      return {
        ok: true,
        apiKey: await openShared(await this.masterKey(), doc.share.ownerUid, shared.profileId, shared.sealed),
        provider: shared.provider, model: shared.model, source: 'shared',
      }
    }
    if (doc.profileId === undefined) return { ok: false, reason: 'no-profile' }
    const profile = await this.deps.store.readPrivate(uid, uid, doc.profileId)
    if (profile?.wrappedDek === undefined) return { ok: false, reason: 'no-profile' }
    const kek = this.kekOf(uid)
    if (kek === undefined) return { ok: false, reason: 'locked' }
    return {
      ok: true,
      apiKey: await openPrivateWithKek(kek, uid, profile.profileId, profile.wrappedDek, profile.sealed),
      provider: profile.provider, model: profile.model, source: 'own',
    }
  }

  // ---- 分享管理（所有者侧；WP5 扩展用量） ----

  async createShared(
    ownerUid: string,
    input: { label: string; provider: string; model: string; baseUrl?: string; apiKey: string },
  ): Promise<{ profileId: string }> {
    const profileId = crypto.randomUUID()
    const sealed = await sealShared(await this.masterKey(), ownerUid, profileId, input.apiKey)
    const now = new Date(this.now()).toISOString()
    await this.deps.store.writeShared(ownerUid, {
      profileId, label: input.label, provider: input.provider, model: input.model,
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
      hint: keyHint(input.apiKey), sealed, createdAt: now, updatedAt: now,
    } satisfies SharedProfile)
    return { profileId }
  }

  /** 授予：写授权表并在被授权者侧投放一条分享（不含 Key）。 */
  async grantShare(ownerUid: string, ownerName: string, targetUid: string, profileId: string): Promise<boolean> {
    const profile = (await this.deps.store.listShared(ownerUid)).find(item => item.profileId === profileId)
    if (profile === undefined) return false
    const table = await this.deps.store.readGrants(ownerUid)
    const entry = table.grants[targetUid]?.profileIds ?? []
    table.grants[targetUid] = {
      profileIds: [...new Set([...entry, profileId])],
      updatedAt: new Date(this.now()).toISOString(),
    }
    await this.deps.store.writeGrants(ownerUid, table)
    const received = await this.deps.store.readReceived(targetUid)
    if (!received.some(share => share.ownerUid === ownerUid && share.profileId === profileId)) {
      received.push({ ownerUid, ownerName, profileId, label: profile.label, provider: profile.provider, model: profile.model, selected: false })
      await this.deps.store.writeReceived(targetUid, received)
    }
    return true
  }

  /** 撤销：立即生效（清授权、清被授权者侧分享、解除默认选择 → 下次调用 fail-closed）。 */
  async revokeShare(ownerUid: string, targetUid: string, profileId: string): Promise<void> {
    const table = await this.deps.store.readGrants(ownerUid)
    const entry = table.grants[targetUid]
    if (entry !== undefined) {
      table.grants[targetUid] = {
        profileIds: entry.profileIds.filter(id => id !== profileId),
        updatedAt: new Date(this.now()).toISOString(),
      }
      await this.deps.store.writeGrants(ownerUid, table)
    }
    await this.deps.store.writeReceived(targetUid,
      (await this.deps.store.readReceived(targetUid)).filter(share => !(share.ownerUid === ownerUid && share.profileId === profileId)))
    const doc = await this.readDefault(targetUid)
    if (doc.share !== undefined && doc.share.ownerUid === ownerUid && doc.share.profileId === profileId) {
      await this.writeDefault(targetUid, doc.profileId === undefined ? { v: 1 } : { v: 1, profileId: doc.profileId })
    }
  }

  async listGrantedProfiles(ownerUid: string): Promise<Array<{ profileId: string; label: string; provider: string; model: string }>> {
    return (await this.deps.store.listShared(ownerUid)).map(profile => ({
      profileId: profile.profileId, label: profile.label, provider: profile.provider, model: profile.model,
    }))
  }

  // ---- 余额 ----

  async balanceOf(uid: string, profileId?: string): Promise<BalanceResult | { error: 'rate-limited' | 'unavailable' | 'no-profile' }> {
    const fetcher = this.deps.balanceFetcher
    if (fetcher === undefined) return { error: 'unavailable' }
    const doc = await this.readDefault(uid)
    const now = this.now()
    const cacheKey = doc.share !== undefined ? `${doc.share.ownerUid}/${doc.share.profileId}` : `${uid}/${profileId ?? doc.profileId ?? ''}`
    const cached = this.balanceCache.get(cacheKey)
    if (cached !== undefined && now - cached.fetchedAt < BALANCE_TTL_MS) return cached
    if (now - (this.lastBalanceAt.get(uid) ?? 0) < BALANCE_MIN_INTERVAL_MS) return { error: 'rate-limited' }

    const apiKey = await this.apiKeyFor(uid, doc, profileId)
    if (apiKey === undefined) return { error: 'no-profile' }
    this.lastBalanceAt.set(uid, now)
    const result = await fetcher(apiKey)
    if (result === null) return { error: 'unavailable' }
    const stamped: BalanceResult = { ...result, fetchedAt: now }
    this.balanceCache.set(cacheKey, stamped)
    return stamped
  }

  private async apiKeyFor(uid: string, doc: DefaultDoc, profileId?: string): Promise<string | undefined> {
    if (doc.share !== undefined) {
      const shared = (await this.deps.store.listShared(doc.share.ownerUid)).find(profile => profile.profileId === doc.share?.profileId)
      if (shared === undefined) return undefined
      return await openShared(await this.masterKey(), doc.share.ownerUid, shared.profileId, shared.sealed)
    }
    const target = profileId ?? doc.profileId
    if (target === undefined) return undefined
    const profile = await this.deps.store.readPrivate(uid, uid, target)
    const kek = this.kekOf(uid)
    if (profile?.wrappedDek === undefined || kek === undefined) return undefined
    return await openPrivateWithKek(kek, uid, target, profile.wrappedDek, profile.sealed)
  }

  private requireKek(uid: string): Uint8Array<ArrayBuffer> {
    const kek = this.kekOf(uid)
    if (kek === undefined) throw new Error('会话未解锁：私有配置的密钥只在该用户会话内存中（请重新登录）')
    return kek
  }
}