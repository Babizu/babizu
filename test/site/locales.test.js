/**
 * 介面語系的完整性：
 * - 前端程式中每一個 t('…') 用到的鍵，在每個內建語系都要有
 * - 各內建語系的鍵完全相同（新增字串時不會漏翻某一種語言）
 * - 參數佔位符 {name} 在各語系一致
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { flattenMessages } from '../../src/site/config.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const LOCALES = readdirSync(join(ROOT, 'locales')).filter((f) => f.endsWith('.json'))
const messages = Object.fromEntries(
  LOCALES.map((f) => [f.slice(0, -5), flattenMessages(JSON.parse(readFileSync(join(ROOT, 'locales', f), 'utf8')))]),
)

/** @param {string} dir @returns {string[]} */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(vue|js)$/.test(name) && !name.endsWith('.test.js') ? [full] : []
  })
}

/** 程式中以字面字串呼叫 t() 的鍵；樣板字串（t(`unit.${code}`)）另外檢查前綴 */
function usedKeys() {
  const keys = new Set()
  const prefixes = new Set()
  for (const file of sourceFiles(join(ROOT, 'app', 'src'))) {
    const code = readFileSync(file, 'utf8')
    for (const m of code.matchAll(/\bt\(\s*'([\w.]+)'/g)) keys.add(m[1])
    for (const m of code.matchAll(/\bt\(\s*`([\w.]+)\.\$\{/g)) prefixes.add(m[1])
  }
  return { keys, prefixes }
}

const placeholders = (/** @type {string} */ s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('介面語系', () => {
  it('框架至少內建中文與英文', () => {
    expect(Object.keys(messages)).toEqual(expect.arrayContaining(['zh-TW', 'en']))
  })

  it('程式用到的每個鍵，每個語系都有', () => {
    const { keys, prefixes } = usedKeys()
    expect(keys.size).toBeGreaterThan(100)
    for (const [locale, table] of Object.entries(messages)) {
      const missing = [...keys].filter((k) => !(k in table))
      expect(missing, `${locale} 缺少`).toEqual([])
      for (const prefix of prefixes) {
        expect(
          Object.keys(table).some((k) => k.startsWith(`${prefix}.`)),
          `${locale} 沒有任何 ${prefix}.* 的字串`,
        ).toBe(true)
      }
    }
  })

  it('各語系的鍵完全相同，參數佔位符也一致', () => {
    const [base, ...others] = Object.keys(messages)
    for (const locale of others) {
      expect(Object.keys(messages[locale]).sort(), `${locale} 與 ${base} 的鍵不同`).toEqual(
        Object.keys(messages[base]).sort(),
      )
      for (const key of Object.keys(messages[base])) {
        expect(placeholders(messages[locale][key]), `${locale} 的 ${key}`).toEqual(placeholders(messages[base][key]))
      }
    }
  })
})
