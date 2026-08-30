// ============================================================================
// totp-vectors.mjs —— TOTP 实现验证（RFC 6238 官方向量 + 往返一致性）
// 运行：node test/totp-vectors.mjs
// ============================================================================
import { totpCodeAt, totpVerifyCode } from '../lib/index.js'

let failures = 0
const check = (label, cond, extra) => {
  if (cond) console.log('PASS ' + label)
  else { failures++; console.error('FAIL ' + label + (extra !== undefined ? ' :: ' + extra : '')) }
}

// RFC 6238 Appendix B / RFC 4226 向量（SHA1，secret = ASCII "12345678901234567890" 的 base32）
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const vectors = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'], // RFC 8 位码 65353130 的后 6 位
]
for (const [t, expect] of vectors) {
  check('RFC 6238 @T=' + t + ' -> ' + expect, totpCodeAt(SECRET, t) === expect, 'got=' + totpCodeAt(SECRET, t))
}
// 往返一致性：当前时间码可通过验证；错误码被拒；非 6 位被拒
{
  const now = Date.now() / 1000
  const code = totpCodeAt(SECRET, now)
  check('verify: 当前码通过', totpVerifyCode(SECRET, code) === true)
  check('verify: 错误码被拒', totpVerifyCode(SECRET, '000000') === false)
  check('verify: 非 6 位码被拒', totpVerifyCode(SECRET, '12345') === false)
  check('verify: 非法字符被拒', totpVerifyCode(SECRET, 'abc123') === false)
  check('verify: 空 secret 返回空码', totpCodeAt('', now) === '')
}
// base32 解码容错：小写与空格
check('decode: 小写 secret 同样可用', totpCodeAt('gezdgnbvgy3tqojqgezdgnbvgy3tqojq', 59) === '287082')
check('decode: 含空格/连字符 secret 可用', totpCodeAt('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ', 59) === '287082')

console.log(failures === 0 ? '\nTOTP VECTORS PASS' : `\n${failures} TOTP FAILURES`)
process.exit(failures === 0 ? 0 : 1)
