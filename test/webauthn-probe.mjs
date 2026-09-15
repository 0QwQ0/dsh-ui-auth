/**
 * Standalone WebAuthn probe — development tool, deliberately NOT part of `npm test`.
 *
 * It answers the one question that decides how passkeys must be configured and documented
 * for this plugin: which relying-party identifiers Chrome actually accepts for the hosts
 * the panel is served on (`localhost`, `127.0.0.1`, and a real domain behind HTTPS).
 *
 * Findings recorded by this probe (Chrome 152 / Windows, CDP virtual authenticator):
 * - `localhost`   : registration, username-less (discoverable) login and counter advance
 *                   all succeed; the credential is stored as a resident credential.
 * - `127.0.0.1`   : Blink refuses the ceremony with
 *                   `SecurityError: 127.0.0.1 is an invalid domain`, because an IP literal
 *                   can never be an RP ID even though loopback is a secure context.
 *   Consequence: a panel opened at http://127.0.0.1:PORT cannot use passkeys; the user must
 *   open http://localhost:PORT instead. `assessRelyingParty()` fails fast with that hint.
 *
 * Run: node test/webauthn-probe.mjs   (build first: npm run build)
 */
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer'
import {
  assessRelyingParty,
  authenticationOptions,
  createChallengeStore,
  finishAuthentication,
  finishRegistration,
  newUserHandle,
  registrationOptions,
  resolveRelyingParty,
} from '../lib/webauthn.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

const state = {
  store: createChallengeStore(),
  userHandle: await newUserHandle(),
  passkeys: [],
}

/* ------------------------------------------------------------------ page assets */

const bundle = await build({
  stdin: { contents: "export * from '@simplewebauthn/browser'", resolveDir: root, loader: 'js' },
  bundle: true,
  format: 'iife',
  globalName: 'SWA',
  platform: 'browser',
  charset: 'utf8',
  write: false,
})
const browserJs = bundle.outputFiles[0].text

const appJs = `
window.__results = {}
window.__force = false
const post = async (p, body) => (await fetch(p + (window.__force ? '?force=1' : ''), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
})).json()
window.runRegister = async () => {
  try {
    const o = await post('/register/options', {})
    if (!o.ok) { window.__results.register = { ok: false, stage: 'server-options', issue: o.issue, error: o.error }; return }
    const cred = await SWA.startRegistration({ optionsJSON: o.options })
    window.__results.register = await post('/register/verify', { handle: o.handle, response: cred, label: 'probe device' })
  } catch (e) {
    window.__results.register = { ok: false, stage: 'browser', name: e && e.name, error: String((e && e.message) || e) }
  }
}
window.runLogin = async () => {
  try {
    const o = await post('/login/options', {})
    if (!o.ok) { window.__results.login = { ok: false, stage: 'server-options', issue: o.issue, error: o.error }; return }
    const cred = await SWA.startAuthentication({ optionsJSON: o.options })
    window.__results.login = await post('/login/verify', { handle: o.handle, response: cred })
  } catch (e) {
    window.__results.login = { ok: false, stage: 'browser', name: e && e.name, error: String((e && e.message) || e) }
  }
}
document.getElementById('register').onclick = () => window.runRegister()
document.getElementById('login').onclick = () => window.runLogin()
document.getElementById('env').textContent = JSON.stringify({
  secure: window.isSecureContext,
  api: typeof window.PublicKeyCredential !== 'undefined',
  platform: typeof window.PublicKeyCredential !== 'undefined'
    ? await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => null)
    : null,
})
`

const html = `<!doctype html><meta charset="utf-8"><title>webauthn probe</title>
<button id="register">register</button> <button id="login">login</button>
<pre id="env"></pre><script src="/browser.js"></script><script type="module" src="/app.js"></script>`

/* ------------------------------------------------------------------ server */

const json = (res, status, body) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return {}
  try { return JSON.parse(text) } catch { return {} }
}

/**
 * The relying party is derived per request exactly as the plugin does.
 * `?force=1` bypasses the guard on purpose, so the probe can capture the browser's own
 * rejection as evidence instead of the plugin's fail-fast message.
 */
