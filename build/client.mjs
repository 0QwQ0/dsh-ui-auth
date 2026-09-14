/**
 * 客户端 bundle 构建：src/client.ts → lib/client.js
 *
 * DSH 的客户端模块契约是「经典脚本 + 工厂形式」：
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
 * 因此这里用 esbuild 打成 CJS，并用 banner/footer 复刻官方 tsdown.client.ts 的包装，
 * 使 factory 内的 `require('react')` 走 DSH 冻结模块表（React 不是全局变量）。
 * `react` 保持 external：bundle 不内联，由宿主模块表提供。
 */
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const ID = 'dsh-ui-auth'
const OUT = 'lib/client.js'

const banner = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
`

const footer = `\t\treturn module.exports;
\t}
});
`

await build({
  entryPoints: ['src/client.ts'],
  outfile: OUT,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  // 保留 UTF-8 原样输出：默认会把中文文案转义成 \uXXXX，产物不可读，
  // 也会让「与重写前实现对照」的保真核验产生大量伪差异。
  charset: 'utf8',
  external: ['react'],
  banner: { js: banner },
  footer: { js: footer },
  legalComments: 'none',
  logLevel: 'info',
})

// 自检：产物必须仍是 DSH 客户端契约的形状（id 唯一、工厂形式、结尾返回 module.exports）
const emitted = await readFile(OUT, 'utf8')
const problems = []
if (!emitted.startsWith('window.__ModuleLoader__.load({')) problems.push('缺少 __ModuleLoader__.load 包装')
if (!emitted.includes(`id: ${JSON.stringify(ID)}`)) problems.push(`缺少 id ${ID}`)
if (!emitted.includes('factory: (require) =>')) problems.push('缺少 factory(require) 形式')
if (!emitted.includes('return module.exports;')) problems.push('缺少 return module.exports')
if (problems.length > 0) {
  throw new Error(`${OUT} 不符合 DSH 客户端契约：${problems.join('；')}`)
}
console.log(`${OUT} 构建完成（${emitted.length} 字节，DSH 客户端契约自检通过）`)
