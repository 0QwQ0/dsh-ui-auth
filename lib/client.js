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
			'.dshua input, .dshua select{padding:8px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font:inherit;outline:none;width:100%}',
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
			'.dshua .badge{padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}',
			'.dshua .badge.admin{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);color:var(--dsw-alias-brand-primary)}',
			'.dshua .badge.user{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			'.dshua .muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
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
			return role === 'admin' ? '管理员' : '普通用户'
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
				if (newPw.length < 8) { setErr('新密码至少 8 位'); return }
				if (newPw !== newPw2) { setErr('两次输入的新密码不一致'); return }
				run(function () {
					return rpc('changePassword', { oldPassword: oldPw, newPassword: newPw }).then(function () {
						setOldPw(''); setNewPw(''); setNewPw2('')
					})
				}, '密码已修改（其他设备上的登录已失效）')
			}

			function createUser() {
				if (!/^[A-Za-z0-9_.-]{2,32}$/.test(cName)) { setErr('用户名仅允许 2-32 位字母、数字、下划线、点或短横线'); return }
				if (cPw.length < 8) { setErr('初始密码至少 8 位'); return }
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
				var pw = window.prompt('为用户「' + u.username + '」设置新密码（至少 8 位）：')
				if (pw === null) return
				if (pw.length < 8) { setErr('新密码至少 8 位'); return }
				run(function () { return rpc('resetPassword', { username: u.username, newPassword: pw }).then(refreshUsers) }, '密码已重置')
			}

			function toggleRole(u) {
				var next = u.role === 'admin' ? 'user' : 'admin'
				if (!window.confirm('将「' + u.username + '」的角色改为「' + roleLabel(next) + '」？')) return
				run(function () { return rpc('setRole', { username: u.username, role: next }).then(refreshUsers) }, '角色已更新')
			}

			function logout() {
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
				React.createElement('label', null, '新密码（至少 8 位）'),
				React.createElement('input', { type: 'password', value: newPw, onChange: function (e) { setNewPw(e.target.value) }, autoComplete: 'new-password' }),
				React.createElement('label', null, '确认新密码'),
				React.createElement('input', { type: 'password', value: newPw2, onChange: function (e) { setNewPw2(e.target.value) }, autoComplete: 'new-password' }),
				React.createElement('div', { className: 'row', style: { marginTop: 12 } },
					React.createElement('button', { onClick: changePassword, disabled: busy }, '修改密码')),
			))

			if (isAdmin) {
				cards.push(React.createElement('div', { className: 'card', key: 'admin' },
					React.createElement('h2', null, '用户管理（管理员）'),
					React.createElement('label', null, '新增用户：用户名'),
					React.createElement('input', { value: cName, onChange: function (e) { setCName(e.target.value) }, placeholder: '2-32 位字母、数字、_ . -', maxLength: 32 }),
					React.createElement('label', null, '初始密码（至少 8 位）'),
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
			}).catch(function (e) {
				// 401 已由 rpc 引导回登录页；其余错误保持原页面（服务端仍会拦截写入）
			})
		}
		return module.exports;
	}
});
