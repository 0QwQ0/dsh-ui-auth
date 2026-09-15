/**
 * live-user-pages-check.mjs — modern 线（DSH 0.1.2+）普通用户可见设置页的可用性验收。
 *
 * 背景：modern 线对普通用户是 deny-by-default，任何一个页面在**加载时**调用的只读端点被误拒，
 * 整页就会失败。真实用户报过两次同类现象：
 *   - 【Agent 预设】显示「无法加载 Agent 预设」（客户端日志 `agentPresets/list ... HTTP 403`）；
 *   - 【插件】显示「暂时无法读取插件。」（`pluginInventory/list` 被拒）。
 * 本脚本把这两条路径固定成可回归的验收：
 *   - 只读且属主可控的调用必须放行：`agentPresets/list`、本会话的 `read`/`select`、`pluginInventory/list`；
 *   - 会改变部署或提权的调用必须仍然 403：预设的 `copy`/`deletePreset`、插件的安装/卸载/启停；
 *   - 页面在真实浏览器里必须真正加载成功（无失败文案、控制台无对应 403）。
 *
 * 用法（需要一个隔离的 0.1.5+ 实例，建议用 localhost 访问）：
 *   DSH_PAGES_URL=http://localhost:3201 DSH_PAGES_ADMIN_PASSWORD=<一次性口令> \
 *     node test/live-user-pages-check.mjs
 */
import puppeteer from 'puppeteer'

const base = process.env.DSH_PAGES_URL ?? process.env.DSH_PRESET_URL ?? 'http://localhost:3201'
const adminUser = process.env.DSH_PAGES_ADMIN ?? 'admin'
const adminPassword = process.env.DSH_PAGES_ADMIN_PASSWORD ?? process.env.DSH_PRESET_ADMIN_PASSWORD ?? ''
const userPassword = 'Ui-Test-pass-42!'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

async function login(username, password) {
  const response = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const cookie = (response.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ')
  return { status: response.status, cookie }
}

async function rpc(cookie, method, body) {
  const response = await fetch(`${base}/auth/rpc/${method}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })
  let json = {}
  try { json = await response.json() } catch { /* keep {} */ }
  return { status: response.status, json }
}

async function remote(cookie, endpoint, args = {}) {
  const response = await fetch(`${base}/api/${endpoint}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `probe-${endpoint}-${Date.now()}`, method: endpoint, payload: { args } }),
  })
  const text = await response.text()
  let envelope
  try { envelope = JSON.parse(text) } catch { envelope = undefined }
  return { status: response.status, envelope, text }
}

if (adminPassword === '') {
  console.error('请通过 DSH_PRESET_ADMIN_PASSWORD 提供一次性管理员口令')
  process.exit(1)
}

const admin = await login(adminUser, adminPassword)
check('管理员登录成功', admin.status === 200 && admin.cookie.startsWith('dsh_auth='), `${admin.status}`)

// 普通用户：被删除的用户名会进永久墓碑，因此按候选名尝试
const roster = await rpc(admin.cookie, 'listUsers')
const names = new Set((roster.json.users ?? []).map((user) => user.username))
let userName = ''
for (const candidate of ['uiuser', 'uiuser2', 'uiuser3', 'uiuser4']) {
  if (names.has(candidate)) { userName = candidate; break }
  const created = await rpc(admin.cookie, 'createUser', { username: candidate, password: userPassword, role: 'user', displayName: 'UI 测试用户' })
  if (created.status === 200) { userName = candidate; break }
}
check('准备普通用户账号', userName !== '', userName || '未能创建')

const user = await login(userName, userPassword)
check('普通用户登录成功', user.status === 200 && user.cookie.startsWith('dsh_auth='), `${user.status}`)

// ---- 普通用户的 agentPresets/* 权限面 ----
const list = await remote(user.cookie, 'agentPresets/list', {})
check('普通用户 agentPresets/list → 200（设置页与预设选择器依赖它）',
  list.status === 200 && list.envelope?.result?.ok === true, `${list.status} ${list.text.slice(0, 90)}`)

const presetIds = (list.envelope?.result?.value?.presets ?? []).map((preset) => preset.agentPreset ?? preset.id).filter(Boolean)
console.log(`  可见预设：${presetIds.slice(0, 6).join(', ') || '（空）'}`)

for (const [endpoint, args, expected] of [
  ['agentPresets/read', { agentId: 'someone-elses-agent', agentPreset: presetIds[0] ?? 'x' }, 403],
  ['agentPresets/select', { agentId: 'someone-elses-agent', agentPreset: presetIds[0] ?? 'x' }, 403],
  ['agentPresets/copy', { from: presetIds[0] ?? 'a', id: 'probe-copy', name: 'probe' }, 403],
  ['agentPresets/deletePreset', { id: presetIds[0] ?? 'a' }, 403],
]) {
  const response = await remote(user.cookie, endpoint, args)
  check(`普通用户 ${endpoint}（非属主 agent / 写操作）→ ${expected}`, response.status === expected, String(response.status))
}

