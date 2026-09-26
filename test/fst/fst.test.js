/**
 * 實驗性 WFST 參考後端的測試：q ∘ E ∘ S 的最短路徑必須等於窮舉——
 * 列出每個詞幹的所有表面詞形（前綴鏈 × Ca 重疊 × 中綴 × 交替 × 後綴鏈），
 * W*(q, t) = min over 表面詞形 u of 構詞成本(u) + E(q, u)。
 */

import { describe, expect, it } from 'vitest'
import { EPSILON, FuzzyIndex, RuleSet, WeightedEditDistance, createAnalyzer } from '../../src/fuzzy/index.js'
import { compose, editTransducer, fstLemmaSearch, shortestDistance, stringAcceptor, surfaceLexicon } from '../../src/fst/index.js'
import { createRandom, pick, randomString } from '../fuzzy/helpers.js'

describe('WFST 基本運算', () => {
  it('字串接受器 ∘ 編輯轉錄器 ∘ 字串接受器 = 加權編輯距離', () => {
    const rules = new RuleSet().add('r', 'l', 0.1).add('l', 'n', 0.1, { position: 'final' }).add('au', 'o', 0.1)
    const metric = new WeightedEditDistance({ rules, normalize: (s) => s })
    const E = editTransducer(metric, 'abdilnortuwx')
    for (const [q, t] of [
      ['bintul', 'bintun'],
      ['raulu', 'laulu'],
      ['dox', 'daux'],
      ['alaw', 'anaw'],
      ['', 'ab'],
      ['abc', ''],
    ]) {
      const machine = compose(stringAcceptor(Array.from(q)), compose(E, stringAcceptor(Array.from(t))))
      expect(shortestDistance(machine).best, `${q} → ${t}`).toBeCloseTo(metric.distance(q, t), 9)
    }
  })
})

describe('WFST 構詞搜尋：與窮舉相同', () => {
  const alphabet = ['a', 'u', 'b', 'd', 'm', 'n']
  const vowels = new Set(['a', 'u'])

  /** @param {() => number} random */
  function setup(random) {
    const rules = new RuleSet()
    for (let k = 0; k < 3; k++) {
      rules.add(randomString(random, alphabet, 1, 2), randomString(random, alphabet, 0, 2) || 'a', 0.1, {
        position: pick(random, ['any', 'any', 'initial', 'final']),
      })
    }
    const metric = new WeightedEditDistance({ rules, normalize: (s) => s })
    const spec = {
      cost: 0.3,
      minStem: 2,
      maxSteps: 2,
      vowels: 'au',
      prefixes: [{ form: randomString(random, alphabet, 1, 2) }, { form: randomString(random, alphabet, 1, 2) }],
      suffixes: [{ form: randomString(random, alphabet, 1, 2) }, { form: 'an' }],
      infixes: [{ form: 'in' }],
      reduplication: [{ pattern: 'Ca' }],
      alternations: [{ underlying: 'd', surface: 'n' }],
    }
    const analyzer = createAnalyzer(spec)
    return { metric, spec: analyzer.spec }
  }

  /**
   * 窮舉一個詞幹的所有表面詞形與構詞成本（至少一個步驟）。
   * @param {string} t
   * @param {any} spec
   */
  function surfaces(t, spec) {
    /** @type {Array<[string, number]>} */
    const out = []
    const seqs = (/** @type {any[]} */ list) => {
      /** @type {Array<[string, number, string[]]>} */
      const res = [['', 0, []]]
      let frontier = res.slice()
      for (let k = 0; k < spec.maxSteps; k++) {
        const next = []
        for (const [s, c, forms] of frontier) for (const a of list) next.push([s + a.form, c + a.cost, [...forms, a.form]])
        res.push(...next)
        frontier = next
      }
      return res
    }
    const chars = Array.from(t)
    let onsetLength = 0
    while (onsetLength < chars.length && !vowels.has(chars[onsetLength])) onsetLength++
    /** @type {Array<[string, number, boolean, boolean]>} 核心形式（詞幹＋非串接步驟）、成本、後面必須接後綴（構詞音變）、是否算一個步驟 */
    const cores = []
    const redups = [['', 0]]
    // Ca 重疊：與 WFST 相同，只重疊第一個輔音（元音開頭則只重疊 a）
    redups.push([vowels.has(chars[0]) ? 'a' : `${chars[0]}a`, spec.reduplication[0].cost])
    for (const [red, redCost] of redups) {
      const infixed = [[t, 0]]
      if (onsetLength < chars.length) {
        for (const x of spec.infixes) infixed.push([chars.slice(0, onsetLength).join('') + x.form + chars.slice(onsetLength).join(''), x.cost])
      }
      for (const [stem, xCost] of infixed) {
        const op = red !== '' || stem !== t
        cores.push([red + stem, redCost + xCost, false, op])
        // 構詞音變：詞幹末的字元寫成另一個，後面必須接後綴；它是規則，不另外算一個步驟
        for (const a of spec.alternations) {
          if (stem.endsWith(a.underlying)) cores.push([red + stem.slice(0, -1) + a.surface, redCost + xCost + a.cost, true, op])
        }
      }
    }
    for (const [p, pc] of seqs(spec.prefixes)) {
      for (const [core, cc, needsSuffix, op] of cores) {
        for (const [s, sc, forms] of seqs(spec.suffixes)) {
          if (needsSuffix && forms.length === 0) continue
          const steps = (p ? 1 : 0) + (s ? 1 : 0) + (op ? 1 : 0)
          if (steps === 0) continue
          out.push([p + core + s, pc + cc + sc])
        }
      }
    }
    return out
  }

  it.each([1, 2, 3, 4])('種子 %i', (seed) => {
    const random = createRandom(seed * 2749)
    for (let round = 0; round < 6; round++) {
      const { metric, spec } = setup(random)
      const vocabulary = [...new Set(Array.from({ length: 8 }, () => randomString(random, alphabet, 2, 4)))]
      const index = new FuzzyIndex(metric).addAll(vocabulary.map((w) => [w, w]))
      const allChars = new Set([...vocabulary.join(''), ...spec.prefixes.map((a) => a.form).join(''), ...spec.suffixes.map((a) => a.form).join(''), 'i', 'n', 'a'])
      const E = editTransducer(metric, allChars)
      const S = surfaceLexicon({ dawg: index.dawg, spec })
      for (let q = 0; q < 4; q++) {
        const query = randomString(random, alphabet, 2, 6)
        const bound = 1
        const { hits } = fstLemmaSearch({ E, S, termAt: (base) => index.terms[base] }, query, { bound })
        for (const t of vocabulary) {
          let best = Infinity
          for (const [u, cost] of surfaces(t, spec)) best = Math.min(best, cost + metric.distance(query, u))
          const expected = best <= bound + EPSILON ? Math.round(best * 1e9) / 1e9 : undefined
          expect(hits.get(t), `query=${query} stem=${t}`).toBe(expected)
        }
      }
    }
  })
})
