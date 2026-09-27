/**
 * 構詞搜尋（morph-search.js）的性質測試。對應 docs/bcdp.md：
 *
 * - 詞綴一層一層合併（第 5、7 節）：第 s 層的交界列等於「恰好 s 個詞綴」的每一條鏈分別算、再逐項取 min，
 *   每一條鏈的值以獨立的聯合對齊（ref-joint.js）計算。前綴由詞首往內；後綴由鏡像距離函式由詞尾往內，
 *   換回正向座標後比較
 * - 整個構詞搜尋與窮舉的比較在 bcdp-reference.test.js
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, createMorphSearch, EPSILON, FuzzyIndex, RuleSet, WeightedEditDistance } from '../../src/fuzzy/index.js'
import { toForwardEnd } from '../../src/fuzzy/junction.js'
import { alternationRules } from '../../src/fuzzy/morphology.js'
import { createRandom, pick, randomString } from './helpers.js'
import { refJoint, refJointContext } from './reference/ref-joint.js'

const alphabet = ['a', 'b', 'd', 'm', 'n', 'u']

/** @param {() => number} random @param {number} [lemmaSpread] */
function randomSetup(random, lemmaSpread = 100) {
  const rules = new RuleSet()
  for (let k = 0; k < 4; k++) {
    const source = randomString(random, alphabet, 0, 2)
    rules.add(source, randomString(random, alphabet, source ? 0 : 1, 2), pick(random, [0.1, 0.2]), { position: pick(random, ['any', 'any', 'initial', 'final']) })
  }
  const affixes = (/** @type {number} */ count) =>
    [...new Set(Array.from({ length: count }, () => randomString(random, alphabet, 1, 3)))].map((form) => ({ form, cost: pick(random, [0.2, 0.3]) }))
  const spec = {
    cost: 0.3,
    minStem: 2,
    maxSteps: 2,
    lemmaSpread,
    prefixes: affixes(4),
    suffixes: affixes(3),
    alternations: random() < 0.5 ? [{ underlying: 'b', surface: 'm', cost: 0.05 }] : [],
  }
  const metric = new WeightedEditDistance({
    rules: rules.addTable(alternationRules(spec)),
    normalize: (s) => s,
    costs: { overrides: { ' ': { substitute: 0.1, delete: 0.1, insert: 0.1 } } },
  })
  const analyzer = createAnalyzer(spec)
  return { metric, spec: analyzer.spec, analyzer }
}

/** 所有恰好 s 個詞綴的鏈 @param {Array<{form: string, cost: number}>} list @param {number} s */
function chainsOf(list, s) {
  /** @type {Array<Array<{form: string, cost: number}>>} */
  let level = [[]]
  for (let k = 0; k < s; k++) level = level.flatMap((c) => list.map((a) => [...c, a]))
  return level
}

