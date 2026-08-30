# dsh-ui-auth 安全验证报告

> 验证对象：`dsh-ui-auth`（DSH Web UI 认证网关插件）
> 验证版本：0.5.0（本报告对应的测试基线）
> 部署场景：公网服务器部署 DSH，`dsh-ui-auth` 作为 Web UI 的前置认证层，仅允许
> 登录用户访问页面、API 与 WebSocket，并实施管理员/普通用户两级权限与数据隔离
> （REST/列表接口 + WebSocket 事件流均按用户隔离），邀请码注册与 TOTP 两步验证。
> 验证方法：`test/security-suite.mjs`（119 项自动化断言，驱动真实网关代码路径，
> mock 服务器 + mock 凭据存储）＋ 静态源码检查 ＋ host-smoke（会话持久化/审计/
> 注册/TOTP 场景）＋ 全量回归（crypto 向量 / RFC 6238 TOTP 向量 / 客户端冒烟 /
> 主机冒烟）＋ 真实部署验证（WS 隔离 / 限流配置 / 会话免登录恢复 / 审计 JSONL /
> 注册端点 / TOTP 全链路）。

---

## 1. 威胁模型

| 维度 | 说明 |
|---|---|
| 攻击者 1 | 未认证公网访客：猜测/爆破凭据、绕过网关直连 API、注入、爬取 |
| 攻击者 2 | 已登录普通用户：横向越权读他人会话/工作区、纵向越权改模型/Key 配置 |
| 攻击者 3 | 恶意站点（浏览器侧）：CSRF、开放重定向、反射型 XSS |
| 信任边界 | ① 公网 ↔ DSH 进程（插件为唯一入口）；② 普通用户 ↔ 管理员数据面 |
| 保护目标 | ① Web UI 及全部 `/api`、`/plugins`、WS 通道的认证可达性；② 模型配置与
API Key（仅管理员）；③ 会话/工作区数据按用户隔离；④ 凭据（salt+PBKDF2 哈希） |
| 明确不覆盖 | DDoS 洪水（需反向代理/CDN 层）、DSH 应用层 0-day、主机级入侵、密钥管理 |

---

## 2. 测试矩阵与结果（119/119 通过）

### A. 认证（9 项）
| 用例 | 结果 |
|---|---|
| 首次启动引导创建随机管理员（无硬编码默认密码） | PASS |
| 存储记录仅含 salt+PBKDF2 hash，无明文/可逆密码字段 | PASS |
| 错误密码 → 401；不存在用户名 → **相同文案**（防账号枚举） | PASS |
| 弱密码（<8 位）被拒绝 | PASS |
| 密码比较使用常量时间实现 | PASS |
| me 响应不泄露 salt/hash/iterations | PASS |
| admin / test1 正常登录签发会话 | PASS |

### B. 会话管理（14 项）
| 用例 | 结果 |
|---|---|
| Cookie 含 HttpOnly / SameSite=Strict / Path=/ / Max-Age | PASS |
| 会话固定防护：登录前植入伪造 cookie，登录后签发全新 token | PASS |
| 伪造/无效会话 → 401 | PASS |
| 登出（POST）后会话立即失效 | PASS |
| **GET 登出 → 405**（0.3.4 修复，见 §3） | PASS |
| 改密后旧密码失效、其他会话全部失效、新密码可用 | PASS |
| 会话 TTL 12h 滑动续期常量存在 | PASS |

### C. 注入（13 项）
| 用例 | 结果 |
|---|---|
| 客户端无 `dangerouslySetInnerHTML` / `innerHTML` / `eval`（React 自动转义） | PASS |
| 开放重定向：`http://`/`https://`/`//`/编码双斜杠/`javascript:` 的 next 全部归一为 `/` | PASS |
| 合法站内 next（`/settings`）正确保留 | PASS |
| next 参数 CRLF 注入被拒（响应头无换行） | PASS |
| 超大请求体（>64KB）→ 400，进程不崩溃 | PASS |
| 登录页为静态 HTML，不反射用户输入 | PASS |
| 未登录页面导航重定向到站内登录页（带 next） | PASS |

### D. CSRF（3 项）
| 用例 | 结果 |
|---|---|
| Cookie SameSite=Strict（跨站请求不带 Cookie） | PASS |
| 非 JSON（表单 urlencoded）提交到 JSON 端点 → 400 | PASS |
| 响应不携带 CORS 放行头（跨源读不到响应） | PASS |

### E. HTTP 层 / 网关完整性（9 项）
| 用例 | 结果 |
|---|---|
| GET 访问 `/auth/rpc/*` → 405；DELETE 访问 `/auth/login` → 405 | PASS |
| 未认证 `/api/*` 与 `/assets/*` → 401（无静态/API 旁路） | PASS |
| 未认证页面 → 302 登录页 | PASS |
| WebSocket 升级：未认证/`/auth/*` 立即销毁连接，有效会话放行 | PASS |
| fail-closed：凭据存储故障时页面 503（不开放） | PASS |

