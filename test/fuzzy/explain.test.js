import { describe, expect, it } from 'vitest'
import { roundCost, RuleSet, WeightedEditDistance } from '../../src/fuzzy/index.js'
import { createPazehKaxabuMetric } from '../fixtures/pazeh.js'
import { createRandom, pick, randomString } from './helpers.js'

describe('explain', () => {
  const metric = createPazehKaxabuMetric()

  it('semer → semee：矩陣右下角 0.1，對齊路徑使用 er→ee 規則', () => {
    const e = metric.explain('semer', 'semee')
    expect(e.distance).toBe(0.1)
    expect(e.matrix[5][5]).toBe(0.1)
    expect(e.matrix[0][0]).toBe(0)
    const ruleSteps = e.alignment.filter((s) => s.op === 'rule')
    expect(ruleSteps).toHaveLength(1)
    expect(ruleSteps[0]).toMatchObject({ source: 'er', target: 'ee', cost: 0.1 })
    expect(ruleSteps[0].rule?.category).toBe('閃音')
    expect(e.path[0]).toEqual([0, 0])
    expect(e.path.at(-1)).toEqual([5, 5])
  })

  it('每格候選依成本排序，第一個候選等於該格數值', () => {
    const e = metric.explain('bintul', 'bintun')
    for (let i = 0; i < e.matrix.length; i++) {
      for (let j = 0; j < e.matrix[i].length; j++) {
        if (i === 0 && j === 0) continue
        expect(e.candidates[i][j][0].cost).toBe(e.matrix[i][j])
      }
    }
  })

  it('finalColumns 標出候選字串的詞尾欄', () => {
    const e = metric.explain('a b', 'ab c')
    expect(e.finalColumns).toEqual([false, false, true, false, true])
  })

  it('性質：對齊步驟成本總和 = distance，且片段拼回原字串', () => {
    const random = createRandom(20260917)
    const alphabet = ['a', 'e', 'r', 'l', 'n', 'u', 'h', ' ', 'x', 'k']
    for (let t = 0; t < 300; t++) {
      const q = randomString(random, alphabet, 0, 7)
      const c = randomString(random, alphabet, 0, 7)
      const e = metric.explain(q, c)
      expect(e.distance).toBe(metric.distance(q, c))
      const total = roundCost(e.alignment.reduce((s, step) => s + step.cost, 0))
      expect(total).toBeCloseTo(e.distance, 9)
      expect(e.alignment.map((s) => s.source).join('')).toBe(e.query.join(''))
      expect(e.alignment.map((s) => s.target).join('')).toBe(e.candidate.join(''))
    }
  })

  it('align 與 explain(...).alignment 逐位元相同（網站規則，以及隨機規則：多字元、空字串、詞首詞尾、同分）', () => {
    const random = createRandom(4099)
    const alphabet = ['a', 'e', 'r', 'l', 'n', 'u', 'h', ' ', 'x', 'k']
    for (let t = 0; t < 300; t++) {
      const q = randomString(random, alphabet, 0, 7)
      const c = randomString(random, alphabet, 0, 7)
      expect(metric.align(q, c), `${q} / ${c}`).toEqual(metric.explain(q, c).alignment)
    }
    // 權重只取少數幾種，讓同分的候選常常出現（考驗 OP_PRIORITY 與先回報者的順序）
    for (let seed = 1; seed <= 10; seed++) {
      const rnd = createRandom(seed * 131)
      const rules = new RuleSet()
      for (let k = 0; k < 1 + Math.floor(rnd() * 6); k++) {
        const source = randomString(rnd, alphabet.slice(0, 6), 0, 3)
        rules.add(source, randomString(rnd, alphabet.slice(0, 6), source ? 0 : 1, 3), pick(rnd, [0.5, 1]), {
          position: pick(rnd, ['any', 'initial', 'final']),
          bidirectional: rnd() < 0.7,
        })
      }
      const m = new WeightedEditDistance({ rules, normalize: (s) => s })
      for (let k = 0; k < 80; k++) {
        const q = randomString(rnd, alphabet, 0, 6)
        const c = randomString(rnd, alphabet, 0, 6)
        expect(m.align(q, c), `seed=${seed} ${q} / ${c}`).toEqual(m.explain(q, c).alignment)
      }
    }
  })
})
