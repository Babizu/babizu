/**
 * 以獨立的參考實作（test/fuzzy/reference/）仲裁正式實作。
 *
 * - refDistance：由定義直接寫成的加權編輯距離，不共用 fillRow。先確認它與 metric.distance 逐一相同，
 *   之後就能當作其他測試的仲裁者（其他測試過去都以 metric.distance 為準，與被測程式共用同一個 DP）。
 * - refMorph：窮舉 BCDP 分段模型的所有分析（docs/bcdp.md 第 1 節）。
 * - 正式實作尚未符合定義的地方（bcdp.md 1.6）以 it.fails 標示：測試描述的是「應該怎樣」，
 *   目前會失敗；修正之後 it.fails 會轉為失敗，提醒把它改回 it。
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, createMorphSearch, EPSILON, FuzzyIndex, roundCost, RuleSet, WeightedEditDistance } from '../../src/fuzzy/index.js'
import { createRandom, pick, randomString } from './helpers.js'
import { refContext, refDistance } from './reference/ref-distance.js'
import { refMorph } from './reference/ref-morph.js'

describe('參考實作：加權編輯距離', () => {
  it('refDistance 與 metric.distance 逐一相同（隨機規則：多字元、空字串、詞首詞尾、單向、空白）', () => {
    const alphabet = ['a', 'b', 'r', 'l', 'n', 'e', ' ']
    for (let seed = 1; seed <= 8; seed++) {
      const random = createRandom(seed * 7919)
      const rules = new RuleSet()
      const count = 1 + Math.floor(random() * 6)
      for (let k = 0; k < count; k++) {
        const source = randomString(random, alphabet.slice(0, 6), 0, 3)
        const target = randomString(random, alphabet.slice(0, 6), source ? 0 : 1, 3)
        rules.add(source, target, pick(random, [0.1, 0.2, 0.3, 0.5]), {
          position: pick(random, ['any', 'any', 'initial', 'final']),
          bidirectional: random() < 0.7,
        })
      }
      const metric = new WeightedEditDistance({ rules, normalize: (s) => s })
      const ctx = refContext(metric)
      for (let k = 0; k < 150; k++) {
        const x = randomString(random, alphabet, 0, 7)
        const y = randomString(random, alphabet, 0, 7)
        expect(roundCost(refDistance(ctx, Array.from(x), Array.from(y))), `seed=${seed} ${JSON.stringify([x, y])}`).toBe(metric.distance(x, y))
      }
    }
  })
})

/**
 * 隨機的構詞規格與詞庫。字母表有元音與輔音，讓中綴（首輔音之後）、Ca／CV 重疊有意義；
 * 詞彙由「詞根＋構詞」產生，確保每個查詢多半真的有命中。
 * @param {() => number} random
 */
function randomMorphSetup(random) {
  const vowels = ['a', 'i', 'u']
  const consonants = ['b', 'd', 'k', 'n', 't']
  const alphabet = [...vowels, ...consonants]
  const rules = new RuleSet()
  const ruleCount = 1 + Math.floor(random() * 4)
  for (let k = 0; k < ruleCount; k++) {
    rules.add(randomString(random, alphabet, 1, 2), randomString(random, alphabet, 1, 2), pick(random, [0.1, 0.2]), {
      position: pick(random, ['any', 'any', 'initial', 'final']),
    })
  }
  const metric = new WeightedEditDistance({ rules, normalize: (s) => s })
  const affixes = (/** @type {number} */ n, /** @type {number} */ max) =>
    [...new Set(Array.from({ length: n }, () => randomString(random, alphabet, 1, max)))].map((form) => ({ form, cost: pick(random, [0.2, 0.3]) }))
  const spec = {
    cost: 0.3,
    minStem: 2,
    maxSteps: 2,
    lemmaDistance: pick(random, [0.2, 0.3]),
    affixDistance: pick(random, [0.1, 0.2]),
    lemmaSpread: 100,
    vowels: 'aiu',
    prefixes: affixes(3, 2),
    suffixes: [...affixes(2, 2), { form: 'an' }],
    infixes: random() < 0.7 ? [{ form: 'in' }] : [],
    reduplication: random() < 0.7 ? [{ pattern: pick(random, ['Ca', 'CV']) }] : [],
    alternations: random() < 0.7 ? [{ underlying: 't', surface: 'd', before: random() < 0.5 ? ['an'] : undefined }] : [],
  }
  const analyzer = createAnalyzer(spec)
  const roots = [...new Set(Array.from({ length: 14 }, () => randomString(random, consonants, 1, 1) + randomString(random, alphabet, 1, 4)))]
  return { metric, spec: analyzer.spec, analyzer, roots, alphabet }
}

