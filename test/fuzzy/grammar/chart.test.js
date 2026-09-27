/**
 * 類 pika 剖析器（src/fuzzy/grammar/chart.js）的仲裁與可停止性（docs/morph-grammar.md 5.3）。
 *
 * 三層仲裁：
 * 1. 窮舉參考實作 ref-morph.js（列舉所有分析，每個以整個詞的聯合對齊 ref-joint.js 計價）仲裁 chart。
 *    ref-morph 讀編譯後的規格（compile.js），chart 讀文法本身、以 derive.js 算複合形式與條件，兩者獨立。
 * 2. chart 仲裁編譯後的 BCDP：同樣的隨機文法、更多查詢；平面清單寫法的隨機規格也比。
 *    BCDP 與 ref-morph 都讀 compile.js，compile.js 的錯誤（例如編譯時就決定的條件沒有加懲罰）只有這一層抓得到。
 * 3. 可停止性：以工作量計數（不以時間）確認走訪不超過由迴圈結構算出的上界，含成本為 0、maxSteps 最大的文法。
 *
 * 真實資料（巴宰語設定檔、全部詞對與凍結的查詢）的仲裁在私有 repo 的工具（tools/arbitrate-chart.mjs）。
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, createMorphSearch, FuzzyIndex, roundCost, RuleSet, WeightedEditDistance } from '../../../src/fuzzy/index.js'
import { createChartSearch } from '../../../src/fuzzy/grammar/chart.js'
import { MAX_STEPS_LIMIT } from '../../../src/fuzzy/grammar/spec.js'
import { createCitation, createRecord, createSense } from '../../../src/schema/index.js'
import { SearchEngine, buildSearchIndex } from '../../../src/search/index.js'
import { PAZEH_PROFILE } from '../../fixtures/pazeh.js'
import { createRandom, pick } from '../helpers.js'
import { randomDerived, randomMorphSetup } from '../random-morph.js'
import { refJointContext } from '../reference/ref-joint.js'
import { refMorph } from '../reference/ref-morph.js'
import { GRAMMAR } from './grammar.test.js'
import { randomGrammarSetup, randomQuery } from './random-grammar.js'

/**
 * 兩份「詞根 → 成本」逐一相同（都沒有的詞根不算）。
 * @param {Map<string, number>} got
 * @param {Map<string, number>} want
 * @param {string} label
 */
function expectSameCosts(got, want, label) {
  for (const t of new Set([...got.keys(), ...want.keys()])) {
    expect(got.get(t) ?? Infinity, `${label} term=${t}`).toBeCloseTo(want.get(t) ?? Infinity, 7)
  }
}

/** @param {Array<{term: string, distance: number}>} hits */
const costsOf = (hits) => new Map(hits.map((h) => [h.term, h.distance]))

/**
 * 每個命中的 trace 以距離函式的聯合對齊（metric.explainSegments，BCDP 說明用的那一份）重建：
 * 對齊成本 ＋ 步驟成本 ＋ 懲罰 ＝ 命中的成本。chart 的逐格 DP 與 explainSegments 是兩份獨立的對齊實作。
 * @param {WeightedEditDistance} metric
 * @param {ReturnType<ReturnType<typeof createChartSearch>['search']>} hits
 * @param {string} label
 */
function expectTraceConsistent(metric, hits, label) {
  for (const h of hits) {
    const e = metric.explainSegments(h.trace.query, h.trace.segments, h.trace.options)
    const steps = h.steps.reduce((a, s) => a + s.cost, 0)
    expect(roundCost(e.distance + steps + (h.penalty ?? 0)), `${label} → ${h.term}`).toBeCloseTo(h.distance, 7)
  }
}

/**
 * BCDP 的完整流程（與搜尋引擎相同：prepare → 一次走訪 → finish）。
 * @param {ReturnType<typeof createMorphSearch>} search
 * @param {FuzzyIndex} index
 * @param {string} query
 * @param {number} maxDistance
 */
function bcdp(search, index, query, maxDistance) {
  const prepared = search.prepare(query, maxDistance)
  if (!prepared || prepared.truncated) return null
  return search.finish(prepared, index.searchChannels(prepared.channels), maxDistance)
}

/** reaching check：每一種分析都要真的出現在 chart 的命中裡 @type {Map<string, number>} */
const reached = new Map()
const reach = (/** @type {string} */ kind) => reached.set(kind, (reached.get(kind) ?? 0) + 1)
/** @param {Array<{steps: Array<Record<string, any>>, penalty?: number}>} hits @param {{crossBest?: number}} stats */
function noteReached(hits, stats) {
  for (const h of hits) {
    if (h.penalty) reach('penalty')
    if (h.steps.some((s) => s.construction && s.left?.type === 'prefix')) reach('construction:prefix')
    if (h.steps.some((s) => s.construction && s.left?.type !== 'prefix')) reach('construction:stem')
    if (h.steps.some((s) => s.type === 'prefix' && (s.parts?.length ?? 0) > 1)) reach('composite')
    if (h.steps.some((s) => s.type === 'infix')) reach('infix')
    if (h.steps.some((s) => s.type === 'reduplication')) reach('reduplication')
  }
  if (stats.crossBest) reach('cross')
}

