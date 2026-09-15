/**
 * 截图脚本：生成 README「界面预览」用的图片。
 *
 * 默认对**一次性/隔离实例**截图（不要对真实部署跑：用户表格里会有真实账号数据）。
 * 通行密钥相关界面只在"可用来源"下完整渲染——浏览器不接受 IP 字面量作为通行密钥域，
 * 因此必须用 `http://localhost:<port>`（或域名 + HTTPS）访问，否则卡片只会显示提示。
 *
 * 用法（Windows PowerShell）：
 *   $env:DSH_SHOT_URL='http://localhost:3201'
 *   $env:DSH_SHOT_USER='admin'; $env:DSH_SHOT_PASSWORD='<一次性口令>'
 *   $env:DSH_SHOT_DEMO_USERS='1'     # 可选：为「用户管理」表格临时创建两个演示账号（用完即删）
 *   node test/shot.mjs
 *
 * 产出（写入 assets/）：
 *   screenshot-login.png    登录页（含「使用通行密钥登录」按钮）
 *   screenshot-register.png 注册页
 *   screenshot-users.png    「用户管理」页（含通行密钥列）
 *   screenshot-passkey.png  「通行密钥（Passkey）」卡片（未绑定状态：两个添加入口）
 */
import puppeteer from 'puppeteer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = process.env.DSH_SHOT_URL ?? 'http://localhost:3201'
const username = process.env.DSH_SHOT_USER ?? 'admin'
const password = process.env.DSH_SHOT_PASSWORD ?? ''
const demoUsers = (process.env.DSH_SHOT_DEMO_USERS ?? '') === '1'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = path.join(ROOT, 'assets')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (password === '') {
  console.error('请通过 DSH_SHOT_PASSWORD 提供一次性口令')
  process.exit(1)
}
if (/\/\/(\d{1,3}\.){3}\d{1,3}(:|\/|$)/.test(base)) {
  console.warn('警告：IP 字面量来源下通行密钥界面不会渲染，截图会显示提示而不是按钮。建议改用 localhost。')
}

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 860 } })
const page = await browser.newPage()
const saved = []
async function shot(target, name) {
  const file = path.join(ASSETS, name)
  if (target === page) await page.screenshot({ path: file })
  else await target.screenshot({ path: file })
  saved.push(name)
  console.log('saved', name)
}
const clickNav = (label) => page.evaluate((text) => {
  const entry = [...document.querySelectorAll('[role=dialog] nav button, [role=dialog] nav [role=button]')]
    .find((element) => (element.textContent || '').trim() === text)
  if (entry) entry.click()
}, label)
const rpcInPage = (method, body) => page.evaluate((m, b) => fetch(`/auth/rpc/${m}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}),
}).then((response) => response.json()), method, body)

try {
  // 1) 登录页：可用来源下应出现通行密钥入口
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#u', { timeout: 15000 })
  await wait(600)
  console.log('登录页通行密钥按钮：', (await page.$('#pk')) !== null ? '存在' : '不存在（来源不可用或脚本未加载）')
  await shot(page, 'screenshot-login.png')

  // 2) 注册页
  await page.goto(`${base}/auth/register`, { waitUntil: 'domcontentloaded' })
  await wait(600)
  await shot(page, 'screenshot-register.png')

  // 3) 登录后进入设置面板 → 用户管理
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#u', { timeout: 15000 })
  await page.type('#u', username)
  await page.type('#p', password)
  await page.click('#b')
  await wait(3000)

  if (demoUsers) {
    const list = await rpcInPage('listUsers')
    const existing = new Set((list.users || []).map((user) => user.username))
    const wanted = [
      { username: 'alice', password: 'alice-demo-1234', role: 'user', displayName: 'Alice', email: 'alice@example.com' },
      { username: 'bob', password: 'bob-demo-1234', role: 'user', displayName: 'Bob', email: '' },
    ]
    const made = []
    for (const user of wanted) {
      if (existing.has(user.username)) continue
      const result = await rpcInPage('createUser', user)
      if (result.ok === true) made.push(user.username)
    }
    console.log('演示账号：', made.length > 0 ? `已创建 ${made.join(', ')}` : '已存在，跳过')
  }

  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('button,[role=button]')].find((element) =>
      (element.getAttribute('aria-label') || '').trim() === '设置' || (element.textContent || '').trim() === '设置')
    if (trigger) trigger.click()
  })
  await wait(1500)
  await clickNav('用户管理')
  await wait(1800)

  const root = await page.$('.dshua')
  if (root === null) throw new Error('未找到「用户管理」页容器（.dshua）')
  await shot(root, 'screenshot-users.png')

  // 4) 通行密钥卡片（未绑定状态：显示两个添加入口）
  const card = await page.evaluateHandle(() => {
    const cards = [...document.querySelectorAll('.dshua .card')]
    return cards.find((element) => (element.textContent || '').includes('通行密钥（Passkey）')) ?? null
  })
  const element = card.asElement()
  if (element === null) console.log('未找到通行密钥卡片，跳过 screenshot-passkey.png')
  else await shot(element, 'screenshot-passkey.png')

  if (demoUsers) {
    const gone = []
    for (const name of ['alice', 'bob']) {
      const result = await rpcInPage('deleteUser', { username: name })
      if (result.ok === true) gone.push(name)
    }
    console.log('演示账号清理：', gone.length > 0 ? `已删除 ${gone.join(', ')}` : '无')
  }
} finally {
  await browser.close()
}

console.log(`\n完成：${saved.join(', ')} → ${ASSETS}`)
