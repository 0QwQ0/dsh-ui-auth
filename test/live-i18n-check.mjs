// 自检（不入库）：① 服务端页面按 Accept-Language 出英文 ② 客户端面板按 locale 偏好出英文
// ③ 错误消息翻译 ④ 还原 zh。
import puppeteer from 'puppeteer'

const base = 'http://127.0.0.1:3202'
const fetchHtml = async (path, lang) => {
  const response = await fetch(base + path, { headers: lang === undefined ? {} : { 'accept-language': lang } })
  return { status: response.status, html: await response.text() }
}

// ① 服务端页面
for (const [path, lang] of [['/auth/login', 'en-US,en;q=0.9'], ['/auth/login', 'zh-CN,zh;q=0.9'], ['/auth/register', 'en-US,en;q=0.9']]) {
  const { status, html } = await fetchHtml(path, lang)
  const marker = html.includes('Sign in to continue') || html.includes('Create an account')
  const chinese = html.includes('请登录后继续访问') || html.includes('注册新账号')
  console.log(`  ${path} [${lang}] → ${status} | 英文标记: ${marker} | 中文残留: ${chinese}`)
}

// ③ 错误消息（未带会话的 RPC → 401/403，带 Accept-Language: en）
const errorResponse = await fetch(`${base}/auth/rpc/me`, { headers: { 'content-type': 'application/json', 'accept-language': 'en-US' }, method: 'POST', body: '{}' })
console.log('  错误消息(en):', errorResponse.status, (await errorResponse.text()).slice(0, 80))

// ② 客户端面板
const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 900 } })
const page = await browser.newPage()
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36')
const setLocale = async (preference) => {
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'QkMP4wzk&n#R@hbi' }) })
  })
  return await page.evaluate(async (value) => {
    const r = await fetch('/api/settings/update', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'settings/update', payload: { args: { ns: 'locale', patch: { preference: value } } } }),
    })
    return r.status
  }, preference)
}
const readOurPanels = async (user, pass) => {
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (u, p) => {
    await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })
  }, user, pass)
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await new Promise((resolve) => setTimeout(resolve, 5000))
  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('button,[role=button]')].find((element) => /^(设置|Settings)$/.test(((element.getAttribute('aria-label') || element.textContent || '').trim())))
    if (trigger !== undefined) trigger.click()
  })
  await new Promise((resolve) => setTimeout(resolve, 2500))
  const texts = []
  const count = await page.evaluate(() => document.querySelectorAll('[role=dialog] nav button,[role=dialog] nav [role=button]').length)
  for (let index = 0; index < count; index += 1) {
    await page.evaluate((i) => {
      const items = [...document.querySelectorAll('[role=dialog] nav button,[role=dialog] nav [role=button]')]
      if (items[i] !== undefined) items[i].click()
    }, index)
    await new Promise((resolve) => setTimeout(resolve, 900))
    const text = await page.evaluate(() => {
      const root = document.querySelector('.dshua')
      return root === null ? '' : (root.innerText || '').slice(0, 220)
    })
    if (text !== '') texts.push(text.replace(/\n+/g, ' | '))
  }
  return texts
}
console.log('  设为 en:', await setLocale('en'), '| 语言设置页(admin):', (await readOurPanels('admin', 'QkMP4wzk&n#R@hbi')).length, '个面板')
for (const text of (await readOurPanels('admin', 'QkMP4wzk&n#R@hbi')).slice(0, 3)) console.log('    en 面板文本:', text.slice(0, 150))
console.log('  还原 zh:', await setLocale('zh'))
const zhPanels = await readOurPanels('admin', 'QkMP4wzk&n#R@hbi')
console.log('    zh 面板文本:', (zhPanels[0] ?? '').slice(0, 120))
await browser.close()