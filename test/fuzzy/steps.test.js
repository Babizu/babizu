/**
 * 演算法實驗室的步驟模型（src/fuzzy/steps.js）：步數與說明結果一致、最後一步的狀態等於正式實作的結果、
 * 狀態只由步驟序號決定（可以任意跳）、每個說明都有英文譯文。
 */

import { describe, expect, it } from 'vitest'
import en from '../../locales/en.json' with { type: 'json' }
import { createAnalyzer, createMorphSearch, FuzzyIndex, REDUPLICATION_PATTERNS, RuleSet, WeightedEditDistance } from '../../src/fuzzy/index.js'
import { alternationRules } from '../../src/fuzzy/morphology.js'
import { bcdpStateAt, bcdpSteps, dawgStateAt, dawgSteps, DISTANCE_PARAMS, dpStateAt, dpSteps } from '../../src/fuzzy/steps.js'
import { sourceText } from '../../src/site/messages.js'
import { createRandom, pick, randomString } from './helpers.js'

/** 說明（中文原文）有英文譯文，文字中的 {參數} 都由步驟提供 @param {import('../../src/fuzzy/steps.js').Step} step */
function expectNote(step) {
  for (const text of [sourceText(step.note.key), /** @type {Record<string, string>} */ (en)[step.note.key]]) {
    expect(typeof text, step.note.key).toBe('string')
    for (const [, name] of String(text).matchAll(/\{(\w+)\}/g)) expect(step.note.params, `${step.note.key} 缺參數 ${name}`).toHaveProperty(name)
  }
}

const alphabet = ['a', 'i', 'u', 'b', 'd', 'k', 'n', 't', ' ']

describe('動態規劃表的步驟', () => {
  it('每個有候選轉移的格一步，最後一步是最佳路徑；狀態只由步驟序號決定', () => {
    const random = createRandom(31)
    const metric = new WeightedEditDistance({ rules: new RuleSet().add('t', 'd', 0.1).add('au', 'o', 0.1).add('n', '', 0.2, { position: 'final' }), normalize: (s) => s })
    for (let k = 0; k < 150; k++) {
      const e = metric.explain(randomString(random, alphabet, 0, 6), randomString(random, alphabet, 0, 6))
      const steps = dpSteps(e)
      const withCandidates = e.order.filter(([i, j]) => e.candidates[i][j].length > 0).length
      expect(steps.length).toBe(withCandidates + 1)
      for (const s of steps) expectNote(s)
      const last = dpStateAt(e, steps, steps.length - 1)
      expect(last).toMatchObject({ revealed: e.order.length, showPath: true })
      // 單調、可任意跳
      let prev = -1
      for (let s = -1; s < steps.length; s++) {
        const state = dpStateAt(e, steps, s)
        expect(state.revealed).toBeGreaterThanOrEqual(prev)
        prev = state.revealed
        expect(dpStateAt(e, steps, s)).toEqual(state)
      }
      expect(dpStateAt(e, steps, 10_000)).toEqual(last)
    }
  })
})

describe('詞圖搜尋的步驟', () => {
  it('每個走訪的節點一步，剪枝與接受的標示與事件一致', () => {
    const random = createRandom(47)
    const metric = new WeightedEditDistance({ rules: new RuleSet().add('t', 'd', 0.1), normalize: (s) => s })
    const words = [...new Set(Array.from({ length: 60 }, () => randomString(random, alphabet.slice(0, 8), 2, 6)))]
    const index = new FuzzyIndex(metric).addAll(words.map((w) => [w, w]))
    for (let k = 0; k < 20; k++) {
      /** @type {any[]} */
      const events = []
      index.search(randomString(random, alphabet.slice(0, 8), 2, 6), { maxDistance: pick(random, [0.3, 1]), onNode: (ev) => events.push(ev) })
      const steps = dawgSteps(events)
      expect(steps).toHaveLength(events.length)
      steps.forEach((s, n) => {
        expectNote(s)
        expect(s.kind).toBe(events[n].pruned ? 'pruned' : events[n].accepted ? 'accepted' : 'node')
      })
      expect(dawgStateAt(steps, steps.length - 1).visited).toBe(events.length)
      expect(dawgStateAt(steps, -1).visited).toBe(0)
    }
  })
})

describe('BCDP 的步驟', () => {
  it('隨機規格：最後一步的狀態走完每一層、每個通道與整個詞的對齊；階段依序；每個說明鍵都有文字', () => {
    const random = createRandom(59)
    let checked = 0
    let aligned = 0
    for (let round = 0; round < 20; round++) {
      const letters = ['a', 'i', 'u', 'b', 'd', 'k', 'n', 't']
      const spec = {
        vowels: 'aiu',
        glides: 'iu',
        minStem: 2,
        maxSteps: 2,
        prefixes: Array.from({ length: 3 }, () => ({ form: randomString(random, letters, 1, 2) })),
        suffixes: [{ form: 'an' }, { form: randomString(random, letters, 1, 2) }],
        infixes: [{ form: 'in' }],
        reduplication: [{ pattern: pick(random, [...REDUPLICATION_PATTERNS]) }],
        alternations: [{ underlying: 't', surface: 'd', cost: 0.05 }],
      }
      const analyzer = createAnalyzer(spec)
      const rules = new RuleSet().add('t', 'd', 0.1).add('au', 'o', 0.1).add('aa', 'a', 0.1).addTable(alternationRules(spec))
      const metric = new WeightedEditDistance({ rules, normalize: (s) => s })
      const roots = [...new Set(Array.from({ length: 12 }, () => randomString(random, letters, 3, 5)))]
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const search = createMorphSearch({ analyzer, metric, index })
      for (let k = 0; k < 6; k++) {
        const root = pick(random, roots)
        const query = pick(random, ['mu', 'pa', 'bi', '']) + root + pick(random, ['an', 'i', ''])
        for (const term of [root, null]) {
          const e = /** @type {any} */ (search.explain(query, term, { maxDistance: 1 }))
          const steps = bcdpSteps(e)
          for (const s of steps) expectNote(s)
          const last = bcdpStateAt(e, steps, steps.length - 1)
          expect(last.result).toBe(true)
          if (e.tooShort) continue
          checked++
          expect(last.prefixLevels).toBe(e.prefixLevels.length)
          expect(last.suffixLevels).toBe(e.suffixLevels.length)
          expect(last.merged).toBe(true)
          expect(last.channels).toBe(e.variants.length)
          expect(last.walks).toBe(e.walks.length)
          if (e.alignment) {
            aligned++
            expect(last.aligned).toBe(e.alignment.steps.length)
          }
          // 階段的順序固定：各層 → 通道 → 結果 → 對齊
          const order = ['levels', 'channels', 'result', 'alignment']
          const phases = steps.map((s) => order.indexOf(s.phase))
          expect(phases).toEqual([...phases].sort((a, b) => a - b))
          // 可任意跳
          const middle = Math.floor(steps.length / 2)
          expect(bcdpStateAt(e, steps, middle)).toEqual(bcdpStateAt(e, steps, middle))
          expect(bcdpStateAt(e, steps, -1)).toMatchObject({ prefixLevels: 0, merged: false, result: false })
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
    expect(aligned).toBeGreaterThan(10)
  })

  it('距離參數的清單涵蓋所有說明中的成本', () => {
    for (const key of ['value', 'distance', 'total', 'cutoff', 'cost', 'maxDistance']) expect(DISTANCE_PARAMS.has(key)).toBe(true)
    for (const key of ['i', 'j', 'at', 'count', 'visited', 'level']) expect(DISTANCE_PARAMS.has(key)).toBe(false)
  })
})
