/**
 * 以獨立的參考實作（test/fuzzy/reference/）仲裁正式實作。
 *
 * - refDistance：由定義直接寫成的加權編輯距離，不共用 fillRow。先確認它與 metric.distance 逐一相同，
 *   之後就能當作其他測試的仲裁者（其他測試過去都以 metric.distance 為準，與被測程式共用同一個 DP）。
 * - refMorph：窮舉 BCDP 分段模型的所有分析（docs/bcdp.md 第 1 節）。
 * - 正式實作曾經不符合定義的地方（bcdp.md 1.6）先以 it.fails 寫成「應該怎樣」，修正後改回 it，
 *   留作回歸測試。
 */

import { describe, expect, it } from 'vitest'
import { createAnalyzer, createMorphSearch, EPSILON, FuzzyIndex, REDUPLICATION_PATTERNS, roundCost, RuleSet, WeightedEditDistance } from '../../src/fuzzy/index.js'
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
    // 一至兩種重疊型式（可能相同，createAnalyzer 照單全收；重複的型式也要與窮舉一致）
    reduplication: random() < 0.8 ? Array.from({ length: 1 + Math.floor(random() * 2) }, () => ({ pattern: pick(random, [...REDUPLICATION_PATTERNS]) })) : [],
    alternations: random() < 0.7 ? [{ underlying: 't', surface: 'd', before: random() < 0.5 ? ['an'] : undefined }] : [],
  }
  const analyzer = createAnalyzer(spec)
  // 詞根多半是 CV(C)CV(C) 形狀，讓兩音節的重疊型式（CVCV、CVCVC）有機會適用
  const syllable = () => pick(random, consonants) + pick(random, vowels) + (random() < 0.3 ? pick(random, consonants) : '')
  const roots = [
    ...new Set(
      Array.from({ length: 14 }, () =>
        random() < 0.6 ? syllable() + syllable() : randomString(random, consonants, 1, 1) + randomString(random, alphabet, 1, 4),
      ),
    ),
  ]
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
  } else if (spec.reduplication.length && random() < 0.35) {
    w = (analyzer.reduplicant(pick(random, spec.reduplication).pattern, w) ?? '') + w
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
  /** reaching check（preparing-tests）：隨機測試中，每種非串接步驟與重疊型式都要真的出現在命中裡 @type {Map<string, number>} */
  const reached = new Map()
  it.each([1, 2, 3, 4, 5, 6])('種子 %i：morphSearch 的每個命中與成本都等於窮舉（沒有截斷的查詢）', (seed) => {
    const random = createRandom(seed * 104729)
    let compared = 0
    for (let round = 0; round < 12; round++) {
      const setup = randomMorphSetup(random)
      const { metric, spec, analyzer, roots } = setup
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const search = createMorphSearch({ analyzer, metric, index })
      const ctx = refContext(metric)
      for (let k = 0; k < 8; k++) {
        const query = derive(random, setup)
        const prepared = search.prepare(query)
        // 還原變體超過上限時會被截斷（prepared.truncated），那時不保證與窮舉相同
        if (prepared?.truncated) continue
        const maxDistance = pick(random, [0.8, 1, 1.2])
        const hits = search.search(query, { maxDistance })
        for (const h of hits) for (const s of h.steps) if (s.type !== 'prefix' && s.type !== 'suffix') reached.set(s.pattern ?? s.type, (reached.get(s.pattern ?? s.type) ?? 0) + 1)
        const got = new Map(hits.map((h) => [h.term, h.distance]))
        /** @type {Map<string, string>} */
        const why = new Map()
        const want = refMorph(ctx, { query, lexicon: roots, spec, maxDistance, reduplicant: analyzer.reduplicant, why })
        const terms = new Set([...got.keys(), ...want.keys()])
        for (const t of terms) {
          const detail = `seed=${seed} round=${round} query=${query} term=${t}；參考：${why.get(t) ?? '—'}；規格：${JSON.stringify({ prefixes: spec.prefixes.map((a) => a.form), suffixes: spec.suffixes.map((a) => a.form), infixes: spec.infixes.map((a) => a.form), red: spec.reduplication.map((r) => r.pattern), alt: spec.alternations, rules: metric.ruleSet.expand().map((r) => `${r.source}>${r.target}:${r.position}`) })}`
          expect(got.get(t) ?? Infinity, detail).toBeCloseTo(want.get(t) ?? Infinity, 7)
        }
        compared++
      }
    }
    expect(compared).toBeGreaterThan(60)
  })

  it('reaching check：上面的隨機測試涵蓋每種重疊型式、中綴與交替', () => {
    for (const kind of [...REDUPLICATION_PATTERNS, 'infix', 'alternation']) expect(reached.get(kind) ?? 0, `${kind}：${JSON.stringify([...reached])}`).toBeGreaterThanOrEqual(3)
  })
})

