/**
 * live-passkey-check.mjs — 通行密钥（Passkey / WebAuthn）端到端验收。
 *
 * 覆盖三件事，全部跑在真实 DSH 实例 + 真实 Chrome 上：
 *  1) 地址可用性判定：IP 字面量地址被服务端提前拒绝（附可操作提示），localhost 可用；
 *  2) 浏览器仪式：添加通行密钥（虚拟认证器扮演平台认证器）→ 免用户名通行密钥登录；
 *  3) 反锁死与授权：无票据的管理调用被拒；2FA 开启且仅剩一个通行密钥时不允许删除。
 *
 * 必须使用 http://localhost:<port>：Chrome 不接受 IP 字面量作为 RP ID
 * （见 test/webauthn-probe.mjs 的实测结论）。虚拟认证器经 CDP WebAuthn 域注入。
 *
 * 用法：
 *   DSH_PK_URL=http://localhost:3201 DSH_PK_USER=admin DSH_PK_PASSWORD=... node test/live-passkey-check.mjs
 */
import puppeteer from 'puppeteer'

const base = process.env.DSH_PK_URL ?? 'http://localhost:3201'
const host = new URL(base).host
const username = process.env.DSH_PK_USER ?? 'admin'
const password = process.env.DSH_PK_PASSWORD ?? 'ALsCQ#zLF!phJ3#2'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

/* ---------------------------------------------------------------- HTTP 前置检查 */

async function httpJson(path, body, cookie) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  })
  let json = {}
  try { json = await response.json() } catch (e) { /* keep {} */ }
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : []
  return { status: response.status, json, cookie: setCookie.map(v => v.split(';')[0]).join('; ') }
}

// 1) 未认证不得访问通行密钥管理面
const anon = await httpJson('/auth/rpc/passkeyList', {})
check('未登录 passkeyList → 401', anon.status === 401, `status=${anon.status}`)

// 2) 登录页脚本匿名可取，且是 JS + 带 ETag
const scriptResponse = await fetch(`${base}/auth/passkey/browser.js`)
const scriptBody = await scriptResponse.text()
check('GET /auth/passkey/browser.js → 200 JS', scriptResponse.status === 200
  && (scriptResponse.headers.get('content-type') || '').includes('javascript'), `status=${scriptResponse.status}`)
check('登录页脚本含注册/登录入口且带 ETag', /startRegistration/.test(scriptBody) && /startAuthentication/.test(scriptBody)
  && (scriptResponse.headers.get('etag') || '').length > 0, `bytes=${scriptBody.length}`)
const cachedResponse = await fetch(`${base}/auth/passkey/browser.js`, { headers: { 'if-none-match': scriptResponse.headers.get('etag') } })
check('脚本条件请求 → 304', cachedResponse.status === 304, `status=${cachedResponse.status}`)

// 3) IP 字面量地址：服务端提前拒绝并给出可操作提示（浏览器根本无法在此地址完成仪式）
const ipLiteral = await (async () => {
  const port = new URL(base).port
  const response = await fetch(`http://127.0.0.1:${port}/auth/passkey/login/options`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })
  const json = await response.json().catch(() => ({}))
  return { status: response.status, json }
})()
check('IP 字面量地址取通行密钥选项 → 409 + ip-literal 提示',
  ipLiteral.status === 409 && ipLiteral.json.issue === 'ip-literal' && ipLiteral.json.suggestedHost === 'localhost',
  `status=${ipLiteral.status} issue=${ipLiteral.json.issue}`)

/* ---------------------------------------------------------------- 浏览器仪式 */

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1360, height: 900 } })
const pageErrors = []
let authenticatorId = ''
let page
let cdp

async function addVirtualAuthenticator(page) {
  const cdp = await page.createCDPSession()
  await cdp.send('WebAuthn.enable')
  const created = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  authenticatorId = created.authenticatorId
  return cdp
}

