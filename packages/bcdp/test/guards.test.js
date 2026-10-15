/**
 * 防禦邏輯：公開 API 收到錯誤的參數時，在邊界上以清楚的訊息丟出，而不是在演算法內部產生空結果、NaN 或把 undefined
 * 當成空字串。（搜尋引擎的選項來自介面，維持寬容，見 babizu 的 test/search/options.test.js。）
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, createMorphSearch, FuzzyIndex } from '../src/index.ts'
import { createPazehKaxabuMetric } from './fixtures/pazeh.js'

const metric = createPazehKaxabuMetric()
const index = new FuzzyIndex(metric).addAll([
  ['daux', 1],
  ['kita', 2],
])

describe('距離函式：查詢與候選必須是字串', () => {
  it.each([undefined, null, 5, ['a']])('distance、normalizedDistance、explain 收到 %s 時丟出 TypeError', (bad) => {
    expect(() => metric.distance(/** @type {any} */ (bad), 'a')).toThrow(TypeError)
    expect(() => metric.distance('a', /** @type {any} */ (bad))).toThrow(TypeError)
    expect(() => metric.normalizedDistance(/** @type {any} */ (bad), 'a')).toThrow(TypeError)
    expect(() => metric.explain('a', /** @type {any} */ (bad))).toThrow(TypeError)
  })

  it('空字串是合法的輸入', () => {
    expect(metric.distance('', 'a')).toBe(0.8)
  })
})

describe('FuzzyIndex：詞與查詢必須是字串，距離上限必須是非負數', () => {
  it('加入非字串的詞時丟出 TypeError', () => {
    expect(() => new FuzzyIndex(metric).add(/** @type {any} */ (5))).toThrow(TypeError)
    expect(() => new FuzzyIndex(metric).addAll(/** @type {any} */ ([[null, 1]]))).toThrow(TypeError)
  })

  it.each([undefined, null, 123])('查詢是 %s 時丟出 TypeError', (bad) => {
    expect(() => index.search(/** @type {any} */ (bad), { maxDistance: 1 })).toThrow(TypeError)
  })

  it.each([NaN, -0.1, '1'])('maxDistance 是 %s 時丟出 RangeError', (bad) => {
    expect(() => index.search('dox', { maxDistance: /** @type {any} */ (bad) })).toThrow(RangeError)
  })

  it.each([NaN, -1, 1.5])('limit 是 %s 時丟出 RangeError', (bad) => {
    expect(() => index.search('dox', { maxDistance: 1, limit: bad })).toThrow(RangeError)
  })

  it('maxDistance 可以是 Infinity（窮舉）、可以省略；limit 可以是 0 或 Infinity', () => {
    expect(index.search('dox', { maxDistance: Infinity })).toHaveLength(2)
    expect(index.search('daux').map((r) => r.term)).toEqual(['daux'])
    expect(index.search('dox', { maxDistance: Infinity, limit: 0 })).toEqual([])
    expect(index.search('dox', { maxDistance: Infinity, limit: Infinity })).toHaveLength(2)
  })
})

describe('構詞搜尋：查詢必須是字串，距離上限必須是非負數；省略時是 1', () => {
  const ms = createMorphSearch({ analyzer: createAnalyzer({ prefixes: [{ form: 'mu' }] }), metric, index })

  it('錯誤的參數丟出 TypeError、RangeError', () => {
    expect(() => ms.search(/** @type {any} */ (123), { maxDistance: 1 })).toThrow(TypeError)
    expect(() => ms.search('mudox', { maxDistance: NaN })).toThrow(RangeError)
    expect(() => ms.explain(/** @type {any} */ (null))).toThrow(TypeError)
  })

  it('省略 maxDistance 與傳入 1 的結果相同（總成本上限也是 1，不是沒有上限）', () => {
    expect(ms.search('mudox', {})).toEqual(ms.search('mudox', { maxDistance: 1 }))
    expect(ms.search('mupaxuxuxux', {})).toEqual(ms.search('mupaxuxuxux', { maxDistance: 1 }))
  })
})
