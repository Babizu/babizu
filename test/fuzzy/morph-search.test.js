/**
 * 構詞搜尋（morph-search.js）的性質測試。對應 docs/bcdp.md：
 *
 * - 定理 3：詞綴圖表 P[i]（S[k]）等於「把 q[0..i)（q[k..n)）切成至多 maxSteps 個詞綴、每段與詞綴的距離 ≤ δ」
 *   的所有切法中，成本總和的最小值
 * - 構詞搜尋的結果：每個命中的成本 = 前綴鏈 ＋ 詞幹距離 ＋ 後綴鏈，且等於窮舉所有切法的最小值
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, createMorphSearch, EPSILON, FuzzyIndex, RuleSet, WeightedEditDistance } from '../../src/fuzzy/index.js'
import { createRandom, randomString } from './helpers.js'

const alphabet = ['a', 'b', 'd', 'm', 'n', 'u']

/** @param {() => number} random */
function randomSetup(random) {
  const rules = new RuleSet()
  for (let k = 0; k < 3; k++) {
    rules.add(randomString(random, alphabet, 1, 2), randomString(random, alphabet, 1, 2), 0.1)
  }
  const metric = new WeightedEditDistance({ rules, normalize: (s) => s })
  const affixes = (/** @type {number} */ count) =>
    [...new Set(Array.from({ length: count }, () => randomString(random, alphabet, 1, 3)))].map((form) => ({ form }))
  const spec = {
    cost: 0.3,
    minStem: 2,
    maxSteps: 2,
    lemmaDistance: 0.2,
    affixDistance: 0.1,
    lemmaSpread: 100,
    prefixes: affixes(4),
    suffixes: affixes(3),
  }
  const analyzer = createAnalyzer(spec)
  return { metric, spec, analyzer }
}

/**
 * 窮舉：把 piece 切成至多 slots 個詞綴，每段與某詞綴距離 ≤ δ，回傳最小成本（切不出來為 ∞）。
 * @param {string} piece
 * @param {Array<{form: string, cost: number}>} list
 * @param {number} slots
 * @param {WeightedEditDistance} metric
 * @param {number} delta
 * @returns {number}
 */
function bruteChain(piece, list, slots, metric, delta) {
  if (piece === '') return 0
  if (slots === 0) return Infinity
  let best = Infinity
  for (let cut = 1; cut <= piece.length; cut++) {
    const head = piece.slice(0, cut)
    let one = Infinity
    for (const a of list) {
      const d = metric.distance(head, a.form)
      if (d <= delta + EPSILON) one = Math.min(one, a.cost + d)
    }
    if (one === Infinity) continue
    best = Math.min(best, one + bruteChain(piece.slice(cut), list, slots - 1, metric, delta))
  }
  return best
}

describe('構詞搜尋：性質測試', () => {
  it.each([1, 2, 3, 4, 5])('詞綴圖表等於窮舉所有切法的最小值（定理 3，種子 %i）', (seed) => {
    const random = createRandom(seed * 6151)
    for (let round = 0; round < 15; round++) {
      const { metric, spec, analyzer } = randomSetup(random)
      const search = createMorphSearch({ analyzer, metric, index: new FuzzyIndex(metric) })
      const query = randomString(random, alphabet, 3, 8)
      const n = query.length
      const { P, S } = search.charts(Array.from(query))
      const minSurface = Math.max(1, spec.minStem - 1)
      for (let i = 0; i <= n; i++) {
        // 圖表只考慮「後面至少還留 minStem − 1 個字元給詞幹」的前綴鏈終點
        const expected = i === 0 ? 0 : i > n - minSurface ? Infinity : bruteChain(query.slice(0, i), analyzer.spec.prefixes, spec.maxSteps, metric, spec.affixDistance)
        expect(P.cost[i], `P[${i}] query=${query}`).toBeCloseTo(expected, 9)
      }
      for (let k = 0; k <= n; k++) {
        const expected = k === n ? 0 : k < minSurface ? Infinity : bruteChain(query.slice(k), analyzer.spec.suffixes, spec.maxSteps, metric, spec.affixDistance)
        expect(S.cost[k], `S[${k}] query=${query}`).toBeCloseTo(expected, 9)
      }
    }
  })

  it.each([1, 2, 3])('命中成本等於窮舉：min over i < k of P[i] + E(q[i..k), t) + S[k]，且 E ≤ λ（種子 %i）', (seed) => {
    const random = createRandom(seed * 3571)
    for (let round = 0; round < 10; round++) {
      const { metric, spec, analyzer } = randomSetup(random)
      const vocabulary = [...new Set(Array.from({ length: 25 }, () => randomString(random, alphabet, 2, 5)))]
      const index = new FuzzyIndex(metric).addAll(vocabulary.map((w) => [w, w]))
      const search = createMorphSearch({ analyzer, metric, index })
      for (let q = 0; q < 5; q++) {
        const query = randomString(random, alphabet, 3, 8)
        const n = query.length
        const { P, S } = search.charts(Array.from(query))
        const maxDistance = 1.5
        const hits = new Map(search.search(query, { maxDistance }).map((h) => [h.term, h.distance]))
        for (const term of vocabulary) {
          if (term === query) continue
          let best = Infinity
          for (let i = 0; i <= n; i++) {
            for (let k = i + 1; k <= n; k++) {
              if (i === 0 && k === n) continue // 沒有構詞步驟的是普通模糊命中
              const d = metric.distance(query.slice(i, k), term)
              if (d > spec.lemmaDistance + EPSILON) continue
              best = Math.min(best, P.cost[i] + d + S.cost[k])
            }
          }
          const expected = best <= maxDistance + EPSILON ? Math.round(best * 1e9) / 1e9 : undefined
          expect(hits.get(term), `query=${query} term=${term}`).toBe(expected)
        }
      }
    }
  })
})
