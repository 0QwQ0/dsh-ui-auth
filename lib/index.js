/**
 * dsh-ui-auth — DSH Web UI 认证网关（正式部署版 Host 半区）。
 *
 * 在 DSH Web UI 的 node:http 服务器层拦截全部 HTTP 请求与 WebSocket 升级：
 * 未登录一律拒绝（页面请求重定向到登录页，API/静态资源返回 401，WS 升级销毁连接），
 * 覆盖 /api/*、/plugins/*、HMR、SPA fallback 等所有原接口，不留旁路。
 *
 * 用户数据持久化使用 credentials 服务（.credentials.yaml，每用户一条 grant 记录），
 * 密码以 PBKDF2-HMAC-SHA256（随机盐）存储，永不保存明文；令牌/盐优先使用
 * Web Crypto 强熵。首次启动自动创建管理员 admin（随机密码写入控制台日志与
 * dsh-ui-auth-bootstrap.txt）。
 */

import { createHash, randomUUID } from 'node:crypto'
import { createModernGateway } from './modern-gateway.js'

export const name = 'dsh-ui-auth'
export const inject = ['webServer', 'connection']

// ============ WebSocket 工具（RFC 6455 最小实现，零依赖） ============
// 事件流（/api/events.mux、/api/events.host）的帧是 JSON text（DSH 用 ws 库、
// 不协商压缩），网关在升级层做代理 + 按归属逐帧过滤：每用户一条 apiProxy
// 事件迭代器，帧经归属判定后编码为 WS text 帧写回用户 socket。

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 纯 JS SHA-1（crypto.createHash 不可用时的兜底；仅用于 WS 握手指纹）。 */
function sha1Fallback(data) {
  // 参考实现：https://datatracker.ietf.org/doc/html/rfc3174 （算法公开）
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const ml = bytes.length
  const padded = new Uint8Array((((ml + 8) >> 6) + 1) * 64)
  padded.set(bytes)
  padded[ml] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 4, (ml * 8) >>> 0, false)
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)
  for (let i = 0; i < padded.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false)
    for (let j = 16; j < 80; j++) {
      const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]
      w[j] = ((n << 1) | (n >>> 31)) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let j = 0; j < 80; j++) {
      let f, k
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) >>> 0
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = temp
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0
  }
  const out = new Uint8Array(20)
  const odv = new DataView(out.buffer)
  odv.setUint32(0, h0, false); odv.setUint32(4, h1, false); odv.setUint32(8, h2, false)
  odv.setUint32(12, h3, false); odv.setUint32(16, h4, false)
  return out
}

function wsSha1(data) {
  try {
    return createHash('sha1').update(data).digest()
  } catch (err) {
    return sha1Fallback(data)
  }
}

/** 计算 Sec-WebSocket-Accept（base64(SHA1(key + GUID))）。 */
function wsAccept(key) {
  const digest = wsSha1(String(key) + WS_GUID)
  // base64（无 Buffer 依赖）
  const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < digest.length; i += 3) {
    const a = digest[i], b = digest[i + 1] === undefined ? 0 : digest[i + 1], c = digest[i + 2] === undefined ? 0 : digest[i + 2]
    out += b64[a >> 2] + b64[((a & 3) << 4) | (b >> 4)] + (digest[i + 1] === undefined ? '=' : b64[((b & 15) << 2) | (c >> 6)]) + (digest[i + 2] === undefined ? '=' : b64[c & 63])
  }
  return out
}

/** 编码一个服务端 → 客户端数据帧（FIN=1, opcode, 无掩码；支持 64 位扩展长度）。 */
function encodeWsText(text) {
  const payload = new TextEncoder().encode(text)
  const len = payload.length
  let head
  if (len < 126) {
    head = new Uint8Array([0x81, len])
  } else if (len < 65536) {
    head = new Uint8Array([0x81, 126, (len >> 8) & 0xff, len & 0xff])
  } else {
    head = new Uint8Array([0x81, 127, 0, 0, 0, 0, 0, 0, 0, 0])
    const dv = new DataView(head.buffer)
    dv.setUint32(2, Math.floor(len / 0x100000000), false)
    dv.setUint32(6, len >>> 0, false)
  }
  const out = new Uint8Array(head.length + len)
  out.set(head, 0)
  out.set(payload, head.length)
  return out
}

/** 编码一个控制帧（close=8 / ping=9 / pong=10；可带 1-125 字节负载）。 */
function encodeWsControl(opcode, payload) {
  const p = payload === undefined ? new Uint8Array(0) : (payload instanceof Uint8Array ? payload : new TextEncoder().encode(String(payload)))
  const head = new Uint8Array([0x80 | opcode, p.length])
  const out = new Uint8Array(head.length + p.length)
  out.set(head, 0)
  out.set(p, head.length)
  return out
}

// ============ TOTP（RFC 6238：HMAC-SHA1 + 30s 步进 + 6 位码） ============
// 纯 JS 实现（复用 WS 握手的 sha1Fallback），不引入外部依赖。
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(bytes) {
  let bits = 0
  let value = 0
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (let i = 0; i < clean.length; i++) {
    const idx = B32_ALPHABET.indexOf(clean[i])
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

function hmacSha1(keyBytes, msgBytes) {
  let key = keyBytes
  if (key.length > 64) key = sha1Fallback(key)
  const k = new Uint8Array(64)
  k.set(key)
  const ipad = new Uint8Array(64)
  const opad = new Uint8Array(64)
  for (let i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c }
  const inner = new Uint8Array(64 + msgBytes.length)
  inner.set(ipad, 0)
  inner.set(msgBytes, 64)
  const outer = new Uint8Array(64 + 20)
  outer.set(opad, 0)
  outer.set(sha1Fallback(inner), 64)
  return sha1Fallback(outer)
}

/** 指定时刻的 6 位 TOTP 码（RFC 6238，30s 步进）。 */
export function totpCodeAt(secretBase32, timeSec) {
  let key
  try { key = base32Decode(secretBase32) } catch (err) { return '' }
  if (key.length === 0) return ''
  const counter = Math.floor(timeSec / 30)
  const msg = new Uint8Array(8)
  let c = counter
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256) }
  const h = hmacSha1(key, msg)
  const off = h[h.length - 1] & 0x0f
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  const code = (bin % 1000000).toString()
  return '000000'.slice(code.length) + code
}

/** 验证 6 位码（允许 ±1 时间窗口，即前后各 30 秒）。 */
export function totpVerifyCode(secretBase32, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false
  const now = Date.now() / 1000
  for (let w = -1; w <= 1; w++) {
    if (totpCodeAt(secretBase32, now + w * 30) === code) return true
  }
  return false
}

/** 客户端 → 服务端帧流式解析器（浏览器下行通道只应出现 close/ping，仍完整支持掩码与分片）。 */
class WsFrameReader {
  constructor() { this.buf = new Uint8Array(0); this.done = false }
  push(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf, 0)
    merged.set(chunk, this.buf.length)
    this.buf = merged
  }
  /** 尝试取出一帧；不足一帧返回 null；连接关闭帧返回 {close: true}。 */
  read() {
    while (this.buf.length >= 2 && !this.done) {
      const b0 = this.buf[0], b1 = this.buf[1]
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7f
      let off = 2
      if (len === 126) {
        if (this.buf.length < 4) return null
        len = (this.buf[2] << 8) | this.buf[3]
        off = 4
      } else if (len === 127) {
        if (this.buf.length < 10) return null
        const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength)
        len = Number(dv.getBigUint64(2, false))
        off = 10
      }
      const maskBytes = masked ? 4 : 0
      if (this.buf.length < off + maskBytes + len) return null
      let payload = this.buf.slice(off + maskBytes, off + maskBytes + len)
      if (masked) {
        const key = this.buf.slice(off, off + 4)
        const unmasked = new Uint8Array(len)
        for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ key[i % 4]
        payload = unmasked
      }
      this.buf = this.buf.slice(off + maskBytes + len)
      if (opcode === 0x8) { this.done = true; return { close: true } }
      if (opcode === 0x9) return { ping: payload }
      if (opcode === 0xa) return { pong: payload }
      if (!fin) continue // 分片续帧不单独处理：下行通道禁止数据帧，直接忽略续片
      return { opcode, payload }
    }
    return null
  }
}

/** 从环境变量解析限流配置（DSH_AUTH_MAX_FAILS / DSH_AUTH_LOCK_MS / DSH_AUTH_TRUST_PROXY）。 */
export function readLockConfig(env) {
  const e = env !== undefined && env !== null ? env : {}
  const num = (v, d) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : d }
  return {
    maxFails: num(e.DSH_AUTH_MAX_FAILS, 5),
    lockMs: num(e.DSH_AUTH_LOCK_MS, 30 * 1000),
    trustProxy: ['1', 'true', 'yes', 'on'].includes(String(e.DSH_AUTH_TRUST_PROXY || '').trim().toLowerCase()),
  }
}

/**
 * 客户端来源 IP：默认取 socket.remoteAddress；仅当显式配置 DSH_AUTH_TRUST_PROXY=1
 * 时才信任 X-Forwarded-For（取最左，反代按 客户端→代理 顺序追加）。默认不信任，
 * 防止未配置反代时伪造 XFF 绕过/污染限流计数。
 */
export function clientIp(req, trustProxy) {
  try {
    const addr = req !== undefined && req.socket !== undefined ? req.socket.remoteAddress : undefined
    if (trustProxy && req !== undefined && req.headers !== undefined && typeof req.headers['x-forwarded-for'] === 'string') {
      // 取最右（最近受信反代追加的地址，客户端无法伪造）；从右向左跳过空段
      const parts = req.headers['x-forwarded-for'].split(',')
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i].trim()
        if (p !== '') return p
      }
    }
    return typeof addr === 'string' ? addr : 'unknown'
  } catch (err) { return 'unknown' }
}