describe('類 pika 剖析器：與窮舉參考實作相同', () => {
  it.each([1, 2, 3])('種子 %i：隨機文法（同位詞素與條件、複合前綴、組合規則、重疊、構詞音變）', { timeout: 300_000 }, (seed) => {
    const random = createRandom(seed * 7919)
    let compared = 0
    for (let round = 0; round < 8; round++) {
      const setup = randomGrammarSetup(random)
      const { metric, analyzer, roots, spec, grammar } = setup
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const chart = createChartSearch({ grammar, metric, index })
      const ctx = refJointContext(metric)
      for (let k = 0; k < 8; k++) {
        const query = randomQuery(random, setup)
        const maxDistance = pick(random, [0.8, 1, 1.2])
        const stats = { visitedNodes: 0, columns: 0 }
        const hits = chart.search(query, { maxDistance, stats })
        noteReached(hits, stats)
        /** @type {Map<string, string>} */
        const why = new Map()
        const want = refMorph(ctx, { query, lexicon: roots, spec: analyzer.spec, maxDistance, why })
        expectSameCosts(costsOf(hits), want, `seed=${seed} round=${round} query=${query}；規格：${JSON.stringify(spec)}`)
        compared++
      }
    }
    expect(compared).toBe(64)
  })
})

describe('類 pika 剖析器仲裁編譯後的 BCDP；命中的 trace 以 explainSegments 重建，成本一致', () => {
  it.each([11, 12, 13, 14, 15, 16, 17, 18])('種子 %i：文法寫法', { timeout: 120_000 }, (seed) => {
    const random = createRandom(seed * 7919)
    let compared = 0
    for (let round = 0; round < 20; round++) {
      const setup = randomGrammarSetup(random)
      const { metric, analyzer, roots, spec, grammar } = setup
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const chart = createChartSearch({ grammar, metric, index })
      const search = createMorphSearch({ analyzer, metric, index })
      for (let k = 0; k < 10; k++) {
        const query = randomQuery(random, setup)
        const maxDistance = pick(random, [0.8, 1, 1.2])
        const want = bcdp(search, index, query, maxDistance)
        if (!want) continue
        const stats = { visitedNodes: 0, columns: 0 }
        const hits = chart.search(query, { maxDistance, stats })
        noteReached(hits, stats)
        expectSameCosts(costsOf(hits), costsOf(want), `seed=${seed} round=${round} query=${query}；規格：${JSON.stringify(spec)}`)
        expectTraceConsistent(metric, hits, `seed=${seed} round=${round} query=${query}`)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(150)
  })

  it.each([1, 2, 3, 4, 5, 6])('種子 %i：平面清單寫法（環綴三種左邊、多種重疊型式、空白、交界上的增生）', { timeout: 120_000 }, (seed) => {
    const random = createRandom(seed * 104729)
    let compared = 0
    for (let round = 0; round < 10; round++) {
      const setup = randomMorphSetup(random)
      const { metric, analyzer, roots } = setup
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const chart = createChartSearch({ grammar: analyzer.grammar, metric, index })
      const search = createMorphSearch({ analyzer, metric, index })
      for (let k = 0; k < 10; k++) {
        const query = randomDerived(random, setup)
        const maxDistance = pick(random, [0.8, 1, 1.2])
        const want = bcdp(search, index, query, maxDistance)
        if (!want) continue
        const stats = { visitedNodes: 0, columns: 0 }
        const hits = chart.search(query, { maxDistance, stats })
        noteReached(hits, stats)
        expectSameCosts(costsOf(hits), costsOf(want), `seed=${seed} round=${round} query=${JSON.stringify(query)}；規格：${JSON.stringify(analyzer.spec)}`)
        expectTraceConsistent(metric, hits, `seed=${seed} round=${round} query=${JSON.stringify(query)}`)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(80)
  })

  it('reaching check：不成立的條件、兩種組合規則、複合前綴、中綴、重疊、跨界規則的走訪都真的決定過命中', () => {
    for (const kind of ['penalty', 'construction:prefix', 'construction:stem', 'composite', 'infix', 'reduplication', 'cross']) {
      expect(reached.get(kind) ?? 0, `${kind}：${JSON.stringify([...reached])}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('固定案例', () => {
  /** @param {string} localId @param {string} text */
  const rec = (localId, text) => createRecord({ source: 'dict', localId, unit: 'word', text, citation: createCitation(`dict ${localId}`) }, { senses: [createSense({ zh: text })] })
  const records = ['usa', 'udan', 'baket', 'kita'].map((w) => rec(w, w))
  const built = buildSearchIndex({ items: records.map((record) => ({ record, shard: 'all' })), groups: [], sourceIds: ['dict'], profile: { ...PAZEH_PROFILE, morphology: GRAMMAR } })
  const engine = new SearchEngine(JSON.parse(JSON.stringify(built)))
  const analyzer = /** @type {NonNullable<typeof engine.text.morphology>} */ (engine.text.morphology)
  const chart = createChartSearch({ grammar: analyzer.grammar, metric: engine.metric, index: engine.index })
  const morph = /** @type {NonNullable<typeof engine.morphSearch>} */ (engine.morphSearch)
  /** @param {string} q @param {string} term */
  const hitOf = (q, term) => chart.search(engine.text.searchKey(q), { maxDistance: 1 }).find((h) => h.term === term)

  it('mausay、maudanay → 組合規則 AF.IRR；minubaket → AF.PRF；成本與 BCDP 相同', () => {
    for (const [q, term, id] of [
      ['mausay', 'usa', 'AF.IRR'],
      ['maudanay', 'udan', 'AF.IRR'],
      ['minubaket', 'baket', 'AF.PRF'],
    ]) {
      const h = hitOf(q, term)
      expect(h?.steps.map((s) => s.construction?.id ?? s.type), q).toEqual([id])
      const b = morph.search(engine.text.searchKey(q), { maxDistance: 1 }).find((x) => x.term === term)
      expect(h?.distance, q).toBeCloseTo(/** @type {number} */ (b?.distance), 9)
    }
    expect(hitOf('mausay', 'usa')?.steps[0].parts.map((/** @type {any} */ p) => `${p.id}:${p.form}`)).toEqual(['AF:m', 'PROG:a', 'IRR:ay'])
  })

  it('mubinaket → mu- ＋ <in>（兩個自由步驟）；mibaket 的 mi- 條件不成立，付懲罰', () => {
    expect(hitOf('mubinaket', 'baket')?.steps.map((s) => `${s.type}:${s.form}`)).toEqual(['prefix:mu', 'infix:in'])
    const mi = hitOf('mibaket', 'baket')
    expect(mi?.penalty).toBeCloseTo(0.3)
    expect(mi?.violations?.map((v) => `${v.id}:${v.form}:${v.when}`)).toEqual(['AF:mi:^C+i'])
    expect(hitOf('mubaket', 'baket')?.penalty).toBeUndefined()
  })

  it('跨越前綴｜詞根交界的規則：q ↔ ab 橫跨 ka-｜bata，由跨界的走訪找到', () => {
    const metric = new WeightedEditDistance({ rules: new RuleSet().add('q', 'ab', 0.1), normalize: (s) => s })
    const spec = { cost: 0.2, minStem: 3, maxSteps: 2, morphemes: [{ id: 'KA', type: 'prefix', form: 'ka' }] }
    const index = new FuzzyIndex(metric).addAll(['bata', 'kita'])
    const c = createChartSearch({ grammar: createAnalyzer(spec).grammar, metric, index })
    const stats = { visitedNodes: 0, columns: 0 }
    const hits = c.search('kqata', { maxDistance: 1, stats })
    expect(hits.find((h) => h.term === 'bata')?.distance).toBeCloseTo(0.3, 9) // ka- 0.2 ＋ 規則 0.1
    expect(stats.crossBest).toBe(1)
    const want = bcdp(createMorphSearch({ analyzer: createAnalyzer(spec), metric, index }), index, 'kqata', 1)
    expectSameCosts(costsOf(hits), costsOf(want ?? []), 'kqata')
  })
})

describe('可停止性：工作量有上界', () => {
  /**
   * 由 chart.js 的迴圈結構算出的欄數上界（docs/morph-grammar.md 第 4 節）。每一項都是有限的：
   * - 查詢變體 V ≤ 1 ＋ n × 中綴運算數 ＋ n² × 重疊運算數 × (1 ＋ 交界增生數)
   * - 前綴那側：序列至多 Σ_{k ≤ S} |前綴單位|^k 個，每個至多 1 ＋ (|前綴單位| ＋ |組合規則|) × (最長 ＋ 2) 欄
   * - 走訪數 ≤ 1 ＋ (n ＋ 1) × 右邊種類數 × (1 ＋ 跨界規則數 × L)；每個走訪：詞圖路徑上每個節點至多 3 欄，
   *   每個詞尾至多 2 ＋ 右邊長度 ＋ Σ_{k ≤ S} |後綴單位|^k × (2 ＋ |後綴單位| × 最長) 欄
   * @param {ReturnType<typeof createChartSearch>} chart
   * @param {any} grammar
   * @param {WeightedEditDistance} metric
   * @param {string[]} words
   * @param {number} n 查詢長度
   */
  function workBound(chart, grammar, metric, words, n) {
    const { prefixUnits, suffixUnits, stemOps, constructions } = chart.units
    const S = grammar.maxSteps
    const geo = (/** @type {number} */ base) => Array.from({ length: S + 1 }, (_, k) => base ** k).reduce((a, b) => a + b, 0)
    const maxLen = (/** @type {Array<{chars?: string[], left?: string[], right?: string[]}>} */ list) => Math.max(1, ...list.map((u) => (u.chars ?? u.left ?? []).length))
    const rules = metric.ruleSet.expand(metric.normalize)
    const L = Math.max(1, ...rules.map((r) => Array.from(r.target).length))
    const cross = rules.filter((r) => r.position === 'any' && !r.junction && Array.from(r.target).length >= 2).length
    const inserts = rules.filter((r) => r.target === '' && r.source !== '' && r.position !== 'final').length
    const infixOps = stemOps.filter((s) => s.kind === 'infix').length + constructions.filter((c) => c.stemOp?.kind === 'infix').length
    const redOps = stemOps.filter((s) => s.kind === 'reduplication').length + constructions.filter((c) => c.stemOp?.kind === 'reduplication').length
    const V = 1 + n * infixOps + n * n * redOps * (1 + inserts)
    const A = geo(prefixUnits.length) * (1 + (prefixUnits.length + constructions.length) * (Math.max(maxLen(prefixUnits), maxLen(constructions)) + 2))
    const rights = 1 + constructions.length
    const W = 1 + (n + 1) * rights * (1 + cross * L)
    const trieNodes = 1 + words.reduce((a, w) => a + Array.from(w).length, 0)
    const maxRight = Math.max(0, ...constructions.map((c) => c.right.length))
    const perWalk = trieNodes * 3 + words.length * (2 + maxRight + geo(suffixUnits.length) * (2 + suffixUnits.length * maxLen(suffixUnits)))
    return V * (A + W * perWalk)
  }

  it('成本全為 0、maxSteps 最大、形式彼此重疊的文法：走訪完成，欄數不超過上界；兩次的工作量相同', { timeout: 120_000 }, () => {
    const spec = {
      cost: 0,
      minStem: 2,
      maxSteps: MAX_STEPS_LIMIT,
      lemmaSpread: 100,
      vowels: 'a',
      unattestedPenalty: 0,
      conditionPenalty: 0,
      morphemes: [
        { id: 'A', type: 'prefix', form: 'a' },
        { id: 'B', type: 'prefix', allomorphs: [{ form: 'b' }, { form: 'ba', when: '^V' }] },
        { id: 'X', type: 'infix', form: 'a' },
        { id: 'S', type: 'suffix', allomorphs: [{ form: 'a' }, { form: 'b', when: 'a$' }] },
        { id: 'R', type: 'reduplication', pattern: 'Ca' },
      ],
      constructions: [
        { id: 'BX', sequence: ['B', 'X'], cost: 0 },
        { id: 'RS', sequence: ['R', 'S'], cost: 0 },
      ],
    }
    const metric = new WeightedEditDistance({ rules: new RuleSet().add('aa', 'a', 0).add('ab', 'ba', 0), normalize: (s) => s })
    const words = ['ab', 'ba', 'aba', 'bab', 'abab']
    const index = new FuzzyIndex(metric).addAll(words)
    const grammar = createAnalyzer(spec).grammar
    const chart = createChartSearch({ grammar, metric, index })
    for (const query of ['abab', 'babab', 'aababa']) {
      const first = { visitedNodes: 0, columns: 0 }
      chart.search(query, { maxDistance: 1, stats: first })
      const second = { visitedNodes: 0, columns: 0 }
      chart.search(query, { maxDistance: 1, stats: second })
      expect(second, query).toEqual(first)
      expect(first.columns, query).toBeLessThanOrEqual(workBound(chart, grammar, metric, words, Array.from(query).length))
    }
  })

  it('一般的隨機文法：欄數也不超過上界', () => {
    const random = createRandom(4242)
    for (let round = 0; round < 10; round++) {
      const setup = randomGrammarSetup(random)
      const index = new FuzzyIndex(setup.metric).addAll(setup.roots)
      const chart = createChartSearch({ grammar: setup.grammar, metric: setup.metric, index })
      for (let k = 0; k < 5; k++) {
        const query = randomQuery(random, setup)
        const stats = { visitedNodes: 0, columns: 0 }
        chart.search(query, { maxDistance: 1.2, stats })
        expect(stats.columns, query).toBeLessThanOrEqual(workBound(chart, setup.grammar, setup.metric, setup.roots, Array.from(query).length))
      }
    }
  })
})