describe('explain：實驗室用的說明與搜尋結果一致', () => {
  it.each([1, 2, 3])('種子 %i：explain(q, t).hit 等於 search 對 t 的命中；找不到時有原因；計價格網的最佳格等於命中的成本', (seed) => {
    const random = createRandom(seed * 7717)
    let explained = 0
    let found = 0
    for (let round = 0; round < 8; round++) {
      const setup = randomMorphSetup(random)
      const { metric, analyzer, roots } = setup
      const index = new FuzzyIndex(metric).addAll(roots.map((w) => [w, w]))
      const search = createMorphSearch({ analyzer, metric, index })
      for (let k = 0; k < 6; k++) {
        const query = derive(random, setup)
        const maxDistance = pick(random, [0.8, 1, 1.2])
        const hits = search.search(query, { maxDistance })
        for (const term of roots) {
          const e = /** @type {any} */ (search.explain(query, term, { maxDistance }))
          explained++
          expect(structuredClone(e)).toEqual(e) // 可以從 Web Worker 傳回
          if (e.tooShort) continue
          expect(e.hits).toEqual(hits)
          const want = hits.find((h) => h.term === term) ?? null
          expect(e.hit, `${query} → ${term}`).toEqual(want)
          if (want) {
            found++
            expect(e.reason).toBeNull()
            const best = Math.min(...e.pricing.filter((p) => p.best).map((p) => p.best.total))
            expect(best).toBeCloseTo(want.distance, 9)
          } else {
            expect(e.reason, `${query} → ${term}`).toMatch(/^(same|short|notCandidate|lambda|bound|spread)$/)
          }
        }
      }
    }
    expect(explained).toBeGreaterThan(300)
    expect(found).toBeGreaterThan(20)
  })

  it('explainChars 與 explain 相同；帶邊界向量時第 0 列就是 start', () => {
    const metric = new WeightedEditDistance({ rules: new RuleSet().add('au', 'o', 0.1), normalize: (s) => s })
    expect(metric.explainChars(Array.from('dox'), Array.from('daux'))).toEqual(metric.explain('dox', 'daux'))
    const x = Array.from('minudox')
    const start = [0, Infinity, Infinity, Infinity, 0.3, Infinity, Infinity, Infinity]
    const e = metric.explainChars(x, Array.from('daux'), { start, extraInitial: start.map((c) => c < Infinity) })
    expect(e.matrix[4][0]).toBeCloseTo(0.3, 9)
    expect(e.matrix[7][4]).toBeCloseTo(0.4, 9) // 0.3（前綴鏈）＋ 0.1（dox ≈ daux）
  })
})