/**
 * 由詞根造一個衍生形：隨機加前綴、後綴、中綴、重疊或交替，偶爾再加一個隨機改字（方言變化）。
 * @param {() => number} random
 * @param {ReturnType<typeof randomMorphSetup>} setup
 */
function derive(random, { spec, analyzer, roots, alphabet }) {
  let w = pick(random, roots)
  if (spec.infixes.length && random() < 0.25) {
    const head = analyzer.onset(w)
    w = head + spec.infixes[0].form + w.slice(head.length)
  } else if (spec.reduplication.length && random() < 0.25) {
    w = (analyzer.reduplicant(spec.reduplication[0].pattern, w) ?? '') + w
  }
  let suffix = ''
  if (random() < 0.5) suffix = pick(random, spec.suffixes).form
  if (spec.alternations.length && w.endsWith('t') && random() < 0.5) {
    w = `${w.slice(0, -1)}d`
    suffix = 'an'
  }
  const prefix = random() < 0.6 ? pick(random, spec.prefixes).form : ''
  let q = prefix + w + suffix
  if (random() < 0.3) {
    const at = Math.floor(random() * q.length)
    q = q.slice(0, at) + pick(random, alphabet) + q.slice(at + 1)
  }
  return q
}

describe('參考實作：BCDP 分段模型', () => {
  it.each([1, 2, 3, 4, 5, 6])('種子 %i：morphSearch 的每個命中與成本都等於窮舉（沒有截斷的查詢）', (seed) => {
    const random = createRandom(seed * 104729)
    let compared = 0
    for (let round = 0; round < 8; round++) {
      const setup = randomMorphSetup(random)
      const { metric, spec, analyzer, roots } = setup
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const search = createMorphSearch({ analyzer, metric, index })
      const ctx = refContext(metric)
      for (let k = 0; k < 6; k++) {
        const query = derive(random, setup)
        const prepared = search.prepare(query)
        // 還原變體達到上限（16）時可能被截斷；那是另一個測試（下方 it.fails）的範圍
        if (prepared && prepared.variants.length >= 16) continue
        const maxDistance = pick(random, [0.8, 1, 1.2])
        const got = new Map(search.search(query, { maxDistance }).map((h) => [h.term, h.distance]))
        /** @type {Map<string, string>} */
        const why = new Map()
        const want = refMorph(ctx, { query, lexicon: roots, spec, maxDistance, reduplicant: analyzer.reduplicant, why })
        const terms = new Set([...got.keys(), ...want.keys()])
        for (const t of terms) {
          // 已知錯誤（bcdp.md 1.6 第 5 項）：重疊部分超過 4 個字元時正式實作找不到；由下方的 it.fails 涵蓋
          const removal = /拿掉 q\[(\d+)\.\.(\d+)\)/.exec(why.get(t) ?? '')
          if (removal && Number(removal[2]) - Number(removal[1]) > 4 && !got.has(t)) continue
          const detail = `seed=${seed} round=${round} query=${query} term=${t}；參考：${why.get(t) ?? '—'}；規格：${JSON.stringify({ prefixes: spec.prefixes.map((a) => a.form), suffixes: spec.suffixes.map((a) => a.form), infixes: spec.infixes.map((a) => a.form), red: spec.reduplication.map((r) => r.pattern), alt: spec.alternations, rules: metric.ruleSet.expand().map((r) => `${r.source}>${r.target}:${r.position}`) })}`
          expect(got.get(t) ?? Infinity, detail).toBeCloseTo(want.get(t) ?? Infinity, 7)
        }
        compared++
      }
    }
    expect(compared).toBeGreaterThan(30)
  })
})

