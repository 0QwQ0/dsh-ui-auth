/**
 * port-fidelity.mjs — TypeScript 重写保真核验（0.6.2）。
 *
 * 直接逐行 diff 没有意义：tsc 会重排格式（缩进/分号/引号）。本工具改为对比
 * **可观察要素的多重集**——字符串字面量、数字字面量、导出名——因为本插件的
 * 行为载荷几乎都在字符串里（登录页/注册页 HTML、CSS、错误文案、凭据键、端点名）。
 *
 * 用法：
 *   node test/port-fidelity.mjs <git-ref>            # 与指定 ref 的 lib/*.js 对比
 *   node test/port-fidelity.mjs HEAD~1               # 与重写前的提交对比
 *
 * 退出码：0 = 未发现要素缺失/新增；1 = 存在差异（需人工判断）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ref = process.argv[2] ?? 'HEAD'
const FILES = ['lib/index.js', 'lib/client.js', 'lib/modern-gateway.js', 'lib/modern-policy.js']

const countInto = (map, value) => map.set(value, (map.get(value) ?? 0) + 1)

/** String literals in all three quote styles, with escapes preserved. */
function strings(code) {
  const map = new Map()
  for (const match of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const literal = match[1] ?? match[2] ?? match[3] ?? ''
    if (literal.length > 0) countInto(map, literal)
  }
  return map
}

/** Numeric literals (identifiers and version strings excluded by the word boundary). */
function numbers(code) {
  const map = new Map()
  for (const match of code.matchAll(/(?<![\w.$])(\d[\d_]*(?:\.\d+)?)(?![\w.])/g)) countInto(map, match[1])
  return map
}

/** Public names, per module kind. */
function exportsOf(code, file) {
  const names = new Set()
  if (file.endsWith('client.js')) {
    for (const match of code.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(match[1])
  } else {
    for (const match of code.matchAll(/export\s+(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1])
    for (const match of code.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name) names.add(name)
      }
    }
  }
  return names
}

function describeDiff(label, before, after) {
  const missing = []
  const added = []
  for (const [value, count] of before) {
    const now = after.get(value) ?? 0
    if (now < count) missing.push(`${JSON.stringify(value)} ×${count - now}`)
  }
  for (const [value, count] of after) {
    const was = before.get(value) ?? 0
    if (was < count) added.push(`${JSON.stringify(value)} ×${count - was}`)
  }
  const ok = missing.length === 0 && added.length === 0
  console.log(`${ok ? 'PASS' : 'DIFF'} ${label}: 缺失 ${missing.length} / 新增 ${added.length}`)
  if (missing.length) console.log('  缺失（重写前有、重写后没有）：\n   ' + missing.slice(0, 40).join('\n   '))
  if (added.length) console.log('  新增（重写后多出）：\n   ' + added.slice(0, 40).join('\n   '))
  return ok
}

let allOk = true
for (const file of FILES) {
  let before
  try {
    before = execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch {
    console.log(`SKIP ${file}: 该 ref 中不存在`)
    continue
  }
  const after = readFileSync(file, 'utf8')
  console.log(`\n=== ${file}（ref ${ref} vs 工作区）===`)
  const stringsOk = describeDiff('字符串字面量', strings(before), strings(after))
  const numbersOk = describeDiff('数字字面量', numbers(before), numbers(after))
  const beforeExports = exportsOf(before, file)
  const afterExports = exportsOf(after, file)
  const missingExports = [...beforeExports].filter(name => !afterExports.has(name))
  const addedExports = [...afterExports].filter(name => !beforeExports.has(name))
  const exportsOk = missingExports.length === 0
  console.log(`${exportsOk ? 'PASS' : 'DIFF'} 导出名: 缺失 [${missingExports.join(', ')}] / 新增 [${addedExports.join(', ')}]`)
  allOk = allOk && stringsOk && numbersOk && exportsOk
}

console.log(`\n===== 保真核验: ${allOk ? '通过（无可观察要素差异）' : '存在差异，需人工判断'} =====`)
process.exit(allOk ? 0 : 1)
