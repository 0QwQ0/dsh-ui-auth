// i18n 单测：词典完整性、短语替换（含拼装文案与长键优先）、Accept-Language 解析、页面翻译。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dictionaries, message, normalizeLocale, localeFromAcceptLanguage, translatePhrase, translateHtml, phraseCount } from '../lib/i18n.js'
import { PHRASES } from '../lib/i18n-phrases.js'

test('the semantic dictionary has both languages for every key', () => {
  const { zh, en } = dictionaries()
  const keys = Object.keys(zh)
  assert.ok(keys.length >= 30, `键数量偏少：${keys.length}`)
  assert.deepEqual(Object.keys(en), keys, '两种语言的键必须一致')
  for (const key of keys) {
    assert.notEqual(zh[key], '', `zh 为空：${key}`)
    assert.notEqual(en[key], '', `en 为空：${key}`)
  }
  assert.equal(message('en', 'models.title'), 'Models')
  assert.equal(message('zh', 'models.title'), '模型')
  assert.equal(message('en', 'models.keyOk', { amount: 'CNY 5.78' }), '✔ Reachable, balance CNY 5.78', '支持 {name} 插值')
  assert.equal(message('zh', 'shares.grant'), '授予')
})

test('the phrase table is well formed and long keys win', () => {
  assert.ok(phraseCount() >= 200, `短语数量偏少：${phraseCount()}`)
  const seen = new Set()
  for (const [zh, en] of PHRASES) {
    assert.notEqual(zh, '', '中文原文不能为空')
    assert.ok(!seen.has(zh), `原文重复：${zh}`)
    seen.add(zh)
    assert.notEqual(en, '', `英文译文不能为空：${zh}`)
    assert.ok(!/[<>]/.test(en), `译文不能引入 HTML 标签（会破坏页面结构）：${zh}`)
  }
})

test('phrase translation handles composed text and reverts for zh', () => {
  assert.equal(translatePhrase('zh', '当前登录：admin'), '当前登录：admin', 'zh 必须原样返回')
  assert.equal(translatePhrase('en', '当前登录：admin'), 'Signed in as: admin', '拼装式文案也要替换')
  assert.equal(translatePhrase('en', '解锁'), 'Unlock')
  assert.equal(translatePhrase('en', '还没有分享配置。'), 'No shared profiles yet.')
  // 未收录的文案保持原文（可增量补充），不会变成空白
  assert.equal(translatePhrase('en', '这个词还没有译文'), '这个词还没有译文')
  // 长键优先：'模型' 不会破坏更长的短语
  const long = translatePhrase('en', '已启用两步验证（登录需密码 + 动态码）')
  assert.ok(!long.includes('两步验证'), '长短语应整体替换：' + long)
})

test('page HTML translation keeps structure and translates visible text', () => {
  const html = '<label for="u">用户名</label><div class="sub">请登录后继续访问</div>'
  const en = translateHtml('en', html)
  assert.ok(en.includes('<label for="u">Username</label>'), en)
  assert.ok(en.includes('Sign in to continue'), en)
  assert.ok(en.includes('for="u"'), '属性和标签结构必须保留')
  assert.equal(translateHtml('zh', html), html, 'zh 原样返回')
})

test('locale detection normalises tags and reads Accept-Language by quality', () => {
  assert.equal(normalizeLocale('zh-CN'), 'zh')
  assert.equal(normalizeLocale('en-GB'), 'en')
  assert.equal(normalizeLocale(undefined), 'en')
  assert.equal(localeFromAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8'), 'zh')
  assert.equal(localeFromAcceptLanguage('en-GB,en;q=0.9,zh;q=0.1'), 'en')
  assert.equal(localeFromAcceptLanguage('fr-FR,zh;q=0.9'), 'zh', '取最高 q 值里我们能识别的')
  assert.equal(localeFromAcceptLanguage(''), undefined)
  assert.equal(localeFromAcceptLanguage(undefined), undefined)
})