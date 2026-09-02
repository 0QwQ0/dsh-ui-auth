#!/usr/bin/env node
/**
 * store-contract-check.mjs — DSH STORE 固定源契约自检。
 *
 * 复刻 DSH-Store catalog 自动化（AI-Scarlett/DSH-Store 的 analyzeFixedSource /
 * inferredCompatibility / permissionSignals）中「作者仓库侧可控」的门禁检查，供上架前
 * 本地自检与审阅者复核。它不做安全审计、不运行插件代码、不写真实 Profile。
 *
 * 硬性失败（exit 1）：manifest 契约 / 许可证 / 文件清单 / 兼容声明 / 生命周期脚本 /
 * 符号链接等自动化会确定性阻断的项。
 * 信息性（exit 0 但列出）：运行依赖与权限信号——对凭据/网络类插件属固有属性，自动
 * 批准通道按设计不可通过（需要 user-reviewed 人工审查），在此如实呈现而非隐瞒。
 *
 * 用法：node scripts/store-contract-check.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const rows = []
let failures = 0
const fail = (gate, ok, detail) => {
  if (!ok) failures += 1
  rows.push({ gate, ok, detail })
}
const info = (gate, detail) => rows.push({ gate, ok: null, detail })

// ---- manifest identity ----
fail('name/version', /^[a-z0-9][a-z0-9._-]*$/.test(manifest.name ?? ''), `name=${manifest.name}`)
fail('semver', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version ?? ''), `version=${manifest.version}`)
const canonical = (manifest.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '')
fail('canonical github repository', /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(canonical), canonical)

// ---- license ----
fail('license field', manifest.license === 'MIT', `license=${manifest.license}`)
fail('LICENSE file', existsSync(join(root, 'LICENSE')), 'LICENSE')

// ---- dsh bundle contract ----
const patchRel = manifest.dsh?.bundle?.patch
fail('dsh.bundle.patch declared', typeof patchRel === 'string' && patchRel.length > 0, `patch=${patchRel}`)
const patchPath = patchRel ? join(root, patchRel) : null
fail('patch file exists', patchPath !== null && existsSync(patchPath), patchPath ?? '(missing)')
const patchText = patchPath && existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
const entryId = manifest.name
fail('patch inserts own entry id', new RegExp(`-\\s*id:\\s*${entryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm').test(patchText), `id=${entryId}`)
fail('client platform web', manifest.dsh?.client?.platform === 'web', `platform=${manifest.dsh?.client?.platform}`)

// ---- entry collision against the shipped catalog (catalog is read-only, skip network) ----
info('entry uniqueness', `entry id "${entryId}" is owned only by this package (single-bundle repo)`)

// ---- compatibility declarations ----
const compat = manifest.dsh?.compatibility ?? {}
const hasDshRange = typeof compat.dsh === 'string' && compat.dsh.length > 0
fail('DSH compatibility declared (dsh.compatibility.dsh)', hasDshRange, `dsh=${compat.dsh}`)
const relKeys = Object.keys(compat.dshReleases ?? {})
const badStatus = relKeys.filter((k) => !['compatible', 'incompatible', 'unknown'].includes(compat.dshReleases[k]))
const validKey = /^(?:rc\.(?:7|8)|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/
const badKey = relKeys.filter((k) => !validKey.test(k))
fail('dshReleases keys/statuses valid', badKey.length === 0 && badStatus.length === 0,
  relKeys.length === 0 ? '(none declared)' : `keys=[${relKeys.join(', ')}] badKeys=[${badKey}] badStatus=[${badStatus}]`)
fail('Node compatibility declared (engines.node)', typeof manifest.engines?.node === 'string', `engines.node=${manifest.engines?.node}`)
if (hasDshRange && relKeys.length === 0) {
  info('dshReleases matrix', 'range declared without exact per-release evidence — automation records unknown for undeclared releases')
}

// ---- lifecycle scripts ----
const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare'].filter((k) => typeof manifest.scripts?.[k] === 'string')
fail('no lifecycle scripts', lifecycle.length === 0, lifecycle.length ? `present: ${lifecycle.join(', ')}` : 'none')

// ---- dependencies ----
const runtimeDeps = { ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) }
info('runtime dependencies', Object.keys(runtimeDeps).length
  ? `${Object.keys(runtimeDeps).sort().join(', ')} — auto-approval (source-verified) requires zero runtime deps; needs separate supply-chain review / user-reviewed path`
  : 'none')
fail('no bundledDependencies', !Array.isArray(manifest.bundledDependencies) || manifest.bundledDependencies.length === 0,
  Array.isArray(manifest.bundledDependencies) ? `present: ${manifest.bundledDependencies.join(', ')}` : 'none')

// ---- explicit files list ----
const files = manifest.files
fail('explicit files list', Array.isArray(files) && files.length > 0, files ? `[${files.join(', ')}]` : '(missing)')
const missingFiles = (files ?? []).filter((f) => !existsSync(join(root, f)))
fail('files entries exist', missingFiles.length === 0, missingFiles.length ? `missing: ${missingFiles.join(', ')}` : 'all present')

// ---- symlinks / submodules ----
let symlinks = []
let submodules = []
try {
  const index = execFileSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  for (const line of index.split('\n')) {
    if (!line.trim()) continue
    const mode = line.split(/\s+/)[0] ?? ''
    const path = line.split('\t').pop()?.trim() ?? ''
    if (mode === '120000') symlinks.push(path)
    if (mode === '160000') submodules.push(path)
  }
} catch { /* not a git checkout — lstat fallback below */ }
if (symlinks.length === 0 && submodules.length === 0) {
  for (const f of files ?? []) {
    try { const s = lstatSync(join(root, f)); if (s.isSymbolicLink()) symlinks.push(f) } catch { /* ignore */ }
  }
}
fail('no symlinks', symlinks.length === 0, symlinks.length ? `symlinks: ${symlinks.join(', ')}` : 'none')
fail('no submodules', submodules.length === 0, submodules.length ? `submodules: ${submodules.join(', ')}` : 'none')

