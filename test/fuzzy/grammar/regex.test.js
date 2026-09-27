/**
 * 正規表達式的原型（src/fuzzy/grammar/regex.js，docs/morph-grammar.md 第 6 節）：
 * - 完全相符的檢查器是第三個獨立的檢查者：與類 pika 剖析器雙向比對「對齊成本 0 的分析」；
 * - 詞根未知的版本只示範界線：反向參照做得到重疊，但 exec 只回傳第一個成功的分析，不是成本最低的。
 */

import { describe, expect, it } from 'vitest'
import { FuzzyIndex } from '../../../src/fuzzy/index.js'
import { createChartSearch } from '../../../src/fuzzy/grammar/chart.js'
import { derive } from '../../../src/fuzzy/grammar/derive.js'
import { compileExactRegex, compileSearchRegex } from '../../../src/fuzzy/grammar/regex.js'
import { normalizeGrammar } from '../../../src/fuzzy/grammar/spec.js'
import { createRandom } from '../helpers.js'
import { GRAMMAR } from './grammar.test.js'
import { randomGrammarSetup, randomQuery } from './random-grammar.js'

const g = normalizeGrammar(GRAMMAR)
/** @param {string} query @param {string} root */
const exact = (query, root) => compileExactRegex(g, root).regex.test(query)

describe('完全相符的檢查器（詞根已知）', () => {
  it('推導產生器的例子：組合規則、落在前綴上的中綴、詞根上的中綴', () => {
    expect(exact('mausaay', 'usa')).toBe(true) // m ＋ <a> ＋ -ay（沒有 aa → a 的音變）
    expect(exact('minubaket', 'baket')).toBe(true) // m<in>u-（組合規則 AF.PRF）
    expect(exact('mubinaket', 'baket')).toBe(true) // mu- ＋ <in>（詞根上的中綴）
    expect(exact('binaketan', 'baket')).toBe(true) // <in>…-an（組合規則 LF.PRF）
    expect(exact('mausay', 'usa')).toBe(false) // a｜a 合併是音變，不是完全相符
    expect(exact('xubaket', 'baket')).toBe(false)
  })

  it('只有輔音的前綴插入中綴：以向前看要求後面是元音', () => {
    const only = normalizeGrammar({
      morphemes: [
        { id: 'M', type: 'prefix', form: 'm' },
        { id: 'A', type: 'infix', form: 'a', free: false },
        { id: 'X', type: 'infix', form: 'in' },
      ],
      constructions: [{ id: 'MA', sequence: ['M', 'A'] }],
    })
    const test = (/** @type {string} */ q, /** @type {string} */ r) => compileExactRegex(only, r).regex.test(q)
    expect(compileExactRegex(only, 'usa').source).toContain('ma(?=[')
    expect(test('mausa', 'usa')).toBe(true)
    expect(test('mabaket', 'baket')).toBe(false) // m ＋ <a> 在輔音開頭的詞根上落進詞根：mbaaket，不是 ma-
    expect(test('mbaaket', 'baket')).toBe(false) // <a> 不是自由的詞素，沒有這種分析
    expect(test('minusa', 'usa')).toBe(true) // m<in>（複合前綴）＋ usa
    expect(test('mbinaket', 'baket')).toBe(true) // m- ＋ b<in>aket（詞根上的中綴）
  })
})

describe('與類 pika 剖析器雙向比對（隨機文法）', () => {
  it.each([1, 2, 3, 4])('種子 %i：正規表達式認得 ⇒ chart 找得到詞根；chart 的零音變分析 ⇒ 正規表達式認得', { timeout: 120_000 }, (seed) => {
    const random = createRandom(seed * 31337)
    let matched = 0
    let zero = 0
    for (let round = 0; round < 10; round++) {
      const setup = randomGrammarSetup(random)
      const { metric, roots, grammar } = setup
      const index = new FuzzyIndex(metric).addAll(roots)
      const chart = createChartSearch({ grammar, metric, index })
      const regexes = new Map(roots.map((r) => [r, compileExactRegex(grammar, r).regex]))
      for (let k = 0; k < 10; k++) {
        const query = randomQuery(random, setup)
        if (Array.from(query).length < grammar.minStem + 1) continue
        const hits = chart.search(query, { maxDistance: 10 })
        const found = new Set(hits.map((h) => h.term))
        for (const root of roots) {
          if (root === query || Array.from(root).length < grammar.minStem) continue
          if (!regexes.get(root)?.test(query)) continue
          matched++
          expect(found.has(root), `seed=${seed} round=${round} ${query} → ${root}`).toBe(true)
        }
        for (const h of hits) {
          if (metric.explainSegments(h.trace.query, h.trace.segments, h.trace.options).distance !== 0) continue
          zero++
          expect(regexes.get(h.term)?.test(query), `seed=${seed} round=${round} ${query} → ${h.term}：${JSON.stringify(h.steps.map((s) => s.form))}`).toBe(true)
        }
      }
    }
    expect(matched).toBeGreaterThan(20)
    expect(zero).toBeGreaterThan(20)
  })

  it('推導產生器的輸出（自由的詞素、沒有音變）都被認得', () => {
    const random = createRandom(99)
    for (let round = 0; round < 20; round++) {
      const { grammar, roots } = randomGrammarSetup(random)
      const side = (/** @type {string} */ type) => grammar.morphemes.filter((m) => m.free && m.type === type)
      /** 一側至多 maxSteps 個自由的詞素（隨機挑、可以重複） @param {string} type */
      const pickSide = (type) => {
        const list = side(type)
        const count = list.length ? Math.floor(random() * (grammar.maxSteps + 1)) : 0
        return Array.from({ length: count }, () => {
          const m = list[Math.floor(random() * list.length)]
          return { id: m.id, allomorph: Math.floor(random() * m.allomorphs.length) }
        })
      }
      for (const root of roots) {
        const ops = [...pickSide('prefix'), ...pickSide('suffix')]
        if (!ops.length) continue
        const surface = derive(grammar, root, ops).surface
        expect(compileExactRegex(grammar, root).regex.test(surface), `${root} ${JSON.stringify(ops)} → ${surface}`).toBe(true)
      }
    }
  })
})

describe('詞根未知：正規表達式的界線', () => {
  it('反向參照表達重疊：kikita → ki ＋ kita', () => {
    const red = normalizeGrammar({ morphemes: [{ id: 'RED', type: 'reduplication', pattern: 'CV' }, { id: 'LF', type: 'suffix', form: 'an' }] })
    const m = compileSearchRegex(red).regex.exec('kikitaan')
    expect(m?.groups).toMatchObject({ red: 'ki', root: 'kita', suffixes: 'an' })
    expect(compileSearchRegex(red).regex.exec('kikita')?.groups?.root).toBe('kita')
  })

  it('只回傳第一個成功的分析：mubaket 得到 m- ＋ ubaket（回溯先試 m），不是成本最低的 mu- ＋ baket', () => {
    const m = compileSearchRegex(g).regex.exec('mubaket')
    expect(m?.groups).toMatchObject({ prefixes: 'm', root: 'ubaket' })
  })
})
