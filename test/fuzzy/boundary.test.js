/**
 * 邊界條件搜尋（構詞搜尋的基礎）的性質測試。對應 docs/bcdp.md 第 4–6 節的定理：
 *
 * - 定理 1／推論 1：帶起點向量 start 與終點向量 end 的詞圖搜尋，在沒有詞首、詞尾規則時結果等於
 *     W(q, t) = min over i ≤ k of  start[i] + E(q[i..k), t) + end[k]
 *   有詞首、詞尾規則時，所有有限起點（終點）都算詞首（詞尾），結果只會不大於上式（定理 1 (b)），
 *   等於「每個起點各搜一次、其他起點仍標成詞首」的最小值
 * - 定理 2：加上邊界條件後剪枝仍然安全（結果與暴力法完全相同，一筆不漏）
 * - 沒有邊界條件時，行為與原本的搜尋完全相同
 */

import { describe, expect, it } from 'vitest'
import { EPSILON, FuzzyIndex, RuleSet, WeightedEditDistance } from '../../src/fuzzy/index.js'
import { createRandom, pick, randomString } from './helpers.js'

const alphabet = ['a', 'b', 'r', 'l', 'n', 'e']

/**
 * @param {() => number} random
 * @param {boolean} positional 是否包含詞首／詞尾規則
 */
function randomMetric(random, positional) {
  const rules = new RuleSet()
  const count = 1 + Math.floor(random() * 7)
  for (let k = 0; k < count; k++) {
    const source = randomString(random, alphabet, 0, 3)
    let target = randomString(random, alphabet, 0, 4)
    if (source === '' && target === '') target = 'a'
    rules.add(source, target, Math.round(random() * 10) / 10, {
      position: positional ? pick(random, ['any', 'any', 'initial', 'final']) : 'any',
      bidirectional: random() < 0.7,
    })
  }
  return new WeightedEditDistance({
    rules,
    costs: { substitute: 0.5 + random() * 1.5, delete: 0.3 + random(), insert: 0.3 + random() },
    normalize: (s) => s,
  })
}

/**
 * 隨機的邊界向量：大多數位置是 ∞，少數位置有非負成本（模擬前綴鏈的終點與後綴鏈的起點）。
 * @param {() => number} random
 * @param {number} length
 * @param {number} anchor 必定有限的位置（起點向量是 0，終點向量是 n）
 */
function randomBoundary(random, length, anchor) {
  return Array.from({ length }, (_, i) => (i === anchor ? 0 : random() < 0.35 ? Math.round(random() * 10) / 10 : Infinity))
}