try {
  page = await browser.newPage()
  page.on('pageerror', error => pageErrors.push(String(error)))
  cdp = await addVirtualAuthenticator(page)

  // 4) 登录页出现通行密钥入口（localhost 可用）
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#u', { timeout: 15000 })
  check('登录页出现「使用通行密钥登录」按钮', await page.$('#pk') !== null)
  check('登录页加载了通行密钥浏览器端脚本', await page.evaluate(() => typeof window.SWA === 'object'))

  // 5) 密码登录（首次仍需密码：此时还没有任何通行密钥）
  await page.type('#u', username)
  await page.type('#p', password)
  await page.click('#b')
  await wait(3000)
  check('密码登录成功进入面板', !page.url().includes('/auth/login'), page.url())
  if (page.url().includes('/auth/login')) {
    console.log('提示：账号停留在「2FA 已开启 + 仅绑定通行密钥」状态时，密码登录需要一次通行密钥断言。')
    console.log('      请在重启隔离实例前删除其 .credentials.yaml（本脚本只应运行在隔离的一次性实例上）。')
  }

  // 6) 通行密钥管理面：环境可用 + 初始为空
  // 面板页本身不加载登录页脚本，这里显式注入（与登录页同一份产物）。
  // 任何一次整页跳转都会丢掉注入的脚本，因此每次用法前重新确认。
  const ensureSwa = async () => {
    if (await page.evaluate(() => typeof window.SWA === 'object')) return
    await page.addScriptTag({ url: `${base}/auth/passkey/browser.js` })
  }
  await ensureSwa()
  check('面板页注入通行密钥脚本后可用（window.SWA）', await page.evaluate(() => typeof window.SWA === 'object'))
  const initial = await page.evaluate(() => fetch('/auth/rpc/passkeyList', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }).then(r => r.json()))
  check('passkeyList 报告当前地址可用（rp.supported）', initial.ok === true && initial.rp && initial.rp.supported === true,
    JSON.stringify(initial.rp || {}))
  check('passkeyList 初始无通行密钥', Array.isArray(initial.passkeys) && initial.passkeys.length === 0,
    `count=${(initial.passkeys || []).length}`)

  // 7) 无票据的改动被拒（管理操作必须二次验证）
  const noTicket = await page.evaluate(() => fetch('/auth/rpc/passkeyAddOptions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preferred: 'localDevice' }),
  }).then(async r => ({ status: r.status, json: await r.json() })))
  check('无票据 passkeyAddOptions → 403', noTicket.status === 403, `status=${noTicket.status}`)

  // 8) 二次验证（密码即可：该账号未开启 2FA 且未绑定 TOTP）
  const stepUp = await page.evaluate(pw => fetch('/auth/rpc/passkeyStepUp', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }),
  }).then(async r => ({ status: r.status, json: await r.json() })), password)
  check('passkeyStepUp（密码）→ 一次性票据', stepUp.status === 200 && stepUp.json.ok === true && typeof stepUp.json.ticket === 'string',
    `mode=${stepUp.json.mode}`)

  // 9) 完整注册仪式：取选项 → 虚拟认证器生成凭据 → 服务端验签
  const registered = await page.evaluate(async (ticket) => {
    const options = await fetch('/auth/rpc/passkeyAddOptions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket, preferred: 'localDevice' }),
    }).then(r => r.json())
    if (options.ok !== true) return { stage: 'options', detail: options }
    const credential = await window.SWA.startRegistration({ optionsJSON: options.options })
    const verified = await fetch('/auth/rpc/passkeyAddVerify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket, handle: options.handle, response: credential, label: 'E2E 平台认证器' }),
    }).then(async r => ({ status: r.status, json: await r.json() }))
    return { stage: 'verify', ...verified, hints: options.options.hints, residentKey: options.options.authenticatorSelection && options.options.authenticatorSelection.residentKey }
  }, stepUp.json.ticket)
  check('注册通行密钥成功（residentKey=required + 用户验证）',
    registered.stage === 'verify' && registered.status === 200 && registered.json.ok === true && registered.residentKey === 'required',
    JSON.stringify(registered.json && registered.json.passkey ? { label: registered.json.passkey.label, deviceType: registered.json.passkey.deviceType } : registered))

  const afterAdd = await page.evaluate(() => fetch('/auth/rpc/passkeyList', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }).then(r => r.json()))
  check('passkeyList 显示 1 个通行密钥', afterAdd.passkeys && afterAdd.passkeys.length === 1,
    `labels=[${(afterAdd.passkeys || []).map(p => p.label).join(' | ')}]`)
  check('通行密钥元数据不含公钥（仅摘要）',
    afterAdd.passkeys && afterAdd.passkeys.length === 1 && afterAdd.passkeys[0].publicKey === undefined
    && typeof afterAdd.passkeys[0].id === 'string')

  // 10) 免用户名通行密钥登录（可发现凭据）：清 cookie 后仅用通行密钥进入
  const cookies = await page.cookies()
  for (const cookie of cookies) await page.deleteCookie(cookie)
  await page.goto(`${base}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#pk', { timeout: 15000 })
  await page.click('#pk')
  await wait(3500)
  check('免用户名通行密钥登录成功（可发现凭据）', !page.url().includes('/auth/login'), page.url())

  const afterLogin = await page.evaluate(() => fetch('/auth/rpc/passkeyList', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }).then(r => r.json()))
  check('通行密钥登录后记录最近使用时间',
    afterLogin.passkeys && afterLogin.passkeys.length === 1 && typeof afterLogin.passkeys[0].lastUsedAt === 'number',
    JSON.stringify((afterLogin.passkeys || [])[0] || {}))

  // 11) 认证器计数器随登录推进（复制检测的依据）
  const credentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
  check('认证器持有可发现凭据且计数已推进', credentials.credentials.length === 1
    && credentials.credentials[0].isResidentCredential === true && credentials.credentials[0].signCount >= 1,
    JSON.stringify(credentials.credentials.map(c => ({ rpId: c.rpId, signCount: c.signCount, resident: c.isResidentCredential }))))

  // 12) 反锁死：开启 2FA（此刻唯一因子是这个通行密钥）后不允许删除它
  const enabled2fa = await page.evaluate(() => fetch('/auth/rpc/totpSet2fa', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
  }).then(async r => ({ status: r.status, json: await r.json() })))
  check('仅有通行密钥的账号可以开启 2FA（无需先绑定 TOTP）', enabled2fa.status === 200 && enabled2fa.json.twoFactor === true,
    `status=${enabled2fa.status}`)

  const stepUp2fa = await page.evaluate(pw => fetch('/auth/rpc/passkeyStepUp', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }),
  }).then(async r => ({ status: r.status, json: await r.json() })), password)
  check('2FA 开启且未绑定 TOTP：二次验证要求密码 + 通行密钥断言',
    stepUp2fa.status === 200 && stepUp2fa.json.need === 'passkey' && stepUp2fa.json.options !== undefined,
    `need=${stepUp2fa.json.need}`)

  const stepUpAsserted = await (async () => {
    await ensureSwa()
    return page.evaluate(async (pw) => {
      const options = await fetch('/auth/rpc/passkeyStepUp', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }),
      }).then(r => r.json())
      const credential = await window.SWA.startAuthentication({ optionsJSON: options.options })
      return fetch('/auth/rpc/passkeyStepUp', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw, handle: options.handle, response: credential }),
      }).then(async r => ({ status: r.status, json: await r.json() }))
    }, password)
  })()
  check('密码 + 通行密钥断言通过二次验证并取得票据',
    stepUpAsserted.status === 200 && stepUpAsserted.json.ok === true && typeof stepUpAsserted.json.ticket === 'string',
    `mode=${stepUpAsserted.json.mode}`)

  const targetId = (afterLogin.passkeys || [])[0] ? afterLogin.passkeys[0].id : ''
  const blockedRemove = await page.evaluate((ticket, id) => fetch('/auth/rpc/passkeyRemove', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket, id }),
  }).then(async r => ({ status: r.status, json: await r.json() })), stepUpAsserted.json.ticket, targetId)
  check('反锁死：2FA 开启且仅剩一个通行密钥时删除被拒（400）',
    blockedRemove.status === 400 && /两步验证/.test(blockedRemove.json.error || ''), `status=${blockedRemove.status} error=${blockedRemove.json.error}`)

  // 13) 关闭 2FA 后可以删除，账号回到无因子状态（并保持可清理）
  const disabled2fa = await page.evaluate(() => fetch('/auth/rpc/totpSet2fa', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }),
  }).then(async r => ({ status: r.status, json: await r.json() })))
  check('可以关闭 2FA', disabled2fa.status === 200 && disabled2fa.json.twoFactor === false, `status=${disabled2fa.status}`)

  const stepUp3 = await page.evaluate(pw => fetch('/auth/rpc/passkeyStepUp', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }),
  }).then(r => r.json()), password)
  const removed = await page.evaluate((ticket, id) => fetch('/auth/rpc/passkeyRemove', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket, id }),
  }).then(async r => ({ status: r.status, json: await r.json() })), stepUp3.ticket, targetId)
  check('关闭 2FA 后删除最后一个通行密钥成功', removed.status === 200 && removed.json.ok === true, `status=${removed.status}`)

  const finalList = await page.evaluate(() => fetch('/auth/rpc/passkeyList', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }).then(r => r.json()))
  check('清理完成：账号无通行密钥且 2FA 关闭',
    (finalList.passkeys || []).length === 0 && finalList.twoFactor === false,
    `count=${(finalList.passkeys || []).length} twoFactor=${finalList.twoFactor}`)

  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
} finally {
  // 尽力清理：把账号恢复成「无通行密钥 + 2FA 关闭」，否则一次中断的失败会让
  // 下次运行卡在「2FA 已开启且只有已丢失的通行密钥」状态。
  if (page !== undefined) {
    try {
      const cleaned = await page.evaluate(async () => {
        const post = (p, b) => fetch(p, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}),
        }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }))
        const me = await post('/auth/rpc/me', {})
        if (me.json.ok !== true || !me.json.me) return 'no-session'
        await post('/auth/rpc/totpSet2fa', { enabled: false })
        const reset = await post('/auth/rpc/passkeyReset', { username: me.json.me.username })
        return `passkeys-removed=${reset.json.removed}`
      })
      console.log(`清理：${cleaned}`)
    } catch (error) {
      console.log(`清理跳过：${String(error && error.message)}`)
    }
    try { await page.close() } catch (error) { /* already gone */ }
  }
  await browser.close()
}

check('页面无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || 'none')

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail === 0 ? 0 : 1)
