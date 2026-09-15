		/**
		 * dsh-ui-auth 客户端源码 —— DSH 客户端模块契约 factory 函数体的 TypeScript 版本。
		 *
		 * 本文件是 lib/client.js（已构建产物）factory 体的逐行移植：只加类型标注，不改逻辑。
		 * 构建用 `node build/client.mjs`（esbuild 打成 CJS），
		 * `window.__ModuleLoader__.load({ id, factory })` 的 banner/footer 由构建脚本补上，
		 * 所以这里只有 factory 体。
		 *
		 * 刻意保持 CommonJS 形状（`exports.*` / `require('react')`）：factory 的 `require`
		 * 由 DSH 冻结模块表提供，React 不是全局变量；改成 ESM `import React from 'react'`
		 * 会改变互操作方式，也会破坏 test/client-smoke.cjs 用普通对象 mock `require('react')`
		 * 的既有约定。
		 */

		// —— 宿主（__ModuleLoader__ factory 形参）注入的 CommonJS 入口 ——
		declare const require: (id: string) => any
		declare const exports: Record<string, any>
		declare const module: { exports: Record<string, any> }

		// —— /auth/rpc/* 的 JSON 形状 ——
		/** 当前登录用户（`me` / `updateProfile` 应答里的 `me`）。 */
		interface MeInfo {
			username: string
			role: string
			displayName?: string | null
			email?: string | null
			totpEnabled?: boolean
			totpIgnore?: boolean
			twoFactor?: boolean
			passkeyCount?: number
		}
		/** 用户管理表格的一行（`listUsers`）。 */
		interface AuthUser {
			username: string
			role: string
			displayName?: string | null
			email?: string | null
			passkeyCount?: number
		}
		/** 一个已绑定的通行密钥（`passkeyList`；服务端不下发公钥）。 */
		interface PasskeySummary {
			id: string
			label: string
			createdAt: number
			lastUsedAt?: number
			deviceType?: string
			backedUp?: boolean
			transports?: string[]
		}
		/** 通行密钥环境（`passkeyList` 的 `rp`）：地址不可用时给出原因与建议地址。 */
		interface PasskeyRp {
			supported: boolean
			rpId?: string
			origin?: string
			issue?: string
			error?: string
			suggestedHost?: string
		}
		/** `passkeyList` 应答。 */
		interface PasskeyListResult {
			passkeys?: PasskeySummary[]
			twoFactor?: boolean
			totpBound?: boolean
			max?: number
			rp?: PasskeyRp
		}
		/** `passkeyStepUp` 应答：`need === 'passkey'` 表示还差一次通行密钥断言。 */
		interface PasskeyStepUpResult {
			need?: string
			ticket?: string
			mode?: string
			options?: unknown
			handle?: string
		}
		/** 通行密钥卡片状态（`passkeyList` 的本地视图）。 */
		interface PasskeyState {
			loaded: boolean
			list: PasskeySummary[]
			twoFactor: boolean
			totpBound: boolean
			max: number
			rp: PasskeyRp | null
		}
		/** 二次验证弹窗状态（添加/重命名/删除通行密钥前的强制确认）。 */
		interface StepUpState {
			open: boolean
			action: string
			id: string
			/** 注册时提交给服务端的设备名（添加/重命名共用）。 */
			label: string
			preferred: string
			need: string
			ticket: string
			busy: boolean
			error: string
		}
		/** 邀请码表格的一行（`inviteList`）。 */
		interface InviteRecord {
			code: string
			used: number
			total: number
			remaining: number
			createdBy: string
		}
		/** 两步验证开关状态（`totpStatus`；初始态不下发 `twoFactor`）。 */
		interface TotpState {
			enabled: boolean
			twoFactor?: boolean
			ignore: boolean
		}
		/** `/auth/rpc/*` 应答信封；各方法按需返回其中的字段。 */
		interface RpcResult {
			ok?: boolean
			error?: string
			me?: MeInfo
			users?: AuthUser[]
			invites?: InviteRecord[]
			totp?: TotpState
			secret?: string
			otpauth?: string
			qrDataUrl?: string | null
		}
		/** `me` 应答（该方法的 `me` 必定下发）。 */
		interface MeResult {
			me: MeInfo
		}
		/** `listUsers` 应答。 */
		interface UsersResult {
			users?: AuthUser[]
		}
		/** `inviteList` 应答。 */
		interface InvitesResult {
			invites?: InviteRecord[]
		}
		/** `totpStatus` 应答（该方法的 `totp` 必定下发）。 */
		interface TotpStatusResult {
			totp: TotpState
		}
		/** `totpGenerate` 应答。 */
		interface TotpGenerateResult {
			secret: string
			otpauth: string
			qrDataUrl?: string | null
		}
		/** `rpc()` 拒绝时抛出的错误：401 时带 `code: 'session-expired'`。 */
		interface CodedError {
			code?: string
			message?: string
		}
		/** React 受控输入的 change 事件（够用即可，避免引入 React 类型依赖）。 */
		interface ChangeEventLike {
			target: { value: string }
		}
		/** settings.section 注册项。 */
		interface SettingsSectionOptions {
			name: string
			id: string
			order: number
			priority?: number
			label: () => string
		}
		/** 客户端 slots 服务（本文件只用这两个方法）。 */
		interface SlotsService {
			inject(name: string, callback: () => void): void
			register(options: SettingsSectionOptions, render: () => unknown): unknown
		}
		/** Cordis 插件上下文（本文件只用 `ctx.get`）。 */
		interface PluginContext {
			get(name: 'slots'): SlotsService | undefined
			get(name: string): unknown
		}

		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		// 成熟社区库 @simplewebauthn/browser：注册/登录仪式全部交给它（base64url、
		// clientDataJSON、authenticatorData 等协议细节不自行实现）。与登录页共用的
		// lib/passkey-browser.js 是同一份依赖，行为一致。
		var SWA = require("@simplewebauthn/browser");

		// ============ 样式（手动注入 <style>，与动态运行时的 styles.insert 等价） ============
		var AUTH_CSS = [
			'.dshua{display:flex;flex-direction:column;gap:18px;padding:4px 2px 18px;max-width:720px;color:var(--dsw-alias-label-primary)}',
			'.dshua h2{margin:0 0 10px;font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary)}',
			'.dshua .card{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:18px 20px}',
			'.dshua .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
			'.dshua .grow{flex:1;min-width:180px}',
			'.dshua label{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin:10px 0 4px}',
			'.dshua input, .dshua select{padding:8px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font:inherit;outline:none;width:100%;box-sizing:border-box}',
			'.dshua input:focus, .dshua select:focus{border-color:var(--dsw-alias-brand-primary)}',
			'.dshua button{padding:8px 14px;border:0;border-radius:7px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-size:13px;font-weight:600;font:inherit;cursor:pointer}',
			'.dshua button:hover{background:var(--dsw-alias-button-primary-hover)}',
			'.dshua button.ghost{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
			'.dshua button.ghost:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-button-ghost-active-border)}',
			'.dshua button.danger{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground)}',
			'.dshua button.danger:hover{background:var(--dsw-alias-state-error-primary);opacity:.88}',
			'.dshua button:disabled{opacity:.55;cursor:default}',
			'.dshua .msg{font-size:13px;color:var(--dsw-alias-state-success-primary);min-height:16px}',
			'.dshua .err{font-size:13px;color:var(--dsw-alias-state-error-primary);min-height:16px}',
			'.dshua .meta{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-left:8px}',
			'.dshua table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;color:var(--dsw-alias-label-primary)}',
			'.dshua th, .dshua td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
			'.dshua th{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:600}',
			'.dshua .actions{display:flex;gap:6px}',
			'.dshua .badge{padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;display:inline-block}',
			'.dshua .badge.admin{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);color:var(--dsw-alias-brand-primary)}',
			'.dshua .badge.user{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			'.dshua .muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
			'.dshua .switch{position:relative;display:inline-flex;align-items:center;cursor:pointer;user-select:none;vertical-align:middle}',
			'.dshua .switch input{position:absolute;opacity:0;width:0;height:0}',
			'.dshua .switch .track{position:relative;width:40px;height:22px;border-radius:22px;background:var(--dsw-alias-interactive-bg-hover,#2a2f3a);transition:background .2s;flex-shrink:0}',
			'.dshua .switch .track .thumb{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s}',
			'.dshua .switch input:checked + .track{background:var(--dsw-alias-brand-primary,#4f7cff)}',
			'.dshua .switch input:checked + .track .thumb{transform:translateX(18px)}',
			'.dshua .switch input:disabled + .track{opacity:.55}',
		].join('')

		function injectAuthCss() {
			if (typeof document === "undefined") return
			if (document.querySelector("style[data-plugin-css=\"dsh-ui-auth\"]") !== null) return
			var tag = document.createElement("style")
			tag.dataset.plugin = "dsh-ui-auth"
			tag.dataset.pluginCss = "dsh-ui-auth"
			tag.textContent = AUTH_CSS
			document.head.appendChild(tag)
		}

		// ============ RPC（cookie 认证的 /auth/rpc/* 端点，服务器端按会话鉴权） ============
		/**
		 * 调用 `/auth/rpc/<method>`。应答是各方法自带的 JSON 信封，形状在调用点标注
		 * （MeResult / UsersResult / InvitesResult / TotpStatusResult / TotpGenerateResult）；
		 * 信封本身是 `RpcResult`，这里按 `any` 传递以保留调用点标注。
		 * 401 时先跳转登录页，再抛 code === 'session-expired' 的错误。
		 */
		function rpc(method: string, body: Record<string, unknown>): Promise<any> {
			return fetch('/auth/rpc/' + method, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body || {}),
			}).then(async (r) => {
				var j: RpcResult = {}
				try { j = await r.json() } catch (e) { /* keep {} */ }
				if (r.status === 401) {
					var p = encodeURIComponent(location.pathname + location.search)
					location.href = '/auth/login?next=' + p
					var err: CodedError = new Error('session-expired')
					err.code = 'session-expired'
					throw err
				}
				if (!r.ok || j.ok !== true) throw new Error(j.error || ('请求失败 (' + r.status + ')'))
				return j
			})
		}

		function roleLabel(role: string): string {
			return role === 'admin' ? '管理' : '用户'
		}

		// ============ 设置面板「用户管理」 ============
		function AuthUsersPage() {
			var _s = React.useState, _e = React.useEffect
			var meS = _s(null), me = meS[0], setMe = meS[1]
			var errS = _s(''), err = errS[0], setErr = errS[1]
			var msgS = _s(''), msg = msgS[0], setMsg = msgS[1]
			var busyS = _s(false), busy = busyS[0], setBusy = busyS[1]
			var pDisplayS = _s(''), pDisplay = pDisplayS[0], setPDisplay = pDisplayS[1]
			var pEmailS = _s(''), pEmail = pEmailS[0], setPEmail = pEmailS[1]
			var oldPwS = _s(''), oldPw = oldPwS[0], setOldPw = oldPwS[1]
			var newPwS = _s(''), newPw = newPwS[0], setNewPw = newPwS[1]
			var newPw2S = _s(''), newPw2 = newPw2S[0], setNewPw2 = newPw2S[1]
			var usersS = _s([]), users = usersS[0], setUsers = usersS[1]
			var cNameS = _s(''), cName = cNameS[0], setCName = cNameS[1]
			var cPwS = _s(''), cPw = cPwS[0], setCPw = cPwS[1]
			var cRoleS = _s('user'), cRole = cRoleS[0], setCRole = cRoleS[1]
			var cDisplayS = _s(''), cDisplay = cDisplayS[0], setCDisplay = cDisplayS[1]
			var cEmailS = _s(''), cEmail = cEmailS[0], setCEmail = cEmailS[1]
			var usersVersionS = _s(0), usersVersion = usersVersionS[0], setUsersVersion = usersVersionS[1]
			var invitesS = _s([]), invites = invitesS[0], setInvites = invitesS[1]
			var iAmountS = _s('1'), iAmount = iAmountS[0], setIAmount = iAmountS[1]
			var iUsesS = _s('1'), iUses = iUsesS[0], setIUses = iUsesS[1]
			var invitesVersionS = _s(0), invitesVersion = invitesVersionS[0], setInvitesVersion = invitesVersionS[1]
			var totpS = _s({ enabled: false, ignore: false }), totp = totpS[0], setTotp = totpS[1]
			var tSecretS = _s(''), tSecret = tSecretS[0], setTSecret = tSecretS[1]
			var tOtpAuthS = _s(''), tOtpAuth = tOtpAuthS[0], setTOtpAuth = tOtpAuthS[1]
			var tQrUrlS = _s(''), tQrUrl = tQrUrlS[0], setTQrUrl = tQrUrlS[1]
			var tCodeS = _s(''), tCode = tCodeS[0], setTCode = tCodeS[1]
			var tRmCodeS = _s(''), tRmCode = tRmCodeS[0], setTRmCode = tRmCodeS[1]
			// —— 通行密钥（Passkey）——
			var pkS = _s({ loaded: false, list: [] as PasskeySummary[], twoFactor: false, totpBound: false, max: 20, rp: null as PasskeyRp | null })
			var pk = pkS[0] as PasskeyState
			var setPk = pkS[1] as (next: PasskeyState | ((prev: PasskeyState) => PasskeyState)) => void
			var pkNameS = _s(''), pkName = pkNameS[0], setPkName = pkNameS[1]
			// 二次验证弹窗：任何会改变账号因子的操作（添加/重命名/删除通行密钥）都要先过它
			var suS = _s({ open: false, action: '', id: '', preferred: '', need: '', ticket: '', busy: false, error: '' })
			var su = suS[0] as StepUpState
			var setSu = suS[1] as (next: StepUpState | ((prev: StepUpState) => StepUpState)) => void
			var suPwS = _s(''), suPw = suPwS[0], setSuPw = suPwS[1]
			var suCodeS = _s(''), suCode = suCodeS[0], setSuCode = suCodeS[1]

			var isAdmin = me !== null && me.role === 'admin'

			_e(function () {
				var cancelled = false
				rpc('me', {}).then(function (j: MeResult) {
					if (cancelled) return
					setMe(j.me)
					setPDisplay(j.me.displayName || '')
					setPEmail(j.me.email || '')
				}).catch(function (e: CodedError) {
					if (e.code !== 'session-expired' && !cancelled) setErr(e.message)
				})
				return function () { cancelled = true }
			}, [])

			_e(function () {
				if (!isAdmin) return
				var cancelled = false
				rpc('listUsers', {}).then(function (j: UsersResult) {
					if (!cancelled) setUsers(j.users || [])
				}).catch(function (e: CodedError) {
					if (e.code !== 'session-expired' && !cancelled) setErr(e.message)
				})
				return function () { cancelled = true }
			}, [isAdmin, usersVersion])

			function refreshUsers() { setUsersVersion(function (v: number) { return v + 1 }) }

			_e(function () {
				if (!isAdmin) return
				var cancelled = false
				rpc('inviteList', {}).then(function (j: InvitesResult) {
					if (!cancelled) setInvites(j.invites || [])
				}).catch(function (e: CodedError) {
					if (e.code !== 'session-expired' && !cancelled) setErr(e.message)
				})
				return function () { cancelled = true }
			}, [isAdmin, invitesVersion])

			function refreshInvites() { setInvitesVersion(function (v: number) { return v + 1 }) }

			function createInvites() {
				var amount = parseInt(iAmount, 10)
				var uses = parseInt(iUses, 10)
				if (!(amount >= 1 && amount <= 50)) { setErr('生成数量需为 1-50'); return }
				if (!(uses >= 1 && uses <= 100)) { setErr('每个邀请码可用次数需为 1-100'); return }
				run(function () { return rpc('inviteCreate', { amount: amount, uses: uses }).then(refreshInvites) }, '邀请码已生成')
			}

			function revokeInvite(code: string) {
				if (!window.confirm('撤销邀请码「' + code + '」？已注册用户不受影响。')) return
				run(function () { return rpc('inviteRevoke', { code: code }).then(refreshInvites) }, '邀请码已撤销')
			}

			_e(function () {
				var cancelled = false
				rpc('totpStatus', {}).then(function (j: TotpStatusResult) {
					if (!cancelled) setTotp({ enabled: j.totp.enabled === true, twoFactor: j.totp.twoFactor === true, ignore: j.totp.ignore === true })
				}).catch(function (e: CodedError) {
					if (e.code !== 'session-expired' && !cancelled) setErr(e.message)
				})
				return function () { cancelled = true }
			}, [me === null ? null : me.username])

			_e(function () {
				var cancelled = false
				rpc('passkeyList', {}).then(function (j: PasskeyListResult) {
					if (cancelled) return
					setPk({
						loaded: true,
						list: j.passkeys || [],
						twoFactor: j.twoFactor === true,
						totpBound: j.totpBound === true,
						max: typeof j.max === 'number' ? j.max : 20,
						rp: j.rp || null,
					})
				}).catch(function (e: CodedError) {
					if (e.code !== 'session-expired' && !cancelled) setErr(e.message)
				})
				return function () { cancelled = true }
			}, [me === null ? null : me.username])

			function refreshTotp() {
				rpc('totpStatus', {}).then(function (j: TotpStatusResult) {
					setTotp({ enabled: j.totp.enabled === true, twoFactor: j.totp.twoFactor === true, ignore: j.totp.ignore === true })
					if (j.totp.enabled === true) { setTSecret(''); setTOtpAuth('') }
				}).catch(function (e: CodedError) { if (e.code !== 'session-expired') setErr(e.message) })
			}

			function toggle2fa() {
				var turningOn = totp.twoFactor !== true
				var onMsg = totp.enabled
					? '已启用两步验证（登录需密码 + 动态码）'
					: '已启用两步验证（登录需密码 + 通行密钥）'
				run(function () { return rpc('totpSet2fa', { enabled: turningOn }).then(function () { refreshTotp(); refreshPk() }) },
					turningOn ? onMsg : '已关闭两步验证（登录仅需密码，通行密钥仍可直接登录）')
			}

			function genTotp() {
				run(function () {
					return rpc('totpGenerate', {}).then(function (j: TotpGenerateResult) {
						setTSecret(j.secret); setTOtpAuth(j.otpauth); setTQrUrl(j.qrDataUrl || ''); setTCode('')
						refreshTotp()
					})
				}, 'TOTP 密钥已生成，请用验证器扫码或手动输入后输入 6 位动态码启用')
			}

			function enableTotp() {
				if (!/^\d{6}$/.test(tCode)) { setErr('请输入 6 位动态验证码'); return }
				run(function () { return rpc('totpVerify', { code: tCode }).then(refreshTotp) }, 'TOTP 已启用')
			}

			function removeTotp() {
				var confirmText = pk.list.length > 0
					? '确定移除 TOTP 令牌？移除后两步验证将由通行密钥完成（登录需「密码 + 通行密钥」）。'
					: '确定移除 TOTP 令牌？移除后两步验证会自动关闭，登录仅需密码。'
				if (!window.confirm(confirmText)) return
				if (!/^\d{6}$/.test(tRmCode)) { setErr('请输入当前 6 位动态验证码以确认移除'); return }
				run(function () {
					return rpc('totpRemove', { code: tRmCode }).then(function () { setTRmCode(''); refreshTotp(); refreshPk() })
				}, 'TOTP 已移除')
			}

			function toggleIgnore() {
				run(function () { return rpc('totpIgnore', { ignore: !totp.ignore }).then(refreshTotp) }, totp.ignore ? '已取消永久忽略' : '已永久忽略登录提醒')
			}

			// ============ 通行密钥（Passkey） ============
			// 添加/重命名/删除都会改变账号的登录因子，因此每一步都要先通过二次验证
			// （passkeyStepUp）：密码 + TOTP，或密码 + 一次已有通行密钥断言。

			function suClosed() {
				return { open: false, action: '', id: '', label: '', preferred: '', need: '', ticket: '', busy: false, error: '' }
			}

			function refreshPk() {
				rpc('passkeyList', {}).then(function (j: PasskeyListResult) {
					setPk({
						loaded: true,
						list: j.passkeys || [],
						twoFactor: j.twoFactor === true,
						totpBound: j.totpBound === true,
						max: typeof j.max === 'number' ? j.max : 20,
						rp: j.rp || null,
					})
				}).catch(function (e: CodedError) { if (e.code !== 'session-expired') setErr(e.message) })
			}

			function askStepUp(action: string, id: string, preferred: string, label: string) {
				setSuPw(''); setSuCode(''); setErr(''); setMsg('')
				setSu({ open: true, action: action, id: id, label: label, preferred: preferred, need: '', ticket: '', busy: false, error: '' })
			}

			function stepUpError(e: CodedError) {
				setSu(function (s) { return { ...s, busy: false, error: (e && e.message) ? e.message : '验证未完成' } })
			}

			/** 二次验证通过后执行真正的动作（ticket 为服务端签发的一次性票据）。 */
			function finishStepUp(ticket: string) {
				var action = su.action
				if (action === 'add') {
					return rpc('passkeyAddOptions', { ticket: ticket, preferred: su.preferred }).then(function (j: any) {
						if (typeof window.PublicKeyCredential === 'undefined') throw new Error('当前浏览器不支持通行密钥')
						return SWA.startRegistration({ optionsJSON: j.options }).then(function (cred: unknown) {
							return rpc('passkeyAddVerify', { ticket: ticket, handle: j.handle, response: cred, label: su.label })
						})
					}).then(function () {
						setSu(suClosed()); setMsg('通行密钥已添加'); refreshPk(); refreshTotp()
					}).catch(stepUpError)
				}
				if (action === 'rename') {
					return rpc('passkeyRename', { ticket: ticket, id: su.id, label: su.label }).then(function () {
						setSu(suClosed()); setMsg('通行密钥已重命名'); refreshPk()
					}).catch(stepUpError)
				}
				if (action === 'remove') {
					return rpc('passkeyRemove', { ticket: ticket, id: su.id }).then(function () {
						setSu(suClosed()); setMsg('通行密钥已删除'); refreshPk(); refreshTotp()
					}).catch(stepUpError)
				}
				setSu(suClosed())
				return undefined
			}

			function submitStepUp() {
				if (suPw === '') { setSu(function (s) { return { ...s, error: '请输入当前密码' } }); return }
				var password = suPw
				var code = suCode
				var base: Record<string, unknown> = { password: password }
				// 2FA 且已绑定 TOTP：第二步是动态码；仅绑定通行密钥时服务端会要求断言
				if (pk.twoFactor && pk.totpBound) base.totp = code
				setSu(function (s) { return { ...s, busy: true, error: '' } })
				rpc('passkeyStepUp', base).then(function (j: PasskeyStepUpResult) {
					if (j.need !== 'passkey') return finishStepUp(j.ticket || '')
					if (typeof window.PublicKeyCredential === 'undefined') throw new Error('当前浏览器不支持通行密钥')
					return SWA.startAuthentication({ optionsJSON: j.options }).then(function (cred: unknown) {
						var again: Record<string, unknown> = { password: password, handle: j.handle, response: cred }
						if (pk.twoFactor && pk.totpBound) again.totp = code
						return rpc('passkeyStepUp', again).then(function (j2: PasskeyStepUpResult) { return finishStepUp(j2.ticket || '') })
					})
				}).catch(stepUpError)
			}

			function removePasskey(p: PasskeySummary) {
				if (!window.confirm('删除通行密钥「' + p.label + '」？删除后该设备将无法再用它登录。')) return
				askStepUp('remove', p.id, '', '')
			}

			function renamePasskey(p: PasskeySummary) {
				var next = window.prompt('为这个通行密钥设置新名称：', p.label)
				if (next === null) return
				askStepUp('rename', p.id, '', next.slice(0, 40))
			}

			function passkeyLabel(p: PasskeySummary) {
				var kind = p.deviceType === 'multiDevice' ? '可同步' : '仅此设备'
				var used = typeof p.lastUsedAt === 'number' && p.lastUsedAt > 0
					? new Date(p.lastUsedAt).toLocaleString()
					: '未使用'
				return kind + ' · 最近使用：' + used
			}

			/** 二次验证弹窗（改动登录因子前的强制确认）。 */
			function renderStepUp() {
				if (!su.open) return null
				var needTotp = pk.twoFactor && pk.totpBound
				var title = su.action === 'add' ? '添加通行密钥' : su.action === 'rename' ? '重命名通行密钥' : '删除通行密钥'
				return React.createElement('div', {
					style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2147483000 },
				},
					React.createElement('div', { className: 'card', style: { width: 420, maxWidth: 'calc(100vw - 40px)', margin: 0 } },
						React.createElement('h2', null, '确认身份 · ' + title),
						React.createElement('div', { className: 'muted', style: { marginBottom: 4 } },
							'通行密钥可以代替密码登录，因此改动前必须确认是你本人。'),
						React.createElement('label', null, '当前密码'),
						React.createElement('input', { type: 'password', value: suPw, onChange: function (e: ChangeEventLike) { setSuPw(e.target.value) }, autoComplete: 'current-password' }),
						needTotp
							? React.createElement('div', null,
								React.createElement('label', null, '动态码（6 位）'),
								React.createElement('input', { value: suCode, onChange: function (e: ChangeEventLike) { setSuCode(e.target.value) }, maxLength: 6, placeholder: '6 位动态码' }))
							: null,
						pk.twoFactor && !pk.totpBound
							? React.createElement('div', { className: 'muted', style: { marginTop: 8 } },
								'该账号的第二步验证是通行密钥：提交密码后会再要求你完成一次通行密钥验证。')
							: null,
						su.error !== '' ? React.createElement('div', { className: 'err' }, su.error) : null,
						React.createElement('div', { className: 'row', style: { marginTop: 14 } },
							React.createElement('button', { onClick: submitStepUp, disabled: su.busy }, su.busy ? '验证中…' : '确认'),
							React.createElement('button', { className: 'ghost', onClick: function () { setSu(suClosed()); setSuPw(''); setSuCode('') }, disabled: su.busy }, '取消')),
					))
			}

			function run(task: () => unknown, okMsg?: string) {
				setBusy(true); setErr(''); setMsg('')
				Promise.resolve().then(task).then(function () {
					if (okMsg) setMsg(okMsg)
				}).catch(function (e: CodedError) {
					if (e.code !== 'session-expired') setErr(e.message)
				}).finally(function () { setBusy(false) })
			}

			function saveProfile() {
				run(function () { return rpc('updateProfile', { displayName: pDisplay, email: pEmail }).then(function (j: MeResult) { setMe(j.me) }) }, '个人信息已保存')
			}

			function changePassword() {
				if (newPw.length < 8) { setErr('新密码至少 8 位且含两种及以上字符类型（大小写字母/数字/符号）'); return }
				if (newPw !== newPw2) { setErr('两次输入的新密码不一致'); return }
				run(function () {
					return rpc('changePassword', { oldPassword: oldPw, newPassword: newPw }).then(function () {
						setOldPw(''); setNewPw(''); setNewPw2('')
					})
				}, '密码已修改（其他设备上的登录已失效）')
			}

			function createUser() {
				if (!/^[A-Za-z0-9_.-]{2,32}$/.test(cName)) { setErr('用户名仅允许 2-32 位字母、数字、下划线、点或短横线'); return }
				if (cPw.length < 8) { setErr('初始密码至少 8 位且含两种及以上字符类型'); return }
				run(function () {
					return rpc('createUser', { username: cName, password: cPw, role: cRole, displayName: cDisplay, email: cEmail }).then(function () {
						setCName(''); setCPw(''); setCRole('user'); setCDisplay(''); setCEmail('')
						refreshUsers()
					})
				}, '用户已创建')
			}

			function deleteUser(u: AuthUser) {
				if (!window.confirm('确定删除用户「' + u.username + '」？该操作不可撤销。')) return
				run(function () { return rpc('deleteUser', { username: u.username }).then(refreshUsers) }, '用户已删除')
			}

			function resetPassword(u: AuthUser) {
				var pw = window.prompt('为用户「' + u.username + '」设置新密码（至少 8 位，含两种字符类型）：')
				if (pw === null) return
				if (pw.length < 8) { setErr('新密码至少 8 位且含两种及以上字符类型（大小写字母/数字/符号）'); return }
				run(function () { return rpc('resetPassword', { username: u.username, newPassword: pw }).then(refreshUsers) }, '密码已重置')
			}

			function resetPasskeys(u: AuthUser) {
				if (!window.confirm('清除用户「' + u.username + '」的全部通行密钥？该用户将无法再用通行密钥登录（用于设备丢失时的账号救援）。')) return
				run(function () { return rpc('passkeyReset', { username: u.username }).then(refreshUsers) }, '该用户的通行密钥已清除')
			}

			function toggleRole(u: AuthUser) {
				var next = u.role === 'admin' ? 'user' : 'admin'
				if (!window.confirm('将「' + u.username + '」的角色改为「' + roleLabel(next) + '」？')) return
				run(function () { return rpc('setRole', { username: u.username, role: next }).then(refreshUsers) }, '角色已更新')
			}

			function logout() {
				try { sessionStorage.removeItem('dshua-totp-reminded') } catch (e) { /* ignore */ }
				fetch('/auth/logout', { method: 'POST' }).then(function () {
					location.href = '/auth/login'
				}).catch(function () { location.href = '/auth/login' })
			}

			if (me === null && err === '') {
				return React.createElement('div', { className: 'dshua' }, React.createElement('div', null, '加载中…'))
			}
			if (me === null) {
				return React.createElement('div', { className: 'dshua' }, React.createElement('div', { className: 'err' }, err))
			}

			var cards = []

			cards.push(React.createElement('div', { className: 'card', key: 'profile' },
				React.createElement('h2', null, '我的账号'),
				React.createElement('div', { className: 'meta' }, '当前登录：' + me.username + '（' + roleLabel(me.role) + '）'),
				React.createElement('label', null, '昵称（显示名）'),
				React.createElement('input', { value: pDisplay, onChange: function (e: ChangeEventLike) { setPDisplay(e.target.value) }, maxLength: 60 }),
				React.createElement('label', null, '邮箱'),
				React.createElement('input', { value: pEmail, onChange: function (e: ChangeEventLike) { setPEmail(e.target.value) }, maxLength: 120 }),
				React.createElement('div', { className: 'row', style: { marginTop: 12 } },
					React.createElement('button', { onClick: saveProfile, disabled: busy }, '保存个人信息'),
					React.createElement('button', { className: 'ghost', onClick: logout }, '退出登录')),
			))

			cards.push(React.createElement('div', { className: 'card', key: 'password' },
				React.createElement('h2', null, '修改密码'),
				React.createElement('label', null, '当前密码'),
				React.createElement('input', { type: 'password', value: oldPw, onChange: function (e: ChangeEventLike) { setOldPw(e.target.value) }, autoComplete: 'current-password' }),
				React.createElement('label', null, '新密码（至少 8 位，含两种字符类型）'),
				React.createElement('input', { type: 'password', value: newPw, onChange: function (e: ChangeEventLike) { setNewPw(e.target.value) }, autoComplete: 'new-password' }),
				React.createElement('label', null, '确认新密码'),
				React.createElement('input', { type: 'password', value: newPw2, onChange: function (e: ChangeEventLike) { setNewPw2(e.target.value) }, autoComplete: 'new-password' }),
				React.createElement('div', { className: 'row', style: { marginTop: 12 } },
					React.createElement('button', { onClick: changePassword, disabled: busy }, '修改密码')),
			))

			// TOTP 绑定流程（未绑定 TOTP 时展示；已绑定 TOTP 且只想要通行密钥的用户也仍可在此补绑）
			var totpSetup = tSecret === ''
				? React.createElement('div', null,
					React.createElement('div', { className: 'muted', style: { marginBottom: 8 } },
						'使用 Google Authenticator / Microsoft Authenticator 等应用，通过 otpauth 链接或手动输入密钥添加本账号；启用后每次登录输入 6 位动态码。'),
					React.createElement('button', { onClick: genTotp, disabled: busy }, '生成 TOTP 密钥'),
				)
				: React.createElement('div', null,
					React.createElement('label', null, '用验证器扫描二维码添加（Google Authenticator / Microsoft Authenticator 等）'),
					tQrUrl !== ''
						? React.createElement('img', { src: tQrUrl, alt: 'TOTP 二维码', style: { display: 'block', width: 200, height: 200, borderRadius: 8, background: '#fff', padding: 6, marginBottom: 6 } })
						: null,
					React.createElement('label', null, '密钥（无法扫码时手动输入）'),
					React.createElement('code', { style: { display: 'block', padding: '10px', borderRadius: 7, background: 'var(--dsw-alias-bg-layer-1)', wordBreak: 'break-all' } }, tSecret),
					React.createElement('label', null, 'otpauth 链接'),
					React.createElement('code', { style: { display: 'block', padding: '10px', borderRadius: 7, background: 'var(--dsw-alias-bg-layer-1)', wordBreak: 'break-all', fontSize: 12 } }, tOtpAuth),
					React.createElement('label', null, '输入验证器中的 6 位动态码以启用'),
					React.createElement('input', { value: tCode, onChange: function (e: ChangeEventLike) { setTCode(e.target.value) }, placeholder: '6 位动态码', maxLength: 6 }),
					React.createElement('div', { className: 'row', style: { marginTop: 12 } },
						React.createElement('button', { onClick: enableTotp, disabled: busy }, '启用 TOTP'),
						React.createElement('button', { className: 'ghost', onClick: function () { setTSecret(''); setTOtpAuth(''); setTQrUrl(''); setTCode('') }, disabled: busy }, '取消')),
				)

			// 两步验证开关：只要账号还有任一因子（TOTP 或通行密钥）就显示，
			// 否则「先关闭两步验证」在只剩通行密钥的账号上会无从操作。
			var hasFactor = totp.enabled || pk.list.length > 0
			var factorText = totp.twoFactor
				? (totp.enabled ? '已启用两步验证（登录需密码 + 动态码）' : '已启用两步验证（登录需密码 + 通行密钥）')
				: '未启用两步验证（登录仅需密码）'

			cards.push(React.createElement('div', { className: 'card', key: 'totp' },
				React.createElement('h2', null, totp.enabled ? '两步验证（TOTP）' : '两步验证'),
				React.createElement('div', null,
					totp.enabled
						? React.createElement('span', { className: 'badge admin' }, '已绑定 TOTP')
						: React.createElement('span', { className: 'badge user' }, '未绑定 TOTP'),
					pk.list.length > 0
						? React.createElement('span', { className: 'badge admin' }, '通行密钥 ' + pk.list.length + ' 个')
						: null,
					totp.ignore ? React.createElement('span', { className: 'meta' }, '（已永久忽略登录提醒）') : null,
				),
				hasFactor
					? React.createElement('div', null,
						React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' } },
							React.createElement('label', { className: 'switch' },
								React.createElement('input', { type: 'checkbox', checked: totp.twoFactor === true, onChange: toggle2fa, disabled: busy }),
								React.createElement('span', { className: 'track' }, React.createElement('span', { className: 'thumb' })),
							),
							React.createElement('label', { style: { cursor: 'pointer', margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, factorText),
						),
						React.createElement('div', { className: 'muted', style: { marginBottom: 6 } },
							totp.twoFactor
								? '关闭后仅凭密码即可登录（通行密钥仍可直接登录）；开启状态下改动通行密钥需要先通过二次验证。'
								: '开启后登录需要第二个因子：已绑定 TOTP 时用动态码，否则用通行密钥。'),
						totp.enabled
							? React.createElement('div', null,
								React.createElement('label', null, '移除令牌需输入当前 6 位动态码'),
								React.createElement('input', { value: tRmCode, onChange: function (e: ChangeEventLike) { setTRmCode(e.target.value) }, placeholder: '6 位动态码', maxLength: 6 }),
								React.createElement('div', { className: 'row', style: { marginTop: 12 } },
									React.createElement('button', { className: 'danger', onClick: removeTotp, disabled: busy }, '移除 TOTP'),
									React.createElement('button', { className: 'ghost', onClick: toggleIgnore, disabled: busy }, totp.ignore ? '取消永久忽略' : '永久忽略登录提醒')))
							: React.createElement('div', null,
								React.createElement('div', { className: 'muted', style: { marginBottom: 8 } },
									'当前账号没有 TOTP 令牌，两步验证由通行密钥完成。如需改用动态码，可在下方生成并绑定 TOTP。'),
								totpSetup),
					)
					: totpSetup,
			))

			// —— 通行密钥卡片 ——
			var pkSupported = pk.rp !== null && pk.rp.supported === true
			var pkPort = ''
			try { pkPort = location.port !== '' ? ':' + location.port : '' } catch (e) { /* ignore */ }
			cards.push(React.createElement('div', { className: 'card', key: 'passkey' },
				React.createElement('h2', null, '通行密钥（Passkey）'),
				React.createElement('div', null,
					pk.list.length > 0
						? React.createElement('span', { className: 'badge admin' }, '已绑定 ' + pk.list.length + ' 个')
						: React.createElement('span', { className: 'badge user' }, '未绑定'),
					pk.twoFactor ? React.createElement('span', { className: 'meta' }, '两步验证已开启') : null,
					pk.list.length >= pk.max ? React.createElement('span', { className: 'meta' }, '已达上限 ' + pk.max + ' 个') : null,
				),
				!pk.loaded
					? React.createElement('div', { className: 'muted', style: { marginTop: 8 } }, '加载中…')
					: null,
				pk.loaded && !pkSupported
					? React.createElement('div', { className: 'err', style: { marginTop: 8 } },
						(pk.rp !== null && pk.rp.error ? pk.rp.error : '当前访问地址无法使用通行密钥。') +
						(pk.rp !== null && pk.rp.suggestedHost ? '请改用 http://' + pk.rp.suggestedHost + pkPort + ' 打开面板后再试。' : ''))
					: null,
				pk.loaded && pkSupported
					? React.createElement('div', { className: 'muted', style: { marginTop: 8 } },
						'用指纹 / 面容 / 设备 PIN 代替密码登录。私钥永不离开设备，服务器只保存公钥；一个账号可以绑定多个（本机设备、多台手机）。')
					: null,
				pk.loaded && pkSupported && pk.list.length > 0
					? React.createElement('table', null,
						React.createElement('thead', null,
							React.createElement('tr', null,
								React.createElement('th', null, '名称'),
								React.createElement('th', null, '类型'),
								React.createElement('th', null, '操作'),
							)),
						React.createElement('tbody', null,
							pk.list.map(function (p: PasskeySummary) {
								return React.createElement('tr', { key: p.id },
									React.createElement('td', null, p.label,
										p.backedUp ? React.createElement('span', { className: 'meta' }, '已备份') : null),
									React.createElement('td', null, React.createElement('span', { className: 'muted' }, passkeyLabel(p))),
									React.createElement('td', null,
										React.createElement('div', { className: 'actions' },
											React.createElement('button', { className: 'ghost', onClick: function () { renamePasskey(p) }, disabled: busy || su.busy }, '重命名'),
											React.createElement('button', { className: 'danger', onClick: function () { removePasskey(p) }, disabled: busy || su.busy }, '删除'))),
								)
							}),
						),
					)
					: null,
				pk.loaded && pkSupported && pk.list.length < pk.max
					? React.createElement('div', null,
						React.createElement('label', null, '名称（可选，便于区分设备）'),
						React.createElement('input', { value: pkName, onChange: function (e: ChangeEventLike) { setPkName(e.target.value) }, maxLength: 40, placeholder: '例如：我的笔记本 / iPhone' }),
						React.createElement('div', { className: 'row', style: { marginTop: 12 } },
							React.createElement('button', { onClick: function () { askStepUp('add', '', 'localDevice', pkName) }, disabled: busy || su.busy }, '＋ 本机通行密钥'),
							React.createElement('button', { className: 'ghost', onClick: function () { askStepUp('add', '', 'remoteDevice', pkName) }, disabled: busy || su.busy }, '📱 手机扫码添加')),
						React.createElement('div', { className: 'muted', style: { marginTop: 8 } },
							'「本机通行密钥」使用这台电脑的指纹 / 面容 / Windows Hello；「手机扫码添加」由浏览器显示二维码，用手机相机扫码后在本机完成绑定（手机无需与电脑处于同一网络）。'))
					: null,
			))

			if (isAdmin) {
				cards.push(React.createElement('div', { className: 'card', key: 'admin' },
					React.createElement('h2', null, '用户管理（管理员）'),
					React.createElement('label', null, '新增用户：用户名'),
					React.createElement('input', { value: cName, onChange: function (e: ChangeEventLike) { setCName(e.target.value) }, placeholder: '2-32 位字母、数字、_ . -', maxLength: 32 }),
					React.createElement('label', null, '初始密码（至少 8 位，含两种字符类型）'),
					React.createElement('input', { type: 'password', value: cPw, onChange: function (e: ChangeEventLike) { setCPw(e.target.value) }, placeholder: '密码仅本次设置，之后无法查看' }),
					React.createElement('div', { className: 'row' },
						React.createElement('div', { className: 'grow' },
							React.createElement('label', null, '角色'),
							React.createElement('select', { value: cRole, onChange: function (e: ChangeEventLike) { setCRole(e.target.value) } },
								React.createElement('option', { value: 'user' }, '普通用户'),
								React.createElement('option', { value: 'admin' }, '管理员'),
							)),
						React.createElement('div', { className: 'grow' },
							React.createElement('label', null, '昵称'),
							React.createElement('input', { value: cDisplay, onChange: function (e: ChangeEventLike) { setCDisplay(e.target.value) }, maxLength: 60 }),
						),
						React.createElement('div', { className: 'grow' },
							React.createElement('label', null, '邮箱'),
							React.createElement('input', { value: cEmail, onChange: function (e: ChangeEventLike) { setCEmail(e.target.value) }, maxLength: 120 }),
						),
					),
					React.createElement('div', { className: 'row', style: { marginTop: 12 } },
						React.createElement('button', { onClick: createUser, disabled: busy }, '创建用户')),
					React.createElement('table', null,
						React.createElement('thead', null,
							React.createElement('tr', null,
								React.createElement('th', null, '用户名'),
								React.createElement('th', null, '角色'),
								React.createElement('th', null, '昵称'),
								React.createElement('th', null, '邮箱'),
								React.createElement('th', null, '通行密钥'),
								React.createElement('th', null, '操作'),
							)),
						React.createElement('tbody', null,
							users.map(function (u: AuthUser) {
								return React.createElement('tr', { key: u.username },
									React.createElement('td', null, u.username, me.username === u.username ? React.createElement('span', { className: 'meta' }, '（我）') : null),
									React.createElement('td', null, React.createElement('span', { className: 'badge ' + u.role }, roleLabel(u.role))),
									React.createElement('td', null, u.displayName || '—'),
									React.createElement('td', null, u.email || '—'),
									React.createElement('td', null, (u.passkeyCount || 0) + ' 个'),
									React.createElement('td', null,
										React.createElement('div', { className: 'actions' },
											React.createElement('button', { className: 'ghost', onClick: function () { resetPassword(u) }, disabled: busy }, '重置密码'),
											(u.passkeyCount || 0) > 0
												? React.createElement('button', { className: 'ghost', onClick: function () { resetPasskeys(u) }, disabled: busy }, '清除通行密钥')
												: null,
											React.createElement('button', { className: 'ghost', onClick: function () { toggleRole(u) }, disabled: busy }, '切换角色'),
											React.createElement('button', { className: 'danger', onClick: function () { deleteUser(u) }, disabled: busy }, '删除'),
										)),
								)
							}),
						),
					),
					React.createElement('div', { className: 'muted', style: { marginTop: 8 } },
						'说明：管理员可以新增、删除用户并重置密码，也可以在设备丢失时清除某个用户的通行密钥（用于账号救援），但无法查看任何人的当前密码。不能删除或降级最后一个管理员。'),
				))
			}

			if (isAdmin) {
				cards.push(React.createElement('div', { className: 'card', key: 'invites' },
					React.createElement('h2', null, '邀请码管理（管理员）'),
					React.createElement('div', { className: 'muted', style: { marginBottom: 6 } },
						'新用户注册必须输入有效邀请码；每个码可按设置的可注册次数使用。'),
					React.createElement('div', { className: 'row' },
						React.createElement('div', { className: 'grow' },
							React.createElement('label', null, '生成数量（1-50）'),
							React.createElement('input', { value: iAmount, onChange: function (e: ChangeEventLike) { setIAmount(e.target.value) }, placeholder: '1' }),
						),
						React.createElement('div', { className: 'grow' },
							React.createElement('label', null, '每个码可注册次数（1-100）'),
							React.createElement('input', { value: iUses, onChange: function (e: ChangeEventLike) { setIUses(e.target.value) }, placeholder: '1' }),
						),
						React.createElement('div', { className: 'grow', style: { alignSelf: 'flex-end' } },
							React.createElement('button', { onClick: createInvites, disabled: busy }, '生成邀请码'),
						),
					),
					React.createElement('table', null,
						React.createElement('thead', null,
							React.createElement('tr', null,
								React.createElement('th', null, '邀请码'),
								React.createElement('th', null, '已用 / 可注册'),
								React.createElement('th', null, '剩余'),
								React.createElement('th', null, '创建者'),
								React.createElement('th', null, '操作'),
							)),
						React.createElement('tbody', null,
							invites.length === 0
								? React.createElement('tr', null, React.createElement('td', { colSpan: 5, className: 'muted' }, '暂无邀请码'))
								: invites.map(function (v: InviteRecord) {
									return React.createElement('tr', { key: v.code },
										React.createElement('td', null, React.createElement('code', null, v.code)),
										React.createElement('td', null, v.used + ' / ' + v.total),
										React.createElement('td', null, React.createElement('span', { className: 'badge ' + (v.remaining > 0 ? 'user' : 'admin') }, v.remaining)),
										React.createElement('td', null, v.createdBy),
										React.createElement('td', null,
											React.createElement('div', { className: 'actions' },
												React.createElement('button', { className: 'danger', onClick: function () { revokeInvite(v.code) }, disabled: busy }, '撤销'),
											)),
									)
								}),
						),
					),
				))
			}
			cards.push(React.createElement('div', { className: 'msg', key: 'msg' }, msg))
			cards.push(React.createElement('div', { className: 'err', key: 'err' }, err))

			return React.createElement('div', { className: 'dshua' }, cards, renderStepUp())
		}

		// ============ 模型配置页锁（仅管理员；仅普通用户注入） ============
		// 服务端网关已对非管理员的模型/Key 写操作一律 403（安全边界）。这里在
		// 客户端把「模型」设置页内容替换为无权限提示，避免普通用户看到配置界面。
		// 注意设置导航用 slots.entries（原始条目、不去重），同 id 注册必然产生
		// 第二个「模型」导航行；内容区按单元格最低 priority 胜出，因此用
		// priority:-1 让锁页成为内容胜者，并用 CSS 隐藏出厂模型页的导航行
		// （导航行无 id 类选择器，按设置面板导航的位次定位；该组合下出厂模型页
		// 恒为第 2 个导航按钮。若部署新增 order<10 的设置页会位移，需同步调整）。
		function ModelsLockedPage() {
			return React.createElement('div', { className: 'dshua' },
				React.createElement('div', { className: 'card' },
					React.createElement('h2', null, '模型配置'),
					React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 14, lineHeight: '22px' } },
						'该页面仅管理员可访问。模型与 API Key 的配置需要管理员权限，请联系管理员处理。'),
				))
		}

		function injectModelsNavHide() {
			if (typeof document === "undefined") return
			if (document.querySelector("style[data-plugin-css=\"dsh-ui-auth-navhide\"]") !== null) return
			var tag = document.createElement("style")
			tag.dataset.plugin = "dsh-ui-auth"
			tag.dataset.pluginCss = "dsh-ui-auth-navhide"
			tag.textContent = '[role="dialog"] nav > div > button:nth-child(2){display:none!important}'
			document.head.appendChild(tag)
		}

		// ============ 登录后 TOTP 提醒弹窗（未绑定且未永久忽略时；同一会话只弹一次） ============
		function showTotpReminder() {
			if (typeof document === "undefined") return
			if (document.getElementById("dshua-totp-reminder") !== null) return
			// 会话内已提醒过（刷新页面不再弹）；登出时会清除，下次登录可再提醒
			try { if (sessionStorage.getItem('dshua-totp-reminded') === '1') return } catch (e) { /* ignore */ }
			var overlay = document.createElement("div")
			overlay.id = "dshua-totp-reminder"
			overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2147483000"
			var card = document.createElement("div")
			card.style.cssText = "width:420px;max-width:calc(100vw - 40px);background:var(--dsw-alias-bg-layer-2,#171a21);border:1px solid var(--dsw-alias-border-l2,#2a2f3a);border-radius:12px;padding:24px;color:var(--dsw-alias-label-primary,#e6e6e6);font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 12px 40px rgba(0,0,0,.45)"
			var title = document.createElement("div")
			title.textContent = "建议开启两步验证"
			title.style.cssText = "font-size:16px;font-weight:700;margin-bottom:10px"
			var body = document.createElement("div")
			body.textContent = "为增强账号安全，建议在【设置】→【用户管理】中添加登录因子：TOTP 动态码令牌（Google Authenticator / Microsoft Authenticator 等）或通行密钥（指纹 / 面容 / 设备 PIN）。也可以永久忽略此提醒。"
			body.style.cssText = "color:var(--dsw-alias-label-secondary,#aab2c3);line-height:22px;margin-bottom:18px"
			var row = document.createElement("div")
			row.style.cssText = "display:flex;gap:10px;justify-content:flex-end"
			function close() { try { overlay.remove() } catch (e) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay) } }
			var later = document.createElement("button")
			later.textContent = "稍后再说"
			later.style.cssText = "padding:8px 14px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit"
			later.addEventListener("click", close)
			var ignore = document.createElement("button")
			ignore.textContent = "永久忽略"
			ignore.style.cssText = "padding:8px 14px;border-radius:7px;border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);cursor:pointer;font:inherit"
			ignore.addEventListener("click", function () {
				rpc('totpIgnore', { ignore: true }).catch(function () {})
				close()
			})
			row.appendChild(later)
			row.appendChild(ignore)
			card.appendChild(title)
			card.appendChild(body)
			card.appendChild(row)
			overlay.appendChild(card)
			document.body.appendChild(overlay)
			try { sessionStorage.setItem('dshua-totp-reminded', '1') } catch (e) { /* ignore */ }
		}

		// ============ 插件入口 ============
		exports.name = 'dsh-ui-auth'
		// slots 服务在 0.1.1-rc.2 由 @deepseek-ai/dsh-client-runtime 提供，0.1.5 起改由
		// @deepseek-ai/dsh-client-ui-renderer 提供；同时 0.1.5 让客户端到达顺序变成显式
		// 依赖（dsh.client.inject 不再只是信息性元数据）。不声明 inject 时本行可能先于
		// 该服务到达 —— 旧实现此时静默 return，表现为设置面板里「用户管理」整个消失。
		exports.inject = ['slots']
		exports.apply = function apply(ctx: PluginContext) {
			injectAuthCss()
			mountSettings(ctx, 0)
		}
		// 即便宿主未按 inject 排序，也以有界重试等待服务就绪；始终取不到则明确报错，
		// 不再静默不渲染（静默会让"菜单缺失"变成无法定位的故障）。
		function mountSettings(ctx: PluginContext, attempt: number) {
			var slots = ctx.get('slots')
			if (slots === undefined) {
				if (attempt < 40) { setTimeout(function () { mountSettings(ctx, attempt + 1) }, 250); return }
				console.error('[dsh-ui-auth] slots 服务不可用：设置面板「用户管理」未能注册')
				return
			}
			slots.inject('settings.section', function () {
				return slots!.register(
					{ name: 'settings.section', id: 'auth-users', order: 30, label: function () { return '用户管理' } },
					function () { return React.createElement(AuthUsersPage) },
				)
			})
			// 非管理员：锁定「模型」页内容 + 隐藏出厂导航行（管理员不注入，保留原页）
			rpc('me', {}).then(function (j: RpcResult) {
				if (j.me !== undefined && j.me.role !== 'admin') {
					injectModelsNavHide()
					slots!.inject('settings.section', function () {
						return slots!.register(
							{ name: 'settings.section', id: 'models', order: 10, priority: -1, label: function () { return '模型' } },
							function () { return React.createElement(ModelsLockedPage) },
						)
					})
				}
				// 登录后：既没有 TOTP 也没有通行密钥且未永久忽略 → 弹窗提醒（管理员同样提醒）
				if (j.me !== undefined && j.me.totpEnabled !== true && (j.me.passkeyCount || 0) === 0 && j.me.totpIgnore !== true) {
					setTimeout(showTotpReminder, 600)
				}
			}).catch(function (e: CodedError) {
				// 401 已由 rpc 引导回登录页；其余错误保持原页面（服务端仍会拦截写入）
			})
		}
