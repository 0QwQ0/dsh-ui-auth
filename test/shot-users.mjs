// 重拍【用户管理】页截图：临时创建两个演示账号 → 截图 → 删除演示账号。
import puppeteer from 'puppeteer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = process.env.DSH_SHOT_URL ?? 'http://localhost:3202'
const admin = { user: 'admin', pass: process.env.DSH_SHOT_PASSWORD ?? 'QkMP4wzk&n#R@hbi' }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = path.join(ROOT, 'assets')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 900 } })
const page = await browser.newPage()
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36')
await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
await page.evaluate(async (u, p) => {
  await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })
}, admin.user, admin.pass)

// 演示账号（拍完删除）
const demo = [['alice', 'Alice Chen'], ['bob', 'Bob Li']]
for (const [name, display] of demo) {
  await page.evaluate(async (n, d) => {
    await fetch('/auth/rpc/createUser', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: n, password: 'Demo-Pass-1234!', role: 'user', displayName: d }),
    })
  }, name, display)
}

await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
await wait(5000)
await page.evaluate(() => {
  const trigger = [...document.querySelectorAll('button,[role=button]')]
    .find((element) => ((element.getAttribute('aria-label') || element.textContent || '').trim()) === '设置')
  if (trigger !== undefined) trigger.click()
})
await wait(2500)
await page.evaluate(() => {
  const target = [...document.querySelectorAll('[role=dialog] nav button,[role=dialog] nav [role=button]')]
    .find((element) => (element.textContent || '').trim() === '用户管理')
  if (target !== undefined) target.click()
})
await wait(2500)
const dialog = await page.$('[role=dialog]')
if (dialog === null) { console.log('未找到设置对话框'); await browser.close(); process.exit(1) }
await dialog.screenshot({ path: path.join(ASSETS, 'screenshot-users.png') })
console.log('saved screenshot-users.png')

// 清理演示账号
for (const [name] of demo) {
  await page.evaluate(async (n) => {
    await fetch('/auth/rpc/deleteUser', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: n }) })
  }, name)
}
console.log('演示账号已删除')
await browser.close()