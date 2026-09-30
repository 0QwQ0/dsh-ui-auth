/**
 * 维护脚本：由安全套件的**机器可读结果**重建 `docs/SECURITY-VERIFICATION.md` 的测试矩阵（§2）。
 *
 * 为什么不用 stdout：套件的逐项 dump 会混入插件日志（`[dsh-ui-auth] …`），按行解析会统计出
 * 与实际不一致的用例数（真实发生过：解析出 159 行 / 含假 FAIL，而套件汇总为 145 项全通过）。
 * 因此这里让套件导出 JSON（`DSH_SUITE_JSON`），报告**只以 JSON 为准**。
 *
 * 用法：
 *   npm run docs:matrix                       # 跑套件 → 重建 §2
 *   node build/docs-matrix.mjs <result.json>  # 用已有 JSON 重建
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const reportPath = path.join(root, 'docs', 'SECURITY-VERIFICATION.md')
const target = process.argv[2] ?? path.join(root, '.security-suite-result.json')

if (process.argv[2] === undefined) {
  console.log('running test/security-suite.mjs (DSH_SUITE_JSON) ...')
  const run = spawnSync(process.execPath, [path.join(root, 'test', 'security-suite.mjs')], {
    cwd: root,
    env: { ...process.env, DSH_SUITE_JSON: target },
    stdio: 'inherit',
  })
  if (run.status !== 0) { console.error('安全套件未通过：不重建报告'); process.exit(run.status ?? 1) }
}

const summary = JSON.parse(readFileSync(target, 'utf8'))
const report = readFileSync(reportPath, 'utf8')

// 分类中文名：优先复用报告里已有的，新分类在此登记
const names = {}
for (const match of report.matchAll(/^###\s+(\S+)\s+路\s+([^（(]+)/gm)) names[match[1]] = match[2].trim()
Object.assign(names, { PROFILE: '密钥存储与隔离', SHARE: '分享与授权', RPC: '接口鉴权', I18N: '本地化安全' })

const blocks = Object.entries(summary.categories).map(([category, group]) => [
  `### ${category} 路 ${names[category] ?? category}（${group.total} 项，${group.passed}/${group.total} 通过）`,
  '',
  '| 用例 | 结果 |',
  '|---|---|',
  ...group.cases.map(entry => `| ${entry.label.replace(/\|/g, '\\|')} | ${entry.pass ? 'PASS' : 'FAIL'} |`),
  '',
].join('\n'))

const start = report.indexOf('## 2.')
const end = report.indexOf('## 3.')
if (start < 0 || end <= start) { console.error('未在报告中定位到 §2…§3 区间'); process.exit(1) }
const head = [
  `## 2. 测试矩阵与结果（${summary.passed}/${summary.total} 通过）`,
  '',
  '> 本节由 `npm run docs:matrix` 生成（内部：套件导出 `DSH_SUITE_JSON` → 本脚本重建），**以 JSON 结果为准**，',
  '> 不解析 stdout —— 逐项 dump 会混入插件日志，统计不可靠（曾因此得到错误总数与假 FAIL）。',
  `> 共 ${summary.total} 项，覆盖 ${Object.keys(summary.categories).length} 个分类。`,
  '',
].join('\n')
writeFileSync(reportPath, report.slice(0, start) + head + blocks.join('\n') + '\n' + report.slice(end))
console.log(`已重建 §2：${summary.passed}/${summary.total} 通过，${Object.keys(summary.categories).length} 个分类`)