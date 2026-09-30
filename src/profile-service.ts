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
  ProfileStore, keyHint, loadMasterKey, openShared, profileKey, sealShared,
  type PrivateProfile, type ProfileSeam, type ReceivedShare, type SharedProfile,
} from './model-profiles.js'
import {
  deriveUserKek, ensureUserKdf, newUserKdf, openPrivateWithKek, readUserKdf, rewrapWithKek,
  sealPrivateWithKek, writeUserKdf, type KekRegistry,
} from './profile-kek.js'

const keyDefault = (uid: string): string => profileKey(`profile-default-${uid}`)
const keyUsage = (uid: string): string => profileKey(`profile-usage-${uid}`)
const MAX_COUNTER = Number.MAX_SAFE_INTEGER

/** 分享用量：所有者 uid → { 被授权者 uid → { 配置 id → 计数 } }。 */
interface UsageDoc {
  readonly v: 1
  usage: Record<string, Record<string, { calls: number; tokens: number; updatedAt: string }>>
}
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
  /** 校验"当前密码"时读取用户记录（由 index 注入）。 */
  readonly readUserByUid?: (uid: string) => Promise<{ salt: string; hash: string; iterations: number } | undefined>
  /** 用登录那套口令哈希比对（绝不落明文）。 */
  readonly verifyPasswordAgainst?: (user: { salt: string; hash: string; iterations: number }, password: string) => boolean
  readonly balanceFetcher?: (apiKey: string, baseUrl?: string) => Promise<Omit<BalanceResult, 'fetchedAt'> | null>
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

  /** 批量查询的每用户节流（整批一次，而不是每条一次）。 */
  private readonly lastBalanceAllAt = new Map<string, number>()

  /** "当前密码"失焦校验的失败节流（每用户）。 */
  private readonly verifyState = new Map<string, { fails: number; until: number }>()
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

  /** 用户名 → uid（不创建；供路由同步与授权查询使用）。 */
  async uidOfName(username: string): Promise<string | undefined> {
    return await this.deps.uidOf(username)
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

  // ---- WP5：分享用量（所有者可见；不含任何 Key 材料） ----

  /** 记录一次由分享配置完成的调用。计数器饱和累加，避免溢出。 */
  async recordUsage(ownerUid: string, targetUid: string, profileId: string, tokens?: number): Promise<void> {
    const doc = await this.readUsage(ownerUid)
    const byTarget = doc.usage[targetUid] ?? {}
    const current = byTarget[profileId] ?? { calls: 0, tokens: 0 }
    const addTokens = Number.isFinite(tokens) && (tokens as number) > 0 ? Math.floor(tokens as number) : 0
    byTarget[profileId] = {
      calls: Math.min(current.calls + 1, MAX_COUNTER),
      tokens: Math.min(current.tokens + addTokens, MAX_COUNTER),
      updatedAt: new Date(this.now()).toISOString(),
    }
    doc.usage[targetUid] = byTarget
    await this.deps.seam.writeRaw(keyUsage(ownerUid), JSON.stringify(doc))
  }

  /**
   * 校验"当前密码"（界面失焦校验用）。只回结论，不签发会话或密钥；失败按用户节流。
   */
  async verifyPassword(uid: string, password: string): Promise<{ ok: boolean; error?: string }> {
    const now = this.now()
    const state = this.verifyState.get(uid) ?? { fails: 0, until: 0 }
    if (state.until > now) return { ok: false, error: '尝试过于频繁，请稍后再试' }
    const user = await this.deps.readUserByUid?.(uid)
    if (user === undefined) return { ok: false, error: '无法校验（用户记录不可用）' }
    const ok = this.deps.verifyPasswordAgainst?.(user, password) === true
    if (!ok) {
      state.fails += 1
      state.until = state.fails >= 5 ? now + 60_000 : now + 1_000
      if (state.fails >= 5) state.fails = 0
      this.verifyState.set(uid, state)
      return { ok: false, error: '当前密码不正确' }
    }
    this.verifyState.delete(uid)
    return { ok: true }
  }

  /** 所有者视角的授权表：每条分享被授予给了哪些用户（未使用过也在此列出）。 */
  async grantsOf(ownerUid: string): Promise<Array<{ targetUid: string; profileIds: string[]; updatedAt: string }>> {
    const table = await this.deps.store.readGrants(ownerUid)
    return Object.entries(table.grants).map(([targetUid, entry]) => ({
      targetUid,
      profileIds: entry.profileIds,
      updatedAt: entry.updatedAt,
    }))
  }

  /** 所有者视角的用量汇总：谁用了哪条分享、多少次、多少 token。 */
  async usageFor(ownerUid: string): Promise<Array<{ targetUid: string; profileId: string; calls: number; tokens: number; updatedAt: string }>> {
    const doc = await this.readUsage(ownerUid)
    const rows: Array<{ targetUid: string; profileId: string; calls: number; tokens: number; updatedAt: string }> = []
    for (const [targetUid, byProfile] of Object.entries(doc.usage)) {
      for (const [profileId, counters] of Object.entries(byProfile)) {
        rows.push({ targetUid, profileId, calls: counters.calls, tokens: counters.tokens, updatedAt: counters.updatedAt })
      }
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  private async readUsage(ownerUid: string): Promise<UsageDoc> {
    const raw = await this.deps.seam.readRaw(keyUsage(ownerUid))
    if (raw === undefined) return { v: 1, usage: {} }
    const parsed = JSON.parse(raw) as UsageDoc
    return parsed.v === 1 && typeof parsed.usage === 'object' && parsed.usage !== null ? parsed : { v: 1, usage: {} }
  }

  // ---- 余额 ----

  async balanceOf(
    uid: string, profileId?: string, options?: { bulk?: boolean },
  ): Promise<BalanceResult | { error: 'rate-limited' | 'unavailable' | 'no-profile' | 'locked' }> {
    const fetcher = this.deps.balanceFetcher
    if (fetcher === undefined) return { error: 'unavailable' }
    const doc = await this.readDefault(uid)
    const now = this.now()
    const cacheKey = doc.share !== undefined ? `${doc.share.ownerUid}/${doc.share.profileId}` : `${uid}/${profileId ?? doc.profileId ?? ''}`
    const cached = this.balanceCache.get(cacheKey)
    if (cached !== undefined && now - cached.fetchedAt < BALANCE_TTL_MS) return cached
    if (options?.bulk !== true && now - (this.lastBalanceAt.get(uid) ?? 0) < BALANCE_MIN_INTERVAL_MS) return { error: 'rate-limited' }

    // 私有配置的口令派生密钥只在本人会话内存中：未解锁时明确告知"需先解锁"（而不是误报"未选择配置"）
    if (doc.share === undefined && this.kekOf(uid) === undefined) {
      const target = profileId ?? doc.profileId
      if (target !== undefined) return { error: 'locked' }
    }
    const resolved = await this.apiKeyFor(uid, doc, profileId)
    if (resolved === undefined) return { error: 'no-profile' }
    if (options?.bulk !== true) this.lastBalanceAt.set(uid, now)
    const result = await fetcher(resolved.apiKey, resolved.baseUrl)
    if (result === null) return { error: 'unavailable' }
    const stamped: BalanceResult = { ...result, fetchedAt: now }
    this.balanceCache.set(cacheKey, stamped)
    return stamped
  }

  /**
   * 批量余额：界面上的「查余额（全部配置）」走这里——一次请求内**顺序**查询该用户全部配置，
   * 整批只做一次每用户节流（否则逐条调用会全部撞上单条最小间隔，看起来就是"查余额失效"）。
   */
  async balanceAll(uid: string): Promise<Record<string, BalanceResult | { error: string }> | { error: 'rate-limited' }> {
    const now = this.now()
    if (now - (this.lastBalanceAllAt.get(uid) ?? 0) < BALANCE_MIN_INTERVAL_MS) return { error: 'rate-limited' }
    this.lastBalanceAllAt.set(uid, now)
    const profiles = await this.listProfiles(uid)
    const results: Record<string, BalanceResult | { error: string }> = {}
    for (const meta of profiles) {
      const id = String(meta.profileId)
      // 逐条提示"需先解锁"
      const one = await this.balanceOf(uid, meta.source === 'shared' ? undefined : id, { bulk: true })
      results[id] = one
      // 依次请求，给上游留出间隔（同时避免被上游限流）
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    return results
  }

  /** 解析某条配置的 Key 与它适用的 baseURL（余额/测试连接都走这里，保证口径一致）。 */
  private async apiKeyFor(
    uid: string, doc: DefaultDoc, profileId?: string,
  ): Promise<{ apiKey: string; baseUrl?: string } | undefined> {
    if (doc.share !== undefined) {
      const shared = (await this.deps.store.listShared(doc.share.ownerUid)).find(profile => profile.profileId === doc.share?.profileId)
      if (shared === undefined) return undefined
      const apiKey = await openShared(await this.masterKey(), doc.share.ownerUid, shared.profileId, shared.sealed)
      return { apiKey, ...(shared.baseUrl === undefined ? {} : { baseUrl: shared.baseUrl }) }
    }
    const target = profileId ?? doc.profileId
    if (target === undefined) return undefined
    const profile = await this.deps.store.readPrivate(uid, uid, target)
    const kek = this.kekOf(uid)
    if (profile?.wrappedDek === undefined || kek === undefined) return undefined
    const apiKey = await openPrivateWithKek(kek, uid, target, profile.wrappedDek, profile.sealed)
    return { apiKey, ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }) }
  }

  /**
   * 校验一条 Key（+可选 baseURL）是否可用——创建分享/保存配置前由界面调用。
   * 只返回结论与余额数字，**不回传 Key**。
   */
  async testKey(
    apiKey: string, baseUrl?: string,
  ): Promise<{ ok: true; balance?: Omit<BalanceResult, 'fetchedAt'> } | { ok: false; error: string }> {
    const fetcher = this.deps.balanceFetcher
    if (fetcher === undefined) return { ok: false, error: '当前部署未启用 Key 校验（缺少余额查询实现）' }
    if (typeof apiKey !== 'string' || apiKey.trim() === '') return { ok: false, error: 'API Key 不能为空' }
    try {
      const result = await fetcher(apiKey.trim(), baseUrl)
      if (result === null) return { ok: false, error: '无法验证：接口拒绝或网络不可达（请检查 Key 与 baseURL）' }
      return { ok: true, balance: result }
    } catch (error) {
      return { ok: false, error: `无法验证：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private requireKek(uid: string): Uint8Array<ArrayBuffer> {
    const kek = this.kekOf(uid)
    if (kek === undefined) throw new Error('会话未解锁：私有配置的密钥只在该用户会话内存中（请重新登录）')
    return kek
  }

  // ---- R1-ii：供 provider 路由的 resolveAuth 调用（调用瞬间解析，绝不缓存） ----

  /** 解开**本人私有**配置的 Key：需要该用户会话的 KEK；未解锁即抛错（fail-closed）。 */
  async resolveOwnPrivateKey(uid: string, profileId: string): Promise<string> {
    const profile = await this.deps.store.readPrivate(uid, uid, profileId)
    if (profile?.wrappedDek === undefined) throw new Error('配置不存在或缺少密文（需重新录入 Key）')
    const kek = this.kekOf(uid)
    if (kek === undefined) throw new Error('会话未解锁：请重新登录后再使用自己的模型配置')
    return await openPrivateWithKek(kek, uid, profileId, profile.wrappedDek, profile.sealed)
  }

  /** 解开**分享**配置的 Key：服务端主密钥托管，所有者离线时被授权者也可用（Q1 的分享侧）。 */
  async resolveSharedKeyUnattended(ownerUid: string, profileId: string): Promise<string> {
    const shared = (await this.deps.store.listShared(ownerUid)).find(profile => profile.profileId === profileId)
    if (shared === undefined) throw new Error('分享配置不存在或已撤销')
    return await openShared(await this.masterKey(), ownerUid, profileId, shared.sealed)
  }
}