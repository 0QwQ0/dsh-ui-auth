/**
 * i18n 核心：单一词典 + 两种取语言的方式。
 *
 * 语言来源（与 DSH 的自动切换对齐）：
 * - 客户端：`ctx.locale`（DSH 客户端 locale 服务）——`register(ns, {zh,en})` 注册词典、
 *   `bind(ns)` 取 `t`、`getSnapshot().active` 得到当前语言；切换时 DSH 广播 `locale/change`，
 *   我们据此重渲染。回退链由 DSH 保证**以 `en` 结尾**。
 * - 宿主（服务端渲染的登录/注册等页）：偏好存在 Host user-settings 的 `locale.preference`
 *   （BCP-47），缺省时按请求的 `Accept-Language` 推断。
 *
 * 未翻译的键**回退到中文原文**（词典里 zh 即原文），因此可以分批推进而不会变成"半截乱码"。
 */

export type Locale = 'zh' | 'en'

import { PHRASES } from './i18n-phrases.js'

/** 一条词条：中文原文 + 英文译文。 */
export interface Entry {
  readonly zh: string
  readonly en: string
}

/** 词典：按命名空间分组，键为语义化 key。 */
export const DICTIONARY = {
  'dsh-ui-auth': {
    // —— 通用 ——
    'common.unlock': { zh: '解锁', en: 'Unlock' },
    'common.add': { zh: '添加', en: 'Add' },
    'common.remove': { zh: '删除', en: 'Delete' },
    'common.cancel': { zh: '取消', en: 'Cancel' },
    'common.save': { zh: '保存', en: 'Save' },
    'common.balance': { zh: '查余额', en: 'Balance' },
    'common.checkKey': { zh: '校验有效性', en: 'Check key' },
    'common.checking': { zh: '校验中…', en: 'Checking…' },
    'common.querying': { zh: '查询中…', en: 'Querying…' },
    'common.notAvailable': { zh: '不可用', en: 'Unavailable' },
    'common.later': { zh: '稍后重试', en: 'Retry later' },
    'common.needUnlock': { zh: '需先解锁', en: 'Unlock required' },
    'common.none': { zh: '—', en: '—' },
    'common.yes': { zh: '是', en: 'Yes' },
    'common.no': { zh: '否', en: 'No' },

    // —— 模型页 ——
    'models.title': { zh: '模型', en: 'Models' },
    'models.intro': {
      zh: '这里的配置只属于你自己：其他用户（包括管理员）都无法查看你的 API Key。管理员分享给你的配置可以直接选用，能看到余额，但看不到 Key。',
      en: 'These profiles belong to you alone: no other user (not even an administrator) can see your API keys. Profiles an administrator shares with you can be selected directly — you can see their balance, never their key.',
    },
    'models.passwordLabel': { zh: '当前登录口令', en: 'Current password' },
    'models.passwordPlaceholder': { zh: '用于解锁私人密钥（不保存）', en: 'Unlocks your private keys (never stored)' },
    'models.balanceAll': { zh: '查余额（全部配置）', en: 'Check balance (all profiles)' },
    'models.setDefault': { zh: '设为默认', en: 'Set as default' },
    'models.useShare': { zh: '选用分享', en: 'Use shared' },
    'models.colName': { zh: '名称', en: 'Name' },
    'models.colModel': { zh: '模型', en: 'Model' },
    'models.colKey': { zh: 'API Key', en: 'API key' },
    'models.colDefault': { zh: '默认', en: 'Default' },
    'models.colBalance': { zh: '余额', en: 'Balance' },
    'models.sharedByAdmin': { zh: '管理员分享', en: 'Shared by admin' },
    'models.empty': {
      zh: '还没有配置。未配置时模型调用会被拒绝——不会回退到部署级配置。',
      en: 'No profiles yet. Model calls are refused without one — there is no fallback to the deployment configuration.',
    },
    'models.addTitle': { zh: '添加我自己的配置', en: 'Add your own profile' },
    'models.fieldName': { zh: '名称', en: 'Name' },
    'models.fieldModel': { zh: '模型', en: 'Model' },
    'models.fieldBaseUrl': { zh: 'baseURL（留空用官方地址）', en: 'baseURL (empty = official endpoint)' },
    'models.fieldApiKey': { zh: 'API Key', en: 'API key' },
    'models.namePlaceholder': { zh: '例如：我的 DeepSeek', en: 'e.g. My DeepSeek' },
    'models.keyOk': { zh: '✔ 连通可用，余额 {amount}', en: '✔ Reachable, balance {amount}' },
    'models.keyFail': { zh: '✘ {reason}', en: '✘ {reason}' },

    // —— 分享管理 ——
    'shares.title': { zh: '分享管理', en: 'Sharing' },
    'shares.intro': {
      zh: '把你的模型分享给指定用户：对方可以选用并查看余额，但看不到你的 API Key；撤销后立即失效。',
      en: 'Share your model with specific users: they can select it and see its balance, but never your API key. Revoking takes effect immediately.',
    },
    'shares.fieldLabel': { zh: '分享名称', en: 'Share name' },
    'shares.fieldModel': { zh: '模型', en: 'Model' },
    'shares.fieldBaseUrl': { zh: 'baseURL（留空用官方地址）', en: 'baseURL (empty = official endpoint)' },
    'shares.fieldApiKey': { zh: 'API Key', en: 'API key' },
    'shares.create': { zh: '创建分享配置', en: 'Create shared profile' },
    'shares.picker': { zh: '分享的 API Key：', en: 'Shared API keys:' },
    'shares.usage': { zh: '用量：{value}', en: 'Usage: {value}' },
    'shares.usageEmpty': { zh: '暂无用量', en: 'No usage yet' },
    'shares.grantees': { zh: '已授权用户', en: 'Authorized users' },
    'shares.noGrantees': { zh: '尚未授权给任何用户', en: 'Not shared with anyone yet' },
    'shares.revoke': { zh: '取消授权', en: 'Revoke' },
    'shares.grantPlaceholder': { zh: '授予用户名', en: 'Username to grant' },
    'shares.grant': { zh: '授予', en: 'Grant' },
    'shares.empty': { zh: '还没有分享配置。', en: 'No shared profiles yet.' },

    // —— 修改密码（引导式） ——
    'password.title': { zh: '修改密码', en: 'Change password' },
    'password.current': { zh: '当前密码', en: 'Current password' },
    'password.new': { zh: '新密码（至少 8 位，含两种字符类型）', en: 'New password (8+ chars, two character classes)' },
    'password.confirm': { zh: '确认新密码', en: 'Confirm new password' },
    'password.submit': { zh: '修改密码', en: 'Change password' },
    'password.hintIdle': {
      zh: '离开此输入框时会自动校验；校验通过前下面两个输入框锁定',
      en: 'Leaving this field verifies it; the two fields below stay locked until it passes',
    },
    'password.hintOk': { zh: '当前密码正确，已解锁下面的输入框', en: 'Current password correct — the fields below are unlocked' },
    'password.hintBad': { zh: '当前密码不正确，下面的输入框保持锁定', en: 'Current password incorrect — the fields below stay locked' },
    'password.strength': { zh: '密码强度：{value}', en: 'Password strength: {value}' },
    'password.levelOk': { zh: '很高', en: 'strong' },
    'password.levelWarn': { zh: '刚满足要求（建议再加长或混合更多字符类型）', en: 'just meets the requirement (longer or more varied is better)' },
    'password.levelBad': { zh: '不满足要求（至少 8 位且含两类字符）', en: 'not sufficient (at least 8 characters and two classes)' },
    'password.match': { zh: '两次输入一致', en: 'Both entries match' },
    'password.mismatch': { zh: '两次输入不一致', en: 'The two entries differ' },
  },
} as const