describe('已知與定義不一致的地方（docs/bcdp.md 1.6；修正後改回 it）', () => {
  /** 與網站相同的空白處理：連續空白合併、去掉頭尾空白（createNormalizer 的 collapseWhitespace） */
  const collapse = (/** @type {string} */ s) => s.replace(/\s+/gu, ' ').trim()
  /** 固定的小規格：prefix mu-、suffix -an，空白的增刪成本 0.1 */
  const fixed = (/** @type {any} */ extra = {}, /** @type {RuleSet} */ rules = new RuleSet(), normalize = (/** @type {string} */ s) => s) => {
    const metric = new WeightedEditDistance({ rules, normalize })
    const spec = { minStem: 2, maxSteps: 2, lemmaSpread: 100, vowels: 'aiu', prefixes: [{ form: 'mu' }], suffixes: [{ form: 'an' }], ...extra }
    const analyzer = createAnalyzer(spec)
    return { metric, analyzer, spec: analyzer.spec }
  }
  /** @param {ReturnType<typeof fixed>} setup @param {string[]} lexicon @param {string} query */
  const compare = ({ metric, analyzer, spec }, lexicon, query, maxDistance = 1) => {
    const index = new FuzzyIndex(metric).addAll(lexicon.map((w) => [w, w]))
    const got = new Map(createMorphSearch({ analyzer, metric, index }).search(query, { maxDistance }).map((h) => [h.term, h.distance]))
    const want = refMorph(refContext(metric), { query, lexicon, spec, maxDistance, reduplicant: analyzer.reduplicant })
    return { got, want }
  }

  it.fails('多詞查詢：詞幹開頭的空白要付刪除成本（計價不能把片段重新正規化而截掉空白）', () => {
    // δ = 0.05：「mu 」（含空白，刪空白 0.1）不是合法的前綴，只能是 mu- ＋ 詞幹 " daux"
    const { got, want } = compare(fixed({ affixDistance: 0.05 }, new RuleSet(), collapse), ['daux'], 'mu daux')
    expect(want.get('daux')).toBeCloseTo(0.4, 9) // mu- 0.3 ＋ 詞幹 " daux" 刪空白 0.1
    expect(got.get('daux')).toBeCloseTo(0.4, 9)
  })

  it.fails('多詞查詢：詞綴不能包含空白', () => {
    // 查詢 "dauxan an"：唯一合法的分析是詞幹 "dauxan "（刪空白 0.1）＋ -an；"n an" 不能被當成一個後綴
    const { got, want } = compare(fixed({ suffixes: [{ form: 'an' }, { form: 'nan' }], affixDistance: 0.2 }, new RuleSet(), collapse), ['dauxa'], 'dauxan an')
    expect(got.get('dauxa') ?? Infinity).toBeCloseTo(want.get('dauxa') ?? Infinity, 9)
  })

  it.fails('非 BMP 字元：計價以 code point 切片', () => {
    const { got, want } = compare(fixed(), ['b𝔞d'], 'mub𝔞d')
    expect(want.get('b𝔞d')).toBeCloseTo(0.3, 9)
    expect(got.get('b𝔞d')).toBeCloseTo(0.3, 9)
  })

  it.fails('詞幹交替的說明：交替後面的第一個後綴必須在 before 清單中', () => {
    // n→m 是方言規則，所以 "am" 在 δ 內也對應到後綴 -am（成本較低），但 -am 不在 before 中
    const rules = new RuleSet().add('n', 'm', 0.1)
    const setup = fixed({ suffixes: [{ form: 'an' }, { form: 'am', cost: 0.1 }], affixDistance: 0.2, alternations: [{ underlying: 't', surface: 'd', before: ['an'] }] }, rules)
    const index = new FuzzyIndex(setup.metric).addAll([['bat', 'bat']])
    const hit = createMorphSearch({ analyzer: setup.analyzer, metric: setup.metric, index })
      .search('badan', { maxDistance: 1 })
      .find((h) => h.term === 'bat' && h.steps.some((s) => s.type === 'alternation'))
    expect(hit).toBeDefined()
    const steps = /** @type {NonNullable<typeof hit>} */ (hit).steps
    const suffix = steps[steps.findIndex((s) => s.type === 'alternation') + 1]
    expect(suffix?.form).toBe('an')
  })

  it.fails('還原變體超過 16 個時不截斷', () => {
    // 20 種交替（底層字元不同、表面都是 d）：第 20 種才能還原出 baz
    const letters = ['b', 'c', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'p', 'q', 'r', 's', 'v', 'w', 'x', 'y', 'o', 'e', 'z']
    const setup = fixed({ alternations: letters.map((u) => ({ underlying: u, surface: 'd' })) })
    const { got, want } = compare(setup, ['baz'], 'badan')
    expect(want.get('baz')).toBeCloseTo(0.6, 9) // 交替 0.3 ＋ -an 0.3
    expect(got.get('baz')).toBeCloseTo(0.6, 9)
  })

  it.fails('重疊部分可以超過 4 個字元（Ca：首輔音群 4 個字元＋a）', () => {
    const setup = fixed({ reduplication: [{ pattern: 'Ca' }] })
    const { got, want } = compare(setup, ['bdknaku'], 'bdknabdknaku')
    expect(want.get('bdknaku')).toBeCloseTo(0.3, 9)
    expect(got.get('bdknaku')).toBeCloseTo(0.3, 9)
  })
})

