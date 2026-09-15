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
const madeDemoUsers = []
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

// 登录后宿主/插件可能会弹出提醒或引导层；它们会盖住要截图的目标，必须真正清掉再拍。
// 注意：不能按“关闭”这类通用文案乱点——设置对话框自己的关闭按钮也叫「关闭」。
// 全新 DSH 实例的 API Key 配置引导用「稍后配置」关闭（用户报告过它盖住截图目标）。
const OVERLAY_TEXTS = ['稍后配置', '稍后设置', '跳过配置', '稍后再说', '继续', '我明白了', '知道了', '我知道了', '开始使用', '跳过', '好的']
async function dismissOverlays() {
  for (let round = 0; round < 5; round++) {
    const closed = await page.evaluate((texts) => {
      const done = []
      // 1) 我们自己的登录提醒弹窗：会话标记 + 直接移除，双保险
      try { sessionStorage.setItem('dshua-totp-reminded', '1') } catch (error) { /* ignore */ }
      const own = document.getElementById('dshua-totp-reminder')
      if (own !== null) { own.remove(); done.push('dshua-totp-reminder') }
      // 2) 覆盖整屏的遮罩层（排除设置对话框本体）里的按钮
      const settingsDialog = document.querySelector('[role=dialog]')
      const overlays = [...document.querySelectorAll('div')].filter((element) => {
        const style = getComputedStyle(element)
        if (style.position !== 'fixed' && style.position !== 'absolute') return false
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) return false
        if (element === settingsDialog || (settingsDialog !== null && settingsDialog.contains(element))) return false
        const rect = element.getBoundingClientRect()
        return rect.width >= innerWidth * 0.8 && rect.height >= innerHeight * 0.8
      })
      for (const overlay of overlays) {
        const button = [...overlay.querySelectorAll('button,[role=button]')].find((candidate) =>
          texts.includes((candidate.textContent || '').trim()) || texts.includes((candidate.getAttribute('aria-label') || '').trim()))
        if (button === undefined) continue
        button.click()
        done.push((button.textContent || button.getAttribute('aria-label') || '').trim())
        break
      }
      return done
    }, OVERLAY_TEXTS)
    if (closed.length === 0) return
    console.log('  关闭覆盖层:', closed.join(', '))
    await wait(900)
  }
}

