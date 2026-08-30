// 完整功能截图（真实面板 127.0.0.1:3080，test1 登录）：设置对话框 / 用户管理 / 模型锁页
// 用法：node test/shot.mjs
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = path.join(ROOT, 'assets')
fs.mkdirSync(ASSETS, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(ASSETS, name), fullPage: false })
  console.log('saved', name)
}

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1360, height: 900 } })
const page = await browser.newPage()

// 登录
await page.goto('http://127.0.0.1:3080/auth/login', { waitUntil: 'networkidle0' })
await page.type('#u', 'test1')
await page.type('#p', '12345678')
await page.click('#b')
await wait(2500)

// 打开设置对话框
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,[role=button]')].find((el) => (el.getAttribute('aria-label') || '') === '设置')
  if (b) b.click()
})
await wait(1200)
await shot(page, 'screenshot-settings.png')

// 点「用户管理」导航
await page.evaluate(() => {
  const nav = [...document.querySelectorAll('[role=dialog] nav button, [role=dialog] nav [role=button]')].find((el) => (el.textContent || '').trim() === '用户管理')
  if (nav) nav.click()
})
await wait(1500)
await shot(page, 'screenshot-users.png')

// 模型页锁（普通用户视角）
await page.evaluate(() => {
  const nav = [...document.querySelectorAll('[role=dialog] nav button, [role=dialog] nav [role=button]')].find((el) => (el.textContent || '').trim() === '模型')
  if (nav) nav.click()
})
await wait(1200)
await shot(page, 'screenshot-models-locked.png')

await browser.close()
console.log('done')