export type Namespace = keyof typeof DICTIONARY
export type MessageKey = keyof (typeof DICTIONARY)['dsh-ui-auth']

/** 取某语言的词条；缺失时回退中文原文（分批翻译期间不会出现空白文案）。 */
export function message(locale: Locale, key: MessageKey, params?: Record<string, unknown>): string {
  const entry = DICTIONARY['dsh-ui-auth'][key] as Entry | undefined
  const template = entry === undefined ? String(key) : (locale === 'en' ? entry.en : entry.zh)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/** 把 BCP-47 语言标记归一化为我们支持的两个值（zh 优先匹配 zh-*，其余归 en）。 */
export function normalizeLocale(tag: string | undefined): Locale {
  if (typeof tag !== 'string' || tag === '') return 'en'
  return /^zh\b/i.test(tag) ? 'zh' : 'en'
}

/**
 * 从 `Accept-Language` 推断语言（服务端渲染页用；用户偏好缺省时以此为准）。
 * 只做足够好的匹配：按 q 值排序后取第一个能识别的语言。
 */
export function localeFromAcceptLanguage(header: string | undefined): Locale | undefined {
  if (typeof header !== 'string' || header.trim() === '') return undefined
  const ranked = header.split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map(item => item.trim()).find(item => item.startsWith('q='))
      return { tag: (tag ?? '').trim(), quality: q === undefined ? 1 : Number(q.slice(2)) || 0 }
    })
    .filter(entry => entry.tag !== '')
    .sort((a, b) => b.quality - a.quality)
  if (ranked.length === 0) return undefined
  // 优先挑"我们能识别的"最高优先级语言；都不认识时才按第一名归一化（非 zh 一律算 en）。
  const supported = ranked.find(entry => /^zh\b/i.test(entry.tag) || /^en\b/i.test(entry.tag))
  return normalizeLocale((supported ?? ranked[0])?.tag)
}

/** 供客户端 `ctx.locale.register` 使用的两套词典（键即上面的语义 key）。 */
export function dictionaries(): { zh: Record<string, string>; en: Record<string, string> } {
  const zh: Record<string, string> = {}
  const en: Record<string, string> = {}
  for (const [key, entry] of Object.entries(DICTIONARY['dsh-ui-auth']) as Array<[string, Entry]>) {
    zh[key] = entry.zh
    en[key] = entry.en
  }
  return { zh, en }
}

// ===== 短语级替换（覆盖尚未逐点改造的 300+ 处中文） =====

/**
 * 按**长键优先**排序的短语表：短键先替换会吃掉长键（例如「模型」会破坏「模型与密钥」），
 * 因此这里按中文原文长度降序，保证最长匹配先行。
 */
const ORDERED_PHRASES: ReadonlyArray<readonly [string, string]> = PHRASES
  .filter(([zh, en]) => zh !== '' && en !== '' && zh !== en)
  .slice()
  .sort((a, b) => b[0].length - a[0].length)

/**
 * 把中文原文短语替换为英文（`zh` 原样返回）。
 * 子串替换天然支持拼装式文案（`'当前登录：' + 名字`）。
 */
export function translatePhrase(locale: Locale, text: string): string {
  if (locale !== 'en' || text === '') return text
  let result = text
  for (const [zh, en] of ORDERED_PHRASES) {
    if (result.includes(zh)) result = result.split(zh).join(en)
  }
  return result
}

/** 服务端渲染页：对整页 HTML 做同样的替换（保留标签与脚本结构，只动可见文字）。 */
export function translateHtml(locale: Locale, html: string): string {
  return translatePhrase(locale, html)
}

/** 词典规模（供测试与文档引用）。 */
export function phraseCount(): number {
  return ORDERED_PHRASES.length
}