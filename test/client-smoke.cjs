// Smoke test: load lib/client.js through a mock of the client module loader,
// then run apply() against mock ctxs to verify:
//   - the settings.section「用户管理」registration path,
//   - the models-page lock for non-admin users (priority -1, nav-hide rule),
//   - button text color uses the on-primary token (readability regression guard).
const fs = require('fs')

const registrations = []
const mockReact = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
}

const window = {
  __ModuleLoader__: {
    load(reg) { registrations.push(reg) },
  },
}

const code = fs.readFileSync('F:/aura/pluginDev/dsh-ui-auth/lib/client.js', 'utf8')
new Function('window', code)(window)

if (registrations.length !== 1) {
  console.error('FAIL: expected exactly 1 __ModuleLoader__.load registration, got', registrations.length)
  process.exit(1)
}
const reg = registrations[0]
console.log('registration id:', reg.id)

const seed = new Map(Object.entries({ 'react': mockReact }))
const exp = reg.factory((spec) => {
  if (seed.has(spec)) return seed.get(spec)
  throw new Error('require("' + spec + '") missed the module table')
})

if (exp.name !== 'dsh-ui-auth' || typeof exp.apply !== 'function') {
  console.error('FAIL: bundle did not export the cordis plugin face')
  process.exit(1)
}

let failures = 0
function check(label, cond, extra) {
  if (cond) { console.log('PASS ' + label) } else { failures++; console.error('FAIL ' + label + (extra !== undefined ? ' :: ' + extra : '')) }
}

// ---- scenario helpers ----
function makeCtx() {
  const recorded = []
  const slots = {
    inject(key, cb) { cb() },
    register(opts, render) { recorded.push({ opts, render }) },
  }
  return {
    ctx: { get: (n) => (n === 'slots' ? slots : undefined) },
    recorded,
  }
}
function stubFetch(meJson) {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => meJson,
  })
}
const tick = () => new Promise((r) => setTimeout(r, 20))

// ---- 1) ADMIN: auth-users only, models lock NOT registered ----
;(async () => {
  stubFetch({ ok: true, me: { username: 'admin', role: 'admin' } })
  const s1 = makeCtx()
  exp.apply(s1.ctx)
  await tick()
  check('admin: auth-users registered', s1.recorded.some((r) => r.opts.id === 'auth-users'))
  check('admin: models lock NOT registered', !s1.recorded.some((r) => r.opts.id === 'models'))
  {
    const authReg = s1.recorded.find((r) => r.opts.id === 'auth-users')
    const inner = authReg.render().type()
    check('admin: auth-users renders dshua root', inner.props.className === 'dshua')
  }

  // ---- 2) USER: auth-users + models lock (priority -1) ----
  stubFetch({ ok: true, me: { username: 'test1', role: 'user' } })
  const s2 = makeCtx()
  exp.apply(s2.ctx)
  await tick()
  check('user: auth-users registered', s2.recorded.some((r) => r.opts.id === 'auth-users'))
  const modelsReg = s2.recorded.find((r) => r.opts.id === 'models')
  check('user: models lock registered', modelsReg !== undefined)
  if (modelsReg !== undefined) {
    check('user: models priority -1 (content winner)', modelsReg.opts.priority === -1, 'priority=' + modelsReg.opts.priority)
    check('user: models label', modelsReg.opts.label() === '模型')
    const texts = []
    const walk = (node) => {
      if (node === null || node === undefined) return
      if (typeof node === 'string') { texts.push(node); return }
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.props && node.props.children !== undefined) walk(node.props.children)
      if (Array.isArray(node.children)) node.children.forEach(walk)
    }
    walk(modelsReg.render().type())
    check('user: locked notice text present', texts.some((t) => t.includes('仅管理员可访问')), texts.join('|'))
  }

  // ---- 静态断言 ----
  check('nav-hide rule present (hides shipped models nav row)', code.includes('dsh-ui-auth-navhide') && code.includes('nth-child(2)'))
  check('button color uses on-primary token', code.includes('--dsw-alias-label-primary-foreground'))
  check('button no longer uses contrast-fill', !code.includes('--dsw-alias-button-contrast-fill'))
  check('danger button uses on-primary token', /\.dshua button\.danger\{[^}]*--dsw-alias-label-primary-foreground/.test(code))
  check('inputs use box-sizing:border-box (width stays inside container, equal side margins)', /\.dshua input, \.dshua select\{[^}]*box-sizing:border-box/.test(code))
  {
    const inputRule = (code.match(/\.dshua input, \.dshua select\{[^}]*\}/) || [''])[0]
    check('input rule: width 100% + padding + border-box (never exceeds parent right edge)', inputRule.includes('width:100%') && inputRule.includes('padding:8px 10px') && inputRule.includes('box-sizing:border-box'))
  }
  check('TOTP card present (两步验证)', code.includes('两步验证（TOTP）') && code.includes('totpGenerate') && code.includes('totpVerify'))
  check('TOTP QR image rendering present', code.includes('TOTP 二维码') && code.includes('tQrUrl') && code.includes('src: tQrUrl'))
  check('TOTP login reminder present (showTotpReminder)', code.includes('showTotpReminder') && code.includes('建议开启两步验证') && code.includes('totpIgnore'))
  check('invite management card present (邀请码管理)', code.includes('邀请码管理（管理员）') && code.includes('inviteCreate') && code.includes('inviteList'))

  console.log(failures === 0 ? '\nCLIENT BUNDLE SMOKE TEST PASSED' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
})()
