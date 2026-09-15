/**
 * Passkey (WebAuthn) support for dsh-ui-auth.
 *
 * Scope of this module:
 * - resolve the relying party (rpId / origin / display name) from the browser-visible
 *   host, with explicit overrides for reverse-proxy deployments;
 * - issue and consume one-time, short-lived challenges bound to a purpose and a user;
 * - wrap the registration and authentication ceremonies of `@simplewebauthn/server`
 *   into discriminated results, and convert between wire and stored representations.
 *
 * Policies encoded here (see docs/DSH-0.1.5-COMPATIBILITY.md and SECURITY.md):
 * - user verification is REQUIRED for both ceremonies: a passkey must prove possession
 *   of the authenticator *and* a local gesture (biometric/PIN) to count as a factor;
 * - resident (discoverable) credentials are REQUIRED so that username-less login works;
 * - attestation is 'none': no authenticator provenance is requested or stored beyond
 *   the AAGUID the authenticator itself reports;
 * - one-time challenges: stored in memory, consumed on first use, bounded in count.
 *
 * Storage note: only the credential id, the COSE public key and public metadata are
 * persisted. No private key or shared secret ever reaches the server.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  CredentialDeviceType,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server'
import { generateChallenge, isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers'

/** Hard cap on passkeys per account (bounds the user record size). */
export const MAX_PASSKEYS = 20
/** How long an issued challenge stays valid. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000
/** Ceremony timeout handed to the browser. */
export const CEREMONY_TIMEOUT_MS = 60_000
/** Bound on simultaneously pending challenges (resource protection). */
const MAX_PENDING_CHALLENGES = 512
/** Label bounds for a user-supplied passkey name. */
const MAX_LABEL_LENGTH = 40

/** Transport hints an authenticator may report. */
const KNOWN_TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'])

/** One passkey as persisted inside the user record (JSON-safe). */
export interface StoredPasskey {
  /** base64url credential id */
  id: string
  /** base64url COSE public key */
  publicKey: string
  /** signature counter as last reported by the authenticator */
  counter: number
  /** transports the authenticator reported at registration */
  transports: string[]
  /** user-visible label */
  label: string
  createdAt: number
  lastUsedAt?: number
  /** 'singleDevice' (bound to one authenticator) or 'multiDevice' (synced) */
  deviceType: CredentialDeviceType
  /** whether a multi-device credential reports itself as backed up */
  backedUp: boolean
  /** authenticator model identifier reported by the authenticator itself */
  aaguid: string
}

/** Passkey metadata safe to send to the browser (never the public key). */
export interface PasskeySummary {
  id: string
  label: string
  createdAt: number
  lastUsedAt?: number
  deviceType: CredentialDeviceType
  backedUp: boolean
  transports: string[]
}

/** The browser-visible relying party facts derived from a request. */
export interface PasskeyRelyingParty {
  rpId: string
  origin: string
  rpName: string
}

/** The subset of a user record the factor rules care about. */
export interface FactorSource {
  totpSecret?: string | undefined
  totpEnabled?: boolean | undefined
  twoFactor?: boolean | undefined
  passkeys?: StoredPasskey[] | undefined
}

/** Which factors an account currently owns, and whether 2FA is usable at all. */
export interface FactorState {
  /** A TOTP secret is bound *and* confirmed. */
  totpBound: boolean
  passkeyCount: number
  twoFactor: boolean
  /** At least one factor exists, so 2FA can be enforced without locking the user out. */
  hasFactor: boolean
}

/**
 * Derive the factor state of an account.
 *
 * The rule that keeps accounts reachable: `twoFactor` may only stay true while at least one
 * factor remains. Every path that removes a factor goes through `reconcileTwoFactor()`, so
 * "2FA on, zero factors" — an account nobody can log into — cannot be produced.
 */
