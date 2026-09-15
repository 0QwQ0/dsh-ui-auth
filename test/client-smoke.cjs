// Smoke test: load lib/client.js through a mock of the client module loader,
// then run apply() against mock ctxs to verify:
//   - the settings.section「用户管理」registration path,
//   - the models-page lock for non-admin users (priority -1, nav-hide rule),
//   - button text color uses the on-primary token (readability regression guard).
const fs = require('fs')
const path = require('path')

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

// 路径必须相对本文件解析：CI（GitHub Actions）上没有作者本机的绝对路径。
const code = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
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
  check('TOTP reminder once per session (sessionStorage gate + logout clear)', code.includes('dshua-totp-reminded') && code.includes('sessionStorage'))
  // 产物由 esbuild 生成，引号风格会被规范化（单引号→双引号），因此该断言不绑定引号风格。
check('2FA toggle is a switch (not checkbox)', /className: ['"]switch['"]/.test(code) && code.includes('dshua .switch input:checked + .track'))
  check('invite management card present (邀请码管理)', code.includes('邀请码管理（管理员）') && code.includes('inviteCreate') && code.includes('inviteList'))

  // ---- 通行密钥（Passkey，0.6.4）----
  check('Passkey card present (通行密钥)', code.includes('通行密钥（Passkey）') && code.includes('passkeyList') && code.includes('passkeyStepUp'))
  check('Passkey add flows: local device + phone QR', code.includes('本机通行密钥') && code.includes('手机扫码添加') && code.includes('localDevice') && code.includes('remoteDevice'))
  check('Passkey ceremonies use the community library (startRegistration/startAuthentication)',
    code.includes('startRegistration') && code.includes('startAuthentication') && code.includes('@simplewebauthn/browser'))
  check('Passkey step-up dialog present (改动登录因子前确认身份)', code.includes('确认身份') && code.includes('passkeyAddVerify') && code.includes('passkeyStepUp'))
  check('Passkey rename/remove wired', code.includes('passkeyRename') && code.includes('passkeyRemove') && code.includes('重命名') && code.includes('删除通行密钥'))
  check('Admin passkey recovery wired (清除通行密钥)', code.includes('passkeyReset') && code.includes('清除通行密钥'))
  check('Passkey origin hint surfaced (IP 字面量需改用 localhost)', code.includes('suggestedHost') && code.includes('无法使用通行密钥'))
  check('2FA switch label reflects the factor in use (动态码 / 通行密钥)', code.includes('登录需密码 + 动态码') && code.includes('登录需密码 + 通行密钥'))
  check('Passkey login reminder only when no factor exists', code.includes('passkeyCount') && code.includes('totpEnabled !== true'))

  console.log(failures === 0 ? '\nCLIENT BUNDLE SMOKE TEST PASSED' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
})()