describe('多通道走訪（searchChannels）', () => {
  /** @param {number} seed @param {number} channels */
  function channelCase(seed, channels) {
    const random = createRandom(seed)
    const alphabet = ['a', 'b', 'd', 'n', 'u', ' ']
    const rules = new RuleSet().add('d', 'n', 0.1).add('au', 'o', 0.1).add('b', '', 0.2, { position: 'initial' })
    const metric = new WeightedEditDistance({ rules, normalize: (s) => s })
    const words = [...new Set(Array.from({ length: 40 }, () => randomString(random, alphabet.slice(0, 5), 1, 6)))]
    const index = new FuzzyIndex(metric).addAll(words.map((w) => [w, w]))
    const specs = Array.from({ length: channels }, () => {
      const query = randomString(random, alphabet, 1, 6)
      const n = Array.from(query).length
      /** @type {import('../../src/fuzzy/fuzzy-index.js').SearchOptions} */
      const options = { maxDistance: pick(random, [0.3, 0.8, 1.5]) }
      if (random() < 0.5) {
        options.start = Array.from({ length: n + 1 }, (_, i) => (i === 0 || random() < 0.3 ? pick(random, [0, 0.1, 0.3]) : Infinity))
        options.end = Array.from({ length: n + 1 }, (_, i) => (i === n || random() < 0.3 ? pick(random, [0, 0.2]) : Infinity))
      }
      return { query, options }
    })
    const sorted = (/** @type {any[]} */ rs) => rs.map((r) => [r.term, r.distance, r.endAt ?? null]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    const together = index.searchChannels(specs)
    specs.forEach((s, c) => {
      const alone = index.searchChannels([s])[0]
      expect(sorted(together[c]), `seed=${seed} channel=${c} query=${s.query}`).toEqual(sorted(alone))
    })
  }

  it('N 個通道一起走訪＝各自單獨搜尋（含邊界向量）', () => {
    for (let seed = 1; seed <= 20; seed++) channelCase(seed * 31, 2 + (seed % 9))
  })

  it.fails('超過 31 個通道也能一起走訪', () => {
    channelCase(4242, 40)
  })
})

// 讓未使用的匯入不觸發警告（EPSILON 保留給之後的容忍比較）
void EPSILON