describe('構詞搜尋：詞綴一層一層合併', () => {
  it.each([1, 2, 3, 4, 5])('第 s 層的交界列 ＝ 恰好 s 個詞綴的每一條鏈逐項取 min（前綴與後綴，種子 %i）', (seed) => {
    const random = createRandom(seed * 6151)
    let finite = 0
    for (let round = 0; round < 16; round++) {
      const { metric, spec, analyzer } = randomSetup(random)
      const search = createMorphSearch({ analyzer, metric, index: new FuzzyIndex(metric) })
      const ctx = refJointContext(metric)
      const isB = (/** @type {string | undefined} */ ch) => ch !== undefined && metric.boundaries.has(ch)
      let query = randomString(random, alphabet, 4, 8)
      if (random() < 0.2) query = `${query.slice(0, 2)} ${query.slice(2)}`
      const q = Array.from(query)
      const n = q.length
      const bound = pick(random, [0.6, 1, 1.5])
      const prepared = /** @type {NonNullable<ReturnType<typeof search.prepare>>} */ (search.prepare(query, bound))
      const clip = (/** @type {number} */ v) => (v > bound + EPSILON ? Infinity : v)
      for (let s = 1; s <= spec.maxSteps; s++) {
        const prefixLevel = prepared.prefixLevels[s - 1]
        const suffixLevel = prepared.suffixLevels[s - 1]
        const suffixRow = suffixLevel ? toForwardEnd(suffixLevel, metric.mirror().compiled).row : null
        for (let x = 0; x <= n; x++) {
          // 前綴鏈：q[0..x) 對到整條鏈，最後一個交界在鏈的尾端（交界上的 X 位置不能在空白旁）
          let want = Infinity
          if (!isB(q[x])) {
            for (const chain of chainsOf(spec.prefixes, s)) {
              const u = Array.from(chain.map((a) => a.form).join(''))
              const junctions = []
              let at = 0
              for (const a of chain) junctions.push((at += Array.from(a.form).length))
              const d = refJoint(ctx, q.slice(0, x), u, { junctions, stem: [u.length, u.length] })
              want = Math.min(want, chain.reduce((c, a) => c + a.cost, 0) + d)
            }
          }
          const got = prefixLevel ? prefixLevel.row[x] : Infinity
          expect(got, `前綴 s=${s} x=${x} query=${query}`).toBeCloseTo(clip(want), 9)
          if (got < Infinity) finite++

          // 後綴鏈：q[x..n) 對到整條鏈（詞中的順序），第一個交界在鏈的開頭
          let wantS = Infinity
          if (!isB(q[x - 1])) {
            for (const chain of chainsOf(spec.suffixes, s)) {
              const u = Array.from(chain.map((a) => a.form).join(''))
              const junctions = [0]
              let at = 0
              for (const a of chain.slice(0, -1)) junctions.push((at += Array.from(a.form).length))
              const d = refJoint(ctx, q.slice(x), u, { junctions, stem: [0, 0] })
              wantS = Math.min(wantS, chain.reduce((c, a) => c + a.cost, 0) + d)
            }
          }
          expect(suffixRow ? suffixRow[x] : Infinity, `後綴 s=${s} x=${x} query=${query}`).toBeCloseTo(clip(wantS), 9)
        }
      }
    }
    expect(finite).toBeGreaterThan(15)
  })
})

describe('構詞搜尋：相對上限（最佳 ＋ lemmaSpread）', () => {
  it.each([1, 2, 3, 4])('起點不小於最後的最佳；收緊上限前後 finish 的結果完全相同，走訪不會變多（種子 %i）', (seed) => {
    const random = createRandom(seed * 7919)
    let seeded = 0
    let saved = 0
    for (let round = 0; round < 12; round++) {
      const { metric, spec, analyzer } = randomSetup(random, pick(random, [0.1, 0.3]))
      const index = new FuzzyIndex(metric)
      const words = Array.from({ length: 40 }, () => randomString(random, alphabet, 2, 5))
      index.addAll(words.map((w) => [w, null]))
      const search = createMorphSearch({ analyzer, metric, index })
      for (let k = 0; k < 6; k++) {
        // 一半的查詢由詞庫詞加上詞綴組成，起點才有機會是有限的
        const w = pick(random, words)
        const query = random() < 0.5 ? `${pick(random, spec.prefixes).form}${w}${pick(random, spec.suffixes).form}` : randomString(random, alphabet, 4, 8)
        const bound = pick(random, [0.6, 1, 1.5])
        const loose = search.prepare(query, bound)
        if (!loose) continue
        const tight = search.seed(search.prepare(query, bound))
        const statsLoose = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
        const statsTight = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
        const without = loose.channels.map((ch) => ({ query: ch.query, options: { ...ch.options, cutoff: undefined } }))
        const want = search.finish(loose, index.searchChannels(without, statsLoose), bound)
        const start = tight?.cutoff.best ?? Infinity
        const got = search.finish(/** @type {any} */ (tight), index.searchChannels(/** @type {any} */ (tight).channels, statsTight), bound)
        expect(got, `query=${query}`).toEqual(want)
        if (want.length) expect(start, `起點 query=${query}`).toBeGreaterThanOrEqual(want[0].distance - EPSILON)
        expect(statsTight.visitedNodes).toBeLessThanOrEqual(statsLoose.visitedNodes)
        if (start < Infinity) seeded++
        if (statsTight.visitedNodes < statsLoose.visitedNodes) saved++
      }
    }
    // reaching check：起點真的出現過、上限真的剪掉過節點
    expect(seeded).toBeGreaterThan(3)
    expect(saved).toBeGreaterThan(3)
  })
})
