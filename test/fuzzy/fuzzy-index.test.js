import { describe, expect, it } from 'vitest'
import { FuzzyIndex, RuleSet, WeightedEditDistance, EPSILON } from '../../src/fuzzy/index.js'
import { createPazehKaxabuMetric } from '../fixtures/pazeh.js'
import { createRandom, pick, randomString } from './helpers.js'

describe('FuzzyIndex', () => {
  const metric = createPazehKaxabuMetric()
  const words = [
    'bintun',
    'atun',
    'alaw',
    'laulu',
    'apay',
    'semee',
    'lasu',
    'tshay',
    'baruzak',
    'baruzak binayu',
  ]
  const index = new FuzzyIndex(metric).addAll(words.map((w, k) => [w, k]))

  it('找到方言對應詞並依距離排序', () => {
    const results = index.search('bintul', { maxDistance: 1 })
    expect(results[0]).toMatchObject({ term: 'bintun', distance: 0.1, payloads: [0] })
  })

  it('精確查詢經過正規化', () => {
    expect(index.lookup('BINTUN')).toEqual([0])
    expect(index.lookup('nothing')).toBeUndefined()
  })

  it('同一詞加入多次時附帶資料會累積', () => {
    const idx = new FuzzyIndex(metric)
    idx.add('alaw', 'a')
    idx.add('Alaw', 'b')
    expect(idx.size).toBe(1)
    expect(idx.lookup('alaw')).toEqual(['a', 'b'])
  })

  it('limit 與 maxNormalized', () => {
    expect(index.search('baruzakbinayu', { maxDistance: 5, limit: 1 })).toHaveLength(1)
    const normalized = index.search('bintul', {
      maxDistance: 10,
      normalization: 'max',
      maxNormalized: 0.05,
    })
    expect(normalized.map((r) => r.term)).toEqual(['bintun'])
    expect(normalized[0].score).toBeCloseTo(0.1 / 6)
  })

  it('剪枝確實發生', () => {
    const { stats } = index.searchWithStats('semer', { maxDistance: 0.3 })
    expect(stats.prunedNodes).toBeGreaterThan(0)
  })

  // 工作量守門（以計數，不以計時）：不剪枝時，每個通道對每個前綴（trie 節點）至少要算一列。
  // 剪枝失效（例如下界算錯而永遠不剪）時結果仍然正確，只有這個測試會發現。
  it.each([
    ['一般查詢', false],
    ['帶邊界向量（BCDP 的還原變體通道）', true],
  ])('工作量守門：%s的剪枝讓計算的列數少 4 倍以上', (_name, withBoundary) => {
    const random = createRandom(777)
    const alphabet = ['a', 'i', 'u', 'b', 'd', 'k', 'n', 't', 's', 'l']
    const lexicon = [...new Set(Array.from({ length: 3000 }, () => randomString(random, alphabet, 3, 10)))]
    const big = new FuzzyIndex(new WeightedEditDistance({ rules: new RuleSet().add('d', 't', 0.1).add('u', 'o', 0.1), normalize: (s) => s })).addAll(
      lexicon.map((w) => [w, w]),
    )
    const prefixes = new Set()
    for (const w of lexicon) for (let k = 0; k <= w.length; k++) prefixes.add(w.slice(0, k))
    const channels = Array.from({ length: 40 }, () => {
      const query = randomString(random, alphabet, 4, 10)
      /** @type {import('../../src/fuzzy/fuzzy-index.js').SearchOptions} */
      const options = { maxDistance: 1 }
      if (withBoundary) {
        // 像詞綴圖表：開頭與幾個前綴終點可以起始、詞尾與幾個後綴起點可以結束
        options.start = Array.from({ length: query.length + 1 }, (_, i) => (i === 0 ? 0 : i <= 3 && random() < 0.5 ? 0.3 : Infinity))
        options.end = Array.from({ length: query.length + 1 }, (_, i) => (i === query.length ? 0 : i >= query.length - 3 && random() < 0.5 ? 0.3 : Infinity))
      }
      return { query, options }
    })
    const stats = { visitedNodes: 0, prunedNodes: 0, computedRows: 0 }
    big.searchChannels(channels, stats)
    expect(stats.computedRows * 4).toBeLessThan(prefixes.size * channels.length)
  })

  it('onNode 回報每個走訪節點', () => {
    const events = []
    index.search('apay', { maxDistance: 0.2, onNode: (e) => events.push(e) })
    expect(events[0]).toMatchObject({ prefix: '', depth: 0 })
    expect(events.some((e) => e.terminal && e.accepted && e.prefix === 'apay')).toBe(true)
  })

  it('查詢展開（實驗性）', () => {
    const results = index.search('mubintun', {
      maxDistance: 0.5,
      expanders: [(q) => (q.startsWith('mu') ? [{ form: q.slice(2), cost: 0.3, note: '去前綴 mu-' }] : [])],
    })
    expect(results[0]).toMatchObject({ term: 'bintun', distance: 0.3, via: '去前綴 mu-' })
  })
})

describe('性質測試：詞圖搜尋結果必須等於暴力逐一計算', () => {
  const alphabet = ['a', 'b', 'r', 'l', 'n', 'e', ' ']

  /**
   * 產生隨機規則集：含多字元、空字串、initial／final、單向。
   * @param {() => number} random
   */
  function randomRules(random) {
    const rules = new RuleSet()
    const count = 1 + Math.floor(random() * 8)
    for (let k = 0; k < count; k++) {
      const source = randomString(random, alphabet.slice(0, 6), 0, 3)
      let target = randomString(random, alphabet.slice(0, 6), 0, 5)
      if (source === '' && target === '') target = 'a'
      rules.add(source, target, Math.round(random() * 10) / 10, {
        position: pick(random, ['any', 'any', 'initial', 'final']),
        bidirectional: random() < 0.7,
      })
    }
    return rules
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('種子 %i', (seed) => {
    const random = createRandom(seed * 7919)
    for (let round = 0; round < 25; round++) {
      const metric = new WeightedEditDistance({
        rules: randomRules(random),
        costs: {
          substitute: 0.5 + random() * 1.5,
          delete: 0.3 + random(),
          insert: 0.3 + random(),
          overrides: { ' ': { substitute: 0.1, delete: 0.1, insert: 0.1 } },
        },
        normalize: (s) => s, // 不整理空白，讓詞邊界的情形更多樣
      })
      const vocabulary = [
        ...new Set(Array.from({ length: 40 }, () => randomString(random, alphabet, 1, 7))),
      ]
      const index = new FuzzyIndex(metric).addAll(vocabulary.map((w) => [w, w]))

      for (let q = 0; q < 6; q++) {
        const query = randomString(random, alphabet, 0, 6)
        const maxDistance = Math.round(random() * 25) / 10
        const normalization = pick(random, ['none', 'max', 'sum', 'query'])
        const maxNormalized = normalization === 'none' ? Infinity : Math.round(random() * 8) / 10

        const expected = vocabulary
          .map((term) => ({ term, distance: metric.distance(query, term) }))
          .filter(({ term, distance }) => {
            if (distance > maxDistance + EPSILON) return false
            if (normalization === 'none') return true
            return metric.normalizedDistance(query, term, normalization) <= maxNormalized + EPSILON
          })
          .map(({ term, distance }) => `${term}@${distance}`)
          .sort()

        const actual = index
          .search(query, { maxDistance, normalization, maxNormalized })
          .map((r) => `${r.term}@${r.distance}`)
          .sort()

        expect(actual, `query=${JSON.stringify(query)} maxDistance=${maxDistance} ${normalization}`).toEqual(
          expected,
        )
      }
    }
  })
})
