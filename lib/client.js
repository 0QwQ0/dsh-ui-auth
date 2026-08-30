window.__ModuleLoader__.load({
	id: "dsh-ui-auth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

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
		function rpc(method, body) {
			return fetch('/auth/rpc/' + method, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body || {}),
			}).then(async (r) => {
				var j = {}
				try { j = await r.json() } catch (e) { /* keep {} */ }
				if (r.status === 401) {
					var p = encodeURIComponent(location.pathname + location.search)
					location.href = '/auth/login?next=' + p
					var err = new Error('session-expired')
					err.code = 'session-expired'
					throw err
				}
				if (!r.ok || j.ok !== true) throw new Error(j.error || ('请求失败 (' + r.status + ')'))
				return j
			})
		}

		function roleLabel(role) {
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

			var isAdmin = me !== null && me.role === 'admin'

			_e(function () {
				var cancelled = false
				rpc('me', {}).then(function (j) {
					if (cancelled) return
					setMe(j.me)
					setPDisplay(j.me.displayName || '')
					setPEmail(j.me.email || '')
				}).catch(function (e) {
					if (e.code !== 'session-expired' && !cancelled) setErr(e.message)
				})
				return function () { cancelled = true }
			}, [])

			_e(function () {
				if (!isAdmin) return
				var cancelled = false
				rpc('listUsers', {}).then(function (j) {
					if (!cancelled) setUsers(j.users || [])
				}).catch(function (e) {
					if (e.code !== 'session-expired' && !cancelled) setErr(e.message)
				})
				return function () { cancelled = true }
			}, [isAdmin, usersVersion])

			function refreshUsers() { setUsersVersion(function (v) { return v + 1 }) }

			_e(function () {
				if (!isAdmin) return
				var cancelled = false
				rpc('inviteList', {}).then(function (j) {
					if (!cancelled) setInvites(j.invites || [])
				}).catch(function (e) {
					if (e.code !== 'session-expired' && !cancelled) setErr(e.message)
				})
				return function () { cancelled = true }
			}, [isAdmin, invitesVersion])

			function refreshInvites() { setInvitesVersion(function (v) { return v + 1 }) }

			function createInvites() {
				var amount = parseInt(iAmount, 10)
				var uses = parseInt(iUses, 10)
				if (!(amount >= 1 && amount <= 50)) { setErr('生成数量需为 1-50'); return }
				if (!(uses >= 1 && uses <= 100)) { setErr('每个邀请码可用次数需为 1-100'); return }
				run(function () { return rpc('inviteCreate', { amount: amount, uses: uses }).then(refreshInvites) }, '邀请码已生成')
			}

			function revokeInvite(code) {
				if (!window.confirm('撤销邀请码「' + code + '」？已注册用户不受影响。')) return
				run(function () { return rpc('inviteRevoke', { code: code }).then(refreshInvites) }, '邀请码已撤销')
			}

			_e(function () {
				var cancelled = false
				rpc('totpStatus', {}).then(function (j) {
					if (!cancelled) setTotp({ enabled: j.totp.enabled === true, twoFactor: j.totp.twoFactor === true, ignore: j.totp.ignore === true })
				}).catch(function (e) {
					if (e.code !== 'session-expired' && !cancelled) setErr(e.message)
				})
				return function () { cancelled = true }
			}, [me === null ? null : me.username])

			function refreshTotp() {
				rpc('totpStatus', {}).then(function (j) {
					setTotp({ enabled: j.totp.enabled === true, twoFactor: j.totp.twoFactor === true, ignore: j.totp.ignore === true })
					if (j.totp.enabled === true) { setTSecret(''); setTOtpAuth('') }
				}).catch(function (e) { if (e.code !== 'session-expired') setErr(e.message) })
			}

			function toggle2fa() {
				run(function () { return rpc('totpSet2fa', { enabled: !totp.twoFactor }).then(refreshTotp) }, totp.twoFactor ? '已关闭两步验证（密码或动态码任选其一登录）' : '已启用两步验证（登录需密码 + 动态码）')
			}

			function genTotp() {
				run(function () {
					return rpc('totpGenerate', {}).then(function (j) {
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
				if (!window.confirm('确定移除 TOTP 令牌？移除后登录将不再需要动态验证码。')) return
				if (!/^\d{6}$/.test(tRmCode)) { setErr('请输入当前 6 位动态验证码以确认移除'); return }
				run(function () { return rpc('totpRemove', { code: tRmCode }).then(function () { setTRmCode(''); refreshTotp() }) }, 'TOTP 已移除')
			}

			function toggleIgnore() {
				run(function () { return rpc('totpIgnore', { ignore: !totp.ignore }).then(refreshTotp) }, totp.ignore ? '已取消永久忽略' : '已永久忽略登录提醒')
			}

			function run(task, okMsg) {
				setBusy(true); setErr(''); setMsg('')
				Promise.resolve().then(task).then(function () {
					if (okMsg) setMsg(okMsg)
				}).catch(function (e) {
					if (e.code !== 'session-expired') setErr(e.message)
				}).finally(function () { setBusy(false) })
			}

			function saveProfile() {
				run(function () { return rpc('updateProfile', { displayName: pDisplay, email: pEmail }).then(function (j) { setMe(j.me) }) }, '个人信息已保存')
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

			function deleteUser(u) {
				if (!window.confirm('确定删除用户「' + u.username + '」？该操作不可撤销。')) return
				run(function () { return rpc('deleteUser', { username: u.username }).then(refreshUsers) }, '用户已删除')
			}

			function resetPassword(u) {
				var pw = window.prompt('为用户「' + u.username + '」设置新密码（至少 8 位，含两种字符类型）：')
				if (pw === null) return
				if (pw.length < 8) { setErr('新密码至少 8 位且含两种及以上字符类型（大小写字母/数字/符号）'); return }
				run(function () { return rpc('resetPassword', { username: u.username, newPassword: pw }).then(refreshUsers) }, '密码已重置')
			}

			function toggleRole(u) {
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
				React.createElement('input', { value: pDisplay, onChange: function (e) { setPDisplay(e.target.value) }, maxLength: 60 }),
				React.createElement('label', null, '邮箱'),
				React.createElement('input', { value: pEmail, onChange: function (e) { setPEmail(e.target.value) }, maxLength: 120 }),
				React.createElement('div', { className: 'row', style: { marginTop: 12 } },
					React.createElement('button', { onClick: saveProfile, disabled: busy }, '保存个人信息'),
					React.createElement('button', { className: 'ghost', onClick: logout }, '退出登录')),
			))

			cards.push(React.createElement('div', { className: 'card', key: 'password' },
				React.createElement('h2', null, '修改密码'),
				React.createElement('label', null, '当前密码'),
				React.createElement('input', { type: 'password', value: oldPw, onChange: function (e) { setOldPw(e.target.value) }, autoComplete: 'current-password' }),
				React.createElement('label', null, '新密码（至少 8 位，含两种字符类型）'),
				React.createElement('input', { type: 'password', value: newPw, onChange: function (e) { setNewPw(e.target.value) }, autoComplete: 'new-password' }),
				React.createElement('label', null, '确认新密码'),
				React.createElement('input', { type: 'password', value: newPw2, onChange: function (e) { setNewPw2(e.target.value) }, autoComplete: 'new-password' }),
				React.createElement('div', { className: 'row', style: { marginTop: 12 } },
					React.createElement('button', { onClick: changePassword, disabled: busy }, '修改密码')),
			))

			cards.push(React.createElement('div', { className: 'card', key: 'totp' },
				React.createElement('h2', null, '两步验证（TOTP）'),
				React.createElement('div', null,
					totp.enabled
						? React.createElement('span', { className: 'badge admin' }, '已启用')
						: React.createElement('span', { className: 'badge user' }, '未绑定'),
					totp.ignore ? React.createElement('span', { className: 'meta' }, '（已永久忽略登录提醒）') : null,
				),
				totp.enabled
					? React.createElement('div', null,
						React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' } },
							React.createElement('label', { className: 'switch' },
								React.createElement('input', { type: 'checkbox', checked: totp.twoFactor, onChange: toggle2fa, disabled: busy }),
								React.createElement('span', { className: 'track' }, React.createElement('span', { className: 'thumb' })),
							),
							React.createElement('label', { style: { cursor: 'pointer', margin: 0, color: 'var(--dsw-alias-label-secondary)' } },
								totp.twoFactor ? '已启用两步验证（登录需密码 + 动态码）' : '未启用两步验证（密码或动态码任选其一登录）'),
						),
						React.createElement('div', { className: 'muted', style: { marginBottom: 6 } },
							'绑定 TOTP 后默认不强制两步验证，可随时用此开关开启/关闭。'),
						React.createElement('label', null, '移除令牌需输入当前 6 位动态码'),
						React.createElement('input', { value: tRmCode, onChange: function (e) { setTRmCode(e.target.value) }, placeholder: '6 位动态码', maxLength: 6 }),
						React.createElement('div', { className: 'row', style: { marginTop: 12 } },
							React.createElement('button', { className: 'danger', onClick: removeTotp, disabled: busy }, '移除 TOTP'),
							React.createElement('button', { className: 'ghost', onClick: toggleIgnore, disabled: busy }, totp.ignore ? '取消永久忽略' : '永久忽略登录提醒')),
					)
					: (tSecret === ''
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
							React.createElement('input', { value: tCode, onChange: function (e) { setTCode(e.target.value) }, placeholder: '6 位动态码', maxLength: 6 }),
							React.createElement('div', { className: 'row', style: { marginTop: 12 } },
								React.createElement('button', { onClick: enableTotp, disabled: busy }, '启用 TOTP'),
								React.createElement('button', { className: 'ghost', onClick: function () { setTSecret(''); setTOtpAuth(''); setTQrUrl(''); setTCode('') }, disabled: busy }, '取消')),
						)),
			))

			if (isAdmin) {
				cards.push(React.createElement('div', { className: 'card', key: 'admin' },
					React.createElement('h2', null, '用户管理（管理员）'),
					React.createElement('label', null, '新增用户：用户名'),
					React.createElement('input', { value: cName, onChange: function (e) { setCName(e.target.value) }, placeholder: '2-32 位字母、数字、_ . -', maxLength: 32 }),
					React.createElement('label', null, '初始密码（至少 8 位，含两种字符类型）'),
					React.createElement('input', { type: 'password', value: cPw, onChange: function (e) { setCPw(e.target.value) }, placeholder: '密码仅本次设置，之后无法查看' }),
					React.createElement('div', { className: 'row' },
						React.createElement('div', { className: 'grow' },
							React.createElement('label', null, '角色'),
							React.createElement('select', { value: cRole, onChange: function (e) { setCRole(e.target.value) } },
								React.createElement('option', { value: 'user' }, '普通用户'),
								React.createElement('option', { value: 'admin' }, '管理员'),
							)),
						React.createElement('div', { className: 'grow' },
							React.createElement('label', null, '昵称'),
							React.createElement('input', { value: cDisplay, onChange: function (e) { setCDisplay(e.target.value) }, maxLength: 60 }),
						),
						React.createElement('div', { className: 'grow' },
							React.createElement('label', null, '邮箱'),
							React.createElement('input', { value: cEmail, onChange: function (e) { setCEmail(e.target.value) }, maxLength: 120 }),
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
								React.createElement('th', null, '操作'),
							)),
						React.createElement('tbody', null,
							users.map(function (u) {
								return React.createElement('tr', { key: u.username },
									React.createElement('td', null, u.username, me.username === u.username ? React.createElement('span', { className: 'meta' }, '（我）') : null),
									React.createElement('td', null, React.createElement('span', { className: 'badge ' + u.role }, roleLabel(u.role))),
									React.createElement('td', null, u.displayName || '—'),
									React.createElement('td', null, u.email || '—'),
									React.createElement('td', null,
										React.createElement('div', { className: 'actions' },
											React.createElement('button', { className: 'ghost', onClick: function () { resetPassword(u) }, disabled: busy }, '重置密码'),
											React.createElement('button', { className: 'ghost', onClick: function () { toggleRole(u) }, disabled: busy }, '切换角色'),
											React.createElement('button', { className: 'danger', onClick: function () { deleteUser(u) }, disabled: busy }, '删除'),
										)),
								)
							}),
						),
					),
					React.createElement('div', { className: 'muted', style: { marginTop: 8 } },
						'说明：管理员可以新增、删除用户并重置密码，但无法查看任何人的当前密码。不能删除或降级最后一个管理员。'),
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
							React.createElement('input', { value: iAmount, onChange: function (e) { setIAmount(e.target.value) }, placeholder: '1' }),
						),
						React.createElement('div', { className: 'grow' },
							React.createElement('label', null, '每个码可注册次数（1-100）'),
							React.createElement('input', { value: iUses, onChange: function (e) { setIUses(e.target.value) }, placeholder: '1' }),
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
								: invites.map(function (v) {
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

			return React.createElement('div', { className: 'dshua' }, cards)
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
			title.textContent = "建议开启两步验证（TOTP）"
			title.style.cssText = "font-size:16px;font-weight:700;margin-bottom:10px"
			var body = document.createElement("div")
			body.textContent = "为增强账号安全，建议在【设置】→【用户管理】→「两步验证（TOTP）」中添加 TOTP 令牌（Google Authenticator / Microsoft Authenticator 等）。也可以永久忽略此提醒。"
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
		exports.apply = function apply(ctx) {
			injectAuthCss()
			var slots = ctx.get('slots')
			if (slots === undefined) return
			slots.inject('settings.section', function () {
				return slots.register(
					{ name: 'settings.section', id: 'auth-users', order: 30, label: function () { return '用户管理' } },
					function () { return React.createElement(AuthUsersPage) },
				)
			})
			// 非管理员：锁定「模型」页内容 + 隐藏出厂导航行（管理员不注入，保留原页）
			rpc('me', {}).then(function (j) {
				if (j.me !== undefined && j.me.role !== 'admin') {
					injectModelsNavHide()
					slots.inject('settings.section', function () {
						return slots.register(
							{ name: 'settings.section', id: 'models', order: 10, priority: -1, label: function () { return '模型' } },
							function () { return React.createElement(ModelsLockedPage) },
						)
					})
				}
				// 登录后：未绑定 TOTP 且未永久忽略 → 弹窗提醒（管理员同样提醒）
				if (j.me !== undefined && j.me.totpEnabled !== true && j.me.totpIgnore !== true) {
					setTimeout(showTotpReminder, 600)
				}
			}).catch(function (e) {
				// 401 已由 rpc 引导回登录页；其余错误保持原页面（服务端仍会拦截写入）
			})
		}
		return module.exports;
	}
});