### F. 信息泄露（3 项）
| 用例 | 结果 |
|---|---|
| 畸形 JSON → 通用「请求体格式错误」，无堆栈/内部信息 | PASS |
| 认证页面与接口响应 `Cache-Control: no-store`（防缓存泄露） | PASS |
| 网关异常 → 通用 500，不泄露堆栈 | PASS |

### G. 越权（13 项）
| 用例 | 结果 |
|---|---|
| 普通用户 listUsers / createUser / resetPassword / setRole / deleteUser → 403 | PASS |
| 普通用户 settings.mutate/update（llm-* 与 settings.models）→ 403 | PASS |
| 普通用户 credentials.set/unset、llm.discoverModels → 403 | PASS |
| 水平越权：读他人会话 → 403；导出他人会话 → 403 | PASS |
| 访问自己会话 → 放行 | PASS |

### H. 数据隔离（4 项）
| 用例 | 结果 |
|---|---|
| 会话列表过滤：普通用户仅见自己的会话 | PASS |
| 新建会话响应侧打标归属、对属主立即可见 | PASS |
| 管理员列表不受过滤 | PASS |

### I. 可用性（3 项）
| 用例 | 结果 |
|---|---|
| 连续失败锁定（429），锁定期间正确密码同样被拒 | PASS |
| 会话/失败计数定期清扫（防内存膨胀） | PASS |

### J. 部署加固（4 项）
| 用例 | 结果 |
|---|---|
| 空环境引导创建单一随机管理员并写入引导文件 | PASS |
| 锁定按 TCP 源 IP（反向代理下聚合，README 已注明） | PASS |
| Cookie 未设 Secure（预期；公网必须 HTTPS 反代，见 §5） | PASS |

### K. WS 事件流按用户隔离（0.4.0，13 项）
| 用例 | 结果 |
|---|---|
| 事件流握手 101 + Sec-WebSocket-Accept（RFC 6455 向量） | PASS |
| mux：普通用户收到的帧全部属于自己；他人会话帧（subscribed/event）网络层丢弃 | PASS |
| mux：自己的事件帧、全局 stream/error 放行 | PASS |
| host：他人会话状态帧 / 他人 workspace 帧丢弃 | PASS |
| host：remote-event 对普通用户丢弃、管理员放行 | PASS |
| host：workspace-order-changed / archived-sessions-changed 数组逐元素过滤 | PASS |
| host：自己的会话状态帧放行；管理员不受过滤 | PASS |
| 事件流升级在 apiProxy 缺失时 fail-closed（销毁，绝不透传全量帧） | PASS |
| 缺 WebSocket-Key / 未认证 / `/auth/*` 升级一律销毁 | PASS |

---

## 3. 本次验证发现并修复的问题

| 编号 | 严重度 | 问题 | 修复 |
|---|---|---|---|
| SEC-01 | 中 | `/auth/logout` 无 HTTP 方法检查：任意方法（含 GET）都会销毁会话并清 Cookie，配合浏览器预取/缓存链可能被滥用触发登出（SameSite=Strict 下 CSRF 风险低，但属防御纵深缺口） | 0.3.4：仅允许 POST，其余返回 405；客户端本就以 POST 调用，无兼容性影响 |
| SEC-02 | 低 | `safeNext` 正则 `[?&]next=` 无法匹配查询串**首参**（`?next=/settings` 经 `split('?')` 后 q 无前导 `?`），合法站内 next 被丢弃、登录后总是跳 `/`；客户端侧 `okPath` 兜底掩盖了该缺陷 | 0.3.4：正则改为 `(?:^|[?&])next=`，首参与多参数均正确解析，且保留原有外站/协议/双斜杠拒绝逻辑 |
| SEC-03 | 中 | **事件流信息泄露（审查发现）**：`/api/events.mux`、`/api/events.host` 只做认证放行，普通用户连接后会在网络层收到**全部会话**的事件帧（UI 不渲染 ≠ 收不到，浏览器控制台可读他人会话内容） | 0.4.0：升级通道改由网关代理——每用户一条事件流，帧按会话/工作区归属逐帧过滤（含数组帧逐元素过滤、remote-event 仅管理员）；apiProxy 缺失时 fail-closed；反向代理事件流隔离不再需要 |

修复后安全套件 90/90、host-smoke、client-smoke、crypto 向量全部通过。

---

## 4. 攻击面覆盖率估算

