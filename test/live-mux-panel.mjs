// mux 修复后的面板回归检查（不入库）：面板是否仍"重新连接中"，初始化是否继续。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer'

const base = process.env.PROBE_URL ?? 'http://127.0.0.1:3204'
const bootstrap = process.env.DSH020_BOOTSTRAP ?? path.join(os.tmpdir(), 'dsh020', 'work', 'dsh-ui-auth-bootstrap.txt')
const adminPw = (/密码[:：]\s*(\S+)/.exec(fs.readFileSync(bootstrap, 'utf8')) ?? [])[1] ?? ''

const login = async (u, p) => {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }), redirect: 'manual' })
  return (r.headers.getSetCookie?.() ?? []).map(v => v.split(';')[0]).join('; ')
}
const rpc = async (cookie, method, body) => {
  const r = await fetch(`${base}/auth/rpc/${method}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  return r.status
}
const pairs = (header) => header.split(/;\s*/).filter(Boolean).map((pair) => {
  const i = pair.indexOf('=')
  return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1), domain: new URL(base).hostname, path: '/' }
})

const admin = await login('admin', adminPw)
const uname = 'panelprobe' + Date.now().toString(36)
await rpc(admin, 'createUser', { username: uname, password: 'Panel-Probe-1234!', role: 'user' })
const user = await login(uname, 'Panel-Probe-1234!')

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1280, height: 900 } })
const page = await browser.newPage()
const connLogs = []
const api = new Set()
page.on('console', (m) => { if (/connection lost|reconnect/i.test(m.text())) connLogs.push(m.text().slice(0, 70)) })
page.on('response', (r) => { if (r.url().includes('/api/')) api.add(r.url().replace(base, '').split('?')[0]) })
await page.setCookie(...pairs(user))
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 13000))
const text = await page.evaluate(() => (document.body.innerText.match(/重新连接[^\n]*/) ?? ['(无)'])[0])
console.log('  面板文案:', text)
console.log('  连接类日志:', connLogs.length, connLogs.slice(0, 2).join(' | '))
console.log('  /api 调用数:', api.size, [...api].slice(0, 6).join(', '))
if (process.env.DSH_PANEL_VERBOSE === '1') console.log('  全部 /api 调用:', [...api].sort().join(', '))
await browser.close()
await rpc(admin, 'deleteUser', { username: uname })
process.exit(text === '(无)' && connLogs.length === 0 ? 0 : 1)