export function factorState(record: FactorSource): FactorState {
  const totpBound = record.totpEnabled === true && typeof record.totpSecret === 'string' && record.totpSecret !== ''
  const passkeyCount = Array.isArray(record.passkeys) ? record.passkeys.length : 0
  return {
    totpBound,
    passkeyCount,
    twoFactor: record.twoFactor === true,
    hasFactor: totpBound || passkeyCount > 0,
  }
}

/** The value `twoFactor` must have after the account's factors changed. */
export function reconcileTwoFactor(record: FactorSource): boolean {
  return record.twoFactor === true && factorState(record).hasFactor
}

/** Drop malformed entries that may have survived an older/edited record. */
export function sanitizePasskeys(value: unknown): StoredPasskey[] {
  if (!Array.isArray(value)) return []
  const out: StoredPasskey[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    if (typeof candidate.id !== 'string' || candidate.id === '' || candidate.id.length > 1024) continue
    if (typeof candidate.publicKey !== 'string' || candidate.publicKey === '' || candidate.publicKey.length > 4096) continue
    out.push({
      id: candidate.id,
      publicKey: candidate.publicKey,
      counter: typeof candidate.counter === 'number' && Number.isFinite(candidate.counter) && candidate.counter >= 0 ? candidate.counter : 0,
      transports: transportsOf(candidate.transports),
      label: typeof candidate.label === 'string' && candidate.label.trim() !== '' ? candidate.label.trim().slice(0, MAX_LABEL_LENGTH) : '通行密钥',
      createdAt: typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) ? candidate.createdAt : 0,
      ...(typeof candidate.lastUsedAt === 'number' && Number.isFinite(candidate.lastUsedAt) ? { lastUsedAt: candidate.lastUsedAt } : {}),
      deviceType: candidate.deviceType === 'multiDevice' ? 'multiDevice' : 'singleDevice',
      backedUp: candidate.backedUp === true,
      aaguid: typeof candidate.aaguid === 'string' ? candidate.aaguid.slice(0, 64) : '',
    })
    if (out.length >= MAX_PASSKEYS) break
  }
  return out
}

export type ChallengePurpose = 'register' | 'login'

interface PendingChallenge {
  challenge: string
  purpose: ChallengePurpose
  /** account the ceremony belongs to; absent for a username-less login */
  username?: string
  /** base64url user handle, present for registration */
  userHandle?: string
  expiresAt: number
}

export interface ChallengeStore {
  /** Store a freshly generated challenge and return the opaque handle to send back. */
  issue(purpose: ChallengePurpose, challenge: string, owner?: { username?: string; userHandle?: string }): string
  /** Read and immediately drop a challenge; undefined when unknown, used or expired. */
  consume(handle: unknown, purpose: ChallengePurpose): PendingChallenge | undefined
  /** Drop every expired entry (called on issue; cheap and bounded). */
  sweep(now?: number): void
  readonly size: number
}

export type PasskeyResult<T> = { ok: true; value: T } | { ok: false; error: string }

const fail = (error: string): PasskeyResult<never> => ({ ok: false, error })

function randomHandle(): string {
  // 24 random bytes as base64url: unguessable, cookie-safe, opaque to the client.
  return isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(24)))
}

/**
 * Create the in-memory challenge store. Challenges are one-time: a successful or failed
 * verification always consumes the handle, so a captured response cannot be replayed.
 */