describe('邊界條件搜尋：性質測試', () => {
  it.each([1, 2, 3, 4, 5, 6])('與暴力法相同：min over i ≤ k of start[i] + E(q[i..k), t) + end[k]（種子 %i）', (seed) => {
    const random = createRandom(seed * 104729)
    for (let round = 0; round < 20; round++) {
      // 沒有詞首／詞尾規則時，子字串的距離與全字串中的位置無關，可以獨立用 metric.distance 計算
      const metric = randomMetric(random, false)
      const vocabulary = [...new Set(Array.from({ length: 30 }, () => randomString(random, alphabet, 1, 6)))]
      const index = new FuzzyIndex(metric).addAll(vocabulary.map((w) => [w, w]))
      for (let q = 0; q < 5; q++) {
        const query = randomString(random, alphabet, 1, 7)
        const n = query.length
        const start = randomBoundary(random, n + 1, 0)
        const end = randomBoundary(random, n + 1, n)
        const maxDistance = Math.round(random() * 25) / 10

        const expected = vocabulary
          .map((term) => {
            let best = Infinity
            for (let i = 0; i <= n; i++) {
              if (start[i] === Infinity) continue
              for (let k = i; k <= n; k++) {
                if (end[k] === Infinity) continue
                best = Math.min(best, start[i] + metric.distance(query.slice(i, k), term) + end[k])
              }
            }
            return { term, distance: Math.round(best * 1e9) / 1e9 }
          })
          .filter((r) => r.distance <= maxDistance + EPSILON)
          .map((r) => `${r.term}@${r.distance}`)
          .sort()
        const actual = index
          .search(query, { maxDistance, start, end })
          .map((r) => `${r.term}@${r.distance}`)
          .sort()
        expect(actual, `query=${query} start=${start} end=${end} max=${maxDistance}`).toEqual(expected)
      }
    }
  })

  it.each([1, 2, 3, 4])('含詞首／詞尾規則：一次搜尋等於「每個起點各搜一次」的最小值（種子 %i）', (seed) => {
    const random = createRandom(seed * 7907)
    for (let round = 0; round < 20; round++) {
      const metric = randomMetric(random, true)
      const vocabulary = [...new Set(Array.from({ length: 30 }, () => randomString(random, alphabet, 1, 6)))]
      const index = new FuzzyIndex(metric).addAll(vocabulary.map((w) => [w, w]))
      for (let q = 0; q < 5; q++) {
        const query = randomString(random, alphabet, 1, 7)
        const n = query.length
        const start = randomBoundary(random, n + 1, 0)
        const end = randomBoundary(random, n + 1, n)
        const maxDistance = Math.round(random() * 25) / 10
        // 詞首／詞尾的判定依整個 start／end 向量而定，所以單一起點的搜尋仍帶著同一組「額外詞首位置」：
        // 以 ∞ 以外的極大值（1e6）標記其他起點，讓它們算詞首但不會被選為起點
        /** @type {Map<string, number>} */
        const best = new Map()
        for (let i = 0; i <= n; i++) {
          if (start[i] === Infinity) continue
          const single = start.map((c, p) => (p === i ? c : c === Infinity ? Infinity : 1e6))
          for (const r of index.search(query, { maxDistance: 1e5, start: single, end })) {
            if (r.distance < (best.get(r.term) ?? Infinity)) best.set(r.term, r.distance)
          }
        }
        const expected = [...best]
          .filter(([, d]) => d <= maxDistance + EPSILON)
          .map(([t, d]) => `${t}@${d}`)
          .sort()
        const actual = index
          .search(query, { maxDistance, start, end })
          .map((r) => `${r.term}@${r.distance}`)
          .sort()
        expect(actual, `query=${query}`).toEqual(expected)
      }
    }
  })

  it('定理 1 (b) 的實例：有詞首規則時，一次搜尋比逐段計算便宜（其他起點也算詞首）', () => {
    const metric = new WeightedEditDistance({ rules: new RuleSet().add('k', 'g', 0.2, { position: 'initial' }), costs: { delete: 0.1 }, normalize: (s) => s })
    const index = new FuzzyIndex(metric).addAll([['gxy', 'gxy']])
    const I = Infinity
    const start = [0, I, 0.5, I, I, I]
    const end = [I, I, I, I, I, 0]
    // 逐段計算：從 0 出發時 k 不在詞首（1.1）；從 2 出發是 0.5 ＋ 0.2
    const perSegment = Math.min(start[0] + metric.distance('abkxy', 'gxy'), start[2] + metric.distance('kxy', 'gxy'))
    expect(perSegment).toBeCloseTo(0.7, 9)
    // 一次搜尋：從 0 出發，刪掉 a、b，在位置 2（也是有限起點）套用詞首規則
    const [hit] = index.search('abkxy', { maxDistance: 2, start, end })
    expect(hit.distance).toBeCloseTo(0.4, 9)
  })

  it('沒有邊界條件時結果不變；start = [0, ∞…]、end = [∞…, 0] 等於普通搜尋', () => {
    const random = createRandom(42)
    const metric = randomMetric(random, true)
    const vocabulary = [...new Set(Array.from({ length: 50 }, () => randomString(random, alphabet, 1, 6)))]
    const index = new FuzzyIndex(metric).addAll(vocabulary.map((w) => [w, w]))
    for (let q = 0; q < 30; q++) {
      const query = randomString(random, alphabet, 1, 6)
      const n = query.length
      const plain = index.search(query, { maxDistance: 2 })
      const start = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : Infinity))
      const end = Array.from({ length: n + 1 }, (_, i) => (i === n ? 0 : Infinity))
      const bounded = index.search(query, { maxDistance: 2, start, end })
      expect(bounded.map((r) => [r.term, r.distance])).toEqual(plain.map((r) => [r.term, r.distance]))
    }
  })

  it('回報詞在查詢中結束的位置；onTerminal 附上完整的列', () => {
    const metric = new WeightedEditDistance({ normalize: (s) => s })
    const index = new FuzzyIndex(metric).addAll([['daux', 1], ['mu', 2]])
    const q = 'mudauxan'
    const start = [0, Infinity, 0.3, Infinity, Infinity, Infinity, Infinity, Infinity, Infinity]
    const end = [Infinity, Infinity, Infinity, Infinity, Infinity, Infinity, 0.3, Infinity, 0]
    const hit = index.search(q, { maxDistance: 1, start, end }).find((r) => r.term === 'daux')
    expect(hit).toMatchObject({ distance: 0.6, endAt: 6 })

    /** @type {Record<string, number[]>} */
    const rows = {}
    index.search('muda', { maxDistance: 5, onTerminal: (term, row) => (rows[term] = [...row]) })
    // row[i]：查詢前 i 個字元轉成這個詞的成本；'mu' 在 i = 2 時為 0
    expect(rows.mu[2]).toBe(0)
  })

  it('長度不符的邊界向量會報錯', () => {
    const index = new FuzzyIndex(new WeightedEditDistance()).addAll([['a', 1]])
    expect(() => index.search('ab', { start: [0, 0] })).toThrow(/長度/)
  })
})