/** 截前状态：自家提醒弹窗是否已关闭、屏幕上还有哪些全屏弹窗及其按钮文案。 */
async function overlayState() {
  return page.evaluate(() => {
    const popups = []
    const candidates = [...document.querySelectorAll('div')]
    const settingsDialog = document.querySelector('[role=dialog]')
    for (const element of candidates) {
      const style = getComputedStyle(element)
      if (style.position !== 'fixed' && style.position !== 'absolute') continue
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue
      const rect = element.getBoundingClientRect()
      if (rect.width < window.innerWidth * 0.8 || rect.height < window.innerHeight * 0.8) continue
      const buttons = [...element.querySelectorAll('button,[role=button]')]
        .map((button) => (button.textContent || button.getAttribute('aria-label') || '').trim()).filter(Boolean)
        .filter((label, index, all) => all.indexOf(label) === index)
      if (buttons.length === 0) continue
      const isSettings = settingsDialog !== null && (element === settingsDialog || element.contains(settingsDialog))
      popups.push({ isSettings, buttons: buttons.slice(0, 6) })
    }
    // 设置对话框自身的按钮不算"遮挡层"
    const blocking = popups.filter((popup) => !popup.isSettings)
    return {
      ownReminder: document.getElementById('dshua-totp-reminder') !== null,
      blocking: blocking.map((popup) => popup.buttons.join(' / ')),
    }
  })
}

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
  // 登录后先清掉可能弹出的提醒层，否则它会盖住要截图的设置页（这正是上一版截图出错的原因）
  await dismissOverlays()

  // 4) 注册成功引导页（第二个因子二选一：TOTP 或通行密钥）
  await page.goto(`${base}/auth/register/success`, { waitUntil: 'domcontentloaded' })
  await wait(900)
  await shot(page, 'screenshot-guide.png')
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await wait(2000)
  await dismissOverlays()

  if (demoUsers) {
    const existing = new Set((await rpcInPage('listUsers')).users?.map((user) => user.username) ?? [])
    // 注意：被删除的用户名会进入永久墓碑（retired-users），无法再次创建，
    // 因此按候选名单挑前两个真正创建成功的名字，保证重复运行仍有像样的表格。
    const candidates = [
      ['alice', 'Alice', 'alice@example.com'],
      ['bob', 'Bob', ''],
      ['carol', 'Carol', 'carol@example.com'],
      ['dave', 'Dave', ''],
      ['erin', 'Erin', ''],
      ['frank', 'Frank', ''],
      ['demo-a', 'Demo A', ''],
      ['demo-b', 'Demo B', ''],
    ]
    for (const [name, displayName, email] of candidates) {
      if (madeDemoUsers.length >= 2) break
      if (existing.has(name)) { madeDemoUsers.push(name); continue }
      const result = await rpcInPage('createUser', { username: name, password: 'demo-pass-1234', role: 'user', displayName, email })
      if (result.ok === true) madeDemoUsers.push(name)
    }
    console.log('演示账号：', madeDemoUsers.length > 0 ? madeDemoUsers.join(', ') : '未能创建（可能都已被占用）')
  }

  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('button,[role=button]')].find((element) =>
      (element.getAttribute('aria-label') || '').trim() === '设置' || (element.textContent || '').trim() === '设置')
    if (trigger) trigger.click()
  })
  await wait(1500)
  await dismissOverlays()
  await clickNav('用户管理')
  await wait(1800)
  await dismissOverlays()

  const root = await page.$('.dshua')
  if (root === null) throw new Error('未找到「用户管理」页容器（.dshua）')
  // 打印各表格的表头与行数，便于确认成图内容（脚本不读图）
  const tableInfo = await page.evaluate(() => [...document.querySelectorAll('.dshua table')].map((table) => ({
    head: [...table.querySelectorAll('th')].map((th) => (th.textContent || '').trim()).join('|'),
    rows: [...table.querySelectorAll('tbody tr')].map((tr) => (tr.firstElementChild?.textContent || '').trim()),
  })))
  for (const table of tableInfo) console.log(`表格 [${table.head}] ${table.rows.length} 行：${table.rows.join(', ') || '（空）'}`)

  // 截前先确认提醒/引导弹窗确实已关闭（这正是上一版截到弹窗的原因），再拍。
  await dismissOverlays()
  await root.scrollIntoView()
  await wait(400)
  const usersState = await overlayState()
  console.log(`用户管理页截前状态：自家提醒弹窗=${usersState.ownReminder ? '仍存在（异常）' : '已关闭'}，遮挡层=${usersState.blocking.length === 0 ? '无' : usersState.blocking.join(' | ')}`)
  await shot(root, 'screenshot-users.png')

  // 4) 通行密钥卡片（未绑定状态：显示两个添加入口）
  await dismissOverlays()
  const card = await page.evaluateHandle(() => {
    const cards = [...document.querySelectorAll('.dshua .card')]
    return cards.find((element) => (element.textContent || '').includes('通行密钥（Passkey）')) ?? null
  })
  const element = card.asElement()
  if (element === null) console.log('未找到通行密钥卡片，跳过 screenshot-passkey.png')
  else {
    await element.evaluate((node) => node.scrollIntoView({ block: 'center' }))
    await wait(400)
    const cardState = await overlayState()
    console.log(`通行密钥卡片截前状态：自家提醒弹窗=${cardState.ownReminder ? '仍存在（异常）' : '已关闭'}，遮挡层=${cardState.blocking.length === 0 ? '无' : cardState.blocking.join(' | ')}`)
    await shot(element, 'screenshot-passkey.png')
  }

  if (madeDemoUsers.length > 0) {
    const gone = []
    for (const name of madeDemoUsers) {
      const result = await rpcInPage('deleteUser', { username: name })
      if (result.ok === true) gone.push(name)
    }
    console.log('演示账号清理：', gone.length > 0 ? `已删除 ${gone.join(', ')}` : '失败（实例上仍保留）')
  }
} finally {
  await browser.close()
}

console.log(`\n完成：${saved.join(', ')} → ${ASSETS}`)