const adminList = await remote(admin.cookie, 'agentPresets/list', {})
check('管理员 agentPresets/list → 200', adminList.status === 200, String(adminList.status))

// ---- 普通用户的 pluginInventory/* 权限面（只读清单放行；安装/卸载等默认仍被拒）----
const inventory = await remote(user.cookie, 'pluginInventory/list', {})
check('普通用户 pluginInventory/list → 200（插件页只读清单）',
  inventory.status === 200 && inventory.envelope?.result?.ok === true, `${inventory.status} ${inventory.text.slice(0, 90)}`)
const inventoryItems = inventory.envelope?.result?.value?.plugins ?? inventory.envelope?.result?.value?.items ?? []
console.log(`  可见插件：${Array.isArray(inventoryItems) ? inventoryItems.length : '?'} 个`)

for (const method of ['pluginInventory/install', 'pluginInventory/uninstall', 'pluginInventory/enable', 'pluginInventory/disable']) {
  const response = await remote(user.cookie, method, { name: 'probe-package' })
  check(`普通用户 ${method} → 403（安装/卸载/启停不因清单放行而开放）`, response.status === 403, String(response.status))
}
const pluginSettingsWrite = await remote(user.cookie, 'settings/mutate', { ns: 'plugins', patch: {} })
check('普通用户插件设置写入 settings/mutate → 403', pluginSettingsWrite.status === 403, String(pluginSettingsWrite.status))

// ---- 浏览器级：设置 → Agent 预设页面必须真的能加载 ----
const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1360, height: 900 } })
const page = await browser.newPage()
const consoleErrors = []
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('pageerror', (error) => consoleErrors.push('pageerror: ' + String(error)))
try {
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#u', { timeout: 15000 })
  await page.type('#u', userName)
  await page.type('#p', userPassword)
  await page.click('#b')
  await wait(3000)
  check('普通用户登录后进入面板', !page.url().includes('/auth/login'), page.url())

  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('button,[role=button]')].find((element) =>
      (element.getAttribute('aria-label') || '').trim() === '设置' || (element.textContent || '').trim() === '设置')
    if (trigger) trigger.click()
  })
  await wait(1500)
  const labels = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] nav button, [role=dialog] nav [role=button]')]
    .map((element) => (element.textContent || '').trim()).filter(Boolean))
  const target = labels.find((text) => text.includes('预设'))
  check('设置导航包含预设入口', typeof target === 'string', labels.join(' | '))

  const openPage = async (label) => {
    await page.evaluate((wanted) => {
      const entry = [...document.querySelectorAll('[role=dialog] nav button, [role=dialog] nav [role=button]')]
        .find((element) => (element.textContent || '').trim() === wanted)
      if (entry) entry.click()
    }, label)
    await wait(2500)
    return page.evaluate(() => {
      const dialog = document.querySelector('[role=dialog]')
      return dialog === null ? document.body.innerText : dialog.innerText
    })
  }

  if (typeof target === 'string') {
    const text = await openPage(target)
    check('「Agent 预设」页面不显示加载失败',
      !text.includes('无法加载 Agent 预设'), text.split('\n').filter(Boolean).slice(0, 4).join(' / '))
    check('「Agent 预设」页面渲染出内容（非空）', text.trim().length > 30, `${text.length} chars`)
    const blocked = consoleErrors.filter((line) => /agentPresets\/list.*403|403.*agentPresets\/list/.test(line))
    check('控制台无 agentPresets/list 403', blocked.length === 0, blocked.slice(0, 2).join(' | ') || 'none')
  }

  // 【插件】页：普通用户应当能看到已安装插件清单，而不是"暂时无法读取插件"
  const pluginsLabel = labels.find((text) => text === '插件' || text.startsWith('插件'))
  check('设置导航包含插件入口', typeof pluginsLabel === 'string', pluginsLabel ?? labels.join(' | '))
  if (typeof pluginsLabel === 'string') {
    const text = await openPage(pluginsLabel)
    check('「插件」页面不显示读取失败',
      !text.includes('暂时无法读取插件') && !text.includes('无法加载插件'),
      text.split('\n').filter(Boolean).slice(0, 5).join(' / '))
    check('「插件」页面渲染出内容（非空）', text.trim().length > 30, `${text.length} chars`)
    const blocked = consoleErrors.filter((line) => /pluginInventory\/list.*403|403.*pluginInventory\/list/.test(line))
    check('控制台无 pluginInventory/list 403', blocked.length === 0, blocked.slice(0, 2).join(' | ') || 'none')
  }
} finally {
  await browser.close()
}

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail === 0 ? 0 : 1)