export function apply(ctx) {
    // ============ 配置常量 ============
    const COOKIE_NAME = 'dsh_auth'
    const SCOPE = 'dsh-auth'
    const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 会话 12 小时，滑动续期
    const SESSION_SWEEP_MS = 5 * 60 * 1000
    const PBKDF2_ITERATIONS = 60000
    const MIN_PASSWORD = 8
    const MAX_PASSWORD = 128
    const MAX_BODY_BYTES = 64 * 1024
    // 限流配置：环境变量覆盖（DSH_AUTH_MAX_FAILS / DSH_AUTH_LOCK_MS / DSH_AUTH_TRUST_PROXY）
    const lock = readLockConfig(typeof process !== 'undefined' && process.env !== undefined ? process.env : {})
    const LOCKOUT_MAX_FAILS = lock.maxFails
    const LOCKOUT_MS = lock.lockMs
    const TRUST_PROXY = lock.trustProxy
    const USERNAME_RE = /^[A-Za-z0-9_.-]{2,32}$/
    const userRecordKey = username => SCOPE + '/' + (/^[a-z][a-z0-9-]*$/.test(username) && !['ownership', 'invites', 'retired-users'].includes(username)
      ? username : 'user-' + createHash('sha256').update(username).digest('hex'))

    // ============ 纯 JS 密码学（沙箱无 crypto/Buffer） ============
    function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0 }

    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ])

    function sha256(data) {
      const len = data.length
      const bitLenHi = Math.floor(len / 0x20000000)
      const bitLenLo = (len << 3) >>> 0
      const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64)
      padded.set(data)
      padded[len] = 0x80
      const dv = new DataView(padded.buffer)
      dv.setUint32(padded.length - 8, bitLenHi)
      dv.setUint32(padded.length - 4, bitLenLo)
      const w = new Uint32Array(64)
      let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
      let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
      for (let i = 0; i < padded.length; i += 64) {
        for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4)
        for (let j = 16; j < 64; j++) {
          const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3)
          const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10)
          w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
        for (let j = 0; j < 64; j++) {
          const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
          const ch = (e & f) ^ (~e & g)
          const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0
          const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
          const maj = (a & b) ^ (a & c) ^ (b & c)
          const t2 = (S0 + maj) >>> 0
          h = g; g = f; f = e; e = (d + t1) >>> 0
          d = c; c = b; b = a; a = (t1 + t2) >>> 0
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
      }
      const out = new Uint8Array(32)
      const odv = new DataView(out.buffer)
      odv.setUint32(0, h0); odv.setUint32(4, h1); odv.setUint32(8, h2); odv.setUint32(12, h3)
      odv.setUint32(16, h4); odv.setUint32(20, h5); odv.setUint32(24, h6); odv.setUint32(28, h7)
      return out
    }

    function hmacSha256(key, msg) {
      const blockSize = 64
      let k = key
      if (k.length > blockSize) k = sha256(k)
      const iKey = new Uint8Array(blockSize)
      const oKey = new Uint8Array(blockSize)
      for (let i = 0; i < blockSize; i++) {
        const kb = i < k.length ? k[i] : 0
        iKey[i] = kb ^ 0x36
        oKey[i] = kb ^ 0x5c
      }
      const inner = new Uint8Array(blockSize + msg.length)
      inner.set(iKey)
      inner.set(msg, blockSize)
      const innerHash = sha256(inner)
      const outer = new Uint8Array(blockSize + innerHash.length)
      outer.set(oKey)
      outer.set(innerHash, blockSize)
      return sha256(outer)
    }

    function pbkdf2(password, salt, iterations) {
      const block = new Uint8Array(salt.length + 4)
      block.set(salt)
      block[salt.length + 3] = 1
      let u = hmacSha256(password, block)
      const result = new Uint8Array(u)
      for (let i = 1; i < iterations; i++) {
        u = hmacSha256(password, u)
        for (let j = 0; j < result.length; j++) result[j] ^= u[j]
      }
      return result
    }

    function toHex(bytes) {
      let s = ''
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i]
        s += (b < 16 ? '0' : '') + b.toString(16)
      }
      return s
    }

    function hexToBytes(hex) {
      const out = new Uint8Array(Math.floor(String(hex).length / 2))
      for (let i = 0; i < out.length; i++) {
        const byte = parseInt(String(hex).slice(i * 2, i * 2 + 2), 16)
        out[i] = Number.isNaN(byte) ? 0 : byte
      }
      return out
    }

    function utf8(str) {
      return new TextEncoder().encode(str)
    }

    function randomBytes(n) {
      // 正式部署环境有 Web Crypto，用它提供强熵；沙箱里回退到 Math.random。
      if (typeof crypto !== 'undefined' && crypto !== null && typeof crypto.getRandomValues === 'function') {
        const out = new Uint8Array(n)
        crypto.getRandomValues(out)
        return out
      }
      const out = new Uint8Array(n)
      for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256)
      return out
    }

    function randomHex(nBytes) {
      return toHex(randomBytes(nBytes))
    }

    function randomPassword(len) {
      const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*'
      const bytes = randomBytes(len)
      let out = ''
      for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length]
      return out
    }

    function constantTimeEqual(a, b) {
      if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
      let diff = 0
      for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
      return diff === 0
    }

    function hashPassword(password, saltHex, iterations) {
      return toHex(pbkdf2(utf8(password), hexToBytes(saltHex), iterations))
    }

    function newPasswordRecord(password) {
      const salt = randomHex(16)
      return { salt, hash: hashPassword(password, salt, PBKDF2_ITERATIONS), iterations: PBKDF2_ITERATIONS }
    }

    function verifyPassword(record, password) {
      if (record === undefined || typeof record.hash !== 'string' || typeof record.salt !== 'string') return false
      const iters = typeof record.iterations === 'number' && record.iterations > 0 ? record.iterations : PBKDF2_ITERATIONS
      return constantTimeEqual(hashPassword(password, record.salt, iters), record.hash)
    }

    // ============ 运行时状态 ============
    const state = {
      users: new Map(),   // username -> 用户记录（含 salt/hash，仅进程内）
      retiredUsers: new Set(),
      sessions: new Map(), // token -> { username, expiresAt }
      fails: new Map(),    // ip -> { count, until }
      ready: false,
      fatal: null,
    }

    let creds = ctx.get('credentials')
    let store = null

    // 用注入的服务构建持久化 store；payload 存 JSON 字符串（沙箱 realm 对象
    // 无法通过 credentials-local 的 host-realm Object.prototype 校验）。
    function buildStore(c) {
      return {
        async load() {
          const prefix = SCOPE + '/'
          const entries = await c.listRecords()
          for (const entry of entries) {
            if (typeof entry.key !== 'string' || !entry.key.startsWith(prefix)) continue
            const rec = await c.readRecord(entry.key)
            if (rec === undefined || rec.kind !== 'grant' || typeof rec.payload !== 'string') continue
            let p
            try { p = JSON.parse(rec.payload) } catch (err) { continue }
            if (p !== null && typeof p === 'object' && typeof p.v === 'number'
              && typeof p.hash === 'string' && typeof p.salt === 'string') {
              const username = typeof p.username === 'string' ? p.username : entry.key.slice(prefix.length)
              state.users.set(username, p)
            }
          }
        },
        async create(rec) {
          if (state.retiredUsers.has(rec.username)) return false
          const key = userRecordKey(rec.username)
          const jsonString = JSON.stringify(rec)
          const written = await c.modifyRecord(key, async (current) => {
            if (current !== undefined) return undefined
            return { kind: 'grant', payload: jsonString }
          })
          if (written === undefined || written.kind !== 'grant' || written.payload !== jsonString) return false
          state.users.set(rec.username, rec)
          return true
        },
        async mutate(username, fn) {
          const key = userRecordKey(username)
          const written = await c.modifyRecord(key, async (current) => {
            if (current === undefined || current.kind !== 'grant' || typeof current.payload !== 'string') return undefined
            let parsed
            try { parsed = JSON.parse(current.payload) } catch (err) { return undefined }
            if (parsed === null || typeof parsed !== 'object') return undefined
            const next = await fn(parsed)
            if (next === undefined) return undefined
            return { kind: 'grant', payload: JSON.stringify(next) }
          })
          if (written !== undefined && written.kind === 'grant' && typeof written.payload === 'string') {
            let parsed
            try { parsed = JSON.parse(written.payload) } catch (err) { return undefined }
            state.users.set(username, parsed)
            return parsed
          }
          return undefined
        },
        async remove(username) {
          await c.modifyRecord(SCOPE + '/retired-users', async current => {
            const retired = current?.kind === 'grant' && typeof current.payload === 'string' ? JSON.parse(current.payload) : []
            return { kind: 'grant', payload: JSON.stringify([...new Set([...retired, username])]) }
          })
          state.retiredUsers.add(username)
          state.users.delete(username)
          await c.deleteRecord(userRecordKey(username))
        },
        async readRaw(key) {
          const rec = await c.readRecord(key)
          if (rec === undefined || rec.kind !== 'grant' || typeof rec.payload !== 'string') return undefined
          return rec.payload
        },
        async writeRaw(key, payload) {
          await c.modifyRecord(key, async (current) => {
            if (current !== undefined && current.kind === 'grant') {
              return { kind: 'grant', payload: current.payload === payload ? current.payload : payload }
            }
            return { kind: 'grant', payload }
          })
        },
      }
    }

    // credentials 服务可能在插件 apply 之后才挂载（启动顺序竞态）：
    // 有界等待它就绪，避免误走内存兜底导致每次重启生成新管理员。
    async function acquireCredentials(timeoutMs) {
      if (creds !== undefined) return
      const deadline = Date.now() + timeoutMs
      while (creds === undefined && Date.now() < deadline) {
        creds = ctx.get('credentials')
        if (creds !== undefined) break
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      if (creds !== undefined && store === null) store = buildStore(creds)
    }

    if (creds !== undefined) store = buildStore(creds)

    async function storeMutate(username, fn) {
      if (store !== null) return store.mutate(username, fn)
      const cur = state.users.get(username)
      if (cur === undefined) return undefined
      const next = await fn(cur)
      if (next === undefined) return undefined
      state.users.set(username, next)
      return next
    }

    async function storeCreate(rec) {
      if (state.retiredUsers.has(rec.username)) return false
      if (store !== null) return store.create(rec)
      if (state.users.has(rec.username)) return false
      state.users.set(rec.username, rec)
      return true
    }

    async function storeRemove(username) {
      if (store !== null) return store.remove(username)
      state.users.delete(username)
    }

    // ============ 会话 ============
    // 会话持久化（0.4.0）：会话表落盘到 dsh-ui-auth-sessions.json（fs 服务工作目录），
    // 重启后恢复未过期会话 —— token 明文落盘等价于"记住登录态"，文件仅属主可读写。
    const SESSIONS_FILE = 'dsh-ui-auth-sessions.json'
    let sessionsDirty = false

    function persistSessions() {
      if (!sessionsDirty) return
      try {
        const fsSvc = ctx.get('fs')
        if (fsSvc === undefined) return
        const data = { v: 1, sessions: {} }
        for (const [token, s] of state.sessions) data.sessions[token] = { username: s.username, expiresAt: s.expiresAt }
        sessionsDirty = false
        fsSvc.resolve(SESSIONS_FILE).then((t) => fsSvc.writeText(t, JSON.stringify(data))).catch((err) => console.error('[dsh-ui-auth] 写入会话文件失败: ' + String(err)))
      } catch (err) { /* ignore */ }
    }

    async function loadSessions() {
      try {
        const fsSvc = ctx.get('fs')
        if (fsSvc === undefined) return
        const t = await fsSvc.resolve(SESSIONS_FILE)
        const text = await fsSvc.readText(t)
        const data = JSON.parse(text)
        if (data === null || typeof data !== 'object' || data.v !== 1 || typeof data.sessions !== 'object' || data.sessions === null) return
        const now = Date.now()
        let loaded = 0
        for (const [key, s] of Object.entries(data.sessions)) {
          // v0.5.1：只接受哈希格式 key（64 位 hex）；旧版明文 token 记录升级后不再恢复
          if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) continue
          if (typeof s !== 'object' || s === null || typeof s.username !== 'string' || typeof s.expiresAt !== 'number') continue
          if (s.expiresAt <= now) continue // 已过期不恢复
          if (!state.users.has(s.username)) continue // 用户已不存在则不恢复
          state.sessions.set(key, { username: s.username, expiresAt: Math.min(s.expiresAt, now + SESSION_TTL_MS) })
          loaded++
        }
        if (loaded > 0) console.log('[dsh-ui-auth] 已恢复 ' + loaded + ' 个持久化会话（重启不掉线）')
      } catch (err) { /* 文件不存在/损坏：从空会话开始 */ }
    }

    /** 会话 token 哈希（内存 key 与落盘均用哈希，磁盘不存明文 token）。 */
    function hashToken(token) {
      return toHex(sha256(new TextEncoder().encode(String(token))))
    }

    function createSession(username) {
      let token = randomHex(24)
      while (state.sessions.has(hashToken(token))) token = randomHex(24)
      state.sessions.set(hashToken(token), { username, expiresAt: Date.now() + SESSION_TTL_MS })
      sessionsDirty = true
      persistSessions()
      return token
    }

    function resolveSession(token, touch = true) {
      if (token === undefined) return undefined
      const key = hashToken(token)
      const s = state.sessions.get(key)
      if (s === undefined) return undefined
      const now = Date.now()
      if (s.expiresAt <= now) {
        state.sessions.delete(key)
        sessionsDirty = true
        return undefined
      }
      if (touch) s.expiresAt = now + SESSION_TTL_MS
      return s.username
    }

    function destroySession(token) {
      if (token !== undefined && state.sessions.delete(hashToken(token))) {
        sessionsDirty = true
        persistSessions()
      }
    }

    function invalidateSessions(username, exceptToken) {
      let changed = false
      for (const [token, s] of state.sessions) {
        if (s.username === username && token !== exceptToken) { state.sessions.delete(token); changed = true }
      }
      if (changed) {
        sessionsDirty = true
        persistSessions()
      }
    }

    function adminCount() {
      let n = 0
      for (const u of state.users.values()) if (u.role === 'admin') n++
      return n
    }

    // ============ 数据归属（按登录用户隔离会话/工作区） ============
    // DSH 是单用户应用，会话/工作区为机器级数据；认证层需要按登录用户隔离。
    // 归属表持久化在 credentials 记录 dsh-auth/ownership（payload=JSON 字符串），
    // 内存缓存供读路径使用。未打标的数据默认归 admin（旧数据对普通用户不可见）。
    // 隔离范围：列表/搜索/工作区响应过滤 + 直连访问按归属拦截 + 创建打标；
    // 事件流（events.mux/host WebSocket）无法在网关层逐帧过滤，属已知边界。
    const OWNERSHIP_KEY = SCOPE + '/ownership'
    state.owners = { sessions: new Map(), workspaces: new Map() }

    async function loadOwnership() {
      if (store === null) return
      const rec = await store.readRaw(OWNERSHIP_KEY)
      if (rec === undefined) return
      let p
      try { p = JSON.parse(rec) } catch (err) { return }
      if (p !== null && typeof p === 'object' && p.sessions !== null && typeof p.sessions === 'object'
        && p.workspaces !== null && typeof p.workspaces === 'object') {
        state.owners.sessions = new Map(Object.entries(p.sessions))
        state.owners.workspaces = new Map(Object.entries(p.workspaces))
      }
    }

    async function persistOwnership() {
      if (store === null) return
      const payload = JSON.stringify({
        v: 1,
        sessions: Object.fromEntries(state.owners.sessions),
        workspaces: Object.fromEntries(state.owners.workspaces),
      })
      await store.writeRaw(OWNERSHIP_KEY, payload)
    }

    let ownershipWrites = Promise.resolve()
    function claimOwner(kind, id, username) {
      const write = ownershipWrites.then(async () => {
        if (typeof id !== 'string' || id.length === 0 || id.length > 256 || !state.users.has(username)) throw new Error('Invalid ownership attribution')
        const table = state.owners[kind]
        const previous = table.get(id)
        if (previous !== undefined && previous !== username) throw new Error('Object already belongs to another user')
        table.set(id, username)
        try { await persistOwnership() }
        catch (error) { if (previous === undefined) table.delete(id); throw error }
      })
      ownershipWrites = write.catch(() => {})
      return write
    }
    const setSessionOwner = (id, username) => claimOwner('sessions', id, username)
    const setWorkspaceOwner = (id, username) => claimOwner('workspaces', id, username)

    function ownerOfSession(sessionId) {
      return state.owners.sessions.get(sessionId) ?? 'admin'
    }

    function ownerOfWorkspace(workspaceId) {
      return state.owners.workspaces.get(workspaceId) ?? 'admin'
    }

    // ============ 邀请码（注册功能，0.5.0） ============
    // 持久化在 credentials 记录 dsh-auth/invites（payload=JSON 字符串）。
    // 每个码：total（可注册次数）/ used（已用次数）/ createdBy / createdAt。
    const INVITES_KEY = SCOPE + '/invites'
    const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去除易混淆字符
    state.invites = new Map()

    function inviteCode() {
      let out = ''
      for (let i = 0; i < 8; i++) out += INVITE_ALPHABET[randomBytes(1)[0] % INVITE_ALPHABET.length]
      return out
    }

    /** 生成随机 TOTP 密钥（20 字节 → base32；使用本 apply 的强熵随机源）。 */
    function totpGenerateSecret() {
      return base32Encode(randomBytes(20))
    }

    async function loadInvites() {
      if (store === null) return
      const rec = await store.readRaw(INVITES_KEY)
      if (rec === undefined) return
      let p
      try { p = JSON.parse(rec) } catch (err) { return }
      if (p !== null && typeof p === 'object' && p.codes !== null && typeof p.codes === 'object') {
        for (const [code, v] of Object.entries(p.codes)) {
          if (v !== null && typeof v === 'object' && typeof v.total === 'number' && typeof v.used === 'number') {
            state.invites.set(code, {
              total: v.total,
              used: v.used,
              createdBy: typeof v.createdBy === 'string' ? v.createdBy : 'admin',
              createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
            })
          }
        }
      }
    }

    async function persistInvites() {
      if (store === null) return
      const payload = JSON.stringify({ v: 1, codes: Object.fromEntries(state.invites) })
      await store.writeRaw(INVITES_KEY, payload)
    }

    // ============ HTTP 工具 ============
    function pathnameOf(rawUrl) {
      if (typeof rawUrl !== 'string') return '/'
      const q = rawUrl.indexOf('?')
      const p = q === -1 ? rawUrl : rawUrl.slice(0, q)
      try { return decodeURIComponent(p) } catch (err) { return p }
    }

    function readCookie(req, name) {
      const header = req.headers !== undefined ? req.headers.cookie : undefined
      if (typeof header !== 'string') return undefined
      const prefix = name + '='
      for (const part of header.split(';')) {
        const t = part.trim()
        if (t.startsWith(prefix)) return t.slice(prefix.length)
      }
      return undefined
    }

    function readBody(req, limit) {
      return new Promise((resolve, reject) => {
        let size = 0
        let text = ''
        const dec = new TextDecoder()
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > limit) {
            reject(new Error('body too large'))
            try { req.destroy() } catch (e) { /* ignore */ }
            return
          }
          text += dec.decode(chunk, { stream: true })
        })
        req.on('end', () => { text += dec.decode(); resolve(text) })
        req.on('error', reject)
      })
    }

    function clientIpOf(req) {
      return clientIp(req, TRUST_PROXY)
    }

    function sendJson(res, status, obj) {
      if (res.headersSent) { try { res.destroy() } catch (e) { /* ignore */ } return }
      try {
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify(obj))
      } catch (err) {
        try { res.destroy() } catch (e) { /* ignore */ }
      }
    }

    function redirect(res, location) {
      if (res.headersSent) { try { res.destroy() } catch (e) { /* ignore */ } return }
      try {
        res.writeHead(302, { location, 'cache-control': 'no-store' })
        res.end()
      } catch (err) {
        try { res.destroy() } catch (e) { /* ignore */ }
      }
    }

    /** 请求是否处于安全通道：TLS 直连，或（仅当信任反代时）X-Forwarded-Proto: https。 */
    function isSecureRequest(req) {
      try {
        if (req.socket !== undefined && req.socket.encrypted === true) return true
        if (TRUST_PROXY && req.headers !== undefined && req.headers['x-forwarded-proto'] === 'https') return true
      } catch (err) { /* ignore */ }
      return false
    }

    function setAuthCookie(res, token, secure) {
      try {
        res.setHeader('set-cookie', COOKIE_NAME + '=' + token + '; Path=/; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '') + '; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000))
      } catch (err) { /* ignore */ }
    }

    function clearAuthCookie(res, secure) {
      try {
        res.setHeader('set-cookie', COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '') + '; Max-Age=0')
      } catch (err) { /* ignore */ }
    }

    function publicUser(p) {
      return {
        username: p.username,
        role: p.role === 'admin' ? 'admin' : 'user',
        displayName: typeof p.displayName === 'string' ? p.displayName : '',
        email: typeof p.email === 'string' ? p.email : '',
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
        totpEnabled: p.totpEnabled === true,
        totpIgnore: p.totpIgnore === true,
        twoFactor: p.twoFactor === true,
      }
    }

    function passwordError(pw) {
      if (typeof pw !== 'string') return '密码格式错误'
      if (pw.length < MIN_PASSWORD) return '密码至少 ' + MIN_PASSWORD + ' 位'
      if (pw.length > MAX_PASSWORD) return '密码过长（最多 ' + MAX_PASSWORD + ' 位）'
      // 复杂度：至少两种字符类型（大写/小写字母、数字、符号）
      const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(pw)).length
      if (kinds < 2) return '密码需包含至少两种字符类型（大写字母、小写字母、数字、符号）'
      return null
    }

    function recordFail(ip) {
      const cur = state.fails.get(ip)
      const count = (cur === undefined ? 0 : cur.count) + 1
      state.fails.set(ip, count >= LOCKOUT_MAX_FAILS
        ? { count, until: Date.now() + LOCKOUT_MS }
        : { count, until: 0 })
    }

    // ============ 登录页 ============
    function loginPage() {
      return '<!DOCTYPE html>' +
        '<html lang="zh-CN"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>登录 · DeepSeek Harness</title><style>' +
        '*{box-sizing:border-box;margin:0;padding:0}' +
        'body{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
        'min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'background:#0f1115;color:#e6e6e6}' +
        '.card{width:360px;max-width:calc(100vw - 40px);background:#171a21;border:1px solid #2a2f3a;' +
        'border-radius:12px;padding:32px 28px;box-shadow:0 12px 40px rgba(0,0,0,.45)}' +
        '.brand{font-size:20px;font-weight:700;letter-spacing:.3px;margin-bottom:4px}' +
        '.sub{font-size:13px;color:#8b93a7;margin-bottom:24px}' +
        'label{display:block;font-size:13px;color:#aab2c3;margin:14px 0 6px}' +
        'input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333a47;' +
        'background:#101318;color:#f0f0f0;font-size:14px;outline:none}' +
        'input:focus{border-color:#4f7cff}' +
        '.pw{position:relative}' +
        '.pw input{padding-right:46px}' +
        '.eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:auto;margin:0;padding:6px 8px;' +
        'background:none;border:0;border-radius:6px;font-size:15px;line-height:1;cursor:pointer;color:#8b93a7}' +
        '.eye:hover{color:#c9d1e3}' +
        'button{width:100%;margin-top:22px;padding:11px;border:0;border-radius:8px;' +
        'background:#4f7cff;color:#fff;font-size:15px;font-weight:600;cursor:pointer}' +
        'button:hover{background:#3d6bff}button:disabled{opacity:.6;cursor:default}' +
        '.err{margin-top:14px;font-size:13px;color:#ff6b6b;min-height:18px}' +
        '.foot{margin-top:22px;font-size:12px;color:#5c6472;text-align:center}' +
        '.foot a{color:#4f7cff;text-decoration:none}' +
        '@media (prefers-color-scheme: light){' +
        'body{background:#f4f6f9;color:#1f2329}' +
        '.card{background:#ffffff;border:1px solid #dfe3ea;box-shadow:0 8px 24px rgba(31,35,41,.08)}' +
        '.sub{color:#5c6472}' +
        'label{color:#5c6472}' +
        'input{background:#ffffff;border:1px solid #d2d7df;color:#1f2329}' +
        'input:focus{border-color:#3b6ee0}' +
        '.eye{color:#8a92a0}.eye:hover{color:#3a4150}' +
        'button{background:#3b6ee0}' +
        'button:hover{background:#315fd0}' +
        '.foot{color:#8a92a0}' +
        '.foot a{color:#3b6ee0}}' +
        '</style></head><body><div class="card">' +
        '<div class="brand">DeepSeek Harness</div>' +
        '<div class="sub">请登录后继续访问</div>' +
        '<form id="f">' +
        '<label for="u">用户名</label><input id="u" name="username" autocomplete="username" required autofocus>' +
        '<label for="p">密码</label><div class="pw"><input id="p" name="password" type="password" autocomplete="current-password">' +
        '<button type="button" class="eye" id="pe" aria-label="显示/隐藏密码">👁</button></div>' +
        '<label for="t">动态码（可选）</label><input id="t" name="totp" inputmode="numeric" autocomplete="one-time-code" placeholder="已启用两步验证时填写；密码留空可用动态码免密登录" maxlength="6">' +
        '<button id="b" type="submit">登 录</button>' +
        '<div class="err" id="e"></div>' +
        '</form><div class="foot">访问受保护 · <a href="/auth/register">注册账号</a></div>' +
        '</div><script>' +
        '(function(){var f=document.getElementById("f"),e=document.getElementById("e"),b=document.getElementById("b"),t=document.getElementById("t"),' +
        'p=document.getElementById("p");' +
        'document.getElementById("pe").addEventListener("click",function(){var on=p.type==="password";p.type=on?"text":"password";' +
        'this.textContent=on?"🙈":"👁"});' +
        'var params=new URLSearchParams(location.search),next=params.get("next");' +
        'function okPath(p){return p&&p.charAt(0)==="/"&&p.indexOf("//")===-1&&p.indexOf(":")===-1}' +
        'f.addEventListener("submit",function(ev){ev.preventDefault();b.disabled=true;e.textContent="";' +
        'fetch("/auth/login",{method:"POST",headers:{"content-type":"application/json"},' +
        'body:JSON.stringify({username:document.getElementById("u").value,password:document.getElementById("p").value,totp:t.value})})' +
        '.then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {status:r.status,json:j}})}).then(function(r){' +
        'if(r.status===200&&r.json.ok){' +
        'if(r.json.totpRequired){e.textContent="该账号已启用两步验证，请输入验证器中的 6 位动态码后再次登录";b.disabled=false;t.focus();return}' +
        'location.href=okPath(r.json.redirect)?r.json.redirect:(okPath(next)?next:"/");return}' +
        'e.textContent=r.json.error||("登录失败 ("+r.status+")");b.disabled=false})' +
        '.catch(function(){e.textContent="网络错误，请重试";b.disabled=false})})})()' +
        '</script></body></html>'
    }

    // ============ 认证端点 ============
    function safeNext(query) {
      let next = '/'
      if (typeof query === 'string') {
        // 匹配首参（q 不含前导 '?'）或任意 '&' 分隔的 next 参数
        const m = query.match(/(?:^|[?&])next=([^&]+)/)
        if (m !== null) {
          try {
            const p = decodeURIComponent(m[1])
            if (p.charAt(0) === '/' && p.indexOf('//') === -1 && p.indexOf(':') === -1) next = p
          } catch (err) { /* ignore */ }
        }
      }
      return next
    }

    async function handleLogin(req, res) {
      const q = typeof req.url === 'string' ? req.url.split('?').slice(1).join('?') : ''
      if (req.method === 'GET' || req.method === 'HEAD') {
        const token = readCookie(req, COOKIE_NAME)
        if (resolveSession(token) !== undefined) { redirect(res, safeNext(q)); return }
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end()
          return
        }
        try {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(loginPage())
        } catch (err) { try { res.destroy() } catch (e) { /* ignore */ } }
        return
      }
      if (req.method === 'POST') {
        if (!state.ready) { sendJson(res, 503, { error: '服务初始化中，请稍后重试' }); return }
        let body
        try {
          const raw = await readBody(req, MAX_BODY_BYTES)
          body = raw.trim() === '' ? {} : JSON.parse(raw)
        } catch (err) { sendJson(res, 400, { error: '请求体格式错误' }); return }
        const username = typeof body.username === 'string' ? body.username.trim() : ''
        const password = typeof body.password === 'string' ? body.password : ''
        const totp = typeof body.totp === 'string' ? body.totp.trim() : ''
        const hasPassword = password !== ''
        const hasTotp = totp !== ''
        const ip = clientIpOf(req)
        // 两种登录方式：密码（可选 + TOTP 两步验证）或免密 TOTP
        if (username === '' || (!hasPassword && !hasTotp)) {
          sendJson(res, 400, { error: '请输入用户名和密码（或 TOTP 动态码）' })
          return
        }
        const lock = state.fails.get(ip)
        if (lock !== undefined && lock.until > Date.now()) {
          sendJson(res, 429, { error: '尝试次数过多，请 ' + Math.ceil((lock.until - Date.now()) / 1000) + ' 秒后再试' })
          return
        }
        if (lock !== undefined && lock.until > 0 && lock.until <= Date.now()) state.fails.delete(ip)
        const rec = state.users.get(username)
        // 2FA 强制 = 已绑定 TOTP 且用户显式开启两步验证开关
        const twoFactorActive = rec !== undefined && rec.totpEnabled === true && rec.twoFactor === true
        if (hasPassword) {
          // ============ 密码登录（启用 2FA 时需第二步 TOTP） ============
          if (rec === undefined || !verifyPassword(rec, password)) {
            recordFail(ip)
            sendJson(res, 401, { error: '用户名或密码错误' })
            return
          }
          if (twoFactorActive) {
            if (!hasTotp) {
              // 密码正确，要求第二步 TOTP（不签发会话）
              sendJson(res, 200, { ok: true, totpRequired: true })
              return
            }
            if (typeof rec.totpSecret !== 'string' || !totpVerifyCode(rec.totpSecret, totp)) {
              recordFail(ip)
              sendJson(res, 403, { error: '验证码不正确' })
              return
            }
          }
          // 未开启 2FA：密码即登录（可同时绑定 TOTP 用于免密，但不强制第二步）
        } else {
          // ============ 免密 TOTP 登录 ============
          if (rec === undefined) {
            recordFail(ip)
            sendJson(res, 401, { error: '用户名或密码错误' })
            return
          }
          if (rec.totpEnabled !== true || typeof rec.totpSecret !== 'string') {
            sendJson(res, 400, { error: '该账号未启用 TOTP' })
            return
          }
          if (rec.twoFactor === true) {
            sendJson(res, 403, { error: '该账号已启用两步验证，请使用密码和动态码登录' })
            return
          }
          if (!totpVerifyCode(rec.totpSecret, totp)) {
            recordFail(ip)
            sendJson(res, 403, { error: '验证码不正确' })
            return
          }
        }
        state.fails.delete(ip)
        const token = createSession(username)
        setAuthCookie(res, token, isSecureRequest(req))
        sendJson(res, 200, { ok: true, redirect: safeNext(q) })
        return
      }
      sendJson(res, 405, { error: 'method not allowed' })
    }

    // ============ 注册（0.5.0：邮箱 + 用户名 + 密码 + 邀请码） ============
    // 邀请码由管理员在【用户管理】中生成；每码可注册 uses 次（默认 1）。
    // 邮箱不做格式校验（后续版本加入邮箱验证），仅限长度；注册后用户可在
    // 【用户管理】中自行修改邮箱。
    async function performRegister(fields) {
      const username = typeof fields !== null && typeof fields === 'object' && typeof fields.username === 'string' ? fields.username.trim() : ''
      const password = typeof fields !== null && typeof fields === 'object' && typeof fields.password === 'string' ? fields.password : ''
      const confirm = typeof fields !== null && typeof fields === 'object' && typeof fields.confirmPassword === 'string' ? fields.confirmPassword : ''
      const email = typeof fields !== null && typeof fields === 'object' && typeof fields.email === 'string' ? fields.email.trim().slice(0, 120) : ''
      const invite = typeof fields !== null && typeof fields === 'object' && typeof fields.invite === 'string' ? fields.invite.trim() : ''
      if (username === '' || password === '') return { status: 400, error: '请输入用户名和密码' }
      if (password !== confirm) return { status: 400, error: '两次输入的密码不一致' }
      if (!USERNAME_RE.test(username)) return { status: 400, error: '用户名仅允许 2-32 位字母、数字、下划线、点或短横线' }
      const pwErr = passwordError(password)
      if (pwErr !== null) return { status: 400, error: pwErr }
      if (invite === '') return { status: 400, error: '请输入邀请码' }
      if (state.users.has(username)) return { status: 409, error: '用户名已存在' }
      const inv = state.invites.get(invite)
      if (inv === undefined || inv.used >= inv.total) return { status: 403, error: '邀请码无效或已用完' }
      const rec = newPasswordRecord(password)
      const now = Date.now()
      const ok = await storeCreate({ v: 1, username, role: 'user', ...rec, displayName: username, email, createdAt: now, updatedAt: now })
      if (!ok) return { status: 409, error: '用户名已存在' }
      inv.used++
      await persistInvites()
      audit('register', 'anonymous', username, { invite: invite.slice(0, 3) + '***' })
      return { status: 200, ok: true, username }
    }

    async function handleRegister(req, res) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end()
          return
        }
        try {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(registerPage())
        } catch (err) { try { res.destroy() } catch (e) { /* ignore */ } }
        return
      }
      if (req.method === 'POST') {
        if (!state.ready) { sendJson(res, 503, { error: '服务初始化中，请稍后重试' }); return }
        let body
        try {
          const raw = await readBody(req, MAX_BODY_BYTES)
          body = raw.trim() === '' ? {} : JSON.parse(raw)
        } catch (err) { sendJson(res, 400, { error: '请求体格式错误' }); return }
        const out = await performRegister(body)
        if (out.status === 200) {
          // 注册成功：自动登录并跳转 TOTP 引导页（建议立即添加两步验证令牌）
          const token = createSession(out.username)
          setAuthCookie(res, token, isSecureRequest(req))
          sendJson(res, 200, { ok: true, redirect: '/auth/register/success' })
          return
        }
        sendJson(res, out.status, { error: out.error })
        return
      }
      sendJson(res, 405, { error: 'method not allowed' })
    }

    function registerPage() {
      return '<!DOCTYPE html>' +
        '<html lang="zh-CN"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>注册 · DeepSeek Harness</title><style>' +
        '*{box-sizing:border-box;margin:0;padding:0}' +
        'body{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
        'min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'background:#0f1115;color:#e6e6e6}' +
        '.card{width:380px;max-width:calc(100vw - 40px);background:#171a21;border:1px solid #2a2f3a;' +
        'border-radius:12px;padding:32px 28px;box-shadow:0 12px 40px rgba(0,0,0,.45)}' +
        '.brand{font-size:20px;font-weight:700;letter-spacing:.3px;margin-bottom:4px}' +
        '.sub{font-size:13px;color:#8b93a7;margin-bottom:20px}' +
        'label{display:block;font-size:13px;color:#aab2c3;margin:12px 0 6px}' +
        'input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333a47;' +
        'background:#101318;color:#f0f0f0;font-size:14px;outline:none;box-sizing:border-box}' +
        'input:focus{border-color:#4f7cff}' +
        '.pw{position:relative}' +
        '.pw input{padding-right:46px}' +
        '.eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:auto;margin:0;padding:6px 8px;' +
        'background:none;border:0;border-radius:6px;font-size:15px;line-height:1;cursor:pointer;color:#8b93a7}' +
        '.eye:hover{color:#c9d1e3}' +
        'button{width:100%;margin-top:20px;padding:11px;border:0;border-radius:8px;' +
        'background:#4f7cff;color:#fff;font-size:15px;font-weight:600;cursor:pointer}' +
        'button:hover{background:#3d6bff}button:disabled{opacity:.6;cursor:default}' +
        '.err{margin-top:14px;font-size:13px;color:#ff6b6b;min-height:18px}' +
        '.ok{margin-top:14px;font-size:13px;color:#4cc38a;min-height:18px}' +
        '.foot{margin-top:20px;font-size:12px;color:#5c6472;text-align:center}' +
        '.foot a{color:#4f7cff;text-decoration:none}' +
        '@media (prefers-color-scheme: light){' +
        'body{background:#f4f6f9;color:#1f2329}' +
        '.card{background:#ffffff;border:1px solid #dfe3ea;box-shadow:0 8px 24px rgba(31,35,41,.08)}' +
        '.sub{color:#5c6472}' +
        'label{color:#5c6472}' +
        'input{background:#ffffff;border:1px solid #d2d7df;color:#1f2329}' +
        'input:focus{border-color:#3b6ee0}' +
        '.eye{color:#8a92a0}.eye:hover{color:#3a4150}' +
        'button{background:#3b6ee0}' +
        'button:hover{background:#315fd0}' +
        '.foot{color:#8a92a0}' +
        '.foot a{color:#3b6ee0}}' +
        '</style></head><body><div class="card">' +
        '<div class="brand">DeepSeek Harness</div>' +
        '<div class="sub">注册新账号（需要有效邀请码）</div>' +
        '<form id="f">' +
        '<label for="u">用户名</label><input id="u" name="username" autocomplete="username" required autofocus>' +
        '<label for="e">邮箱</label><input id="e" name="email" type="email" autocomplete="email" required>' +
        '<label for="p">密码</label><div class="pw"><input id="p" name="password" type="password" autocomplete="new-password" required>' +
        '<button type="button" class="eye" id="pe" aria-label="显示/隐藏密码">👁</button></div>' +
        '<label for="p2">确认密码</label><div class="pw"><input id="p2" name="confirmPassword" type="password" autocomplete="new-password" required>' +
        '<button type="button" class="eye" id="pe2" aria-label="显示/隐藏密码">👁</button></div>' +
        '<label for="i">邀请码</label><input id="i" name="invite" autocomplete="off" required>' +
        '<button id="b" type="submit">注 册</button>' +
        '<div class="err" id="e2"></div><div class="ok" id="o"></div>' +
        '</form><div class="foot"><a href="/auth/login">已有账号？返回登录</a></div>' +
        '</div><script>' +
        '(function(){var f=document.getElementById("f"),e=document.getElementById("e2"),o=document.getElementById("o"),b=document.getElementById("b"),' +
        'p=document.getElementById("p"),p2=document.getElementById("p2");' +
        'function toggleEye(input,btn){btn.addEventListener("click",function(){var on=input.type==="password";input.type=on?"text":"password";btn.textContent=on?"🙈":"👁"})}' +
        'toggleEye(p,document.getElementById("pe"));toggleEye(p2,document.getElementById("pe2"));' +
        'f.addEventListener("submit",function(ev){ev.preventDefault();e.textContent="";o.textContent="";' +
        'if(p.value!==p2.value){e.textContent="两次输入的密码不一致";return}' +
        'b.disabled=true;' +
        'fetch("/auth/register",{method:"POST",headers:{"content-type":"application/json"},' +
        'body:JSON.stringify({username:document.getElementById("u").value,password:p.value,confirmPassword:p2.value,' +
        'email:document.getElementById("e").value,invite:document.getElementById("i").value})})' +
        '.then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {status:r.status,json:j}})}).then(function(r){' +
        'if(r.status===200&&r.json.ok){o.textContent="注册成功！即将进入安全设置…";setTimeout(function(){location.href="/auth/register/success"},900);return}' +
        'e.textContent=r.json.error||("注册失败 ("+r.status+")");b.disabled=false})' +
        '.catch(function(){e.textContent="网络错误，请重试";b.disabled=false})})})()' +
        '</script></body></html>'
    }

    // ============ 注册成功引导页（建议立即添加 TOTP，0.5.0） ============
    function escHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      })
    }

    function registerSuccessPage(username) {
      return '<!DOCTYPE html>' +
        '<html lang="zh-CN"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>注册成功 · DeepSeek Harness</title><style>' +
        '*{box-sizing:border-box;margin:0;padding:0}' +
        'body{font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
        'min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'background:#0f1115;color:#e6e6e6;padding:24px 0}' +
        '.card{width:440px;max-width:calc(100vw - 40px);background:#171a21;border:1px solid #2a2f3a;' +
        'border-radius:12px;padding:32px 28px;box-shadow:0 12px 40px rgba(0,0,0,.45)}' +
        '.brand{font-size:20px;font-weight:700;letter-spacing:.3px;margin-bottom:4px}' +
        '.sub{font-size:13px;color:#8b93a7;margin-bottom:14px}' +
        '.tip{font-size:13px;color:#aab2c3;line-height:22px;background:#101318;border:1px solid #2a2f3a;' +
        'border-radius:8px;padding:12px 14px;margin-bottom:16px}' +
        'label{display:block;font-size:13px;color:#aab2c3;margin:12px 0 6px}' +
        'input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333a47;' +
        'background:#101318;color:#f0f0f0;font-size:14px;outline:none;box-sizing:border-box}' +
        'input:focus{border-color:#4f7cff}' +
        'code{display:block;padding:10px;border-radius:8px;background:#101318;border:1px solid #2a2f3a;' +
        'font-size:12px;word-break:break-all;color:#c9d1e3}' +
        'button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:8px;' +
        'background:#4f7cff;color:#fff;font-size:15px;font-weight:600;cursor:pointer}' +
        'button:hover{background:#3d6bff}button:disabled{opacity:.6;cursor:default}' +
        'button.ghost{background:transparent;border:1px solid #2a2f3a;color:#aab2c3;margin-top:10px}' +
        'button.ghost:hover{background:#1d2129}' +
        '.msg{margin-top:12px;font-size:13px;color:#4cc38a;min-height:18px}' +
        '.err{margin-top:12px;font-size:13px;color:#ff6b6b;min-height:18px}' +
        '.foot{margin-top:20px;font-size:12px;color:#5c6472;text-align:center}' +
        '.foot a{color:#4f7cff;text-decoration:none}' +
        '@media (prefers-color-scheme: light){' +
        'body{background:#f4f6f9;color:#1f2329}' +
        '.card{background:#ffffff;border:1px solid #dfe3ea;box-shadow:0 8px 24px rgba(31,35,41,.08)}' +
        '.sub{color:#5c6472}' +
        '.tip{color:#5c6472;background:#f7f8fa;border-color:#e5e8ee}' +
        'label{color:#5c6472}' +
        'input{background:#ffffff;border:1px solid #d2d7df;color:#1f2329}' +
        'input:focus{border-color:#3b6ee0}' +
        'code{background:#f7f8fa;border-color:#e5e8ee;color:#3a4150}' +
        'button{background:#3b6ee0}' +
        'button:hover{background:#315fd0}' +
        'button.ghost{color:#5c6472;border-color:#dfe3ea}' +
        'button.ghost:hover{background:#f2f4f7}' +
        '.foot{color:#8a92a0}' +
        '.foot a{color:#3b6ee0}}' +
        '</style></head><body><div class="card">' +
        '<div class="brand">DeepSeek Harness</div>' +
        '<div class="sub">注册成功，欢迎 ' + escHtml(username) + '！</div>' +
        '<div class="tip">建议立即添加 <b>TOTP 两步验证令牌</b>（如 Google Authenticator / Microsoft Authenticator）：' +
        '绑定后登录将获得额外保护。也可以跳过此步，稍后在【设置】→【用户管理】→「两步验证（TOTP）」中随时添加。</div>' +
        '<button id="g">立即添加 TOTP 令牌</button>' +
        '<div id="panel" style="display:none">' +
        '<img id="qr" alt="TOTP 二维码" style="display:none;width:200px;height:200px;border-radius:8px;background:#fff;padding:6px;margin:6px auto;border:1px solid #2a2f3a">' +
        '<label>密钥（无法扫码时手动输入）</label><code id="sec"></code>' +
        '<label>验证器中的 6 位动态码</label><input id="c" inputmode="numeric" maxlength="6" placeholder="6 位动态码">' +
        '<button id="v">启用两步验证</button>' +
        '<div class="msg" id="m"></div><div class="err" id="e2"></div>' +
        '</div>' +
        '<button class="ghost" id="skip">稍后再说，进入首页</button>' +
        '<div class="foot">访问受保护 · <a href="/auth/login">返回登录</a></div>' +
        '</div><script>' +
        '(function(){var g=document.getElementById("g"),panel=document.getElementById("panel"),qr=document.getElementById("qr"),' +
        'sec=document.getElementById("sec"),c=document.getElementById("c"),v=document.getElementById("v"),' +
        'm=document.getElementById("m"),e2=document.getElementById("e2");' +
        'document.getElementById("skip").addEventListener("click",function(){location.href="/"});' +
        'g.addEventListener("click",function(){g.disabled=true;e2.textContent="";' +
        'fetch("/auth/rpc/totpGenerate",{method:"POST",headers:{"content-type":"application/json"},body:"{}"})' +
        '.then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {status:r.status,json:j}})}).then(function(r){' +
        'if(r.status===200&&r.json.ok){sec.textContent=r.json.secret;if(r.json.qrDataUrl){qr.src=r.json.qrDataUrl;qr.style.display="block"}' +
        'panel.style.display="block";g.style.display="none";c.focus();return}' +
        'g.disabled=false;e2.textContent=r.json.error||("生成失败 ("+r.status+")")})' +
        '.catch(function(){g.disabled=false;e2.textContent="网络错误，请重试"})});' +
        'v.addEventListener("click",function(){v.disabled=true;m.textContent="";e2.textContent="";' +
        'fetch("/auth/rpc/totpVerify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:c.value})})' +
        '.then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {status:r.status,json:j}})}).then(function(r){' +
        'if(r.status===200&&r.json.ok){m.textContent="✓ 两步验证已启用！即将进入首页…";setTimeout(function(){location.href="/"},1200);return}' +
        'v.disabled=false;e2.textContent=r.json.error||("验证失败 ("+r.status+")")})' +
        '.catch(function(){v.disabled=false;e2.textContent="网络错误，请重试"})})})()' +
        '</script></body></html>'
    }

    async function handleAuthPath(req, res, pathname) {
      if (pathname === '/auth/login') { await handleLogin(req, res); return }
      if (pathname === '/auth/register') { await handleRegister(req, res); return }
      if (pathname === '/auth/register/success') {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const token = readCookie(req, COOKIE_NAME)
          const who = resolveSession(token)
          if (who === undefined) { redirect(res, '/auth/login'); return }
          if (req.method === 'HEAD') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end()
            return
          }
          try {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(registerSuccessPage(who))
          } catch (err) { try { res.destroy() } catch (e) { /* ignore */ } }
          return
        }
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (pathname === '/auth/logout') {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
        const token = readCookie(req, COOKIE_NAME)
        destroySession(token)
        clearAuthCookie(res, isSecureRequest(req))
        sendJson(res, 200, { ok: true })
        return
      }
      if (pathname === '/auth/me') {
        const token = readCookie(req, COOKIE_NAME)
        const who = resolveSession(token)
        const me = who === undefined ? undefined : state.users.get(who)
        if (me === undefined) { sendJson(res, 401, { authenticated: false }); return }
        sendJson(res, 200, { authenticated: true, me: publicUser(me) })
        return
      }
      if (pathname.startsWith('/auth/rpc/')) {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
        const method = pathname.slice('/auth/rpc/'.length)
        if (method === '' || method.length > 64) { sendJson(res, 404, { error: '未知方法' }); return }
        let body
        try {
          const raw = await readBody(req, MAX_BODY_BYTES)
          body = raw.trim() === '' ? {} : JSON.parse(raw)
        } catch (err) { sendJson(res, 400, { error: '请求体格式错误' }); return }
        await handleRpc(req, res, method, body)
        return
      }
      sendJson(res, 404, { error: 'not found' })
    }

    async function handleRpc(req, res, method, body) {
      if (!state.ready) { sendJson(res, 503, { error: '服务初始化中，请稍后重试' }); return }
      const token = readCookie(req, COOKIE_NAME)
      const who = resolveSession(token)
      if (who === undefined) { sendJson(res, 401, { error: '未登录或会话已过期' }); return }
      const me = state.users.get(who)
      if (me === undefined) {
        destroySession(token)
        sendJson(res, 401, { error: '账号不存在' })
        return
      }
      const args = body !== null && typeof body === 'object' ? body : {}
      const requireAdmin = () => {
        if (me.role !== 'admin') {
          audit(method, who, undefined, { denied: true })
          sendJson(res, 403, { error: '需要管理员权限' })
          return false
        }
        return true
      }
      const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : ''

      switch (method) {
        case 'me':
          sendJson(res, 200, { ok: true, me: publicUser(me) })
          return
        case 'updateProfile': {
          const displayName = str(args.displayName, 60)
          const email = str(args.email, 120)
          const updated = await storeMutate(who, (p) => ({ ...p, displayName, email, updatedAt: Date.now() }))
          sendJson(res, 200, { ok: true, me: publicUser(updated === undefined ? me : updated) })
          return
        }
        case 'changePassword': {
          const oldP = typeof args.oldPassword === 'string' ? args.oldPassword : ''
          const newP = typeof args.newPassword === 'string' ? args.newPassword : ''
          if (!verifyPassword(me, oldP)) { sendJson(res, 403, { error: '原密码不正确' }); return }
          const pwErr = passwordError(newP)
          if (pwErr !== null) { sendJson(res, 400, { error: pwErr }); return }
          const rec = newPasswordRecord(newP)
          await storeMutate(who, (p) => ({ ...p, salt: rec.salt, hash: rec.hash, iterations: rec.iterations, updatedAt: Date.now() }))
          invalidateSessions(who, token)
          audit('changePassword', who, who)
          // 首次引导文件自毁：任意用户改密成功后删除明文初始密码文件（若存在）
          try {
            const fsSvc = ctx.get('fs')
            if (fsSvc !== undefined) {
              const target = await fsSvc.resolve('dsh-ui-auth-bootstrap.txt')
              if (typeof fsSvc.unlink === 'function') {
                await fsSvc.unlink(target)
              } else if (typeof fsSvc.processPath === 'function') {
                const real = fsSvc.processPath(target)
                if (typeof real === 'string') {
                  const { unlink } = await import('node:fs/promises')
                  await unlink(real)
                }
              }
            }
          } catch (err) { /* 文件不存在或删除失败：忽略 */ }
          sendJson(res, 200, { ok: true })
          return
        }
        case 'listUsers': {
          if (!requireAdmin()) return
          const users = []
          for (const u of state.users.values()) users.push(publicUser(u))
          users.sort((a, b) => a.username < b.username ? -1 : a.username > b.username ? 1 : 0)
          sendJson(res, 200, { ok: true, users })
          return
        }
        case 'createUser': {
          if (!requireAdmin()) return
          const username = str(args.username, 32)
          const password = typeof args.password === 'string' ? args.password : ''
          const role = args.role === 'admin' ? 'admin' : 'user'
          const displayName = str(args.displayName, 60)
          const email = str(args.email, 120)
          if (!USERNAME_RE.test(username)) {
            sendJson(res, 400, { error: '用户名仅允许 2-32 位字母、数字、下划线、点或短横线' })
            return
          }
          const pwErr = passwordError(password)
          if (pwErr !== null) { sendJson(res, 400, { error: pwErr }); return }
          const rec = newPasswordRecord(password)
          const now = Date.now()
          const ok = await storeCreate({ v: 1, username, role, ...rec, displayName, email, createdAt: now, updatedAt: now })
          if (!ok) { sendJson(res, 409, { error: '用户名已存在' }); return }
          audit('createUser', who, username, { role })
          sendJson(res, 200, { ok: true })
          return
        }
        case 'deleteUser': {
          if (!requireAdmin()) return
          const username = str(args.username, 32)
          const target = state.users.get(username)
          if (target === undefined) { sendJson(res, 404, { error: '用户不存在' }); return }
          if (username === who) { sendJson(res, 400, { error: '不能删除当前登录的账号' }); return }
          if (target.role === 'admin' && adminCount() <= 1) { sendJson(res, 400, { error: '不能删除最后一个管理员' }); return }
          await storeRemove(username)
          invalidateSessions(username)
          audit('deleteUser', who, username)
          sendJson(res, 200, { ok: true })
          return
        }
        case 'resetPassword': {
          if (!requireAdmin()) return
          const username = str(args.username, 32)
          const newP = typeof args.newPassword === 'string' ? args.newPassword : ''
          const target = state.users.get(username)
          if (target === undefined) { sendJson(res, 404, { error: '用户不存在' }); return }
          const pwErr = passwordError(newP)
          if (pwErr !== null) { sendJson(res, 400, { error: pwErr }); return }
          const rec = newPasswordRecord(newP)
          await storeMutate(username, (p) => ({ ...p, salt: rec.salt, hash: rec.hash, iterations: rec.iterations, updatedAt: Date.now() }))
          invalidateSessions(username, username === who ? token : undefined)
          audit('resetPassword', who, username)
          sendJson(res, 200, { ok: true })
          return
        }
        case 'setRole': {
          if (!requireAdmin()) return
          const username = str(args.username, 32)
          const role = args.role === 'admin' ? 'admin' : 'user'
          const target = state.users.get(username)
          if (target === undefined) { sendJson(res, 404, { error: '用户不存在' }); return }
          if (target.role === 'admin' && role !== 'admin' && adminCount() <= 1) {
            sendJson(res, 400, { error: '不能降级最后一个管理员' })
            return
          }
          await storeMutate(username, (p) => ({ ...p, role, updatedAt: Date.now() }))
          audit('setRole', who, username, { role })
          sendJson(res, 200, { ok: true })
          return
        }
        case 'inviteCreate': {
          if (!requireAdmin()) return
          const amount = Number.isInteger(args.amount) && args.amount >= 1 && args.amount <= 50 ? args.amount : 1
          const uses = Number.isInteger(args.uses) && args.uses >= 1 && args.uses <= 100 ? args.uses : 1
          const codes = []
          const now = Date.now()
          for (let i = 0; i < amount; i++) {
            let code = inviteCode()
            while (state.invites.has(code)) code = inviteCode()
            state.invites.set(code, { total: uses, used: 0, createdBy: who, createdAt: now })
            codes.push(code)
          }
          await persistInvites()
          audit('inviteCreate', who, undefined, { amount, uses })
          sendJson(res, 200, { ok: true, codes })
          return
        }
        case 'inviteList': {
          if (!requireAdmin()) return
          const list = []
          for (const [code, v] of state.invites) {
            list.push({
              code,
              total: v.total,
              used: v.used,
              remaining: Math.max(0, v.total - v.used),
              createdBy: v.createdBy,
              createdAt: v.createdAt,
            })
          }
          list.sort((a, b) => b.createdAt - a.createdAt)
          sendJson(res, 200, { ok: true, invites: list })
          return
        }
        case 'inviteRevoke': {
          if (!requireAdmin()) return
          const code = str(args.code, 32)
          if (code === '' || !state.invites.delete(code)) { sendJson(res, 404, { error: '邀请码不存在' }); return }
          await persistInvites()
          audit('inviteRevoke', who, code)
          sendJson(res, 200, { ok: true })
          return
        }
        // ============ TOTP（0.5.0：每人管理自己的令牌） ============
        case 'totpStatus': {
          sendJson(res, 200, { ok: true, totp: { enabled: me.totpEnabled === true, twoFactor: me.twoFactor === true, ignore: me.totpIgnore === true } })
          return
        }
        case 'totpSet2fa': {
          const enabled = args.enabled === true
          if (enabled && me.totpEnabled !== true) { sendJson(res, 400, { error: '请先绑定并启用 TOTP 令牌' }); return }
          await storeMutate(who, (p) => ({ ...p, twoFactor: enabled }))
          audit('totpSet2fa', who, who, { enabled })
          sendJson(res, 200, { ok: true, twoFactor: enabled })
          return
        }
        case 'totpGenerate': {
          if (me.totpEnabled === true) { sendJson(res, 400, { error: '已启用 TOTP，如需更换请先移除现有令牌' }); return }
          const secret = totpGenerateSecret()
          const otpauth = 'otpauth://totp/' + encodeURIComponent('DeepSeek Harness:' + who) +
            '?secret=' + secret + '&issuer=' + encodeURIComponent('DeepSeek Harness') + '&period=30&digits=6'
          await storeMutate(who, (p) => ({ ...p, totpSecret: secret, totpEnabled: false, totpIgnore: false }))
          let qrDataUrl
          try {
            const qr = await import('qrcode')
            // SVG 输出为纯 JS 生成（无需 canvas），Node 端可用
            const svg = await qr.toString(otpauth, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
            qrDataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64')
          } catch (err) {
            // qrcode 依赖缺失/失败时降级：前端仍可手动输入密钥
          }
          sendJson(res, 200, { ok: true, secret, otpauth, ...(qrDataUrl !== undefined ? { qrDataUrl } : {}) })
          return
        }
        case 'totpVerify': {
          const code = typeof args.code === 'string' ? args.code.trim() : ''
          if (typeof me.totpSecret !== 'string' || me.totpSecret === '') { sendJson(res, 400, { error: '请先生成 TOTP 密钥' }); return }
          if (!totpVerifyCode(me.totpSecret, code)) { sendJson(res, 403, { error: '验证码不正确' }); return }
          await storeMutate(who, (p) => ({ ...p, totpEnabled: true }))
          audit('totpVerify', who, who)
          sendJson(res, 200, { ok: true })
          return
        }
        case 'totpRemove': {
          const targetName = typeof args.username === 'string' ? args.username : who
          if (targetName !== who) {
            // 管理员移除任意用户的令牌（无需该用户的验证码）
            if (!requireAdmin()) return
            const target = state.users.get(targetName)
            if (target === undefined) { sendJson(res, 404, { error: '用户不存在' }); return }
            await storeMutate(targetName, (p) => ({ ...p, totpSecret: undefined, totpEnabled: false, twoFactor: false }))
            audit('totpRemove', who, targetName, { byAdmin: true })
            sendJson(res, 200, { ok: true })
            return
          }
          if (typeof me.totpSecret !== 'string' || me.totpSecret === '') { sendJson(res, 400, { error: '未启用 TOTP' }); return }
          const code = typeof args.code === 'string' ? args.code.trim() : ''
          if (!totpVerifyCode(me.totpSecret, code)) { sendJson(res, 403, { error: '验证码不正确' }); return }
          await storeMutate(who, (p) => ({ ...p, totpSecret: undefined, totpEnabled: false, twoFactor: false }))
          audit('totpRemove', who, who)
          sendJson(res, 200, { ok: true })
          return
        }
        case 'totpIgnore': {
          const ignore = args.ignore === true
          await storeMutate(who, (p) => ({ ...p, totpIgnore: ignore }))
          sendJson(res, 200, { ok: true, ignore })
          return
        }
        default:
          sendJson(res, 404, { error: '未知方法' })
      }
    }

    // ============ 管理员操作审计（0.4.0：JSONL） ============
    // 追加写 dsh-ui-auth-audit.jsonl（fs 服务工作目录）：记录越权尝试与全部
    // 成功的管理员操作（增删用户/重置密码/改角色/改密）。低频操作，串行队列
    // 防并发写竞态；写失败仅记日志，不中断业务。
    const AUDIT_FILE = 'dsh-ui-auth-audit.jsonl'
    let auditChain = Promise.resolve()
    function audit(action, actor, target, extra) {
      const entry = { t: new Date().toISOString(), actor, action, target, ...(extra !== undefined ? extra : {}) }
      auditChain = auditChain.then(async () => {
        try {
          const fsSvc = ctx.get('fs')
          if (fsSvc === undefined) return
          const t = await fsSvc.resolve(AUDIT_FILE)
          let old = ''
          try { old = await fsSvc.readText(t) } catch (err) { /* 首次写入：文件不存在 */ }
          await fsSvc.writeText(t, old + JSON.stringify(entry) + '\n')
        } catch (err) {
          console.error('[dsh-ui-auth] 审计写入失败: ' + String(err))
        }
      })
    }

    // ============ 首次启动引导 ============
    function trace(msg) {
      try {
        const fsSvc = ctx.get('fs')
        if (fsSvc === undefined) return
        fsSvc.resolve('dsh-ui-auth-init.log').then((t) => fsSvc.writeText(t, msg + '\n', undefined)).catch(() => {})
      } catch (err) { /* ignore */ }
    }

    async function bootstrap() {
      if (state.users.size > 0) return
      if (store === null) {
        console.log('[dsh-ui-auth] 检测到 credentials 服务缺失，用户数据仅保存在内存中，重启后将丢失')
      }
      const username = 'admin'
      const password = randomPassword(16)
      const rec = newPasswordRecord(password)
      const now = Date.now()
      const ok = await storeCreate({ v: 1, username, role: 'admin', ...rec, displayName: '管理员', email: '', createdAt: now, updatedAt: now })
      if (!ok) {
        console.error('[dsh-ui-auth] 引导创建管理员失败（用户名已存在？）')
        return
      }
      console.log('[dsh-ui-auth] ================================================')
      console.log('[dsh-ui-auth] 首次启动：已创建管理员账号')
      console.log('[dsh-ui-auth]   用户名: ' + username)
      console.log('[dsh-ui-auth]   密码:   ' + password)
      console.log('[dsh-ui-auth] 请立即登录并修改密码。')
      console.log('[dsh-ui-auth] ================================================')
      try {
        const fsSvc = ctx.get('fs')
        if (fsSvc !== undefined) {
          const lines = [
            'DeepSeek Harness UI 认证插件 - 初始管理员账号',
            '================================================',
            '用户名: ' + username,
            '密码:   ' + password,
            '',
            '请在登录后立即修改该密码，然后删除本文件。',
          ]
          const target = await fsSvc.resolve('dsh-ui-auth-bootstrap.txt')
          await fsSvc.writeText(target, lines.join('\n'))
          console.log('[dsh-ui-auth] 初始账号已写入文件 dsh-ui-auth-bootstrap.txt（进程工作目录）')
        }
      } catch (err) {
        console.error('[dsh-ui-auth] 写入初始账号文件失败: ' + String(err))
      }
    }

    async function init() {
      try {
        // 启动顺序竞态：等 credentials 服务就绪（最多 10 秒）再加载用户表
        await acquireCredentials(10000)
        if (store !== null) {
          await store.load()
          const retired = await store.readRaw(SCOPE + '/retired-users')
          if (retired !== undefined) state.retiredUsers = new Set(JSON.parse(retired))
          await loadOwnership()
          await loadInvites()
        }
        await bootstrap()
        await loadSessions()
        state.ready = true
      } catch (err) {
        trace('step=error: ' + String(err) + (err && err.stack ? '\n' + err.stack : ''))
        throw err
      }
    }

    const initialized = init()
    initialized.catch((err) => {
      state.fatal = String(err)
      trace('step=fatal: ' + String(err))
      console.error('[dsh-ui-auth] 初始化失败（保持 fail-closed，所有非登录请求返回 503）: ' + (err instanceof Error ? (err.stack || err.message) : String(err)))
    })

    // ============ 网关：包装 node:http 服务器 ============
    const ws = ctx.get('webServer')
    const server = ws !== undefined && ws.server !== undefined ? ws.server : undefined
    if (server === undefined) {
      console.error('[dsh-ui-auth] webServer 不可用，认证网关未启用（当前环境可能不提供 HTTP 服务）')
      return
    }

    const origReq = server.listeners('request')
    const origUp = server.listeners('upgrade')
    const modern = typeof ctx.get('connection')?.authorizeIndex === 'function'
      ? createModernGateway(ctx, {
          ready: initialized,
          user(username) {
            const user = state.users.get(username)
            return state.ready && user !== undefined ? Object.freeze({ username, role: user.role }) : undefined
          },
          principal(req) {
            if (!state.ready) return undefined
            const username = resolveSession(readCookie(req, COOKIE_NAME), false)
            const user = state.users.get(username)
            return user === undefined ? undefined : Object.freeze({ username, role: user.role })
          },
          loginKey: req => hashToken(readCookie(req, COOKIE_NAME) ?? ''),
          session: ownerOfSession,
          workspace: ownerOfWorkspace,
          async sessionExists(id) {
            if (state.owners.sessions.has(id) || ctx.get('sessions')?.get(id) !== undefined) return true
            const persistence = ctx.get('sessionPersistence')
            // A caller-supplied id cannot be adopted without checking cold state too.
            if (persistence?.inspect === undefined) return true
            try { return (await persistence.inspect(id)) !== undefined }
            catch (error) {
              if (error?.name === 'SessionPersistenceNotFoundError') return false
              throw error
            }
          },
          claimSession: setSessionOwner,
          claimWorkspace: setWorkspaceOwner,
        })
      : undefined
    server.removeAllListeners('request')
    server.removeAllListeners('upgrade')

    // ============ 管理员专属 API 守卫 ============
    // 模型配置（settings 的 llm-* 命名空间与 settings.models 镜像）与 Key 配置
    // （credentials.set/unset、llm.discoverModels）仅管理员可用。普通用户即使
    // 绕过 UI 直接调 /api 也会在此被拒；放行的请求用原始 chunk 回放请求体。
    const ADMIN_API_RESTRICTED = new Set([
      'settings.update', 'settings.replace', 'settings.mutate',
      'credentials.set', 'credentials.unset',
      'llm.discoverModels',
    ])

    function isLlmSettingsNs(ns) {
      return ns === 'settings.models' || (typeof ns === 'string' && ns.startsWith('llm-'))
    }

    function readBodyChunks(req, limit) {
      return new Promise((resolve, reject) => {
        const chunks = []
        let size = 0
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > limit) {
            reject(new Error('body too large'))
            try { req.destroy() } catch (e) { /* ignore */ }
            return
          }
          chunks.push(chunk)
        })
        req.on('end', () => resolve(chunks))
        req.on('error', reject)
      })
    }

    function decodeChunks(chunks) {
      let text = ''
      const dec = new TextDecoder()
      for (const c of chunks) text += dec.decode(c, { stream: true })
      return text + dec.decode()
    }

    // /api 路由处理器只读 headers，body 经 `for await (req)` 消费：
    // 网关读体后放行时，用保留了原始字段 + 缓冲 chunk 的对象回放。
    function replayRequest(original, chunks) {
      let i = 0
      return {
        url: original.url,
        method: original.method,
        headers: original.headers,
        socket: original.socket,
        httpVersion: original.httpVersion,
        httpVersionMajor: original.httpVersionMajor,
        httpVersionMinor: original.httpVersionMinor,
        destroy: () => { try { original.destroy() } catch (e) { /* ignore */ } },
        [Symbol.asyncIterator]() {
          return {
            next() {
              if (i < chunks.length) return Promise.resolve({ value: chunks[i++], done: false })
              return Promise.resolve({ value: undefined, done: true })
            },
          }
        },
      }
    }

    // 非管理员访问受限 /api 方法：读取请求体判断并拒绝，返回 {pass, chunks}。
    async function gateAdminApi(req, res, pathname) {
      const method = pathname.slice('/api/'.length)
      if (!ADMIN_API_RESTRICTED.has(method)) return { pass: true }
      let chunks
      try {
        chunks = await readBodyChunks(req, MAX_BODY_BYTES)
      } catch (err) {
        sendJson(res, 403, { error: '仅管理员可执行此操作' })
        return { pass: false }
      }
      let body = {}
      try { body = JSON.parse(decodeChunks(chunks)) } catch (err) { body = {} }
      const payload = body !== null && typeof body === 'object' && body.payload !== null && typeof body.payload === 'object'
        ? body.payload : {}
      let block = false
      if (method === 'credentials.set' || method === 'credentials.unset' || method === 'llm.discoverModels') {
        block = true
      } else {
        block = isLlmSettingsNs(typeof payload.ns === 'string' ? payload.ns : '')
      }
      if (block) {
        sendJson(res, 403, { error: '仅管理员可执行此操作' })
        return { pass: false }
      }
      return { pass: true, chunks }
    }

    // ============ 数据面隔离：按登录用户隔离会话/工作区 ============
    // 直接访问方法 → 请求载荷里的 id 必须属于当前用户；
    // 列表方法 → 响应体改写过滤；
    // 创建方法 → 响应体打标（归属当前用户）。
    const DATA_DIRECT_CHECKS = {
      'session.history': ['sessionId'],
      'session.rename': ['sessionId'],
      'session.selectModel': ['sessionId'],
      'session.updateQueue': ['sessionId'],
      'session.cancel': ['sessionId'],
      'session.prompt': ['sessionId'],
      'session.attachment': ['sessionId'],
      'session.models': ['sessionId'],
      'session.fork': ['sessionId'],
      'session.create': ['sessionId', 'workspaceId'],
      'workspace.rename': ['workspaceId'],
      'workspace.delete': ['workspaceId'],
      'workspace.insertBefore': ['workspaceId'],
      'workspace.insertSessionBefore': ['workspaceId', 'sessionId'],
      'workspace.archiveSession': ['sessionId', 'workspaceId'],
    }
    const LIST_FILTER_METHODS = new Set(['session.list', 'session.search', 'workspace.list'])
    const TAG_METHODS = new Set(['session.create', 'session.fork', 'workspace.create'])

    function checkDataOwnership(method, payload, username) {
      const fields = DATA_DIRECT_CHECKS[method]
      if (fields === undefined) return true
      for (const f of fields) {
        const id = typeof payload[f] === 'string' ? payload[f] : ''
        if (id === '') continue
        if (f === 'sessionId') {
          if (method === 'session.create') {
            // session.create 允许携带全新 id：仅当该 id 已知且属于他人时拒绝
            const known = state.owners.sessions.get(id)
            if (known !== undefined && known !== username) return false
          } else if (ownerOfSession(id) !== username) {
            return false
          }
        } else if (f === 'workspaceId' && ownerOfWorkspace(id) !== username) {
          return false
        }
      }
      return true
    }

    // 捕获响应的代理 res：body 收集完成后交给 transform，再把结果写给真实 res。
    function captureJsonResponse(res, transform) {
      const chunks = []
      const proxy = Object.create(res)
      proxy.writeHead = (...args) => res.writeHead(...args)
      proxy.write = (chunk) => {
        if (chunk !== undefined && chunk !== null && chunk.length !== 0) chunks.push(Buffer.from(chunk))
        return true
      }
      proxy.end = (chunk) => {
        if (chunk !== undefined && chunk !== null && chunk.length !== 0) chunks.push(Buffer.from(chunk))
        let out
        try {
          out = transform(Buffer.concat(chunks))
        } catch (err) {
          console.error('[dsh-ui-auth] 响应转换失败，原样转发: ' + String(err))
          out = Buffer.concat(chunks)
        }
        try {
          res.write(out)
          res.end()
        } catch (err) {
          try { res.destroy() } catch (e) { /* ignore */ }
        }
      }
      return proxy
    }

    function filterListResponseBody(method, body, username) {
      let parsed
      try { parsed = JSON.parse(body.toString('utf8')) } catch (err) { return body }
      if (parsed === null || typeof parsed !== 'object') return body
      const result = parsed.result
      if (result === null || typeof result !== 'object' || result.ok !== true
        || result.value === null || typeof result.value !== 'object') return body
      const value = result.value
      if (method === 'session.list' || method === 'session.search') {
        if (Array.isArray(value.items)) {
          const before = value.items.length
          value.items = value.items.filter((it) => it !== null && typeof it === 'object'
            && ownerOfSession(it.sessionId) === username)
          if (method === 'session.search' && value.items.length < before) value.hasMore = false
        }
      } else if (method === 'workspace.list') {
        if (Array.isArray(value.items)) {
          value.items = value.items
            .filter((w) => w !== null && typeof w === 'object' && ownerOfWorkspace(w.workspaceId) === username)
            .map((w) => {
              if (Array.isArray(w.sessionIds)) {
                w.sessionIds = w.sessionIds.filter((id) => ownerOfSession(id) === username)
              }
              return w
            })
        }
        if (Array.isArray(value.archivedSessionIds)) {
          value.archivedSessionIds = value.archivedSessionIds.filter((id) => ownerOfSession(id) === username)
        }
      }
      return JSON.stringify(parsed)
    }

    function tagResponseBody(method, body, username) {
      let parsed
      try { parsed = JSON.parse(body.toString('utf8')) } catch (err) { return body }
      if (parsed === null || typeof parsed !== 'object') return body
      const result = parsed.result
      if (result === null || typeof result !== 'object' || result.ok !== true
        || result.value === null || typeof result.value !== 'object') return body
      const value = result.value
      if ((method === 'session.create' || method === 'session.fork')
        && typeof value.sessionId === 'string' && value.sessionId !== '') {
        setSessionOwner(value.sessionId, username).catch((err) => {
          console.error('[dsh-ui-auth] 会话打标失败: ' + String(err))
        })
      } else if (method === 'workspace.create') {
        const w = value.workspace
        if (w !== null && typeof w === 'object' && typeof w.workspaceId === 'string' && w.workspaceId !== '') {
          setWorkspaceOwner(w.workspaceId, username).catch((err) => {
            console.error('[dsh-ui-auth] 工作区打标失败: ' + String(err))
          })
        }
      }
      return body
    }

    // GET /api/session.export?sessionId=... —— 导出会话日志，非属主必须拒绝
    function exportSessionIdOf(pathname, rawUrl) {
      if (pathname !== '/api/session.export') return undefined
      if (typeof rawUrl !== 'string') return undefined
      const m = rawUrl.match(/[?&]sessionId=([^&]+)/)
      if (m === null) return undefined
      try { return decodeURIComponent(m[1]) } catch (err) { return m[1] }
    }

    async function handleGate(req, res) {
      const pathname = pathnameOf(req.url)
      if (pathname === '/auth' || pathname.startsWith('/auth/')) {
        await handleAuthPath(req, res, pathname)
        return
      }
      if (!state.ready) {
        sendJson(res, 503, { error: '服务初始化中，请稍后重试' })
        return
      }
      const token = readCookie(req, COOKIE_NAME)
      const who = resolveSession(token)
      if (who !== undefined) {
        if (modern !== undefined && await modern.handleHttp(req, res, (request, response) => {
          for (const fn of origReq) fn.call(server, request, response)
        })) return
        const user = state.users.get(who)
        if (user !== undefined && user.role !== 'admin' && pathname.startsWith('/api/')) {
          const method = pathname.slice('/api/'.length)
          // A) 管理员专属写操作（模型/Key 配置）
          const adminGate = await gateAdminApi(req, res, pathname)
          if (!adminGate.pass) return
          // B) 会话导出（GET + query sessionId）
          const exportId = exportSessionIdOf(pathname, req.url)
          if (exportId !== undefined) {
            if (ownerOfSession(exportId) !== who) {
              sendJson(res, 403, { error: '无权导出该会话' })
              return
            }
            for (const fn of origReq) fn.call(server, req, res)
            return
          }
          // C) 数据面隔离
          if (DATA_DIRECT_CHECKS[method] !== undefined) {
            let chunks
            try { chunks = await readBodyChunks(req, MAX_BODY_BYTES) } catch (err) {
              sendJson(res, 403, { error: '无权访问该会话或工作区' })
              return
            }
            let body = {}
            try { body = JSON.parse(decodeChunks(chunks)) } catch (err) { body = {} }
            const payload = body !== null && typeof body === 'object' && body.payload !== null && typeof body.payload === 'object'
              ? body.payload : {}
            if (!checkDataOwnership(method, payload, who)) {
              sendJson(res, 403, { error: '无权访问该会话或工作区' })
              return
            }
            // session.create/fork 既校验源也需对新建会话打标：检查通过后仍走响应捕获
            if (TAG_METHODS.has(method)) {
              for (const fn of origReq) fn.call(server, replayRequest(req, chunks), captureJsonResponse(res, (b) => tagResponseBody(method, b, who)))
            } else {
              for (const fn of origReq) fn.call(server, replayRequest(req, chunks), res)
            }
            return
          }
          if (LIST_FILTER_METHODS.has(method)) {
            for (const fn of origReq) fn.call(server, req, captureJsonResponse(res, (body) => filterListResponseBody(method, body, who)))
            return
          }
          if (TAG_METHODS.has(method)) {
            for (const fn of origReq) fn.call(server, req, captureJsonResponse(res, (body) => tagResponseBody(method, body, who)))
            return
          }
          for (const fn of origReq) fn.call(server, req, res)
          return
        }
        for (const fn of origReq) fn.call(server, req, res)
        return
      }
      const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
      if (method === 'GET' || method === 'HEAD') {
        const accept = typeof req.headers.accept === 'string' ? req.headers.accept : ''
        const isApi = pathname === '/api' || pathname.startsWith('/api/')
          || pathname === '/plugins' || pathname.startsWith('/plugins/')
          || pathname === '/hmr' || pathname.startsWith('/hmr/')
        const lastSlash = pathname.lastIndexOf('/')
        const lastSeg = lastSlash === -1 ? pathname : pathname.slice(lastSlash + 1)
        const looksLikeAsset = lastSeg.indexOf('.') !== -1
        const looksLikePage = !isApi && (accept.indexOf('text/html') !== -1 || !looksLikeAsset)
        if (looksLikePage) {
          const next = pathname !== '/' && pathname !== '/index.html' ? '?next=' + encodeURIComponent(pathname) : ''
          redirect(res, '/auth/login' + next)
          return
        }
      }
      sendJson(res, 401, { error: 'unauthorized' })
    }

    const gate = (req, res) => {
      handleGate(req, res).catch((err) => {
        console.error('[dsh-ui-auth] 网关处理异常: ' + (err instanceof Error ? (err.stack || err.message) : String(err)))
        if (res.headersSent) { try { res.destroy() } catch (e) { /* ignore */ } return }
        try { res.writeHead(500); res.end() } catch (e) { try { res.destroy() } catch (x) { /* ignore */ } }
      })
    }

    // ============ 事件流代理（0.4.0：按登录用户逐帧隔离） ============
    // events.mux / events.host 的帧是 JSON text（DSH ws 库、无压缩），每帧带
    // sessionId（或 workspaceId）。网关在升级层代理：进程内直接消费 apiProxy
    // 的事件迭代器（每用户一条，等价于浏览器直连），逐帧按归属表过滤后
    // 编码为 WS text 帧写回用户 socket —— 网络层即隔离，无需反向代理。
    // 依赖 ctx.apiProxy（DSH host 服务）；不可用时 fail-closed（销毁连接），
    // 绝不降级为透传（那会把全量事件帧交给普通用户）。

    function filterMuxEnvelope(who, envelope) {
      const p = envelope !== null && typeof envelope === 'object' ? envelope.payload : undefined
      if (p === undefined || typeof p !== 'object' || p === null) return null
      if (p.type === 'stream/error') return envelope
      if (typeof p.sessionId === 'string' && ownerOfSession(p.sessionId) === who) return envelope
      return null
    }

    function filterHostEnvelope(who, envelope) {
      const p = envelope !== null && typeof envelope === 'object' ? envelope.payload : undefined
      if (p === undefined || typeof p !== 'object' || p === null) return null
      if (p.type === 'stream/error') return envelope
      const isAdmin = (state.users.get(who) || {}).role === 'admin'
      if (p.type === 'host/remote-event') return isAdmin ? envelope : null
      if (typeof p.sessionId === 'string') {
        return ownerOfSession(p.sessionId) === who ? envelope : null
      }
      if (typeof p.workspaceId === 'string') {
        return ownerOfWorkspace(p.workspaceId) === who ? envelope : null
      }
      if (p.type === 'host/workspace-order-changed' && Array.isArray(p.workspaceIds)) {
        const own = p.workspaceIds.filter((id) => ownerOfWorkspace(id) === who)
        return { ...envelope, payload: { ...p, workspaceIds: own } }
      }
      if (p.type === 'host/archived-sessions-changed' && Array.isArray(p.archivedSessionIds)) {
        const own = p.archivedSessionIds.filter((id) => ownerOfSession(id) === who)
        return { ...envelope, payload: { ...p, archivedSessionIds: own } }
      }
      return null
    }

    function wsWriteBackpressure(socket, chunk, cb) {
      try {
        if (socket.write(chunk)) { cb(); return }
        let settled = false
        const onDrain = () => { if (!settled) { settled = true; cleanup(); cb() } }
        const onErr = () => { if (!settled) { settled = true; cleanup(); cb() } }
        const cleanup = () => { socket.removeListener('drain', onDrain); socket.removeListener('error', onErr) }
        socket.once('drain', onDrain)
        socket.once('error', onErr)
      } catch (err) { cb() }
    }

    function handleEventUpgrade(req, socket, who, pathname, head) {
      const key = req.headers !== undefined ? req.headers['sec-websocket-key'] : undefined
      if (typeof key !== 'string' || key === '') { try { socket.destroy() } catch (e) { /* ignore */ } return }
      try {
        socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n')
      } catch (err) { try { socket.destroy() } catch (e) { /* ignore */ } return }
      const apiProxy = ctx.get('apiProxy')
      const events = apiProxy !== undefined ? apiProxy.events : undefined
      if (events === undefined) {
        // apiProxy 未就绪：fail-closed，绝不透传（透传会让普通用户收到全量事件帧）
        try { socket.destroy() } catch (e) { /* ignore */ }
        return
      }
      const isMux = pathname === '/api/events.mux'
      const filter = isMux ? filterMuxEnvelope : filterHostEnvelope
      const controller = new AbortController()
      const signal = controller.signal
      const reader = new WsFrameReader()
      const closeBoth = () => {
        try { controller.abort() } catch (e) { /* ignore */ }
        try { socket.end() } catch (e) { /* ignore */ }
      }
      const processIncoming = (bytes) => {
        reader.push(bytes)
        let frame
        while ((frame = reader.read()) !== null) {
          if (frame.close) { closeBoth(); return }
          if (frame.ping !== undefined) {
            try { socket.write(encodeWsControl(0xa, frame.ping)) } catch (e) { /* ignore */ }
            continue
          }
          // 下行通道禁止数据消息（对齐 DSH：close 1008 'downlink only'）
          try { socket.write(encodeWsControl(0x8, new Uint8Array([0x03, 0xf0]))) } catch (e) { /* ignore */ }
          closeBoth()
          return
        }
      }
      socket.on('data', (chunk) => { try { processIncoming(new Uint8Array(chunk)) } catch (e) { /* ignore */ } })
      socket.on('close', () => { try { controller.abort() } catch (e) { /* ignore */ } })
      socket.on('error', () => { try { controller.abort() } catch (e) { /* ignore */ } })
      if (head !== undefined && head.length > 0) { try { processIncoming(new Uint8Array(head)) } catch (e) { /* ignore */ } }
      const pump = (async () => {
        try {
          const iterable = isMux
            ? events.mux({ rpcId: randomUUID(), payload: {} }, signal)
            : events.host({ rpcId: randomUUID(), payload: {} }, signal)
          for await (const envelope of iterable) {
            const out = filter(who, envelope)
            if (out === null) continue
            const text = JSON.stringify({
              type: 'server-request',
              rpcId: out.rpcId,
              method: out.payload !== undefined && typeof out.payload === 'object' ? out.payload.type : undefined,
              payload: out.payload,
            })
            if (socket.destroyed || socket.writableEnded) break
            await new Promise((resolve) => wsWriteBackpressure(socket, encodeWsText(text), resolve))
          }
        } catch (err) {
          if (!signal.aborted) {
            try {
              socket.write(encodeWsText(JSON.stringify({
                type: 'server-request',
                rpcId: randomUUID(),
                method: 'stream/error',
                payload: { type: 'stream/error', error: { code: 'internal', message: String(err instanceof Error ? err.message : err), details: {} } },
              })))
            } catch (e) { /* ignore */ }
          }
        } finally {
          closeBoth()
        }
      })()
      void pump
    }

    const gateUp = (req, socket, head) => {
      try {
        const pathname = pathnameOf(req.url)
        if (pathname === '/auth' || pathname.startsWith('/auth/') || !state.ready) {
          socket.destroy()
          return
        }
        const token = readCookie(req, COOKIE_NAME)
        const who = resolveSession(token)
        if (who === undefined) { socket.destroy(); return }
        if (modern !== undefined) {
          modern.handleUpgrade(req, socket, head, (request, stream, bytes) => {
            for (const fn of origUp) fn.call(server, request, stream, bytes)
          })
          return
        }
        if (pathname === '/api/events.mux' || pathname === '/api/events.host') {
          handleEventUpgrade(req, socket, who, pathname, head)
          return
        }
        for (const fn of origUp) fn.call(server, req, socket, head)
      } catch (err) {
        try { socket.destroy() } catch (e) { /* ignore */ }
      }
    }

    server.on('request', gate)
    server.on('upgrade', gateUp)

    ctx.effect(() => () => {
      server.removeListener('request', gate)
      server.removeListener('upgrade', gateUp)
      for (const fn of origReq) server.on('request', fn)
      for (const fn of origUp) server.on('upgrade', fn)
    }, 'dsh-ui-auth: 还原网关监听器')

    // 会话与失败计数清理
    const sweep = () => {
      const now = Date.now()
      let changed = false
      for (const [token, s] of state.sessions) {
        if (s.expiresAt <= now) { state.sessions.delete(token); changed = true }
      }
      if (changed) {
        sessionsDirty = true
        persistSessions()
      }
      for (const [ip, f] of state.fails) {
        if (f.until > 0 && f.until <= now) state.fails.delete(ip)
      }
    }
    const timer = setInterval(sweep, SESSION_SWEEP_MS)
    timer.unref?.()
    ctx.effect(() => () => clearInterval(timer), 'dsh-ui-auth: session cleanup timer')
}