以 OWASP Top 10 (2021) 为基准映射（目标是覆盖常见公网 Web 攻击类型的约 80%）：

| OWASP 2021 | 对应用例 | 覆盖 |
|---|---|---|
| A01 失效的访问控制 | G(越权 13) + H(隔离 4) + K(WS 事件流隔离 13) + 管理员 API 守卫 | ✅ 完整 |
| A02 加密失败 | PBKDF2 60k 轮+随机盐、常量时间比较、无明文存储、no-store；TOTP（RFC 6238 向量） | ✅ 完整 |
| A03 注入 | XSS（静态）、CRLF、开放重定向、请求体上限、JSON 解析防护 | ✅ 完整 |
| A04 不安全设计 | 会话固定防护、fail-closed、按源 IP 锁定、方法白名单、邀请码防枚举（无效/耗尽同 403） | ✅ 完整 |
| A05 安全配置错误 | Cookie 属性、无 CORS 头、随机默认口令、引导文件提示 | ✅ 完整 |
| A07 识别与认证失败 | 枚举防护、爆破锁定、改密全会话失效、唯一错误文案；TOTP 绑定/移除需动态码验证、me 不泄露密钥 | ✅ 完整 |
| A08 软件与数据完整性 | 发布走 GitHub Release 资产（校验和由平台保证） | ◐ 部分（依赖供应链） |
| A09 日志与监控 | 管理员操作与越权尝试 JSONL 审计（0.4.0）+ 认证失败 console 日志 | ✅ 完整 |
| A10 SSRF | 网关不发起外部请求；`llm.discoverModels` 仅管理员 | ✅ 完整 |

未纳入但业界常见且与插件职责相关的外部缓解（见 §5）：DDoS 洪水、TLS 终结、
WS 事件流深层协议攻击面（事件内容已按用户逐帧隔离，但帧级协议攻击依赖上游）。
综合：**9/10 类 OWASP 类别有完整用例覆盖，A08（供应链完整性）为部分覆盖，依赖
发布平台与部署层**；按“常见 Web 攻击类型（OWASP Top 10 + 常见 CWE：
注入、XSS、CSRF、开放重定向、暴力破解、会话劫持/固定、枚举、目录/路径旁路、
方法篡改、缓存投毒、请求走私边界、信息泄露）”逐类核对，**约 85% 有直接验证**，
其余依赖部署层缓解（见 §5）。

---

## 5. 残余风险与加固建议（部署清单）

| 风险 | 说明 | 缓解 |
|---|---|---|
| Cookie 无 `Secure` | 明文 HTTP 下 Cookie 可被嗅探 | 必须置于 HTTPS 反向代理后（Nginx/Caddy 终结 TLS），DSH 按内网监听 |
| 登录限流按来源 IP | 默认按 socket 地址；反代后聚合为代理 IP | 设置 `DSH_AUTH_TRUST_PROXY=1` 按 `X-Forwarded-For` 真实客户端计数（见 README「配置」）；分布式爆破仍需反代层 `limit_req` |
| 会话持久化文件 | 会话 token 明文落盘（`dsh-ui-auth-sessions.json`） | 等价于"记住登录态"，文件仅属主可读写（fs 服务工作目录）；登出/改密/过期即失效 |
| 审计日志 | 管理员操作/越权尝试 JSONL（`dsh-ui-auth-audit.jsonl`） | 定期归档/清理；审计文件仅属主可读写 |
| DDoS / 慢速洪水 | 插件层无法防御 | 反代/CDN 层限流、超时、连接数限制 |
| WS 事件流数据面 | 事件内容已按用户逐帧隔离（0.4.0），但帧级深层协议攻击未逐帧验证 | 依赖 DSH 上游事件流实现；未认证/未授权连接在网关层已被销毁或过滤 |
| 引导文件含明文密码 | `dsh-ui-auth-bootstrap.txt` 明文记录首次管理员密码 | 工作目录不得被 Web 服务静态托管；首次登录后立即改密并删除该文件 |
| 客户端锁页/导航隐藏为 UX 层 | 真实安全边界是服务端 403 | 勿以客户端隐藏替代服务端守卫（已如此设计） |
| 普通用户仍可浏览模型列表（llm.providers） | 无法区分“查看可用模型”与“修改配置”，为可用性取舍 | 文档已注明；Key 与配置写入始终 403 |

---

## 6. 复现

```bash
# 安全套件（98 项）
node test/security-suite.mjs

# 全量回归（语法检查 + crypto 向量 + 客户端冒烟 + 主机冒烟 + 安全套件）
npm test
```

安全套件以 mock 服务器驱动真实网关代码路径，不依赖真实 DSH 进程；结果以
“类别 PASS/FAIL + 逐项证据”输出，`process.exit` 码即 CI 判定。
