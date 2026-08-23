// Standalone validation of the pure-JS SHA-256 / HMAC-SHA256 / PBKDF2
// implementation that will be embedded in the dsh-ui-auth plugin host half.
// Run: node crypto-check.js

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
  const bitLenHi = Math.floor(len / 0x20000000) // len*8 in two 32-bit halves
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

function utf8Bytes(str) {
  return new TextEncoder().encode(str)
}

const vectors = [
  ['sha256 empty', toHex(sha256(new Uint8Array(0))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['sha256 abc', toHex(sha256(utf8Bytes('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['sha256 long', toHex(sha256(utf8Bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
]

// RFC 4231 HMAC-SHA256 test case 1
{
  const key = new Uint8Array(20).fill(0x0b)
  const msg = utf8Bytes('Hi There')
  vectors.push(['hmac rfc4231-1', toHex(hmacSha256(key, msg)), 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'])
}

// RFC 7914 PBKDF2-HMAC-SHA256 vectors
{
  const p = utf8Bytes('password')
  const s = utf8Bytes('salt')
  vectors.push(['pbkdf2 c=1', toHex(pbkdf2(p, s, 1)), '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b'])
  vectors.push(['pbkdf2 c=2', toHex(pbkdf2(p, s, 2)), 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43'])
}

let allOk = true
for (const [name, got, want] of vectors) {
  const ok = got === want
  if (!ok) allOk = false
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (ok ? '' : '\n  got:  ' + got + '\n  want: ' + want))
}

// timing benchmark for PBKDF2 at a few iteration counts
for (const iters of [1000, 5000, 10000, 25000]) {
  const t0 = Date.now()
  pbkdf2(utf8Bytes('benchmark-password'), utf8Bytes('benchmark-salt'), iters)
  const ms = Date.now() - t0
  console.log('bench pbkdf2(' + iters + ') = ' + ms + 'ms')
}

console.log(allOk ? 'ALL VECTORS PASS' : 'VECTOR FAILURES PRESENT')