export function createChallengeStore(ttlMs: number = CHALLENGE_TTL_MS, maxPending: number = MAX_PENDING_CHALLENGES): ChallengeStore {
  const pending = new Map<string, PendingChallenge>()
  const sweep = (now: number = Date.now()): void => {
    for (const [handle, entry] of pending) {
      if (entry.expiresAt <= now) pending.delete(handle)
    }
    // Bound the map even under a burst of abandoned ceremonies (drop oldest first).
    if (pending.size > maxPending) {
      const excess = pending.size - maxPending
      let dropped = 0
      for (const handle of pending.keys()) {
        pending.delete(handle)
        if (++dropped >= excess) break
      }
    }
  }
  return {
    issue(purpose, challenge, owner) {
      sweep()
      const handle = randomHandle()
      pending.set(handle, {
        challenge,
        purpose,
        ...(owner?.username !== undefined ? { username: owner.username } : {}),
        ...(owner?.userHandle !== undefined ? { userHandle: owner.userHandle } : {}),
        expiresAt: Date.now() + ttlMs,
      })
      return handle
    },
    consume(handle, purpose) {
      if (typeof handle !== 'string' || handle.length === 0 || handle.length > 128) return undefined
      const entry = pending.get(handle)
      if (entry === undefined) return undefined
      pending.delete(handle)
      if (entry.purpose !== purpose || entry.expiresAt <= Date.now()) return undefined
      return entry
    },
    sweep,
    get size() { return pending.size },
  }
}

/** Strip a trailing slash from an origin override. */
function normalizeOrigin(value: string): string {
  const trimmed = value.trim()
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

/**
 * IPv4 literal, or a bracketed/raw IPv6 literal.
 * Verified against Chrome 152 (test/webauthn-probe.mjs): an IP literal can never be an
 * RP ID — the browser throws `SecurityError: … is an invalid domain` — even though
 * loopback origins are secure contexts. So a panel opened at http://127.0.0.1:PORT
 * cannot use passkeys at all, while http://localhost:PORT can.
 */
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/

function isIpLiteral(hostname: string): boolean {
  return IPV4_LITERAL.test(hostname) || hostname.startsWith('[') || hostname.includes(':')
}

/** Hosts that browsers treat as a trustworthy origin even over plain HTTP. */
function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

export type RelyingPartyIssue = 'missing-host' | 'invalid-host' | 'ip-literal' | 'insecure-origin' | 'rp-id-mismatch'

export interface RelyingPartyAssessment {
  supported: boolean
  rp?: PasskeyRelyingParty
  issue?: RelyingPartyIssue
  /** Host the user should open instead, when the deployment offers an equivalent one. */
  suggestedHost?: string
}

/**
 * Decide whether passkeys can be used for this request, and if not, why.
 * The reason is surfaced to the UI so it can tell the user exactly what to do
 * (open `localhost` instead of the loopback IP, or serve the panel over HTTPS).
 */
export function assessRelyingParty(input: {
  host?: string | undefined
  secure: boolean
  rpId?: string | undefined
  origin?: string | undefined
  rpName?: string | undefined
}): RelyingPartyAssessment {
  const host = (input.host ?? '').trim().toLowerCase()
  if (host.length === 0 || host.length > 255 || host.includes('/') || host.includes(' ')) {
    return { supported: false, issue: host.length === 0 ? 'missing-host' : 'invalid-host' }
  }
  const originOverride = input.origin !== undefined && input.origin.trim().length > 0 ? normalizeOrigin(input.origin) : undefined
  let browserOrigin: URL
  try {
    browserOrigin = new URL(originOverride ?? `${input.secure ? 'https' : 'http'}://${host}`)
  } catch {
    return { supported: false, issue: 'invalid-host' }
  }
  if (browserOrigin.protocol !== 'http:' && browserOrigin.protocol !== 'https:') return { supported: false, issue: 'invalid-host' }
  const browserHost = browserOrigin.hostname.toLowerCase()
  if (browserHost.length === 0) return { supported: false, issue: 'invalid-host' }

  if (isIpLiteral(browserHost)) {
    // An equivalent name exists only for loopback; nothing can rescue a LAN IP.
    return isLoopbackHost(browserHost)
      ? { supported: false, issue: 'ip-literal', suggestedHost: 'localhost' }
      : { supported: false, issue: 'ip-literal' }
  }
  // A non-loopback origin over plain HTTP is not a secure context: no WebAuthn at all.
  if (browserOrigin.protocol === 'http:' && !isLoopbackHost(browserHost)) {
    return { supported: false, issue: 'insecure-origin' }
  }

  const rpId = input.rpId !== undefined && input.rpId.trim().length > 0 ? input.rpId.trim().toLowerCase() : browserHost
  // An rpId is only valid for the host that signs with it: equal, or a registrable suffix.
  if (!(browserHost === rpId || browserHost.endsWith(`.${rpId}`))) return { supported: false, issue: 'rp-id-mismatch' }

  const rpName = input.rpName !== undefined && input.rpName.trim().length > 0 ? input.rpName.trim() : 'DeepSeek Harness'
  return { supported: true, rp: { rpId, origin: `${browserOrigin.protocol}//${browserOrigin.host}`, rpName } }
}

/** Human-readable explanation for a rejected relying party (shown verbatim in the UI). */
export function relyingPartyIssueMessage(issue: RelyingPartyIssue, suggestedHost?: string): string {
  const hint = suggestedHost !== undefined ? `请改用 http://${suggestedHost}:<端口> 打开面板后重试` : ''
  switch (issue) {
    case 'missing-host':
      return '请求缺少 Host 头，无法确定通行密钥的域名'
    case 'ip-literal':
      return `浏览器不接受 IP 地址作为通行密钥域（RP ID）${hint.length > 0 ? `：${hint}` : '，请改用域名并通过 HTTPS 访问'}`
    case 'insecure-origin':
      return '通行密钥要求安全上下文（HTTPS 或 localhost），当前地址为明文 HTTP'
    case 'rp-id-mismatch':
      return '配置的 RP ID 与当前访问域名不匹配，请检查 DSH_AUTH_RP_ID'
    default:
      return '当前访问地址无法使用通行密钥'
  }
}

/**
 * Resolve the relying party for one request, or undefined when passkeys cannot work here.
 * `host` is the Host header the browser used; `secure` is the plugin's existing assessment
 * (TLS, or an X-Forwarded-Proto=https header from a *trusted* proxy). When an origin override
 * is configured (public HTTPS endpoint behind a proxy) the rpId is validated against *that*
 * host, because it is what the browser signs.
 */
export function resolveRelyingParty(input: {
  host?: string | undefined
  secure: boolean
  rpId?: string | undefined
  origin?: string | undefined
  rpName?: string | undefined
}): PasskeyRelyingParty | undefined {
  return assessRelyingParty(input).rp
}

/** Normalize a user-supplied label; falls back to a timestamped default. */
export function normalizePasskeyLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return fallback
  return trimmed.slice(0, MAX_LABEL_LENGTH)
}

function transportsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && KNOWN_TRANSPORTS.has(item)))]
}

/** Convert a stored passkey back into the credential shape the verifier expects. */
export function toWebAuthnCredential(stored: StoredPasskey): WebAuthnCredential {
  return {
    id: stored.id,
    publicKey: isoBase64URL.toBuffer(stored.publicKey),
    counter: stored.counter,
    ...(stored.transports.length > 0 ? { transports: stored.transports as WebAuthnCredential['transports'] } : {}),
  }
}

/** Browser-safe view of a passkey (never exposes the public key). */
export function summarizePasskey(stored: StoredPasskey): PasskeySummary {
  return {
    id: stored.id,
    label: stored.label,
    createdAt: stored.createdAt,
    ...(stored.lastUsedAt !== undefined ? { lastUsedAt: stored.lastUsedAt } : {}),
    deviceType: stored.deviceType,
    backedUp: stored.backedUp,
    transports: stored.transports,
  }
}

/** Structural check for a client registration response before verification. */
function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && candidate.id.length > 0 && candidate.id.length <= 1024
    && typeof candidate.rawId === 'string'
    && typeof candidate.response === 'object' && candidate.response !== null
    && typeof candidate.type === 'string'
}

/** Structural check for a client authentication response before verification. */
function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && candidate.id.length > 0 && candidate.id.length <= 1024
    && typeof candidate.rawId === 'string'
    && typeof candidate.response === 'object' && candidate.response !== null
}

