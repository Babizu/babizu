/**
 * 以窮舉參考實作（test/fuzzy/reference/ref-morph.js）仲裁「構詞文法編譯成 BCDP」：
 * 隨機的文法（同位詞素與條件、落在前綴上的中綴、組合規則）× 隨機的詞庫與查詢，
 * 每個詞根的成本（含不成立的條件的懲罰）都要與窮舉相同。
 *
 * BCDP 的條件是分類計算的（交界狀態依還沒決定的條件分類、沿詞綴與詞圖的字元讀下去）；
 * 參考實作直接在具體的字串上讀條件，兩者獨立（docs/morph-grammar.md 5.3）。
 */

import { describe, expect, it } from 'vitest'
import { createMorphSearch, FuzzyIndex, roundCost } from '../../../src/fuzzy/index.js'
import { createRandom, pick } from '../helpers.js'
import { refJointContext } from '../reference/ref-joint.js'
import { refMorph } from '../reference/ref-morph.js'
import { randomGrammarSetup, randomQuery } from './random-grammar.js'

describe('構詞文法編譯成 BCDP：與窮舉相同（含同位詞素條件的懲罰）', () => {
  /** @type {Map<string, number>} reaching check：懲罰、組合規則、複合前綴都要真的出現在命中裡 */
  const reached = new Map()
  const reach = (/** @type {string} */ kind) => reached.set(kind, (reached.get(kind) ?? 0) + 1)

  it.each([1, 2, 3, 4, 5, 6])('種子 %i', { timeout: 120_000 }, (seed) => {
    const random = createRandom(seed * 7919)
    let compared = 0
    for (let round = 0; round < 8; round++) {
      const setup = randomGrammarSetup(random)
      const { metric, analyzer, roots, spec } = setup
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const search = createMorphSearch({ analyzer, metric, index })
      const ctx = refJointContext(metric)
      for (let k = 0; k < 8; k++) {
        const query = randomQuery(random, setup)
        const maxDistance = pick(random, [0.8, 1, 1.2])
        const prepared = search.prepare(query, maxDistance)
        if (!prepared || prepared.truncated) continue
        const hits = search.finish(prepared, index.searchChannels(prepared.channels), maxDistance)
        for (const h of hits) {
          // 說明的對齊 ＋ 步驟成本 ＋ 條件的懲罰 ＝ 命中的成本
          const e = search.explainHit(prepared, h).explanation
          const steps = h.steps.reduce((a, s) => a + s.cost, 0)
          expect(roundCost(e.distance + steps + (h.penalty ?? 0)), `${query} → ${h.term}`).toBeCloseTo(h.distance, 7)
          if (h.penalty) reach('penalty')
          if (h.steps.some((s) => s.violations?.length)) reach('static')
          if (h.penalty && !/[aiu]/.test(h.term)) reach('undecided')
          if (h.steps.some((s) => s.construction)) reach('construction')
          if (h.steps.some((s) => s.type === 'prefix' && (s.parts?.length ?? 0) > 1)) reach('composite')
        }
        const got = new Map(hits.map((h) => [h.term, h.distance]))
        /** @type {Map<string, string>} */
        const why = new Map()
        const want = refMorph(ctx, { query, lexicon: roots, spec: analyzer.spec, maxDistance, why })
        for (const t of new Set([...got.keys(), ...want.keys()])) {
          expect(got.get(t) ?? Infinity, `seed=${seed} round=${round} query=${query} term=${t}；參考：${why.get(t) ?? '—'}；規格：${JSON.stringify(spec)}`).toBeCloseTo(want.get(t) ?? Infinity, 7)
        }
        compared++
      }
    }
    expect(compared).toBeGreaterThan(40)
  })

  it('reaching check：隨機測試涵蓋不成立的條件、組合規則、複合前綴、編譯時就決定的條件、讀到詞根結尾仍未決定的條件', () => {
    for (const kind of ['penalty', 'construction', 'composite', 'static', 'undecided']) expect(reached.get(kind) ?? 0, `${kind}：${JSON.stringify([...reached])}`).toBeGreaterThanOrEqual(3)
  })
})
