// 新增功能截图：普通用户【模型】页 与 管理员【分享管理】页（写入 assets/）。
import puppeteer from 'puppeteer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = process.env.DSH_SHOT_URL ?? 'http://localhost:3202'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = path.join(ROOT, 'assets')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const openSettings = async (page, section) => {
  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('button,[role=button]')]
      .find((element) => ((element.getAttribute('aria-label') || element.textContent || '').trim()) === '设置')
    if (trigger !== undefined) trigger.click()
  })
  await wait(2500)
  await page.evaluate((label) => {
    const target = [...document.querySelectorAll('[role=dialog] nav button,[role=dialog] nav [role=button]')]
      .find((element) => (element.textContent || '').trim() === label && element.style.display !== 'none')
    if (target !== undefined) target.click()
  }, section)
  await wait(2500)
  const dialog = await page.$('[role=dialog]')
  return dialog
}

const capture = async (user, pass, section, file) => {
  const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 900 } })
  const page = await browser.newPage()
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36')
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (u, p) => {
    await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })
  }, user, pass)
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await wait(5000)
  const dialog = await openSettings(page, section)
  if (dialog === null) { console.log(`  [失败] ${file}：未找到设置对话框`); await browser.close(); return }
  await dialog.screenshot({ path: path.join(ASSETS, file) })
  console.log(`  saved ${file}`)
  await browser.close()
}

await capture(process.env.SHOT_USER_MODELS ?? 'checkuser', process.env.SHOT_PASS_MODELS ?? 'Check-0.7.0-pass!', '模型', 'screenshot-models.png')
await capture(process.env.SHOT_USER_SHARES ?? 'admin', process.env.SHOT_PASS_SHARES ?? 'QkMP4wzk&n#R@hbi', '分享管理', 'screenshot-shares.png')