/** The credential id carried by a client response (used before verification). */
export function responseCredentialId(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const id = (value as Record<string, unknown>).id
  return typeof id === 'string' && id.length > 0 && id.length <= 1024 ? id : undefined
}

export interface RegistrationOptionsResult {
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>
  handle: string
  userHandle: string
}

/**
 * Build registration options and remember the challenge.
 *
 * `preferredAuthenticatorType` is what separates the two UI entry points:
 * 'localDevice' asks the platform authenticator (this machine, Touch ID/Windows Hello),
 * 'remoteDevice' steers the browser to the cross-device flow, which is where the browser
 * itself displays the QR code for a phone. Neither restricts what the user may pick.
 */
export async function registrationOptions(input: {
  rp: PasskeyRelyingParty
  store: ChallengeStore
  username: string
  displayName: string
  userHandle: string
  existing: StoredPasskey[]
  preferred?: 'localDevice' | 'remoteDevice' | 'securityKey' | undefined
}): Promise<PasskeyResult<RegistrationOptionsResult>> {
  if (input.existing.length >= MAX_PASSKEYS) return fail(`每个账号最多绑定 ${MAX_PASSKEYS} 个通行密钥`)
  let challenge
  try {
    // Copied into a fresh buffer so the type is a plain Uint8Array under every TS version.
    challenge = new Uint8Array(await generateChallenge())
  } catch {
    return fail('无法生成挑战，请重试')
  }
  let options: Awaited<ReturnType<typeof generateRegistrationOptions>>
  try {
    options = await generateRegistrationOptions({
      rpName: input.rp.rpName,
      rpID: input.rp.rpId,
      userName: input.username,
      userID: isoBase64URL.toBuffer(input.userHandle),
      userDisplayName: input.displayName,
      challenge,
      timeout: CEREMONY_TIMEOUT_MS,
      attestationType: 'none',
      excludeCredentials: input.existing.map(passkey => ({
        id: passkey.id,
        ...(passkey.transports.length > 0 ? { transports: passkey.transports } : {}),
      })),
      authenticatorSelection: {
        // Discoverable credentials make username-less login possible.
        residentKey: 'required',
        requireResidentKey: true,
        // A passkey must verify the user locally (biometric/PIN) to count as a factor.
        userVerification: 'required',
      },
      ...(input.preferred !== undefined ? { preferredAuthenticatorType: input.preferred } : {}),
    })
  } catch {
    return fail('无法生成注册选项，请重试')
  }
  const handle = input.store.issue('register', options.challenge, { username: input.username, userHandle: input.userHandle })
  return { ok: true, value: { options, handle, userHandle: input.userHandle } }
}

/**
 * Verify a registration response and produce the passkey record to persist.
 * The caller must have already re-authenticated the user.
 */
export async function finishRegistration(input: {
  rp: PasskeyRelyingParty
  store: ChallengeStore
  handle: unknown
  response: unknown
  label: string
}): Promise<PasskeyResult<StoredPasskey>> {
  const pending = input.store.consume(input.handle, 'register')
  if (pending === undefined) return fail('注册会话已过期，请重新开始')
  if (!isRegistrationResponse(input.response)) return fail('注册响应格式不正确')
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: pending.challenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpId,
      requireUserPresence: true,
      requireUserVerification: true,
    })
  } catch {
    return fail('通行密钥校验失败，请重试')
  }
  if (!verification.verified || verification.registrationInfo === undefined) return fail('通行密钥校验失败，请重试')
  const info = verification.registrationInfo
  if (!info.userVerified) return fail('该设备未完成用户验证（需要指纹/PIN 等），请改用支持验证的设备')
  return {
    ok: true,
    value: {
      id: info.credential.id,
      publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
      counter: info.credential.counter,
      transports: transportsOf(info.credential.transports),
      label: input.label,
      createdAt: Date.now(),
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      aaguid: info.aaguid,
    },
  }
}