// ---- runtime source bounds (replica of the store's bounded scan over the fixed Commit) ----
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|json|ya?ml|sh|py|rb|go|rs)$/i
const EXCLUDED_DIRECTORY = /(?:^|\/)(?:node_modules|vendor|test|tests|docs?|examples?|fixtures?|benchmarks?|coverage|\.github)(?:\/|$)/i
// The store scans the fixed Commit tree (tracked files only); mirror that here so the
// local check cannot be skewed by untracked working-tree artifacts.
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\n').map((l) => l.trim()).filter(Boolean)
const runtime = tracked
  .filter((rel) => !EXCLUDED_DIRECTORY.test('/' + rel + '/') && SOURCE_FILE.test(rel))
  .map((rel) => {
    let bytes = 0
    try { bytes = statSync(join(root, rel)).size } catch { /* missing on disk: ignore */ }
    return { path: rel, bytes }
  })
  .filter((f) => f.bytes > 0)
const maxBytes = 262144
const total = runtime.reduce((s, f) => s + f.bytes, 0)
fail('runtime file count within bounds', runtime.length > 0 && runtime.length <= 240, `${runtime.length} files (max 240)`)
fail('runtime bytes within bounds', runtime.every((f) => f.bytes <= maxBytes) && total <= 2097152,
  `${total} bytes total (max 2097152); largest ${Math.max(0, ...runtime.map((f) => f.bytes))} bytes (max ${maxBytes})`)

// ---- permission signals (replica) ----
const moduleImport = (names) => new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*(?:\\(\\s*)?|\\brequire\\s*\\(\\s*)["'](?:node:)?(?:${names})["']`, 'i')
const RE = {
  files: moduleImport('fs|fs/promises'),
  network: moduleImport('http|https|net|tls|dgram|axios|got|undici'),
  commands: moduleImport('child_process'),
}
const signalTest = {
  files: (s) => RE.files.test(s) || /\b(?:readFile|writeFile|appendFile|rename|unlink|mkdir|rmdir|rm)\s*\(/i.test(s) || /\$DSH_HOME|\.dsh\/profiles/i.test(s),
  network: (s) => RE.network.test(s) || /\b(?:fetch|WebSocket|EventSource)\s*\(/i.test(s) || /\b(?:axios|got|undici)\s*(?:\.|\()/i.test(s),
  commands: (s) => RE.commands.test(s) || /\b(?:exec|execFile|spawn|fork)\s*\(|shell\s*:\s*true|Bun\.spawn|new\s+Deno\.Command/i.test(s),
  credentials: (s) => /process\.env/i.test(s) || /\b(?:keychain|credentials?|oauth)\b\s*(?:\.|\[|\()/i.test(s)
    || /\b(?:api[_-]?key|apiKey|access[_-]?token|accessToken|client[_-]?secret|clientSecret|password)\b/i.test(s),
  protectedDsh: (s) => /(?:__ModuleLoader__[^\n]{0,120}(?:unload|remove)|\bFiber\b[^\n]{0,120}(?:remove|disable|replace)|@deepseek-ai\/[^\n]{0,160}disabled\s*:\s*true|tool\.call\.toolview)/i.test(s),
}
const signals = { files: false, network: false, commands: false, credentials: false, protectedDsh: false }
for (const f of runtime) {
  const src = readFileSync(join(root, f.path), 'utf8')
  for (const [name, test] of Object.entries(signalTest)) {
    if (test(src)) { signals[name] = true; if (!signals._hits) signals._hits = {}; (signals._hits[name] ??= []).push(f.path) }
  }
}
for (const name of ['files', 'network', 'commands', 'credentials', 'protectedDsh']) {
  const hits = (signals._hits?.[name] ?? []).slice(0, 8)
  info(`permission signal: ${name}`, signals[name] ? `present in ${hits.join(', ')} — capability-class plugin; user-reviewed path applies` : 'absent')
}

// ---- render ----
console.log(`dsh-ui-auth store contract check — package.json@${manifest.version}\n`)
for (const r of rows) {
  if (r.ok === null) { console.log(`  ℹ  ${r.gate}: ${r.detail}`); continue }
  if (r.ok) { console.log(`  ✓  ${r.gate}`); continue }
  console.log(`  ✗  ${r.gate} — ${r.detail}`)
}
console.log('')
const passed = rows.filter((r) => r.ok === true).length
const infoCount = rows.filter((r) => r.ok === null).length
console.log(`gates: ${passed} passed / ${failures} failed / ${infoCount} informational`)
process.exit(failures === 0 ? 0 : 1)