function rpFor(req, force) {
  const host = req.headers.host
  if (!force) return resolveRelyingParty({ host, secure: false, rpName: 'dsh-ui-auth probe' })
  const hostname = new URL(`http://${host}`).hostname.toLowerCase()
  return { rpId: hostname, origin: `http://${host}`, rpName: 'dsh-ui-auth probe' }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://placeholder')
  const force = url.searchParams.get('force') === '1'

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
    return
  }
  if (req.method === 'GET' && url.pathname === '/browser.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
    res.end(browserJs)
    return
  }
  if (req.method === 'GET' && url.pathname === '/app.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    res.end(appJs)
    return
  }
  if (req.method === 'GET' && url.pathname === '/rp') {
    json(res, 200, assessRelyingParty({ host: req.headers.host, secure: false, rpName: 'dsh-ui-auth probe' }))
    return
  }
  if (req.method !== 'POST') { json(res, 404, { ok: false, error: 'not found' }); return }

  const rp = rpFor(req, force)
  if (rp === undefined) {
    const assessment = assessRelyingParty({ host: req.headers.host, secure: false })
    json(res, 409, { ok: false, issue: assessment.issue, suggestedHost: assessment.suggestedHost, error: 'no relying party for this host' })
    return
  }
  const body = await readBody(req)

  if (url.pathname === '/register/options') {
    const result = await registrationOptions({
      rp,
      store: state.store,
      username: 'probe',
      displayName: 'Probe User',
      userHandle: state.userHandle,
      existing: state.passkeys,
    })
    json(res, 200, result.ok ? { ok: true, options: result.value.options, handle: result.value.handle } : result)
    return
  }
  if (url.pathname === '/register/verify') {
    const result = await finishRegistration({
      rp,
      store: state.store,
      handle: body.handle,
      response: body.response,
      label: typeof body.label === 'string' ? body.label : 'probe device',
    })
    if (result.ok) state.passkeys.push(result.value)
    json(res, 200, result.ok ? { ok: true, passkey: result.value } : result)
    return
  }
  if (url.pathname === '/login/options') {
    // No allowCredentials: a discoverable-credential (username-less) login.
    const result = await authenticationOptions({ rp, store: state.store })
    json(res, 200, result.ok ? { ok: true, options: result.value.options, handle: result.value.handle } : result)
    return
  }
  if (url.pathname === '/login/verify') {
    const id = body.response && typeof body.response === 'object' ? body.response.id : undefined
    const stored = state.passkeys.find(passkey => passkey.id === id)
    if (stored === undefined) { json(res, 200, { ok: false, error: 'unknown credential' }); return }
    const result = await finishAuthentication({ rp, store: state.store, handle: body.handle, response: body.response, credential: stored })
    if (result.ok) {
      const previous = stored.counter
      stored.counter = result.value.newCounter
      stored.lastUsedAt = Date.now()
      json(res, 200, { ok: true, counter: { from: previous, to: result.value.newCounter }, deviceType: result.value.deviceType, backedUp: result.value.backedUp })
      return
    }
    json(res, 200, result)
    return
  }
  json(res, 404, { ok: false, error: 'not found' })
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

/* ------------------------------------------------------------------ browser */

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1024, height: 768 } })
const results = []

async function waitForResult(page, key, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await page.evaluate(k => window.__results[k], key)
    if (value !== undefined) return value
    if (Date.now() > deadline) return { ok: false, stage: 'timeout', error: `${key} did not settle` }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

const clearResult = (page, key) => page.evaluate(k => { delete window.__results[k] }, key)

async function probeHost(host) {
  const entry = { host, url: `http://${host}:${port}/` }
  entry.assessment = assessRelyingParty({ host: `${host}:${port}`, secure: false, rpName: 'dsh-ui-auth probe' })
  const page = await browser.newPage()
  const problems = []
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('favicon')) problems.push(`console: ${message.text()}`) })
  try {
    const cdp = await page.createCDPSession()
    await cdp.send('WebAuthn.enable')
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
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
    await page.goto(entry.url, { waitUntil: 'load' })
    entry.env = JSON.parse(await page.$eval('#env', node => node.textContent))
    state.passkeys.length = 0

    // 1. As the plugin behaves: the guard rejects an unusable host before any ceremony.
    await clearResult(page, 'register')
    await page.click('#register')
    entry.register = await waitForResult(page, 'register')
    if (entry.register.ok === true) {
      // 2. Only for a supported host: a username-less login, twice, to watch the counter.
      await clearResult(page, 'login')
      await page.click('#login')
      entry.login = await waitForResult(page, 'login')
      await clearResult(page, 'login')
      await page.click('#login')
      entry.loginSecond = await waitForResult(page, 'login')
    } else {
      // 2'. For an unusable host, bypass the guard once to record the browser's own refusal.
      await page.evaluate(() => { window.__force = true })
      await clearResult(page, 'register')
      await page.click('#register')
      entry.forcedRegister = await waitForResult(page, 'register')
      await page.evaluate(() => { window.__force = false })
    }

    const credentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
    entry.authenticatorCredentials = credentials.credentials.map(credential => ({
      credentialId: `${credential.credentialId.slice(0, 12)}…`,
      signCount: credential.signCount,
      isResidentCredential: credential.isResidentCredential,
      rpId: credential.rpId,
    }))
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
  } catch (error) {
    entry.fatal = String((error && error.message) || error)
  } finally {
    if (problems.length > 0) entry.problems = problems
    await page.close()
    results.push(entry)
  }
}

await probeHost('127.0.0.1')
await probeHost('localhost')

await browser.close()
server.close()

console.log(JSON.stringify(results, null, 2))

/**
 * `localhost` must work end to end. An IP literal must be refused by the guard (with a
 * usable hint) and, when forced, by the browser itself — that refusal is the finding.
 */
const verdict = results.map(entry => {
  const supported = entry.assessment.supported === true
  const ceremonies = entry.register && entry.register.ok === true
    && entry.login && entry.login.ok === true
    && entry.loginSecond && entry.loginSecond.ok === true
  const guarded = entry.register && entry.register.ok === false && entry.register.stage === 'server-options'
    && typeof entry.register.issue === 'string'
  const browserRefused = entry.forcedRegister && entry.forcedRegister.ok === false && entry.forcedRegister.stage === 'browser'
  if (supported) {
    return { host: entry.host, expected: 'usable', result: ceremonies ? 'PASS' : 'FAIL', detail: ceremonies ? undefined : entry.register }
  }
  return {
    host: entry.host,
    expected: 'unusable',
    result: guarded && browserRefused ? 'EXPECTED-REJECT' : 'FAIL',
    detail: guarded && browserRefused ? { issue: entry.register.issue, hint: entry.register.suggestedHost, browser: entry.forcedRegister.error } : entry.register,
  }
})

console.log('\n=== verdict ===')
for (const row of verdict) {
  console.log(`${row.host.padEnd(12)} expect=${row.expected.padEnd(8)} ${row.result}${row.detail ? '  ' + JSON.stringify(row.detail) : ''}`)
}
process.exitCode = verdict.every(row => row.result === 'PASS' || row.result === 'EXPECTED-REJECT') ? 0 : 1
