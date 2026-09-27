/**
 * 介面語系的完整性。介面字串直接以中文寫在程式裡（src/site/messages.js），譯文檔是「中文原文 → 譯文」：
 * - 程式裡的每一個介面字串（t('…')、msg('…')），每個譯文檔都有譯文
 * - 譯文檔沒有程式不再使用的鍵（改了中文原文卻忘了改譯文檔）
 * - 參數佔位符 {name} 與中文原文一致
 * - 不再有用變數或樣板字串組出來的鍵（掃不到，也沒辦法從程式直接看到中文）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractFromSource, extractMessages } from '../../src/site/extract-messages.js'
import { sourceText } from '../../src/site/messages.js'
import { BUILTIN_LOCALES, SOURCE_LOCALE } from '../../src/site/paths.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TRANSLATIONS = readdirSync(join(ROOT, 'locales')).filter((f) => f.endsWith('.json'))
const messages = Object.fromEntries(
  TRANSLATIONS.map((f) => [f.slice(0, -5), /** @type {Record<string, string>} */ (JSON.parse(readFileSync(join(ROOT, 'locales', f), 'utf8')))]),
)
const keys = extractMessages()

const placeholders = (/** @type {string} */ s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(vue|js)$/.test(name) && !name.endsWith('.test.js') ? [full] : []
  })
}

describe('介面語系', () => {
  it('中文是原文語系，沒有譯文檔；框架至少內建英文', () => {
    expect(BUILTIN_LOCALES[0]).toBe(SOURCE_LOCALE)
    expect(Object.keys(messages)).not.toContain(SOURCE_LOCALE)
    expect(Object.keys(messages)).toContain('en')
  })

  it('找得到程式裡的介面字串，包括 msg() 表與語境', () => {
    expect(keys.length).toBeGreaterThan(300)
    expect(keys).toContain('搜尋')
    expect(keys).toContain('頁面標題|詞條')
    expect(keys).toContain('角色|詞條')
  })

  it('抽取規則：語境、跳脫字元、註解中的示範', () => {
    const code = [
      "t('一')",
      "t('二 {n}', { n })",
      "t('三', null, '語境')",
      "msg('四')",
      "msg('五', '語境')",
      "t('It\\'s')",
      '/* t(\'註解\') */',
      '// msg(\'也是註解\')',
      "<!-- t('模板註解') -->",
      "split('x')",
    ].join('\n')
    expect(extractFromSource(code)).toEqual(['一', '二 {n}', '語境|三', '四', '語境|五', "It's"])
  })

  it('每個譯文檔：程式用到的字串都有譯文，沒有多餘的鍵，佔位符與中文一致', () => {
    for (const [locale, table] of Object.entries(messages)) {
      expect(keys.filter((k) => !(k in table)), `${locale} 缺少`).toEqual([])
      expect(Object.keys(table).filter((k) => !keys.includes(k)), `${locale} 有程式沒有用到的鍵`).toEqual([])
      for (const key of keys) {
        expect(typeof table[key], `${locale} 的「${key}」`).toBe('string')
        expect(placeholders(table[key]), `${locale} 的「${key}」`).toEqual(placeholders(sourceText(key)))
      }
    }
  })

  it('不用樣板字串或舊的點號鍵呼叫 t()', () => {
    const offenders = []
    for (const file of [...sourceFiles(join(ROOT, 'app', 'src')), join(ROOT, 'src', 'fuzzy', 'steps.js')]) {
      const code = readFileSync(file, 'utf8')
      for (const m of code.matchAll(/\bt\(\s*`[^`]*`|\bt\(\s*'[a-z]\w*(?:\.\w+)+'/g)) offenders.push(`${file}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })
})