export interface AuthenticationOptionsResult {
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>
  handle: string
}

/**
 * Build authentication options. With neither `username` nor `allowCredentials` the
 * browser performs a discoverable-credential login ("passkey only", no username typed).
 */
export async function authenticationOptions(input: {
  rp: PasskeyRelyingParty
  store: ChallengeStore
  username?: string
  allowCredentials?: StoredPasskey[]
}): Promise<PasskeyResult<AuthenticationOptionsResult>> {
  let challenge
  try {
    challenge = new Uint8Array(await generateChallenge())
  } catch {
    return fail('无法生成挑战，请重试')
  }
  const allow = input.allowCredentials ?? []
  let options: Awaited<ReturnType<typeof generateAuthenticationOptions>>
  try {
    options = await generateAuthenticationOptions({
      rpID: input.rp.rpId,
      challenge,
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: 'required',
      ...(allow.length > 0
        ? {
            allowCredentials: allow.map(passkey => ({
              id: passkey.id,
              ...(passkey.transports.length > 0 ? { transports: passkey.transports } : {}),
            })),
          }
        : {}),
    })
  } catch {
    return fail('无法生成登录选项，请重试')
  }
  const handle = input.store.issue('login', options.challenge, input.username !== undefined ? { username: input.username } : {})
  return { ok: true, value: { options, handle } }
}

export interface AuthenticationOutcome {
  credentialId: string
  newCounter: number
  deviceType: CredentialDeviceType
  backedUp: boolean
  userVerified: boolean
}

/**
 * Verify an authentication response against one known credential.
 * A counter that fails to advance (a sign of a cloned authenticator) is rejected.
 */
export async function finishAuthentication(input: {
  rp: PasskeyRelyingParty
  store: ChallengeStore
  handle: unknown
  response: unknown
  credential: StoredPasskey
  expectedUsername?: string
}): Promise<PasskeyResult<AuthenticationOutcome>> {
  const pending = input.store.consume(input.handle, 'login')
  if (pending === undefined) return fail('登录会话已过期，请重新开始')
  // Only enforced when the options were issued for a specific account: a discoverable
  // (username-less) ceremony legitimately resolves to whichever account owns the credential.
  if (pending.username !== undefined && input.expectedUsername !== undefined && pending.username !== input.expectedUsername) {
    return fail('登录会话与账号不匹配，请重新开始')
  }
  if (!isAuthenticationResponse(input.response)) return fail('登录响应格式不正确')
  if (responseCredentialId(input.response) !== input.credential.id) return fail('登录响应与凭据不匹配')
  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: pending.challenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpId,
      credential: toWebAuthnCredential(input.credential),
      requireUserVerification: true,
    })
  } catch {
    return fail('通行密钥验证失败')
  }
  if (!verification.verified) return fail('通行密钥验证失败')
  const info = verification.authenticationInfo
  if (!info.userVerified) return fail('该设备未完成用户验证（需要指纹/PIN 等）')
  // Clone detection: an authenticator that reports a counter must never go backwards.
  if (input.credential.counter > 0 && info.newCounter > 0 && info.newCounter <= input.credential.counter) {
    return fail('通行密钥计数器异常（可能被复制），已拒绝本次登录')
  }
  return {
    ok: true,
    value: {
      credentialId: info.credentialID,
      newCounter: info.newCounter,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      userVerified: info.userVerified,
    },
  }
}

/** Generate the stable per-account WebAuthn user handle (32 random bytes, base64url). */
export async function newUserHandle(): Promise<string> {
  return isoBase64URL.fromBuffer(await generateChallenge())
}

/** Constant-time-ish comparison used by tests and callers that match handles. */
export function handlesEqual(left: string, right: string): boolean {
  return isoUint8Array.areEqual(isoBase64URL.toBuffer(left), isoBase64URL.toBuffer(right))
}
