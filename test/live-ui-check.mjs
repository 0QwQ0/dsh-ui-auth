/**
 * live-ui-check.mjs — 浏览器级验收：设置面板是否出现「用户管理」入口，且该页可渲染。
 *
 * 回答的正是"菜单注入失效"这类只会在真实浏览器里暴露的问题（客户端到达顺序、
 * slots 服务可用性、bundle 加载错误都只在页面里可见）。
 *
 * 用法（默认对隔离的 0.1.5 实例）：
 *   DSH_UI_URL=http://127.0.0.1:3201 DSH_UI_USER=admin DSH_UI_PASSWORD=... \
 *     node test/live-ui-check.mjs
 * 对真实 0.1.1-rc.2 面板回归：
 *   DSH_UI_URL=http://127.0.0.1:3080 DSH_UI_USER=test1 DSH_UI_PASSWORD=12345678 \
 *     node test/live-ui-check.mjs
 */
import puppeteer from 'puppeteer'

const base = process.env.DSH_UI_URL ?? 'http://127.0.0.1:3201'
const username = process.env.DSH_UI_USER ?? 'admin'
const password = process.env.DSH_UI_PASSWORD ?? 'ALsCQ#zLF!phJ3#2'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1360, height: 900 } })
const page = await browser.newPage()
const consoleLines = []
const pageErrors = []
page.on('console', message => consoleLines.push(`[${message.type()}] ${message.text()}`))
page.on('pageerror', error => pageErrors.push(String(error)))

try {
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#u', { timeout: 15000 })
  await page.type('#u', username)
  await page.type('#p', password)
  await page.click('#b')
  await wait(3000)

  check('登录后进入应用（URL 不再是 /auth/login）', !page.url().includes('/auth/login'), page.url())

  // 触发器的可访问名在不同 Host 上分别落在 aria-label（0.1.5）与按钮文本（0.1.1-rc.2）。
  const findTrigger = () => [...document.querySelectorAll('button,[role=button]')].find(element =>
    (element.getAttribute('aria-label') || '').trim() === '设置' || (element.textContent || '').trim() === '设置')
  const trigger = await page.waitForFunction(
    () => [...document.querySelectorAll('button,[role=button]')].some(element =>
      (element.getAttribute('aria-label') || '').trim() === '设置' || (element.textContent || '').trim() === '设置'),
    { timeout: 20000 },
  ).then(() => true).catch(() => false)
  check('设置入口按钮存在（客户端插件已激活）', trigger)

  if (trigger) {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button,[role=button]')].find(element =>
        (element.getAttribute('aria-label') || '').trim() === '设置' || (element.textContent || '').trim() === '设置')
      if (button) button.click()
    })
    await wait(1500)

    const navLabels = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] nav button, [role=dialog] nav [role=button]')]
      .map(element => (element.textContent || '').trim())
      .filter(Boolean))
    check('设置导航包含「用户管理」（插件注入生效）', navLabels.includes('用户管理'), `nav=[${navLabels.join(' | ')}]`)

    if (navLabels.includes('用户管理')) {
      await page.evaluate(() => {
        const entry = [...document.querySelectorAll('[role=dialog] nav button, [role=dialog] nav [role=button]')]
          .find(element => (element.textContent || '').trim() === '用户管理')
        if (entry) entry.click()
      })
      await wait(1800)
      const bodyText = await page.evaluate(() => document.body.innerText)
      check('「用户管理」页已渲染（我的账号 / 修改密码 / 两步验证）',
        ['我的账号', '修改密码', '两步验证'].every(text => bodyText.includes(text)),
        `bytes=${bodyText.length}`)
      // 通行密钥卡片（0.6.4）：可用地址给添加入口，IP 字面量地址给可操作提示
      check('「用户管理」页出现通行密钥卡片', bodyText.includes('通行密钥（Passkey）'), `bytes=${bodyText.length}`)
      check('通行密钥卡片按当前访问地址给出正确状态',
        bodyText.includes('本机通行密钥') || bodyText.includes('改用 http://localhost'),
        bodyText.includes('本机通行密钥') ? '可用地址：显示添加入口' : 'IP 字面量地址：显示 localhost 提示')
      if (username === 'admin') {
        check('管理员额外看到创建用户 / 邀请码管理',
          bodyText.includes('创建用户') && bodyText.includes('邀请码管理（管理员）'))
      }
    }
  }
} finally {
  await browser.close()
}

const pluginErrors = consoleLines.filter(line => line.includes('dsh-ui-auth'))
check('页面无插件级错误日志', pluginErrors.filter(line => line.includes('error') || line.includes('[Error]')).length === 0,
  pluginErrors.slice(0, 3).join(' / ') || 'none')
if (pageErrors.length > 0) console.log('page errors:', pageErrors.slice(0, 5).join(' | '))
const noisy = consoleLines.filter(line => /error|warn/i.test(line))
if (noisy.length > 0) console.log('console 错误/警告（前 8 条）:\n  ' + noisy.slice(0, 8).join('\n  '))

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail === 0 ? 0 : 1)