describe('固定案例：bcdp.md 1.6 修正過的項目與 1.7 的語意', () => {
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

  it('多詞查詢：構詞不跨越詞邊界（前綴與詞幹之間不能是空白），也不因重新正規化而截掉空白', () => {
    // 「mu daux」是兩個詞：不能分析成 mu- ＋ 詞幹 " daux"（交界在空白旁），也不能把「mu 」當成前綴。
    // 改動前：計價時把 " daux" 重新正規化成 "daux"，得到錯誤的 0.3
    const { got, want } = compare(fixed({ affixDistance: 0.2 }, new RuleSet(), collapse), ['daux'], 'mu daux')
    expect(want.has('daux')).toBe(false)
    expect(got.has('daux')).toBe(false)
    // 同一個詞之內照常：mudaux → mu- ＋ daux
    expect(compare(fixed({}, new RuleSet(), collapse), ['daux'], 'mudaux').got.get('daux')).toBeCloseTo(0.3, 9)
  })

  it('多詞查詢：詞幹本身可以含空白（複合詞），交界不在空白旁即可', () => {
    const { got, want } = compare(fixed({}, new RuleSet(), collapse), ['kan dalum'], 'mukan dalum')
    expect(want.get('kan dalum')).toBeCloseTo(0.3, 9)
    expect(got.get('kan dalum')).toBeCloseTo(0.3, 9)
  })

  it('多詞查詢：詞綴不能包含空白', () => {
    // 查詢 "dauxan an"：唯一合法的分析是詞幹 "dauxan "（刪空白 0.1）＋ -an；"n an" 不能被當成一個後綴
    const { got, want } = compare(fixed({ suffixes: [{ form: 'an' }, { form: 'nan' }], affixDistance: 0.2 }, new RuleSet(), collapse), ['dauxa'], 'dauxan an')
    expect(got.get('dauxa') ?? Infinity).toBeCloseTo(want.get('dauxa') ?? Infinity, 9)
  })

  it('非 BMP 字元：計價以 code point 切片', () => {
    const { got, want } = compare(fixed(), ['b𝔞d'], 'mub𝔞d')
    expect(want.get('b𝔞d')).toBeCloseTo(0.3, 9)
    expect(got.get('b𝔞d')).toBeCloseTo(0.3, 9)
  })

  it('詞幹交替：後面的後綴鏈可以有 maxSteps ＋ 1 個（第一個在 before 中，其後至多 maxSteps 個）', () => {
    // maxSteps = 1：badani ＝ bat ＋ 交替 t>d ＋ -an ＋ -i
    const setup = fixed({ maxSteps: 1, suffixes: [{ form: 'an' }, { form: 'i' }], alternations: [{ underlying: 't', surface: 'd', before: ['an'] }] })
    const { got, want } = compare(setup, ['bat'], 'badani')
    expect(want.get('bat')).toBeCloseTo(0.9, 9)
    expect(got.get('bat')).toBeCloseTo(0.9, 9)
  })

  it('詞幹交替的說明：交替後面的第一個後綴必須在 before 清單中', () => {
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

  it('詞幹長度差剛好等於上界、成本剛好等於 λ 的切法也要計價', () => {
    // x 的脫落每個 0.1，λ ＝ 0.3：詞幹 daxxxux 比詞根 daux 長 3，距離正好 0.3
    const setup = fixed({ lemmaDistance: 0.3 }, new RuleSet().add('x', '', 0.1))
    const { got, want } = compare(setup, ['daux'], 'mudaxxxux')
    expect(want.get('daux')).toBeCloseTo(0.6, 9)
    expect(got.get('daux')).toBeCloseTo(0.6, 9)
  })

  it('還原變體超過 16 個時不截斷（上限 64）', () => {
    // 20 種交替（底層字元不同、表面都是 d）：第 20 種才能還原出 baz
    const letters = ['b', 'c', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'p', 'q', 'r', 's', 'v', 'w', 'x', 'y', 'o', 'e', 'z']
    const setup = fixed({ alternations: letters.map((u) => ({ underlying: u, surface: 'd' })) })
    const { got, want } = compare(setup, ['baz'], 'badan')
    expect(want.get('baz')).toBeCloseTo(0.6, 9) // 交替 0.3 ＋ -an 0.3
    expect(got.get('baz')).toBeCloseTo(0.6, 9)
  })

  it('重疊部分可以超過 4 個字元（Ca：首輔音群 4 個字元＋a）', () => {
    const setup = fixed({ reduplication: [{ pattern: 'Ca' }] })
    const { got, want } = compare(setup, ['bdknaku'], 'bdknabdknaku')
    expect(want.get('bdknaku')).toBeCloseTo(0.3, 9)
    expect(got.get('bdknaku')).toBeCloseTo(0.3, 9)
  })

  // 各重疊型式各一例。查詢都是公開資料集中的詞，型式的歸類依 Li & Tsuchida (2001) p. 22、
  // Lim & Zeitoun (2024) §51.3.2.2（見 bcdp.md 1.7）
  it.each(/** @type {Array<[string, string, string, number]>} */ ([
    ['Ca', 'dius', 'dadius', 0.3],
    ['CV', 'kiliw', 'kikiliw', 0.3],
    ['CVV', 'depex', 'deedepex', 0.3],
    ['CVV', 'kita', 'kiikita', 0.3],
    ['CVCV', 'lubahing', 'lubalubahing', 0.3],
    ['CVCV', 'kudung', 'maakudukudung', 0.6], // 巴宰語：兩音節去韻尾（maa- ＋ 重疊）
    ['CVCVC', 'kudung', 'maakudungkudung', 0.6], // 噶哈巫語：兩音節含韻尾
    ['full', 'saw', 'sawsaw', 0.3], // 單音節詞根的完整重疊
  ]))('重疊型式 %s：%s ← %s', (pattern, stem, query, cost) => {
    const setup = fixed({ vowels: 'aeiu', prefixes: [{ form: 'mu' }, { form: 'maa' }], suffixes: [{ form: 'an' }, { form: 'i' }], reduplication: [{ pattern }] })
    const { got, want } = compare(setup, [stem], query)
    expect(want.get(stem)).toBeCloseTo(cost, 9)
    expect(got.get(stem)).toBeCloseTo(cost, 9)
  })

  it('重疊複製查詢（方言）的形式：重疊部分跟著查詢，詞幹再以方言規則對應', () => {
    // kipu~kipud-i：詞根 kiput 在 -i 前濁化。只用 CVCV 與方言規則 t↔d（0.1）時，
    // 重疊部分 kipu 由查詢的詞幹 kipud 產生，kipud 再以 0.1 對應到 kiput：0.3 ＋ 0.1 ＋ 0.3
    const setup = fixed({ suffixes: [{ form: 'i' }], reduplication: [{ pattern: 'CVCV' }] }, new RuleSet().add('t', 'd', 0.1))
    const { got, want } = compare(setup, ['kiput'], 'kipukipudi')
    expect(want.get('kiput')).toBeCloseTo(0.7, 9)
    expect(got.get('kiput')).toBeCloseTo(0.7, 9)
  })

  it('重疊的模板只套用在詞幹上，不含後綴', () => {
    // kanakanan：若把模板套用在「詞幹＋後綴」kanan 上，CVCV 得到 kana，會誤分析成 kana~kan-an。
    // 詞幹 kan 只有一個音節，CVCV 不適用，所以不是 kan 的重疊
    const setup = fixed({ reduplication: [{ pattern: 'CVCV' }] })
    const { got, want } = compare(setup, ['kan'], 'kanakanan')
    expect(want.has('kan')).toBe(false)
    expect(got.has('kan')).toBe(false)
    // 同一個查詢、兩音節的詞幹 kana：kana~kana-n 不成立（沒有 -n），kana~kanan 成立
    expect(compare(setup, ['kanan'], 'kanakanan').got.get('kanan')).toBeCloseTo(0.3, 9)
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

  it('超過 31 個通道也能一起走訪', () => {
    channelCase(4242, 40)
  })
})

// 讓未使用的匯入不觸發警告（EPSILON 保留給之後的容忍比較）
void EPSILON
