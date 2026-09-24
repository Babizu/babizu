import { describe, expect, it } from 'vitest'
import { roundCost } from '../../src/fuzzy/index.js'
import { createPazehKaxabuMetric } from '../fixtures/pazeh.js'
import { createRandom, randomString } from './helpers.js'

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
})
