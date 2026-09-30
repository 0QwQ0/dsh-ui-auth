/**
 * 多版本兼容矩阵运行器（可复现）。
 *
 * 对每个 DSH 版本：装一个**一次性** CLI + profile（把本仓库作为插件加入）→ 启动到独立端口 →
 * 跑 `test/live-020-check.mjs`（同一套 38 项断言）→ 记录通过/失败数 → 停实例、清理。
 *
 * 用法：
 *   node test/live-compat-matrix.mjs                       # 默认跑待测的中间版本
 *   node test/live-compat-matrix.mjs 0.1.7-rc.2 0.1.6-alpha.2
 *
 * 判读：中间版本里"宿主不存在的端点"会返回 404，那属于**能力收窄**而不是回归；
 * 结果写回 docs/DSH-0.2.0-COMPATIBILITY.md 的矩阵表。
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const DEFAULT_VERSIONS = ['0.1.7-rc.2', '0.1.7-rc.1', '0.1.6-alpha.2', '0.1.6-alpha.1', '0.1.5-rc.2', '0.1.5-rc.1']
const versions = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_VERSIONS
const BASE_PORT = Number(process.env.MATRIX_PORT ?? 3210)
const isWindows = process.platform === 'win32'

const sh = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: 'utf8', shell: isWindows, ...options })

const waitForPort = async (port, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/auth/login`, { redirect: 'manual' })
      if (response.status > 0) return true
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  return false
}

const stopTree = (pid) => {
  if (isWindows) sh('taskkill', ['/PID', String(pid), '/T', '/F'])
  else { try { process.kill(-pid, 'SIGKILL') } catch { /* ignore */ } }
}

const results = []
for (const [index, version] of versions.entries()) {
  const port = BASE_PORT + index
  const root = path.join(os.tmpdir(), `dsh-matrix-${version.replace(/[^\w.-]/g, '_')}`)
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(path.join(root, 'work'), { recursive: true })
  const cliBin = path.join(root, 'cli', 'node_modules', '.bin', isWindows ? 'dsh.cmd' : 'dsh')
  const env = { ...process.env, DSH_HOME: path.join(root, 'home'), PUPPETEER_SKIP_DOWNLOAD: 'true' }
  console.log(`\n===== ${version}（端口 ${port}）`)

  const install = sh('npm', ['install', '--prefix', path.join(root, 'cli'), `@deepseek-ai/dsh@${version}`], { env })
  if (install.status !== 0) {
    console.log(`  安装失败：${(install.stderr ?? '').split('\n').slice(-3).join(' / ')}`)
    results.push({ version, installed: false })
    continue
  }
  sh(cliBin, ['plugin', '--profile', 'web', 'add', REPO], { env, cwd: path.join(root, 'work') })

  const server = spawn(cliBin, ['web', '--port', String(port), '--no-open'], {
    cwd: path.join(root, 'work'), env, detached: !isWindows, stdio: 'ignore', shell: isWindows,
  })
  try {
    if (!(await waitForPort(port, 150_000))) {
      console.log('  启动超时')
      results.push({ version, installed: true, booted: false })
      continue
    }
    const bootstrap = path.join(root, 'work', 'dsh-ui-auth-bootstrap.txt')
    const check = sh('node', [path.join(REPO, 'test', 'live-020-check.mjs')], {
      env: { ...env, DSH020_URL: `http://127.0.0.1:${port}`, DSH020_BOOTSTRAP: bootstrap },
      cwd: REPO,
    })
    const output = `${check.stdout ?? ''}`
    const summary = /结果:\s*(\d+)\s*通过\s*\/\s*(\d+)\s*失败/.exec(output)
    const failures = output.split('\n').filter(line => line.startsWith('FAIL')).map(line => line.trim())
    const pass = summary === null ? 0 : Number(summary[1])
    const fail = summary === null ? -1 : Number(summary[2])
    console.log(`  结果：${pass} 通过 / ${fail} 失败`)
    for (const line of failures) console.log('    ' + line)
    results.push({ version, installed: true, booted: true, pass, fail, failures })
  } finally {
    stopTree(server.pid)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

console.log('\n===== 矩阵汇总 =====')
for (const entry of results) {
  if (entry.booted !== true) { console.log(`| ${entry.version} | ❌ | 未能启动 | |`); continue }
  const verdict = entry.fail === 0 ? '✅ compatible' : '⚠️ 能力收窄'
  console.log(`| ${entry.version} | ${verdict} | ${entry.pass}/${entry.pass + entry.fail} | ${entry.failures.slice(0, 3).join('；')} |`)
}
fs.writeFileSync(path.join(REPO, 'matrix-result.json'), JSON.stringify(results, null, 2), 'utf8')
console.log('\n结果已写入 matrix-result.json（未跟踪，供人工回填文档）')